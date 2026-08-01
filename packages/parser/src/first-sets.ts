/**
 * FIRST-set computation for TPEG grammars: for an expression, the set of
 * characters a successful match could start with.
 *
 * This is the classic compiler-theory FIRST-set analysis (see e.g. Aho,
 * Sethi, Ullman), adapted for PEG's ordered choice and codegen's runtime
 * value representation (single characters and inclusive ranges, not
 * arbitrary regex classes). It's the static analysis `predictiveChoice`
 * (`packages/core/src/combinators.ts`) needs to skip alternatives that
 * provably cannot match at the current position, without running them --
 * see the plan's Phase 3 section for why this does NOT require changing
 * codegen's output format (predictiveChoice is a combinator, not a
 * generated `switch`).
 *
 * ## Soundness: always an over-approximation
 *
 * PEG choice is order-dependent and context-sensitive in general (an
 * `ActionExpression`'s code can't be statically analyzed at all), so this
 * module can only ever produce a *safe superset* of the characters an
 * expression might actually start with. The representation encodes that
 * directly: a `FirstSet` is either a concrete `{ chars, ranges }` (every
 * character in this set, and only characters in this set, may start a
 * match) or `{ unknown: true }` ("could not be determined -- assume it
 * could start with anything, including matching zero characters"). Never
 * the reverse: it is always safe to fall back to `unknown`, never safe to
 * guess a smaller set than the truth. `predictiveChoice` treats `unknown`
 * as "always attempt this alternative," so an `unknown` result can only
 * cost a skipped fast-path, never cause a valid parse to be missed.
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
 * `unknown` (from `firstSetOfExpression` itself) is used for:
 * - `AnyChar` (`.`) -- matches every character; representing that as an
 *   unbounded range is possible but pointless, since it would never
 *   filter anything a real FIRST set couldn't already subsume.
 * - A negated `CharacterClass` (`[^...]`) -- "everything except these
 *   ranges" is not expressible as this module's `{ chars, ranges }` shape
 *   without computing a complement, which `mergeCharacterClasses` in
 *   `ast-optimize.ts` deliberately avoids for the same reason (De
 *   Morgan's law wants an intersection of ranges, not a union).
 * - `QualifiedIdentifier` (a cross-module `module.rule` reference) --
 *   this module only sees one `GrammarDefinition`'s rules, so a
 *   cross-module reference's FIRST set is opaque here.
 * - An `Identifier` naming something that isn't a rule of this grammar --
 *   an externally-supplied parser reference, whose FIRST set this module
 *   simply has no way to see.
 * - A `CharacterClass` with a non-BMP/astral endpoint (see `isAstralChar`)
 *   -- the runtime range check in `predictiveChoice`
 *   (`packages/core/src/combinators.ts`) compares single UTF-16 code
 *   units, which doesn't correspond to code-point order for a surrogate
 *   pair.
 *

 * ## Rule references: fixpoint, not one-shot recursion
 *
 * A naive recursive walk over `Identifier` references would infinite-loop
 * on any recursive grammar (e.g. `value = ... / array`, `array = "[" ...
 * value ...`). Instead, `computeFirstSets` runs the standard iterative
 * dataflow fixpoint: every rule starts at `{ chars: {}, ranges: [],
 * unknown: false }` (the *least* element -- "matches nothing yet
 * known"), and each pass recomputes every rule's FIRST set using the
 * previous pass's results for `Identifier` lookups, monotonically
 * growing (`unknown` is sticky once set) until nothing changes. This
 * always terminates because the state per rule is bounded (the earlier
 * ranges/chars encountered from the grammar's own DP, or the number of
 * grammar-string chars ever encountered, whichever comes first; `unknown`
 * is a one-way flag).
 */

import type {
  CharacterClass,
  Expression,
  GrammarDefinition,
  Sequence,
} from "./types";

export interface CharRangeLiteral {
  readonly start: string;
  readonly end: string;
}

/**
 * A statically-computed, always-safe-to-over-approximate set of
 * characters an expression's match could start with.
 *
 * `unknown: true` means "could not be determined -- treat as matching
 * anything" (see module doc comment); `chars`/`ranges` are meaningless in
 * that case and callers should not read them.
 */
export interface FirstSet {
  readonly chars: ReadonlySet<string>;
  readonly ranges: readonly CharRangeLiteral[];
  readonly unknown: boolean;
}

const UNKNOWN_FIRST_SET: FirstSet = {
  chars: new Set(),
  ranges: [],
  unknown: true,
};

const EMPTY_FIRST_SET: FirstSet = {
  chars: new Set(),
  ranges: [],
  unknown: false,
};

const singleCharFirstSet = (c: string): FirstSet => ({
  chars: new Set([c]),
  ranges: [],
  unknown: false,
});

/** Dedupes by `"start:end"` -- harmless either way for correctness (a
 * repeated range only makes the runtime membership scan in
 * `firstCharFilterMatches`, `packages/core/src/combinators.ts`, longer,
 * never wrong), but this keeps the fixpoint's repeated re-unioning of the same
 * rule's FIRST set into itself (e.g. a recursive grammar re-deriving
 * `sum`'s FIRST set on every pass) from accumulating duplicate entries
 * across iterations, which would otherwise also bloat any generated code
 * a `FirstSet` gets serialized into. */
const dedupeRanges = (
  ranges: readonly CharRangeLiteral[],
): CharRangeLiteral[] => {
  const seen = new Map<string, CharRangeLiteral>();
  for (const r of ranges) seen.set(`${r.start}:${r.end}`, r);
  return [...seen.values()];
};

const unionFirstSets = (a: FirstSet, b: FirstSet): FirstSet => {
  if (a.unknown || b.unknown) return UNKNOWN_FIRST_SET;
  if (a === EMPTY_FIRST_SET) return b;
  if (b === EMPTY_FIRST_SET) return a;
  return {
    chars: new Set([...a.chars, ...b.chars]),
    ranges: dedupeRanges([...a.ranges, ...b.ranges]),
    unknown: false,
  };
};

/**
 * A non-BMP (astral) character is 2 UTF-16 code units in a JS string
 * (a surrogate pair); a boundary/single-char entry longer than 1 means
 * this range endpoint is one. `firstCharFilterMatches`'s runtime
 * `<=`/`>=` range comparison (`packages/core/src/combinators.ts`)
 * compares that against `input[pos.offset]`, which is always exactly one
 * UTF-16 code unit -- lexicographic string comparison between a 1-unit
 * lone-surrogate value and a 2-unit range boundary does not correspond to
 * code-point order, so a range with an astral endpoint can't be safely
 * represented here. (A single non-range char is exact-match via `Set.has`
 * and stays safe either way, but is excluded here too for a uniform, easy
 * to state rule: any surrogate pair anywhere in this class bails the
 * whole class to `unknown`, rather than keeping some entries precise and
 * others not.)
 */
const isAstralChar = (c: string): boolean => c.length > 1;

const charClassFirstSet = (expr: CharacterClass): FirstSet => {
  if (expr.negated) return UNKNOWN_FIRST_SET;
  const chars = new Set<string>();
  const ranges: CharRangeLiteral[] = [];
  for (const r of expr.ranges) {
    if (isAstralChar(r.start) || (r.end !== undefined && isAstralChar(r.end))) {
      return UNKNOWN_FIRST_SET;
    }
    if (r.end === undefined) {
      chars.add(r.start);
    } else {
      ranges.push({ start: r.start, end: r.end });
    }
  }
  return { chars, ranges, unknown: false };
};

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
 */
export const isNullable = (
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
      return expr.elements.every((el) => isNullable(el, nullableRules));
    case "Choice":
      return expr.alternatives.some((alt) => isNullable(alt, nullableRules));
    case "Group":
      return isNullable(expr.expression, nullableRules);
    case "Star":
    case "Optional":
      return true;
    case "Plus":
      return isNullable(expr.expression, nullableRules);
    case "Quantified":
      return expr.min === 0 || isNullable(expr.expression, nullableRules);
    case "PositiveLookahead":
    case "NegativeLookahead":
      // Zero-width assertions: never consume input themselves.
      return true;
    case "LabeledExpression":
    case "ActionExpression":
      return isNullable(expr.expression, nullableRules);
    default:
      return true;
  }
};

const sequenceFirstSet = (
  expr: Sequence,
  ctx: ReadonlyMap<string, FirstSet>,
  nullableRules: ReadonlyMap<string, boolean>,
): FirstSet => {
  let result = EMPTY_FIRST_SET;
  for (const element of expr.elements) {
    result = unionFirstSets(
      result,
      firstSetOfExpression(element, ctx, nullableRules),
    );
    if (!isNullable(element, nullableRules)) {
      // This element can't match zero characters, so nothing after it
      // can contribute to what the *sequence* might start with.
      break;
    }
  }
  return result;
};

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
      return expr.value === ""
        ? EMPTY_FIRST_SET
        : singleCharFirstSet(expr.value[0] as string);
    case "CharacterClass":
      return charClassFirstSet(expr);
    case "AnyChar":
      return UNKNOWN_FIRST_SET;
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
      // `unknown` before this ever matters in practice.
      return EMPTY_FIRST_SET;
    case "LabeledExpression":
    case "ActionExpression":
      return firstSetOfExpression(
        expr.expression,
        ruleFirstSets,
        nullableRules,
      );
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
      if (isNullable(rule.pattern, nullable)) {
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
  if (a.chars.size !== b.chars.size) return false;
  for (const c of a.chars) if (!b.chars.has(c)) return false;
  if (a.ranges.length !== b.ranges.length) return false;
  return a.ranges.every(
    (r, i) => r.start === b.ranges[i]?.start && r.end === b.ranges[i]?.end,
  );
};

export interface GrammarFirstSetAnalysis {
  readonly firstSets: ReadonlyMap<string, FirstSet>;
  readonly nullableRules: ReadonlyMap<string, boolean>;
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

  return { firstSets, nullableRules };
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
): {
  chars: ReadonlySet<string>;
  ranges: readonly CharRangeLiteral[];
} | null => {
  if (isNullable(expr, analysis.nullableRules)) return null;
  const fs = firstSetOfExpression(
    expr,
    analysis.firstSets,
    analysis.nullableRules,
  );
  if (fs.unknown) return null;
  return { chars: fs.chars, ranges: fs.ranges };
};
