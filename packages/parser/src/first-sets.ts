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
 * Computes the FIRST set of `elements[from..]` as a suffix of a
 * `Sequence` -- the recursive core of `sequenceFirstSet`, split out so a
 * `NegativeLookahead` element can subtract `alwaysMatchesSet` from
 * everything that follows it in the same nullable-prefix run (see module
 * doc comment: `FIRST(!a b) = FIRST(b) \ ALWAYS_FIRST(a)`).
 *
 * Elements before index `from` have already been unioned in by the
 * caller; this function only accounts for `elements[from]` onward, and
 * mirrors the original loop's "stop after the first non-nullable element"
 * behavior exactly (see the two base-case returns below).
 */
const sequenceFirstSetFrom = (
  elements: readonly Expression[],
  from: number,
  ctx: ReadonlyMap<string, FirstSet>,
  nullableRules: ReadonlyMap<string, boolean>,
): FirstSet => {
  if (from >= elements.length) return EMPTY_FIRST_SET;
  const element = elements[from] as Expression;
  const own = firstSetOfExpression(element, ctx, nullableRules);
  if (!isNullable(element, nullableRules)) return own;

  let rest = sequenceFirstSetFrom(elements, from + 1, ctx, nullableRules);
  if (element.type === "NegativeLookahead") {
    rest = differenceFirstSet(rest, alwaysMatchesSet(element.expression));
  }
  return unionFirstSets(own, rest);
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

const computeNullableRules = (
  grammar: GrammarDefinition,
): Map<string, boolean> => {
  const nullable = new Map<string, boolean>(
    grammar.rules.map((r) => [r.name, false]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of grammar.rules) {
      if (nullable.get(rule.name)) continue;
      if (isNullableUncached(rule.pattern, nullable)) {
        nullable.set(rule.name, true);
        changed = true;
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

  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of grammar.rules) {
      const next = firstSetOfExpression(rule.pattern, firstSets, nullableRules);
      const prev = firstSets.get(rule.name) as FirstSet;
      if (!firstSetsEqual(prev, next)) {
        firstSets.set(rule.name, next);
        changed = true;
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

export const canCommitWithoutConsuming = (
  expr: Expression,
  analysis: GrammarFirstSetAnalysis,
  visitedRules: ReadonlySet<string> = EMPTY_VISITED_RULES,
): boolean => {
  switch (expr.type) {
    case "Cut":
      return true;
    case "Sequence": {
      for (const element of expr.elements) {
        if (canCommitWithoutConsuming(element, analysis, visitedRules)) {
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
      return canCommitWithoutConsuming(expr.expression, analysis, visitedRules);
    case "Optional":
    case "Star":
    case "Plus":
    case "Quantified":
      return canCommitWithoutConsuming(expr.expression, analysis, visitedRules);
    case "PositiveLookahead":
    case "NegativeLookahead":
      // Both `andPredicate` and `notPredicate` absorb a `fatal` child
      // failure at their own boundary -- see `lookahead.ts`.
      return false;
    case "Identifier": {
      if (visitedRules.has(expr.name)) return true;
      const pattern = analysis.rulePatterns.get(expr.name);
      if (!pattern) return true;
      return canCommitWithoutConsuming(
        pattern,
        analysis,
        new Set([...visitedRules, expr.name]),
      );
    }
    case "QualifiedIdentifier":
      return true;
    default:
      return false;
  }
};

/**
 * `Star`/`Plus`/`Quantified{min,}` (unbounded, `max === undefined`) over a
 * nullable body has no well-defined PEG semantics: the wrapped expression
 * could succeed while consuming zero characters, so the repetition would
 * never terminate by input exhaustion. `packages/core/src/repetition.ts`'s
 * `zeroOrMore`/`oneOrMore`/`quantified` all carry a runtime
 * zero-progress guard for this (`createInfiniteLoopError`), but that guard
 * produces a NON-fatal failure -- which `optional`/`withDefault`/`choice`
 * then silently swallow as "no match" rather than surfacing it, so the
 * same underlying grammar mistake is a hard error in one context
 * (`zeroOrMore(...)` at top level) and silently accepted as `[]` in
 * another (`optional(zeroOrMore(...))`). Rather than generate code whose
 * behavior depends on incidental wrapping, codegen rejects this shape
 * outright -- see `assertNoNullableRepetition`.
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

const collectNullableRepetitions = (
  expr: Expression,
  ruleName: string,
  analysis: GrammarFirstSetAnalysis,
  issues: NullableRepetitionIssue[],
): void => {
  switch (expr.type) {
    case "Star":
    case "Plus":
      if (isNullable(expr.expression, analysis.nullableRules)) {
        issues.push({ ruleName, nodeType: expr.type });
      }
      collectNullableRepetitions(expr.expression, ruleName, analysis, issues);
      return;
    case "Quantified":
      if (
        expr.max === undefined &&
        isNullable(expr.expression, analysis.nullableRules)
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
