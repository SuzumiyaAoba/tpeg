/**
 * FIRST-set computation for TPEG grammars: for an expression, the set of
 * characters a successful match could start with.
 *
 * This is the classic compiler-theory FIRST-set analysis (see e.g. Aho,
 * Sethi, Ullman), adapted for PEG's ordered choice and codegen's runtime
 * value representation. It's the static analysis `predictiveChoice`
 * (`packages/core/src/combinators.ts`) needs to skip alternatives that
 * provably cannot match at the current position, without running them.
 *
 * ## Representation: a closed Boolean algebra over code points
 *
 * A `FirstSet`'s concrete part is a `CharSet` (`./char-set.ts`): a
 * canonical sorted list of code-point intervals, closed under union,
 * intersection, complement, and difference. This replaced an earlier
 * `{ chars: Set<string>, ranges: CharRangeLiteral[] }` shape that was only
 * closed under union -- which is exactly why a negated character class
 * (`[^"]`) or a negative lookahead's subtraction (`!a b`) had nowhere to
 * go but `unknown`. Working over code points (not UTF-16 code units) also
 * means a surrogate-pair (astral) character is just another interval
 * endpoint, with no special-casing needed here (the lowering to UTF-16
 * code units happens once, at the runtime `FirstCharFilter` boundary in
 * `packages/core/src/combinators.ts`, since that's the only place that
 * actually needs code units -- it compares against `input[pos.offset]`).
 *
 * ## Soundness: always an over-approximation
 *
 * PEG choice is order-dependent and context-sensitive in general (an
 * `ActionExpression`'s code can't be statically analyzed at all), so this
 * module can only ever produce a *safe superset* of the characters an
 * expression might actually start with. The representation encodes that
 * directly: a `FirstSet` is either a concrete `{ set }` (every code point
 * in this set, and only code points in this set, may start a match) or
 * `{ unknown: true }` ("could not be determined -- assume it could start
 * with anything, including matching zero characters"). Never the reverse:
 * it is always safe to fall back to `unknown`, never safe to guess a
 * smaller set than the truth. `predictiveChoice` treats `unknown` as
 * "always attempt this alternative," so an `unknown` result can only cost
 * a skipped fast-path, never cause a valid parse to be missed.
 *
 * `firstSetOfExpression` itself computes only "if this expression
 * consumes at least one character, what could the first one be" --
 * deliberately independent of whether the expression as a whole might
 * also match *zero* characters (that's `isNullable`, a separate
 * function). A `Star`/`Optional`/`Quantified{0,..}` node's own FIRST set
 * is exactly its wrapped expression's FIRST set for this reason: nested
 * inside a `Sequence` (e.g. `"-"? [0-9]+`), `sequenceFirstSet` already
 * handles "this element might match zero characters" by also unioning in
 * the *next* element's FIRST set (via `isNullable`); folding "nullable ->
 * unknown" into `firstSetOfExpression` too would double up on that and
 * needlessly poison the whole sequence's FIRST set to `unknown`.
 *
 * Nullability instead matters at the top: a `Choice` alternative that is
 * itself (possibly) nullable can succeed by consuming nothing at all, so
 * no "next character" constrains whether it should be attempted --
 * callers computing a filter for `predictiveChoice` (codegen) MUST check
 * `isNullable` on the *whole* candidate alternative and treat a nullable
 * one as `unknown`/"always attempt", never using its `firstSetOfExpression`
 * result as a filter on its own. `predictiveFilterForExpression` below
 * does exactly this and is the intended entry point for that use case.
 *
 * `unknown` (from `firstSetOfExpression` itself) is now used only for the
 * genuinely unresolvable cases -- both `AnyChar` and negated character
 * classes are exact (⊤ and a real complement, respectively) since the
 * `CharSet` representation can express them:
 * - `QualifiedIdentifier` (a cross-module `module.rule` reference) --
 *   this module only sees one `GrammarDefinition`'s rules, so a
 *   cross-module reference's FIRST set is opaque here.
 * - An `Identifier` naming something that isn't a rule of this grammar --
 *   an externally-supplied parser reference, whose FIRST set this module
 *   simply has no way to see.
 *
 * ## Rule references: fixpoint, not one-shot recursion
 *
 * A naive recursive walk over `Identifier` references would infinite-loop
 * on any recursive grammar (e.g. `value = ... / array`, `array = "[" ...
 * value ...`). Instead, `computeFirstSets` runs the standard iterative
 * dataflow fixpoint: every rule starts at the empty set (the *least*
 * element -- "matches nothing yet known"), and each pass recomputes every
 * rule's FIRST set using the previous pass's results for `Identifier`
 * lookups, monotonically growing (`unknown` is sticky once set) until
 * nothing changes. This always terminates because the state per rule is
 * bounded (the grammar's own finite set of literal characters/ranges, or
 * `unknown`, a one-way flag).
 */

import { childExpressions } from "@suzumiyaaoba/tpeg-core";
import {
  type CharSet,
  EMPTY_SET,
  isDisjoint as charSetsDisjoint,
  complement,
  difference,
  fromChar,
  fromCodePointRange,
  union,
} from "./char-set";
import type {
  CharacterClass,
  Expression,
  GrammarDefinition,
  Sequence,
} from "./types";

/** A single grammar-source character range, as written in the AST
 * (`start`/`end` are 1-code-point JS strings, astral characters included
 * via surrogate pairs). Kept for callers that still want the
 * grammar-source shape; `FirstSet` itself is `CharSet`-based. */
export interface CharRangeLiteral {
  readonly start: string;
  readonly end: string;
}

/**
 * A statically-computed, always-safe-to-over-approximate set of
 * characters an expression's match could start with, as a `CharSet` (a
 * closed Boolean algebra over code points -- see module doc comment).
 *
 * `unknown: true` means "could not be determined -- treat as matching
 * anything" (see module doc comment); `set` is meaningless in that case
 * and callers should not read it.
 */
export interface FirstSet {
  readonly set: CharSet;
  readonly unknown: boolean;
}

const UNKNOWN_FIRST_SET: FirstSet = {
  set: EMPTY_SET,
  unknown: true,
};

/** The empty `FirstSet`: matches nothing yet known / nothing follows.
 * Exported for `regex-fusion.ts`'s top-level determinism check call
 * (nothing follows an entire fused subtree -- see its module doc
 * comment's "external tail is always empty" argument). */
export const EMPTY_FIRST_SET: FirstSet = {
  set: EMPTY_SET,
  unknown: false,
};

/** The top element for a *concrete* (non-`unknown`) FIRST set: matches
 * every code point. Used for `AnyChar` (`.`), which -- unlike `unknown`
 * -- is exact: there is no character `.` could match that isn't already
 * in this set, so representing it precisely costs nothing and is
 * strictly more informative to `firstSetsDisjoint`/`isDisjoint` than
 * `unknown` would be (an `unknown` alternative can never be proven
 * disjoint from anything; a `⊤` alternative correctly still can't be
 * either, but arrives there by the same `isDisjoint` logic as every other
 * concrete set, not a separate bail-out path). */
const ALL_FIRST_SET: FirstSet = {
  set: [{ lo: 0, hi: 0x10ffff }],
  unknown: false,
};

const singleCharFirstSet = (c: string): FirstSet => ({
  set: fromChar(c),
  unknown: false,
});

/**
 * Exported for `regex-fusion.ts`'s determinism check, which needs to fold
 * a `tail` `FirstSet` (what follows a fusable subtree, from an enclosing
 * call) backward through a `Sequence`'s elements the same nullable-aware
 * way `sequenceFirstSetFrom` does internally, but starting from a
 * caller-supplied base instead of always `EMPTY_FIRST_SET`.
 */
export const unionFirstSets = (a: FirstSet, b: FirstSet): FirstSet => {
  if (a.unknown || b.unknown) return UNKNOWN_FIRST_SET;
  if (a === EMPTY_FIRST_SET) return b;
  if (b === EMPTY_FIRST_SET) return a;
  return { set: union(a.set, b.set), unknown: false };
};

/**
 * `FIRST(b) \ ALWAYS_FIRST(a)`, the subtraction `sequenceFirstSet` applies
 * across a `!a` element on its way to a following `b` (see module doc
 * comment's negative-lookahead handling and `alwaysMatchesSet` below): if
 * a character is guaranteed to make `a` succeed, `!a` is guaranteed to
 * fail there, so that character can never start a match of `!a b`. `a`
 * being `unknown` never causes an unsound narrowing here, because
 * `alwaysMatchesSet` only returns a non-empty set for constructs it can
 * reason about exactly (see its doc comment) -- there is no `unknown`
 * input to this function to begin with.
 *
 * If `first.unknown`, the result stays `unknown`: subtracting a known set
 * from "could be anything" does NOT mean "could be anything except that
 * known set" -- `unknown` isn't a concrete ⊤ value for this purpose, it's
 * "we don't know," so no subtraction can safely narrow it.
 */
const differenceFirstSet = (first: FirstSet, subtrahend: CharSet): FirstSet => {
  if (first.unknown) return first;
  return { set: difference(first.set, subtrahend), unknown: false };
};

const charClassFirstSet = (expr: CharacterClass): FirstSet => {
  let raw: CharSet = EMPTY_SET;
  for (const r of expr.ranges) {
    raw = union(
      raw,
      r.end === undefined
        ? fromChar(r.start)
        : fromCodePointRange(r.start, r.end),
    );
  }
  return { set: expr.negated ? complement(raw) : raw, unknown: false };
};

/**
 * A sound *lower bound* on the characters guaranteed to make `expr`
 * succeed at a position, used only to subtract from a following element's
 * FIRST set across a negative lookahead (`!a b` -- see
 * `sequenceFirstSet`). Deliberately conservative: exact only for a
 * `CharacterClass` (any code point in its set makes it succeed, by
 * definition) and a single-character `StringLiteral` (that one character
 * makes it succeed, and nothing else does -- multi-character literals are
 * NOT included here even though they're deterministic, since their
 * "guaranteed success" set is a single length->1 string, not a set of
 * *starting* characters distinct from other cases worth the complexity).
 * Everything else returns the empty set, meaning "we don't guarantee
 * anything, so no subtraction happens" -- the safe default, never an
 * unsound one: `differenceFirstSet` subtracting the empty set is a no-op.
 */
const alwaysMatchesSet = (expr: Expression): CharSet => {
  switch (expr.type) {
    case "CharacterClass":
      return charClassFirstSet(expr).set;
    case "StringLiteral":
      return expr.value.length === 1 ? fromChar(expr.value) : EMPTY_SET;
    default:
      return EMPTY_SET;
  }
};

// --- isNullable, with memoization scoped to a converged nullableRules map ---
//
// `isNullable` is called from three places with very different mutation
// profiles for its `nullableRules` argument:
//
//   1. `computeNullableRules`'s own fixpoint loop below, which mutates
//      the SAME `Map` instance in place across iterations as rules
//      converge from `false` to `true`. Caching by `expr` identity alone
//      here would go stale mid-loop -- a rule's nullability can change
//      between passes while the map object itself never does.
//   2. `analyzeFirstSets`'s FIRST-set fixpoint loop, and
//   3. `ast-optimize.ts`'s `findCutPosition` (via
//      `GrammarFirstSetAnalysis.nullableRules`),
//
//   both of which only ever see the *already-converged*, never-mutated-
//   again `nullableRules` map that `computeNullableRules` returns. For
//   those two, `(nullableRules, expr)` is a pure function -- exactly the
//   case memoization is safe and valuable, since (2) alone re-derives the
//   same sub-expressions' nullability on every one of its own passes, and
//   (3) is called once per `Choice` alternative.
//
// The exported `isNullable` is the memoized wrapper, keyed by the
// `nullableRules` map's own identity so results from two different
// analyses (or two different snapshots) can never collide; the internal
// `computeNullableRules` loop calls `isNullableUncached` directly to
// avoid caching against its still-mutating map.

const isNullableUncached = (
  expr: Expression,
  nullableRules: ReadonlyMap<string, boolean>,
): boolean => {
  switch (expr.type) {
    case "StringLiteral":
      return expr.value === "";
    case "CharacterClass":
      return false;
    case "AnyChar":
      return false;
    case "Identifier":
      return nullableRules.get(expr.name) ?? true;
    case "QualifiedIdentifier":
      return true;
    case "Sequence":
      return expr.elements.every((el) => isNullableUncached(el, nullableRules));
    case "Choice":
      return expr.alternatives.some((alt) =>
        isNullableUncached(alt, nullableRules),
      );
    case "Group":
      return isNullableUncached(expr.expression, nullableRules);
    case "Star":
    case "Optional":
      return true;
    case "Plus":
      return isNullableUncached(expr.expression, nullableRules);
    case "Quantified":
      return (
        expr.min === 0 || isNullableUncached(expr.expression, nullableRules)
      );
    case "PositiveLookahead":
    case "NegativeLookahead":
      // Zero-width assertions: never consume input themselves.
      return true;
    case "Cut":
      // The `~` cut/commit marker: consumes nothing and occupies no
      // tuple slot (`docs/peg-grammar.md`'s capture table), so a
      // sequence's nullability is unaffected by its presence either way
      // -- treating it as nullable lets `sequenceFirstSet` (and
      // `reentrancy.ts`'s mirror of it) continue past it to whatever
      // comes next, which is correct: a cut never itself blocks the
      // "did this element consume a character" question the nullable-
      // prefix walk is asking.
      return true;
    case "LabeledExpression":
    case "ActionExpression":
      return isNullableUncached(expr.expression, nullableRules);
    default:
      return true;
  }
};

const nullableMemo = new WeakMap<
  ReadonlyMap<string, boolean>,
  WeakMap<Expression, boolean>
>();

/**
 * `true` if `expr` might match zero characters. Unresolved constructs
 * (an as-yet-unconverged rule reference during fixpoint iteration, or a
 * cross-module `QualifiedIdentifier`) default to `true` -- the safe
 * direction for nullability specifically, since treating a possibly-
 * nullable element as non-nullable would stop a `Sequence`'s FIRST-set
 * computation short of characters a later element could actually start
 * the match with (see `sequenceFirstSet`).
 *
 * Exported for callers deciding whether a whole `Choice` alternative can
 * be used as a `predictiveChoice` filter at all (see module doc comment
 * and `predictiveFilterForExpression`) -- takes the converged
 * `nullableRules` map from `computeFirstSets`'s companion nullable-rules
 * output, not a rule name, so it works on an arbitrary sub-expression
 * (e.g. one alternative of a `Choice`), not just a whole rule's pattern.
 *
 * Memoized per `(nullableRules, expr)` pair for the OUTERMOST call only
 * (see the block comment above `isNullableUncached` for why that's safe
 * here but NOT inside `computeNullableRules`'s own fixpoint, which calls
 * `isNullableUncached` directly and exclusively -- `isNullableUncached`
 * always recurses into itself, never back into this memoized wrapper, so
 * no cache entry is ever created against a map `computeNullableRules` is
 * still mutating). Sub-expressions reached by recursing *within* a single
 * call aren't individually cached, only whatever `expr` was passed in at
 * the top -- still enough to avoid re-deriving the same sequence
 * element's nullability on every one of `analyzeFirstSets`'s fixpoint
 * passes, which is what motivated this in the first place.
 */
export const isNullable = (
  expr: Expression,
  nullableRules: ReadonlyMap<string, boolean>,
): boolean => {
  let perMap = nullableMemo.get(nullableRules);
  if (!perMap) {
    perMap = new WeakMap();
    nullableMemo.set(nullableRules, perMap);
  }
  const cached = perMap.get(expr);
  if (cached !== undefined) return cached;
  const result = isNullableUncached(expr, nullableRules);
  perMap.set(expr, result);
  return result;
};

/**
 * Adds to `into` every rule name referenced by an `Identifier` reachable
 * at offset ZERO from `expr`'s own start -- i.e. reachable without any
 * preceding element necessarily having consumed a character. A
 * `Sequence` contributes each element's refs in order but stops at the
 * first non-nullable element (anything past it starts at a strictly
 * later offset); a `Choice` contributes every alternative's; unary
 * wrappers pass through. A `Cut` element is skipped without stopping the
 * walk -- it consumes nothing (`isNullable(Cut)` is `true`), so whatever
 * follows it is still at offset 0. `QualifiedIdentifier` contributes
 * nothing: a cross-module reference can't recurse back into THIS
 * grammar's own rules from here.
 *
 * This is the edge relation behind left-recursion detection
 * (`grammar-validation.ts`'s `findLeftRecursiveRules`: a rule is
 * left-recursive iff it can reach itself along zero-offset edges) and
 * reentrancy's `computeRuleInvocableAtZero` (which propagates along the
 * same edges through a worklist). Both previously kept their own
 * structurally identical copy of this walk.
 */
export const collectZeroOffsetRuleRefs = (
  expr: Expression,
  nullableRules: ReadonlyMap<string, boolean>,
  into: Set<string>,
): void => {
  switch (expr.type) {
    case "Identifier":
      into.add(expr.name);
      return;
    case "Sequence":
      for (const el of expr.elements) {
        if (el.type === "Cut") continue;
        collectZeroOffsetRuleRefs(el, nullableRules, into);
        // Only an element that might itself match zero characters lets
        // the position stay at the sequence's own start for whatever
        // comes next -- anything past the first non-nullable element is
        // unreachable at offset 0 into this sequence's own attempt.
        if (!isNullable(el, nullableRules)) return;
      }
      return;
    case "Choice":
      for (const alt of expr.alternatives) {
        collectZeroOffsetRuleRefs(alt, nullableRules, into);
      }
      return;
    case "Group":
    case "LabeledExpression":
    case "ActionExpression":
    case "Star":
    case "Plus":
    case "Optional":
    case "Quantified":
    case "PositiveLookahead":
    case "NegativeLookahead":
      collectZeroOffsetRuleRefs(expr.expression, nullableRules, into);
      return;
    case "StringLiteral":
    case "CharacterClass":
    case "AnyChar":
    case "Cut":
    case "QualifiedIdentifier":
      // Leaves: no rule references to collect.
      return;
    default: {
      // Compile-time exhaustiveness: a new Expression variant must make
      // an explicit decision here or this fails to typecheck.
      const _exhaustive: never = expr;
      return _exhaustive;
    }
  }
};

/**
 * Computes the FIRST set of `elements[from..]` as a suffix of a
 * `Sequence` -- the core of `sequenceFirstSet`, split out so a
 * `NegativeLookahead` element can subtract `alwaysMatchesSet` from
 * everything that follows it in the same nullable-prefix run (see module
 * doc comment: `FIRST(!a b) = FIRST(b) \ ALWAYS_FIRST(a)`).
 *
 * Elements before index `from` have already been unioned in by the
 * caller; this function only accounts for `elements[from]` onward, and
 * stops contributing at the first non-nullable element (see the two
 * passes below).
 */
const sequenceFirstSetFrom = (
  elements: readonly Expression[],
  from: number,
  ctx: ReadonlyMap<string, FirstSet>,
  nullableRules: ReadonlyMap<string, boolean>,
): FirstSet => {
  // Iterative version of the original right-recursive formulation, which
  // overflowed the call stack on a `Sequence` of ~50k+ (possibly-)
  // nullable elements: recursion depth equaled the length of the nullable
  // prefix starting at `from`. The recursion computed, at element i,
  // `own_i` and -- only while element i is nullable -- unioned it with
  // f(i+1) (subtracting `alwaysMatchesSet` across a `!a` element); a
  // non-nullable element i returned `own_i` alone without ever evaluating
  // the suffix. So only the nullable prefix at `from`, plus its first
  // non-nullable terminator, contributes.
  //
  // Pass 1 (forward): find that terminator's index. Elements past it are
  // never consulted, exactly like the recursion's early `return own`.
  let last = elements.length - 1;
  for (let i = from; i < elements.length; i++) {
    if (!isNullable(elements[i] as Expression, nullableRules)) {
      last = i;
      break;
    }
  }

  // Pass 2 (backward): fold each element's own FIRST set into the running
  // suffix, mirroring the recursion -- at `last` the running suffix is
  // `EMPTY_FIRST_SET`, so `unionFirstSets(own, EMPTY)` is `own`, matching
  // the recursive `return own`; every element before `last` is nullable
  // by construction (and a `NegativeLookahead` is always nullable, so the
  // subtraction can never wrongly fire on the terminator).
  let rest = EMPTY_FIRST_SET;
  for (let i = last; i >= from; i--) {
    const element = elements[i] as Expression;
    const own = firstSetOfExpression(element, ctx, nullableRules);
    if (element.type === "NegativeLookahead") {
      rest = differenceFirstSet(rest, alwaysMatchesSet(element.expression));
    }
    rest = unionFirstSets(own, rest);
  }
  return rest;
};

const sequenceFirstSet = (
  expr: Sequence,
  ctx: ReadonlyMap<string, FirstSet>,
  nullableRules: ReadonlyMap<string, boolean>,
): FirstSet => sequenceFirstSetFrom(expr.elements, 0, ctx, nullableRules);

/**
 * Computes the FIRST set of a single expression, given already-known (or,
 * during fixpoint iteration, partially-known) FIRST sets and nullability
 * for every rule in the grammar. Exported so `predictiveChoice` callers
 * (codegen) can compute a `Choice`'s alternatives' FIRST sets directly
 * once `computeFirstSets` has produced a converged `ruleFirstSets` map.
 */
export const firstSetOfExpression = (
  expr: Expression,
  ruleFirstSets: ReadonlyMap<string, FirstSet>,
  nullableRules: ReadonlyMap<string, boolean>,
): FirstSet => {
  switch (expr.type) {
    case "StringLiteral":
      // `singleCharFirstSet(expr.value)`, NOT `expr.value[0]`: `fromChar`
      // (via `singleCharFirstSet`) calls `codePointAt(0)` on the string
      // it's given, which decodes a leading surrogate pair into its one
      // astral code point correctly -- but only if given the *whole*
      // string. `expr.value[0]` is a single UTF-16 code *unit*, so for an
      // astral first character (e.g. `"😀x"`) it would be the lone lead
      // surrogate on its own, an invalid/different code point from what
      // `predictiveChoice`'s runtime check (`input.codePointAt(offset)`,
      // `packages/core/src/combinators.ts`) actually compares against --
      // silently excluding an alternative that should have matched.
      return expr.value === ""
        ? EMPTY_FIRST_SET
        : singleCharFirstSet(expr.value);
    case "CharacterClass":
      return charClassFirstSet(expr);
    case "AnyChar":
      return ALL_FIRST_SET;
    case "Identifier": {
      // A name absent from `ruleFirstSets` is NOT "not yet converged" --
      // every in-grammar rule has an entry from the moment
      // `analyzeFirstSets`/`computeFirstSets` seeds the map (starting at
      // EMPTY, which *does* mean "known to match nothing yet"). A missing
      // entry means `expr.name` isn't a rule of this grammar at all -- an
      // externally-supplied parser reference, which `codegen.ts`'s
      // `generateIdentifier` emits as a bare (unresolved-here) name.
      // Falling back to EMPTY there would under-approximate ("this could
      // never match anything"), the unsafe direction -- must be
      // `unknown` ("could match anything"), matching how `isNullable`
      // already treats the same case (`?? true`) above.
      const known = ruleFirstSets.get(expr.name);
      return known ?? UNKNOWN_FIRST_SET;
    }
    case "QualifiedIdentifier":
      return UNKNOWN_FIRST_SET;
    case "Sequence":
      return sequenceFirstSet(expr, ruleFirstSets, nullableRules);
    case "Choice":
      return expr.alternatives.reduce<FirstSet>(
        (acc, alt) =>
          unionFirstSets(
            acc,
            firstSetOfExpression(alt, ruleFirstSets, nullableRules),
          ),
        EMPTY_FIRST_SET,
      );
    case "Group":
    case "Star":
    case "Optional":
    case "Plus":
    case "Quantified":
      // FIRST doesn't depend on repetition bounds: whether this node
      // matches zero times is a *nullability* question (see `isNullable`,
      // consulted separately by `sequenceFirstSet` and by codegen before
      // treating a whole alternative's FIRST set as a valid filter) --
      // *if* it consumes at least one character, that character is
      // exactly the wrapped expression's own FIRST set, regardless of
      // `min`/`max`. Folding nullability in here too (e.g. returning
      // `unknown` for `Star`/`Optional` unconditionally) would be
      // *wrong*, not just imprecise: nested inside a `Sequence`, e.g.
      // `"-"? [0-9]+`, it would poison the whole sequence's FIRST set to
      // `unknown` even though `sequenceFirstSet` already handles "this
      // element might match zero chars" by also unioning in the next
      // element -- the precise chars this element *could* start with
      // remain exactly as informative either way.
      return firstSetOfExpression(
        expr.expression,
        ruleFirstSets,
        nullableRules,
      );
    case "PositiveLookahead":
    case "NegativeLookahead":
      // Zero-width: never consumes, so it never "starts with" a
      // character of its own -- but as a standalone alternative it's
      // nullable, which callers gating on nullability already route to
      // `unknown` before this ever matters in practice. The subtraction
      // a `NegativeLookahead` contributes to a *following* sequence
      // element happens in `sequenceFirstSetFrom`, not here.
      return EMPTY_FIRST_SET;
    case "LabeledExpression":
    case "ActionExpression":
      return firstSetOfExpression(
        expr.expression,
        ruleFirstSets,
        nullableRules,
      );
    case "Cut":
      // Consumes nothing and (per `isNullable` above) is always
      // nullable, so it contributes no characters of its own -- same
      // shape as the lookahead cases just above.
      return EMPTY_FIRST_SET;
    default:
      return UNKNOWN_FIRST_SET;
  }
};

/**
 * Collects every rule name `Identifier`s in `expr` reference, into `into`.
 * Deliberately over-approximates the actual data-flow dependency: it
 * counts an `Identifier` in ANY position (e.g. after a `Sequence`'s
 * non-nullable terminator, or inside a lookahead), even where the
 * fixpoint evaluation above never reads that rule's value. For the
 * worklist-driven fixpoints below that's safe -- an over-wide edge can
 * only cause a redundant recomputation, never a missed update -- and it
 * keeps the dependency graph static instead of depending on the
 * still-converging state.
 *
 * Iterative (explicit stack) rather than recursive: a parsed grammar's
 * nesting depth is bounded by the grammar parser's own recursion guard,
 * but a hand-built AST can nest arbitrarily.
 */
const collectRuleReferences = (expr: Expression, into: Set<string>): void => {
  const stack: Expression[] = [expr];
  while (stack.length > 0) {
    const node = stack.pop() as Expression;
    if (node.type === "Identifier") {
      into.add(node.name);
      continue;
    }
    // `childExpressions` (`@suzumiyaaoba/tpeg-core`) owns the
    // which-nodes-have-children enumeration -- including the
    // `ActionExpression` case hand-written copies kept missing; leaves
    // (StringLiteral/CharacterClass/AnyChar/Cut/QualifiedIdentifier)
    // contribute nothing.
    for (const child of childExpressions(node)) {
      stack.push(child);
    }
  }
};

/**
 * Maps a referenced rule name to the indexes (into `rules`) of every
 * rule whose pattern references it -- the reverse dependency edges both
 * worklist fixpoints below propagate change notifications along.
 */
const buildRuleDependents = (
  rules: readonly { readonly name: string; readonly pattern: Expression }[],
): Map<string, number[]> => {
  const dependents = new Map<string, number[]>();
  for (let i = 0; i < rules.length; i++) {
    const refs = new Set<string>();
    collectRuleReferences((rules[i] as (typeof rules)[number]).pattern, refs);
    for (const name of refs) {
      const list = dependents.get(name);
      if (list) {
        list.push(i);
      } else {
        dependents.set(name, [i]);
      }
    }
  }
  return dependents;
};

/** Exported for `grammar-validation.ts`'s left-recursion check, which
 * needs nullability but not full FIRST sets. Safe to call directly on a
 * grammar with duplicate rule names (unlike `analyzeFirstSets`'s FIRST-set
 * fixpoint below): `nullable` is Boolean and only ever moves `false ->
 * true`, never back, so two `RuleDefinition`s sharing a name can't make
 * this oscillate the way two different FIRST sets can -- whichever one
 * sets the shared entry `true` first, it stays `true`.
 *
 * Worklist-driven rather than a recompute-everything fixpoint loop: the
 * old `while (changed)` formulation re-evaluated EVERY rule on every
 * pass and needed one pass per step a `false -> true` transition
 * propagated along a reference chain, so a grammar of n rules chained
 * `r1 = r2`, `r2 = r3`, ... cost O(n^2) evaluations (tens of thousands
 * of rules -- reachable in generated/concatenated grammars -- never
 * finished). Here a rule is re-evaluated only when a rule it references
 * actually flipped, so each rule evaluates at most once per incoming
 * dependency edge plus once: O(rules + edges) evaluations total. Same
 * least fixpoint -- a flip still notifies every referencing rule through
 * `dependents`, so no update is ever missed -- computed with far less
 * redundant work. */
export const computeNullableRules = (
  grammar: GrammarDefinition,
): Map<string, boolean> => {
  const nullable = new Map<string, boolean>(
    grammar.rules.map((r) => [r.name, false]),
  );
  const dependents = buildRuleDependents(grammar.rules);

  // Worklist of rule INDEXES (not names) so two `RuleDefinition`s sharing
  // a name each still get their own evaluation -- either may be the one
  // to flip the shared `nullable` entry, matching the old pass loop's
  // "any duplicate can set it" behavior.
  const queue: number[] = grammar.rules.map((_, i) => i);
  const inQueue = new Set<number>(queue);
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++] as number;
    inQueue.delete(i);
    const rule = grammar.rules[i] as (typeof grammar.rules)[number];
    // Already `true` can't go back (monotone), so a rule whose shared
    // name was flipped by a duplicate earlier in the queue is done.
    if (nullable.get(rule.name)) continue;
    if (isNullableUncached(rule.pattern, nullable)) {
      nullable.set(rule.name, true);
      for (const dependent of dependents.get(rule.name) ?? []) {
        if (!inQueue.has(dependent)) {
          inQueue.add(dependent);
          queue.push(dependent);
        }
      }
    }
  }
  return nullable;
};

const firstSetsEqual = (a: FirstSet, b: FirstSet): boolean => {
  if (a.unknown !== b.unknown) return false;
  if (a.unknown) return true;
  if (a.set.length !== b.set.length) return false;
  return a.set.every((r, i) => r.lo === b.set[i]?.lo && r.hi === b.set[i]?.hi);
};

export interface GrammarFirstSetAnalysis {
  readonly firstSets: ReadonlyMap<string, FirstSet>;
  readonly nullableRules: ReadonlyMap<string, boolean>;
  /** Rule name -> pattern, for callers (`canCommitWithoutConsuming` below)
   * that need to follow an `Identifier` reference to its rule's body.
   * Built alongside the other two maps rather than re-deriving `grammar.rules`
   * at each call site. */
  readonly rulePatterns: ReadonlyMap<string, Expression>;
}

/**
 * Computes converged FIRST sets and nullability for every rule in
 * `grammar`, via iterative fixpoint (see module doc comment for why a
 * one-shot recursive walk isn't safe for recursive grammars). This is the
 * entry point codegen should use -- `firstSetOfExpression`/`isNullable`
 * on an individual sub-expression (e.g. one `Choice` alternative that
 * isn't itself a whole rule) both need the *converged* rule-level maps
 * this produces, not a partial fixpoint state.
 */
export const analyzeFirstSets = (
  grammar: GrammarDefinition,
): GrammarFirstSetAnalysis => {
  const nullableRules = computeNullableRules(grammar);
  const firstSets = new Map<string, FirstSet>(
    grammar.rules.map((r) => [r.name, EMPTY_FIRST_SET]),
  );

  // De-duplicated by name (last declaration wins, an arbitrary but stable
  // tie-break -- a duplicate name has no well-defined grammar meaning to
  // begin with). `grammar-validation.ts`'s `validateGrammar` is the
  // primary defense against a duplicate rule name (rejected with a clear
  // diagnostic before this function is ever reached from codegen), but
  // this fixpoint must not hang even if some other caller passes one
  // directly: iterating `grammar.rules` as-is would have two
  // `RuleDefinition`s overwrite the SAME `firstSets` entry from two
  // different patterns every pass, which can oscillate between their two
  // computed FIRST sets forever instead of converging (rule A's result,
  // then rule B's overwrites it, then re-deriving A's differs from what's
  // now stored so `changed` flips again, ad infinitum).
  const uniqueRules = [
    ...new Map(grammar.rules.map((r) => [r.name, r])).values(),
  ];

  // Same worklist-driven fixpoint as `computeNullableRules` above, for
  // the identical reason: the old `while (changed)` pass loop cost one
  // full re-evaluation of every rule per step a change propagated along
  // a reference chain -- O(n^2) on `r1 = r2`, `r2 = r3`, ... -- while a
  // worklist re-evaluates a rule only when a referenced rule's FIRST set
  // actually changed. `firstSetOfExpression` is monotone in `firstSets`
  // (union of literal sets and rule lookups; the only subtraction,
  // `differenceFirstSet`, removes a constant syntactic set -- see its doc
  // comment), so values still converge to the same least fixpoint, just
  // without re-deriving unchanged rules on every pass.
  const dependents = buildRuleDependents(uniqueRules);
  const patternByName = new Map<string, Expression>(
    uniqueRules.map((r) => [r.name, r.pattern]),
  );
  const queue: string[] = uniqueRules.map((r) => r.name);
  const inQueue = new Set<string>(queue);
  let head = 0;
  while (head < queue.length) {
    const name = queue[head++] as string;
    inQueue.delete(name);
    const next = firstSetOfExpression(
      patternByName.get(name) as Expression,
      firstSets,
      nullableRules,
    );
    const prev = firstSets.get(name) as FirstSet;
    if (!firstSetsEqual(prev, next)) {
      firstSets.set(name, next);
      for (const dependent of dependents.get(name) ?? []) {
        const depName = (uniqueRules[dependent] as (typeof uniqueRules)[number])
          .name;
        if (!inQueue.has(depName)) {
          inQueue.add(depName);
          queue.push(depName);
        }
      }
    }
  }

  const rulePatterns = new Map<string, Expression>(
    grammar.rules.map((r) => [r.name, r.pattern]),
  );

  return { firstSets, nullableRules, rulePatterns };
};

/** Convenience wrapper over {@link analyzeFirstSets} for callers that only
 * need the per-rule FIRST sets (e.g. tests) and not nullability. */
export const computeFirstSets = (
  grammar: GrammarDefinition,
): Map<string, FirstSet> => new Map(analyzeFirstSets(grammar).firstSets);

/**
 * Computes the `predictiveChoice` filter for a single `Choice`
 * alternative, or `null` if it can't safely be used to skip that
 * alternative: either its FIRST set couldn't be determined precisely
 * (`firstSetOfExpression` returned `unknown`), or the alternative is
 * itself (possibly) nullable -- see the module doc comment for why a
 * nullable alternative can never be filtered by "next character" at all.
 * The intended entry point for codegen deciding, per alternative of a
 * `Choice`, what to pass as `predictiveChoice`'s second tuple element.
 */
export const predictiveFilterForExpression = (
  expr: Expression,
  analysis: GrammarFirstSetAnalysis,
): CharSet | null => {
  if (isNullable(expr, analysis.nullableRules)) return null;
  const fs = firstSetOfExpression(
    expr,
    analysis.firstSets,
    analysis.nullableRules,
  );
  if (fs.unknown) return null;
  return fs.set;
};

/**
 * `true` iff `a` and `b` are provably disjoint: no character could
 * satisfy both. `unknown` on either side means "could match anything," so
 * it is never safe to call the pair disjoint in that case -- matches
 * `predictiveFilterForExpression`'s treatment of `unknown` as "always
 * attempt," here inverted to "never assume this one is excluded."
 *
 * Used by `ast-optimize.ts`'s `insertAutomaticCuts`: a later `Choice`
 * alternative can safely be treated as unreachable once an earlier
 * alternative has matched a non-nullable prefix whose FIRST set is
 * disjoint from the later alternative's own FIRST set -- the character
 * that was actually consumed proves the later alternative could never
 * have matched here.
 */
export const firstSetsDisjoint = (a: FirstSet, b: FirstSet): boolean => {
  if (a.unknown || b.unknown) return false;
  return charSetsDisjoint(a.set, b.set);
};

/**
 * `true` iff SOME execution path through `expr`'s nullable prefix can
 * reach a `Cut` while having consumed zero characters relative to
 * wherever `expr` itself started -- i.e., `expr`'s failure at its own
 * starting offset can come back `fatal` (see `ParseError.fatal` /
 * `commit` in `packages/core/src/combinators.ts`).
 *
 * This is `predictiveChoice`'s (`packages/core/src/combinators.ts`)
 * missing precondition: that combinator skips a `Choice` alternative
 * whenever its FIRST-set filter provably excludes the current character,
 * reasoning that running the skipped alternative "would only reproduce a
 * failure at `pos`." That reasoning is sound for an ORDINARY failure --
 * `choice`/`tryOrderedCandidates` would just move on to the next
 * candidate either way -- but not for a `fatal` one: a fatal failure
 * aborts the WHOLE choice, and it is emitted at the alternative's own
 * starting offset (zero-width), independent of what the actual input
 * character is, whenever the alternative's nullable prefix can reach a
 * `Cut` by taking its empty-match branch (`optional`'s "parser failed ->
 * succeed with []" branch never even looks at the input character it
 * failed to match). Concretely: `("a"? ~ "a") / "b"` on input `"b"` must
 * fail the WHOLE choice (`"a"?` matches empty, the cut commits, and the
 * following `"a"` fails fatally) -- but the alternative's FIRST set is
 * `{a}` (computed correctly from the literal after the cut), so a naive
 * predictive filter would skip it on `"b"` and wrongly fall through to
 * the second alternative.
 *
 * `codegen-optimized.ts`'s `tryGeneratePredictiveChoice` MUST treat this
 * function returning `true` for a `Choice` alternative the same as an
 * unresolvable ("unknown") FIRST set: emit `null` for both that
 * alternative's filter AND its literal-prefix trie slot (see
 * `packages/core/src/dispatch-trie.ts` -- the trie is a second,
 * independent skip path with the exact same hazard), so the alternative
 * is always attempted, never skipped by a static "next character" guess.
 *
 * Mirrors, node type by node type, which combinators actually re-raise a
 * child's `fatal` failure unchanged vs. absorb it at their own boundary
 * (see each one's own doc comment):
 * - `Sequence`/`sequence()`: relays a failing element's result unchanged
 *   -- a `Cut` reachable through a nullable prefix propagates.
 * - `Choice`/`tryOrderedCandidates`: absorbs `fatal` at ITS OWN boundary
 *   (never forwards it to whatever encloses that `Choice`) -- so a `Cut`
 *   inside one alternative can never escape through this node.
 * - `Optional`/`Star`/`Plus`/`Quantified` (`repetition.ts`): all four
 *   re-raise a `fatal` child failure rather than treating it as "no
 *   match" -- so a `Cut` reachable on the wrapped expression's own first
 *   (possibly only) attempt propagates through the repetition node too,
 *   regardless of `min`.
 * - `PositiveLookahead`/`NegativeLookahead` (`andPredicate`/
 *   `notPredicate`, `lookahead.ts`): both absorb a `fatal` child failure
 *   at their own boundary (swap it back to non-fatal before relaying) --
 *   a `Cut` inside a lookahead can never escape through it.
 * - `Identifier`: follows the referenced rule's pattern via
 *   `analysis.rulePatterns` -- a `Cut` inside a referenced rule is just
 *   as reachable as one written inline, since `predictiveChoice` filters
 *   whichever `Choice` node actually contains the reference, and that
 *   reference's own failure (fatal or not) is whatever the referenced
 *   rule produces. `QualifiedIdentifier` (cross-module) and an
 *   `Identifier` this grammar has no rule for are both unresolvable here
 *   -- conservatively `true`, the same "cannot rule out" direction
 *   `predictiveFilterForExpression` already takes for an unresolvable
 *   FIRST set. A rule reference already on `visitedRules` (a cycle
 *   reached with zero net consumption -- left recursion) is likewise
 *   conservatively `true` rather than looping forever; ordinary
 *   (non-left-recursive) recursion never revisits a rule at zero
 *   consumed input, so this never fires for a well-formed grammar.
 */
const EMPTY_VISITED_RULES: ReadonlySet<string> = new Set();

/**
 * Upper bound on how many rule references `canCommitWithoutConsuming`
 * follows along a single reference chain before answering `true` (the
 * conservative "cannot rule it out" direction -- the alternative is
 * simply always attempted, never skipped, so this can only cost a
 * fast-path, never skip a `fatal`-producing alternative). Bounds the
 * call-stack depth of the `Identifier` case below for pathological
 * grammars (e.g. tens of thousands of rules chained `r1 = r2`, `r2 = r3`,
 * ...), which would otherwise overflow it.
 */
const MAX_CAN_COMMIT_REFERENCE_DEPTH = 10_000;

export const canCommitWithoutConsuming = (
  expr: Expression,
  analysis: GrammarFirstSetAnalysis,
  visitedRules: ReadonlySet<string> = EMPTY_VISITED_RULES,
): boolean => {
  // `onPath` holds exactly the rule names on the current reference chain
  // (added before descending into a rule's pattern, removed on the way
  // back) -- the same set the previous implementation built by copying
  // (`new Set([...visitedRules, name])`) on every hop, minus an O(depth)
  // copy per reference.
  const onPath = new Set(visitedRules);

  // Per-rule answers, memoized for this one top-level call. Without it,
  // a DAG-shaped reference graph (e.g. `r0 = r1 r1`, `r1 = r2 r2`, ...)
  // re-evaluates the same rule once per path reaching it -- exponential
  // in the chain length. Reuse is exact for every grammar this function
  // can legitimately see: a rule's answer can only depend on `onPath`
  // when its subtree references a rule already on the path, i.e. a
  // zero-consumption reference cycle -- left recursion -- which
  // `grammar-validation.ts`'s `validateGrammar` rejects before either
  // codegen reaches this. On such a rejected-anyway grammar a memoized
  // entry may differ from a fresh per-path evaluation, in either
  // direction; both remain sound-or-safe approximations of an already
  // undefined construct.
  const ruleMemo = new Map<string, boolean>();

  const visit = (node: Expression): boolean => {
    switch (node.type) {
      case "Cut":
        return true;
      case "Sequence": {
        for (const element of node.elements) {
          if (visit(element)) {
            return true;
          }
          if (!isNullable(element, analysis.nullableRules)) return false;
        }
        return false;
      }
      case "Choice":
        // `tryOrderedCandidates` absorbs a `fatal` failure at THIS node's
        // own boundary (see `commit`'s doc comment in
        // `packages/core/src/combinators.ts`) -- a Cut inside one
        // alternative never escapes through the Choice itself.
        return false;
      case "Group":
      case "LabeledExpression":
      case "ActionExpression":
        return visit(node.expression);
      case "Optional":
      case "Star":
      case "Plus":
      case "Quantified":
        return visit(node.expression);
      case "PositiveLookahead":
      case "NegativeLookahead":
        // Both `andPredicate` and `notPredicate` absorb a `fatal` child
        // failure at their own boundary -- see `lookahead.ts`.
        return false;
      case "Identifier": {
        if (onPath.has(node.name)) return true;
        const pattern = analysis.rulePatterns.get(node.name);
        if (!pattern) return true;
        const cached = ruleMemo.get(node.name);
        if (cached !== undefined) return cached;
        if (onPath.size >= MAX_CAN_COMMIT_REFERENCE_DEPTH) return true;
        onPath.add(node.name);
        const result = visit(pattern);
        onPath.delete(node.name);
        ruleMemo.set(node.name, result);
        return result;
      }
      case "QualifiedIdentifier":
        return true;
      default:
        return false;
    }
  };

  return visit(expr);
};

/**
 * `Star`/`Plus`/`Quantified{min,}` (unbounded, `max === undefined`) over a
 * nullable body has no well-defined PEG semantics: the wrapped expression
 * could succeed while consuming zero characters, so the repetition would
 * never terminate by input exhaustion. `packages/core/src/repetition.ts`'s
 * `zeroOrMore`/`oneOrMore`/`quantified` all carry a runtime
 * zero-progress guard for this (`createInfiniteLoopError`), which fails
 * `fatal: true` so `optional`/`withDefault`/`choice` re-raise it rather
 * than swallowing it -- the runtime path is therefore safe in every
 * wrapping context. `assertNoNullableRepetition` still rejects the shape
 * at GENERATION time because a grammar-authoring mistake deserves a
 * diagnostic pointing at the rule in the `.tpeg` file, not a fatal
 * failure surfaced mid-parse by whatever input first reaches it.
 *
 * A *bounded* `Quantified{n,m}` (including `{n,n}`) is NOT flagged: PEG
 * gives `e{n,m}` well-defined semantics even when `e` is nullable (each of
 * the `n` required and up to `m` optional attempts is a legitimate
 * possibly-zero-width match, and the `for` loop bounding them can never
 * loop unboundedly regardless) -- see `quantified`'s own doc comment in
 * `repetition.ts`.
 */
export interface NullableRepetitionIssue {
  readonly ruleName: string;
  readonly nodeType: "Star" | "Plus" | "Quantified";
}

/**
 * `true` only when `expr` is PROVABLY nullable from what this grammar
 * itself declares -- the mirror image of `isNullable`'s "unresolved ->
 * true" default. `isNullable` treats an `Identifier` naming no rule of
 * this grammar (the documented external-parser escape hatch -- see
 * `grammar-validation.ts`'s module doc comment) and a cross-module
 * `QualifiedIdentifier` as nullable because that's the safe direction
 * for FIRST-set computation. For `collectNullableRepetitions`'s
 * *rejection* check it is exactly backwards: `ext*` was rejected even
 * though nothing in the grammar can prove `ext` nullable, making the
 * external escape hatch unusable under any unbounded repetition. Only a
 * construct this grammar can prove nullable gets flagged -- an external
 * parser that happens to be nullable at runtime still hits
 * `zeroOrMore`'s zero-progress guard (`createInfiniteLoopError`), which
 * is the correct layer to own that case.
 */
const isProvablyNullable = (
  expr: Expression,
  nullableRules: ReadonlyMap<string, boolean>,
): boolean => {
  switch (expr.type) {
    case "StringLiteral":
      return expr.value === "";
    case "CharacterClass":
    case "AnyChar":
      return false;
    case "Identifier":
      return nullableRules.get(expr.name) ?? false;
    case "QualifiedIdentifier":
      return false;
    case "Sequence":
      return expr.elements.every((el) => isProvablyNullable(el, nullableRules));
    case "Choice":
      return expr.alternatives.some((alt) =>
        isProvablyNullable(alt, nullableRules),
      );
    case "Group":
      return isProvablyNullable(expr.expression, nullableRules);
    case "Star":
    case "Optional":
      return true;
    case "Plus":
      return isProvablyNullable(expr.expression, nullableRules);
    case "Quantified":
      return (
        expr.min === 0 || isProvablyNullable(expr.expression, nullableRules)
      );
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "Cut":
      // Zero-width constructs: provably never consume input.
      return true;
    case "LabeledExpression":
    case "ActionExpression":
      return isProvablyNullable(expr.expression, nullableRules);
    default:
      return false;
  }
};

const collectNullableRepetitions = (
  expr: Expression,
  ruleName: string,
  analysis: GrammarFirstSetAnalysis,
  issues: NullableRepetitionIssue[],
): void => {
  switch (expr.type) {
    case "Star":
    case "Plus":
      if (isProvablyNullable(expr.expression, analysis.nullableRules)) {
        issues.push({ ruleName, nodeType: expr.type });
      }
      collectNullableRepetitions(expr.expression, ruleName, analysis, issues);
      return;
    case "Quantified":
      // `max === undefined` OR a non-finite `max` (hand-built ASTs can
      // carry `Infinity`, the documented spelling of unbounded that
      // `tpeg-core`'s `quantified` also honors) both mean "unbounded".
      if (
        (expr.max === undefined || !Number.isFinite(expr.max)) &&
        isProvablyNullable(expr.expression, analysis.nullableRules)
      ) {
        issues.push({ ruleName, nodeType: "Quantified" });
      }
      collectNullableRepetitions(expr.expression, ruleName, analysis, issues);
      return;
    case "Sequence":
      for (const element of expr.elements) {
        collectNullableRepetitions(element, ruleName, analysis, issues);
      }
      return;
    case "Choice":
      for (const alt of expr.alternatives) {
        collectNullableRepetitions(alt, ruleName, analysis, issues);
      }
      return;
    case "Group":
    case "Optional":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "LabeledExpression":
    case "ActionExpression":
      collectNullableRepetitions(expr.expression, ruleName, analysis, issues);
      return;
    default:
      return;
  }
};

/** Every `NullableRepetitionIssue` (see above) reachable in `grammar`,
 * across every rule. Exported mainly so a test can assert on the
 * structured result directly rather than parsing `assertNoNullableRepetition`'s
 * message. */
export const findNullableRepetitions = (
  grammar: GrammarDefinition,
  analysis: GrammarFirstSetAnalysis,
): NullableRepetitionIssue[] => {
  const issues: NullableRepetitionIssue[] = [];
  for (const rule of grammar.rules) {
    collectNullableRepetitions(rule.pattern, rule.name, analysis, issues);
  }
  return issues;
};

/**
 * Throws if `grammar` contains any `NullableRepetitionIssue` (see
 * `findNullableRepetitions`'s doc comment for why this shape is rejected
 * outright rather than generated). Called by both `codegen.ts` and
 * `codegen-optimized.ts` before generating any code, so the failure is a
 * grammar-authoring error reported at generation time -- matching
 * `quantified`'s own construction-time validation in
 * `packages/core/src/repetition.ts` for an analogous "this grammar/call
 * can never behave sensibly" case.
 */
export const assertNoNullableRepetition = (
  grammar: GrammarDefinition,
  analysis: GrammarFirstSetAnalysis,
): void => {
  const issues = findNullableRepetitions(grammar, analysis);
  if (issues.length === 0) return;
  const description = issues
    .map(
      (issue) =>
        `rule '${issue.ruleName}': ${issue.nodeType} over a nullable expression`,
    )
    .join("; ");
  throw new Error(
    `Grammar contains unbounded repetition over a nullable (possibly zero-width) expression -- this has no well-defined PEG semantics, since the repetition could succeed without ever consuming input: ${description}`,
  );
};
