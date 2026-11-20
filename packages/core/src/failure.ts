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
 * - A nested `parse()` snapshots the outer watermark and restores it
 *   when the nested call finishes, including when it throws. The nested
 *   failure is materialized before restoration, so both parses retain
 *   their own diagnostics. Direct calls on another input still reset the
 *   watermark; use `parse()` to isolate reentrant parsing.
 * - Generated-code evaluation in `packages/{cli,generator,parser}`'s
 *   specs and `packages/parser/bench/`
 *   binds one shared module instance of this file per process, so it is
 *   correct by construction there. A consumer that somehow bundles two
 *   separate copies of `tpeg-core` gets two independent watermarks --
 *   diagnostics degrade (each half only sees its own failures), parses do
 *   not.
 */

import type { ParseError, ParseFailure } from "./types";
import { escapeControlCharsForDisplay } from "./escape";
import { cloneParseError, getCharAt, isValidOffset } from "./utils";

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
  /** A concrete failure without explicit expectations. Its message is
   * used for aggregation, while `label` identifies duplicate records.
   * Control flags remain independent of the diagnostic watermark. */
  readonly diagnostic?: ParseError;
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
      e === exp ||
      (e.label === exp.label &&
        e.parserName === exp.parserName &&
        (e.diagnostic === undefined) === (exp.diagnostic === undefined)),
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
  // An out-of-contract `pos` must not enter the watermark: `Infinity`
  // satisfies `pos > watermarkPos` unconditionally and would pin the
  // farthest-failure position to `Infinity` for the rest of this input's
  // parse; `NaN` compares false everywhere but still lands in
  // `watermarkPos` on a fresh input; `pos > input.length` produces an
  // error offset no formatter can map back to a source location
  // (`validateParseError` in `./error.ts` rejects `pos >= 0` violations).
  // The call still fails -- `FAIL` is returned regardless -- only the
  // diagnostic record is skipped. `pos === input.length` is a legitimate
  // "end of input" record and is kept.
  if (!isValidOffset(pos) || pos > input.length) {
    return FAIL;
  }

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
  const labels: string[] = [];
  let diagnostics: ParseError[] | undefined;
  for (const expectation of watermarkExpected) {
    if (expectation.diagnostic) {
      (diagnostics ??= []).push(expectation.diagnostic);
    } else {
      labels.push(expectation.label);
    }
  }
  const expected: string | string[] | undefined =
    labels.length === 0 ? undefined : labels.length === 1 ? labels[0] : labels;
  const found =
    watermarkInput !== null
      ? getCharAt(watermarkInput, pos) || "end of input"
      : undefined;
  const expectedMessage =
    expected !== undefined
      ? `Expected ${Array.isArray(expected) ? expected.join(" or ") : expected}${
          found !== undefined
            ? `, found "${escapeControlCharsForDisplay(found)}"`
            : ""
        }`
      : "Parse failed";
  const message = diagnostics
    ? [
        ...(expected !== undefined ? [expectedMessage] : []),
        ...diagnostics.map((diagnostic) => diagnostic.message).filter(Boolean),
      ].join(" or ") || "Parse failed"
    : expectedMessage;

  // `parserName` is only attributable when every expectation tied at the
  // farthest position agrees on it -- e.g. a single leaf parser failing
  // alone (the common case this preserves: a custom name passed to
  // `literal`/`anyChar`/`andPredicate`/`notPredicate` still shows up).
  // Several DIFFERENT leaves tying at the same farthest offset (the
  // aggregated-choice case) have no single owner, so it's omitted rather
  // than arbitrarily picking one -- matching the spirit of "expected" also
  // being a merged list, not one candidate's alone, in that situation.
  const candidateName = watermarkExpected[0]?.parserName;
  const parserName = watermarkExpected.every(
    (e) => e.parserName === candidateName,
  )
    ? candidateName
    : undefined;

  // A unique custom diagnostic can retain its context and metadata.
  // Tied independent custom failures have no single metadata owner.
  const custom = diagnostics?.length === 1 ? diagnostics[0] : undefined;
  const error: ParseError = {
    ...(custom ? cloneParseError(custom) : {}),
    message,
    pos,
    ...(expected !== undefined ? { expected } : {}),
    ...(found !== undefined && custom?.found === undefined ? { found } : {}),
    ...(parserName !== undefined ? { parserName } : {}),
    ...(fatal ? { fatal: true } : {}),
  };
  if (expected === undefined) delete error.expected;
  if (parserName === undefined) delete error.parserName;
  if (!fatal) delete error.fatal;
  delete error.abort;
  if (Array.isArray(error.context)) error.context = [...error.context];
  return error;
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
 * Checks whether a committed failure or resource abort prevents backtracking.
 * Identity comparisons against the two singletons run FIRST, so this never
 * triggers `error`'s lazy getter on the hot path -- only a non-singleton
 * failure (from a hand-written parser, or one of this module's own
 * "internal invariant violation" `ParseError`s that deliberately stay
 * concrete -- see `./combinators.ts`'s `Parser at index ... is undefined`)
 * needs to read its control flags.
 */
export const isFatalFailure = (result: ParseFailure): boolean => {
  if (result === FAIL_FATAL) return true;
  if (result === FAIL) return false;
  const error = result.error;
  return error.fatal === true || error.abort === true;
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

const EMPTY_WATERMARK_SNAPSHOT: FailureWatermarkSnapshot = Object.freeze({
  input: null,
  pos: -1,
  expected: Object.freeze([]),
});

export const snapshotFailureWatermark = (): FailureWatermarkSnapshot =>
  watermarkInput === null &&
  watermarkPos === -1 &&
  watermarkExpected.length === 0
    ? EMPTY_WATERMARK_SNAPSHOT
    : {
        input: watermarkInput,
        pos: watermarkPos,
        expected: watermarkExpected,
      };

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
 * while collecting a parser's failures in isolation -- using the exact same
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
 */
export const mergeFailureWatermark = (
  input: string,
  pos: number,
  expected: readonly Expectation[],
): void => {
  if (expected.length === 0) return;
  // Same out-of-contract-`pos` defense as `fail` above: a replayed
  // snapshot position that is somehow invalid (e.g. produced by a
  // hand-written parser bypassing the leaf guards) must not pin the
  // watermark to `Infinity`/`NaN`/past-EOF.
  if (!isValidOffset(pos) || pos > input.length) return;
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

/**
 * Relabels an already-recorded watermark expectation matching `input`/
 * `pos` and `label` to a new `parserName`, IN PLACE -- unlike calling
 * `fail()` again with the same `label` but a different `parserName`,
 * which `expectationSeen` deliberately treats as a second, independent
 * expectation (see its doc comment: that's correct for two genuinely
 * different named parsers that happen to expect the same label text, and
 * `failure.spec.ts` pins exactly that case).
 *
 * `@suzumiyaaoba/tpeg-combinator`'s `withDetailedError` (`named`/`token`/
 * etc.) is a DIFFERENT case: it relabels a failure that already recorded
 * ITSELF via `fail()` at its point of origin -- the exact same underlying
 * failure event, not a second one. Without a way to update that entry in
 * place, `withDetailedError` had to return a plain object carrying the
 * new `parserName` (no longer the `FAIL` singleton, since a per-call
 * decoration can't be baked into a shared singleton), which made
 * `choice`'s `tryOrderedCandidates` (`./combinators.ts`) treat it as an
 * unrecorded, freshly-built `ParseError` (indistinguishable, from there,
 * from a hand-written parser's own `createFailure` call) and re-forward
 * it into the watermark as an ADDITIONAL entry -- same label, new
 * `parserName`. That doubled the resulting message ("Expected X or X")
 * and, since `materializeParseError` only reports a `parserName` when
 * every tied expectation agrees on one, silently dropped it entirely.
 *
 * A no-op if `input`/`pos` no longer match the current watermark (this
 * failure is no longer the farthest one recorded, so there is nothing
 * live to rename) or no entry has a matching `label`.
 *
 * When several tied entries share `label` (they differ in `parserName`,
 * per `expectationSeen`), only the LAST one is renamed: the entry a
 * just-run parser contributed is the most recently appended one with
 * that label, while earlier same-label entries belong to previously
 * recorded (possibly already-renamed) expectations and must keep their
 * own attribution. Renaming every match would let a later
 * `withDetailedError` call silently retitle a sibling alternative's
 * expectation to its own name.
 */
export const renameWatermarkExpectation = (
  input: string,
  pos: number,
  label: string,
  parserName: string,
): void => {
  if (input !== watermarkInput || pos !== watermarkPos) return;
  let last = -1;
  for (let i = watermarkExpected.length - 1; i >= 0; i--) {
    if (watermarkExpected[i]?.label === label) {
      last = i;
      break;
    }
  }
  if (last === -1) return;
  watermarkExpected = watermarkExpected.map((e, i) =>
    i === last ? { ...e, parserName } : e,
  );
};

/**
 * Retitles, to `parserName`, exactly the watermark entries recorded
 * AFTER `snapshot` was taken -- the precise set of expectations the
 * just-finished call contributed. This is a strictly narrower targeting
 * than {@link renameWatermarkExpectation}, which matches by label text
 * and therefore also retitles entries other parsers recorded earlier
 * that merely share the label -- or, when the wrapped parser's own
 * failure was recorded at a NEARER position than the current farthest
 * one (so `fail()` ignored it entirely), retitles an unrelated parser's
 * expectation wholesale (`Expected "b"` attributed to a wrapper that
 * never expected `"b"`).
 *
 * The "new" boundary is positional: if this call advanced the farthest
 * position, `fail()` replaced `watermarkExpected` wholesale, so every
 * current entry is new; if it merely tied at the same position, entries
 * appended past `snapshot.expected.length` are the new ones (entries
 * are only ever appended, never removed, at an unchanged position). If
 * the watermark somehow sits at an EARLIER position than the snapshot
 * (an internal `restoreFailureWatermark` rolled it back), nothing can
 * be attributed reliably and this is a no-op.
 *
 * `@suzumiyaaoba/tpeg-combinator`'s `withDetailedError` pairs this with
 * {@link snapshotFailureWatermark} taken immediately before running its
 * wrapped parser -- see its source for the call pattern. Optional
 * `details` also update custom diagnostics contributed by that call, so
 * an enclosing choice does not discard the wrapper's found/context.
 * Diagnostic objects and context arrays are copied before updating them
 * to preserve earlier snapshots, including memoized contributions.
 */
export const renameWatermarkExpectationsSince = (
  input: string,
  snapshot: FailureWatermarkSnapshot,
  parserName: string,
  details?: Readonly<Pick<ParseError, "found" | "context">>,
): void => {
  if (input !== watermarkInput) return;
  const firstNew =
    watermarkPos > snapshot.pos
      ? 0
      : watermarkPos === snapshot.pos
        ? snapshot.expected.length
        : watermarkExpected.length;
  if (firstNew >= watermarkExpected.length) return;
  const found = details?.found;
  const context = details?.context;
  watermarkExpected = watermarkExpected.map((e, i) => {
    if (i < firstNew) return e;
    if (e.diagnostic && (found !== undefined || context !== undefined)) {
      const diagnostic = cloneParseError(e.diagnostic);
      if (found !== undefined) diagnostic.found = found;
      if (context !== undefined) {
        diagnostic.context = Array.isArray(context) ? [...context] : context;
      }
      return { ...e, parserName, diagnostic };
    }
    return { ...e, parserName };
  });
};
