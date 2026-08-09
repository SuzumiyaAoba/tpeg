/**
 * Failure as control flow (Ford, "Parsing Expression Grammars", POPL 2004;
 * "Packrat Parsing", ICFP 2002). In PEG semantics, a failed match is not an
 * exceptional event carrying a payload -- `e?`, `e*`, `!e` are *defined* in
 * terms of it, and the overwhelming majority of failures a real parse
 * produces are immediately discarded: `zeroOrMore`/`oneOrMore` (see
 * `./repetition.ts`) terminate BY failure, `notPredicate` (see
 * `./lookahead.ts`) succeeds BY failure, `optional`/`withDefault` swallow
 * one. Yet `createFailure` (`./utils.ts`) has always allocated two objects
 * and an already-interpolated diagnostic string on every failing call,
 * whether or not anyone will ever read it.
 *
 * This module separates the two concerns LPeg and PEGTL both separate:
 * - Control flow: `FAIL`/`FAIL_FATAL`, two frozen singletons a hot-path
 *   caller can return with zero allocation and compare with `===`.
 * - Diagnostics: a single, module-global "farthest failure so far"
 *   watermark (position + the expectations seen there), which a
 *   `ParseFailure`'s `error` getter materializes into a real `ParseError`
 *   lazily, ONLY when something actually reads `.error`.
 *
 * ## Why a global watermark strictly improves on the old per-call one
 *
 * Before this module, farthest-failure tracking lived inside
 * `tryOrderedCandidates` (`./combinators.ts`), scoped to a single `choice`/
 * `predictiveChoice` call: it could only compare the alternatives of ONE
 * choice against each other, never against a failure from a sibling rule
 * that got farther. A single watermark for the whole in-progress parse
 * dominates that: it always knows the true farthest position across every
 * attempted branch, not just the branches of whichever `choice` happens to
 * be aggregating right now. What's lost is the old per-choice nested
 * "None of the parsers matched. Expected one of: ..." message chain --
 * replaced by one uniform top-level message built from the watermark.
 *
 * ## Lifecycle: diagnostics-only, never correctness-affecting
 *
 * The watermark can only ever make an error MESSAGE worse (report a less
 * precise position/expectation) -- it can never change whether a parse
 * succeeds, what value it produces, or where it stops. That single
 * invariant is what makes every lifecycle question below tractable:
 *
 * - A direct `Parser<T>` call that doesn't go through `parse()`
 *   (`./utils.ts`) inherits whatever a previous, unrelated parse left in
 *   the watermark until its own first leaf failure resets it (via the
 *   `input !== watermarkInput` identity check below, the same pattern
 *   `packages/combinator/src/logic.ts`'s `commitAtTopLevel` already uses
 *   for its own, unrelated watermark). Reporting can only be "too far",
 *   never "too near" or wrong about success/failure.
 * - A nested/reentrant top-level parse (a different `input`) resets the
 *   watermark out from under an in-progress outer parse; when the outer
 *   parse resumes, its own next failure resets it back. The outer parse
 *   loses whatever expectations it had accumulated before the nesting --
 *   a quality regression in that one diagnostic, nothing else.
 * - Code compiled via `new Function(...)` (the pattern used throughout
 *   `packages/{cli,generator,parser}`'s specs and `packages/parser/bench/`)
 *   binds one shared module instance of this file per process, so it is
 *   correct by construction there. A consumer that somehow bundles two
 *   separate copies of `tpeg-core` gets two independent watermarks --
 *   diagnostics degrade (each half only sees its own failures), parses do
 *   not.
 */

import type { ParseError, ParseFailure } from "./types";
import { getCharAt } from "./utils";

/**
 * A leaf parser's static description of what it was looking for --
 * allocated exactly ONCE, at parser *construction* time (e.g. once per
 * `literal("foo")` or `charClass(...)` call, not once per attempted
 * match), then merely referenced by every failing call that parser makes.
 * Object identity is what lets the watermark de-duplicate repeated
 * failures from the same parser instance at the same position (e.g. a
 * `charClass` retried at an unchanged offset across backtracking) without
 * a string-equality scan.
 */
export interface Expectation {
  readonly label: string;
  /**
   * Optional, mirrors the old per-call `parserName` argument (e.g.
   * `literal(str, "keyword parser")`) that many leaf parsers accept for
   * debugging. Carried on the `Expectation` (fixed at construction, like
   * `label`) rather than looked up separately so a materialized error's
   * `parserName` can still identify a custom-named parser -- but only
   * when unambiguous, see `materializeParseError` below.
   */
  readonly parserName?: string;
}

let watermarkInput: string | null = null;
let watermarkPos = -1;
// Replaced wholesale, never mutated in place -- see `snapshotFailureWatermark`
// below for why an in-place `.push` would silently corrupt an earlier snapshot
// that captured the same array reference.
let watermarkExpected: readonly Expectation[] = [];

/**
 * `true` iff `expected` already contains an `Expectation` equivalent to
 * `exp` -- either the exact same object (the common case: every leaf
 * parser allocates its `Expectation` once at construction time and
 * reuses that same instance on every failing call, so a `charClass`
 * retried at an unchanged offset across backtracking hits this via plain
 * `===`) or, failing that, one with the same `label`/`parserName` pair.
 * The fallback matters because not every caller can reuse a single
 * instance: `tryOrderedCandidates` (`./combinators.ts`) forwards a
 * concrete (non-singleton) child failure's expectation(s) into the
 * watermark by building a fresh `{ label, ... }` object on every call --
 * a value-only comparison is what keeps that path from making `expected`
 * grow without bound across repeated failures at the same position (e.g.
 * a memoized rule whose failure is reported via forwarding, once per
 * outer retry).
 */
const expectationSeen = (
  expected: readonly Expectation[],
  exp: Expectation,
): boolean =>
  expected.some(
    (e) =>
      e === exp || (e.label === exp.label && e.parserName === exp.parserName),
  );

/**
 * Records a control-flow failure at `pos` with expectation `exp`, updating
 * the shared farthest-failure watermark, and returns the zero-allocation
 * `FAIL` singleton. This is the one function every leaf parser (`literal`,
 * `charClass`, `negatedCharClass`, `anyChar`, `regexFused`) and
 * `predictiveChoice`'s "no candidate survived filtering" case call on
 * their failing path.
 *
 * `pos < watermarkPos` (a failure at an earlier position than the current
 * farthest one) intentionally changes nothing: an earlier, less-far
 * failure carries no new information the watermark doesn't already have.
 */
export const fail = (
  input: string,
  pos: number,
  exp: Expectation,
): ParseFailure => {
  if (input !== watermarkInput) {
    watermarkInput = input;
    watermarkPos = pos;
    watermarkExpected = [exp];
  } else if (pos > watermarkPos) {
    watermarkPos = pos;
    watermarkExpected = [exp];
  } else if (pos === watermarkPos && !expectationSeen(watermarkExpected, exp)) {
    watermarkExpected = [...watermarkExpected, exp];
  }
  return FAIL;
};

/**
 * Builds a real `ParseError` from the watermark's current state. Called
 * lazily, from the `error` accessor defined on `FAIL`/`FAIL_FATAL` below --
 * never eagerly, so a discarded failure (the common case) never pays for
 * this.
 */
export const materializeParseError = (fatal: boolean): ParseError => {
  const pos = watermarkPos;
  const labels = watermarkExpected.map((e) => e.label);
  const expected: string | string[] | undefined =
    labels.length === 0 ? undefined : labels.length === 1 ? labels[0] : labels;
  const found =
    watermarkInput !== null
      ? getCharAt(watermarkInput, pos) || "end of input"
      : undefined;
  const message =
    expected !== undefined
      ? `Expected ${Array.isArray(expected) ? expected.join(" or ") : expected}${
          found !== undefined ? `, found "${found}"` : ""
        }`
      : "Parse failed";

  // `parserName` is only attributable when every expectation tied at the
  // farthest position agrees on it -- e.g. a single leaf parser failing
  // alone (the common case this preserves: a custom name passed to
  // `literal`/`anyChar`/`andPredicate`/`notPredicate` still shows up).
  // Several DIFFERENT leaves tying at the same farthest offset (the
  // aggregated-choice case) have no single owner, so it's omitted rather
  // than arbitrarily picking one -- matching the spirit of "expected" also
  // being a merged list, not one candidate's alone, in that situation.
  const parserNames = new Set(
    watermarkExpected.map((e) => e.parserName).filter((n) => n !== undefined),
  );
  const parserName = parserNames.size === 1 ? [...parserNames][0] : undefined;

  return {
    message,
    pos,
    ...(expected !== undefined ? { expected } : {}),
    ...(found !== undefined ? { found } : {}),
    ...(parserName !== undefined ? { parserName } : {}),
    ...(fatal ? { fatal: true } : {}),
  };
};

const createFailureSingleton = (fatal: boolean): ParseFailure => {
  const obj = { success: false as const };
  // `defineProperty` MUST run before `freeze`: an accessor property can be
  // added to a plain object at any time, but `Object.freeze` makes the
  // object's own property set immutable (no new properties, no
  // reconfiguring existing ones) -- it does NOT stop an already-defined
  // getter from running and returning a fresh value on every read, which
  // is exactly what's needed here (freeze the identity/shape, not the
  // getter's output).
  Object.defineProperty(obj, "error", {
    get: () => materializeParseError(fatal),
    enumerable: true,
    configurable: false,
  });
  return Object.freeze(obj) as ParseFailure;
};

/** The single non-fatal control-flow failure. Every leaf parser's failing
 * path, and every combinator that just relays a child failure unchanged,
 * returns this exact reference -- never a copy. */
export const FAIL: ParseFailure = createFailureSingleton(false);

/** The single fatal (cut/commit-marked) control-flow failure -- see
 * `commit`/`commitAtTopLevel` in `./combinators.ts` /
 * `@suzumiyaaoba/tpeg-combinator`. */
export const FAIL_FATAL: ParseFailure = createFailureSingleton(true);

/**
 * Checks whether `result` is a `fatal` (cut/commit-marked) failure.
 * Identity comparisons against the two singletons run FIRST, so this never
 * triggers `error`'s lazy getter on the hot path -- only a non-singleton
 * failure (from a hand-written parser, or one of this module's own
 * "internal invariant violation" `ParseError`s that deliberately stay
 * concrete -- see `./combinators.ts`'s `Parser at index ... is undefined`)
 * falls through to reading `.error.fatal` directly.
 */
export const isFatalFailure = (result: ParseFailure): boolean => {
  if (result === FAIL_FATAL) return true;
  if (result === FAIL) return false;
  return result.error.fatal === true;
};

/** Resets the farthest-failure watermark unconditionally. Called by
 * `parse()` (`./utils.ts`) at the start of a top-level parse; a direct
 * `Parser<T>` call that bypasses `parse()` instead relies on `fail`'s own
 * `input !== watermarkInput` identity check -- see this module's doc
 * comment on lifecycle. */
export const resetFailureWatermark = (): void => {
  watermarkInput = null;
  watermarkPos = -1;
  watermarkExpected = [];
};

/**
 * Opaque snapshot of the watermark's state, for `notPredicate`
 * (`./lookahead.ts`) to restore around a negative-lookahead probe -- see
 * that function for why ONLY `notPredicate` needs this (not `andPredicate`,
 * whose every failure is a genuine, non-discarded cause of the surrounding
 * parser's own failure). Safe to hold onto across a `fail()` call that
 * happens in between: `watermarkExpected` is always replaced wholesale,
 * never mutated in place, so an earlier snapshot's array reference is
 * never retroactively changed underneath it.
 */
export interface FailureWatermarkSnapshot {
  readonly input: string | null;
  readonly pos: number;
  readonly expected: readonly Expectation[];
}

export const snapshotFailureWatermark = (): FailureWatermarkSnapshot => ({
  input: watermarkInput,
  pos: watermarkPos,
  expected: watermarkExpected,
});

export const restoreFailureWatermark = (
  snapshot: FailureWatermarkSnapshot,
): void => {
  watermarkInput = snapshot.input;
  watermarkPos = snapshot.pos;
  watermarkExpected = snapshot.expected;
};

/**
 * Re-applies a previously-captured watermark contribution -- `pos`/
 * `expected` read back from a {@link FailureWatermarkSnapshot} taken
 * right after some parser call finished -- using the exact same
 * farther-wins/tie-unions/nearer-is-ignored rule {@link fail} applies for
 * a single `Expectation`. For `@suzumiyaaoba/tpeg-combinator`'s
 * `memoize`: a cache HIT returns a previously-computed `ParseResult`
 * without re-running the wrapped parser, so none of the leaf `fail()`
 * calls that originally produced that result run again -- without this,
 * the watermark would silently miss whatever that call would have
 * contributed. `memoize` snapshots the watermark right after each cache
 * MISS's real call and re-merges that snapshot here on every later HIT,
 * for both a cached success and a cached failure alike (a memoized
 * rule's own internal failure can still be the parse's overall farthest
 * one even where the rule as a whole went on to succeed via a later
 * alternative).
 *
 * A no-op when `expected` is empty (a cache entry from before this
 * rule's first `fail()` call anywhere, or one whose call never reached a
 * leaf failure at all) -- there is nothing to merge, and an empty list
 * must never be allowed to overwrite a real one the way a fresh
 * farther-position `fail()` legitimately would.
 *
 * ## Known imprecision (diagnostics-only, matches this module's own
 * documented lifecycle contract)
 *
 * The snapshot taken after a cache MISS reflects the watermark's state
 * as adjusted by whatever was already in it *at that particular call*.
 * If that call's own leaf failure was nearer than the watermark's
 * position at the time (so `fail()` left the watermark unchanged), that
 * nearer failure is invisible to this snapshot and can't be replayed on
 * a later hit even if the watermark has since moved to a position where
 * it WOULD be the new farthest. This can only make a later error message
 * less precise, never wrong about success/failure/stop-position -- the
 * same invariant this module's doc comment already establishes for the
 * watermark generally.
 */
export const mergeFailureWatermark = (
  input: string,
  pos: number,
  expected: readonly Expectation[],
): void => {
  if (expected.length === 0) return;
  if (input !== watermarkInput) {
    watermarkInput = input;
    watermarkPos = pos;
    watermarkExpected = [...expected];
    return;
  }
  if (pos > watermarkPos) {
    watermarkPos = pos;
    watermarkExpected = [...expected];
    return;
  }
  if (pos === watermarkPos) {
    const fresh = expected.filter(
      (exp) => !expectationSeen(watermarkExpected, exp),
    );
    if (fresh.length > 0) {
      watermarkExpected = [...watermarkExpected, ...fresh];
    }
  }
};
