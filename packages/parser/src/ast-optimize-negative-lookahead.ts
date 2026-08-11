/**
 * Negative-lookahead generalization: `!a b` -> a computed replacement,
 * whenever that's provably sound. Two independent clauses, tried in
 * order for each `[NegativeLookahead(a), b]` pair found as two adjacent
 * elements of a `Sequence`:
 *
 * 1. **Character-set difference** (the general form of the original
 *    `!a .` -> negated-character-class degeneration this module started
 *    as, where `b` was always `AnyChar`): whenever BOTH `a` and `b` are
 *    representable as a single-code-point `CharSet` (a `CharacterClass`,
 *    a 1-character `StringLiteral`, or `AnyChar` for the universal set --
 *    see `charSetView`), `!a b` matches code point `c` iff `c ∉ A ∧ c ∈
 *    B` iff `c ∈ B ∖ A` -- consuming exactly one code point either way.
 *    `!a b` is replaced by `CharacterClass(B ∖ A)`. Needs no FIRST-set
 *    analysis; subsumes the original `AnyChar`-only degeneration (`B =
 *    ALL_CHARS` makes `B ∖ A` just `complement(A)`); and fires even when
 *    `A`/`B` overlap (e.g. `!"\n" [^x]` -> `[^x\n]`), a case FIRST-set
 *    disjointness alone could never simplify since overlapping sets are
 *    never "disjoint." If `B ∖ A` is empty -- the pattern can never
 *    match (e.g. `!"a" "a"`) -- the pair is left untouched: synthesizing
 *    a "never matches" node isn't this pass's job, and a grammar author
 *    writing that is almost certainly not relying on it as intentional
 *    behavior worth preserving byte-for-byte.
 *
 * 2. **FIRST-disjoint deletion**: when clause 1 doesn't apply (`b` isn't
 *    representable as a single-code-point `CharSet` -- a multi-character
 *    literal, an `Identifier`, a `Sequence`, ...), `!a` is dropped
 *    entirely (`!a b -> b`) whenever `a` and `b` are BOTH non-nullable,
 *    `FIRST(a) ∩ FIRST(b) = ∅`, and `b` cannot commit (reach a `Cut`)
 *    without consuming input.
 *
 *    Proof: at the current position, if `a` fails, `!a` succeeds
 *    consuming nothing, so `!a b` behaves exactly like `b` there. If `a`
 *    succeeds, it consumed >= 1 character (non-nullable), so the current
 *    character is in `FIRST(a)` (a sound over-approximation of what `a`
 *    can start with); disjointness puts that character outside
 *    `FIRST(b)`. Since `b` is also non-nullable, a successful `b` at
 *    this position would need to consume >= 1 character starting with
 *    something in `FIRST(b)` -- which the current character isn't -- so
 *    `b` fails too. Either way, `!a b` and `b` agree ON RECOGNITION: both
 *    fail, or `!a` trivially succeeds and only `b`'s own outcome matters.
 *
 *    That proof alone is NOT enough, though -- it only shows both sides
 *    FAIL, not that they fail the SAME WAY. In the original, whenever `a`
 *    succeeds, `!a` fails immediately as an ORDINARY (non-`fatal`)
 *    leaf-level lookahead failure -- `b` is never even invoked. In the
 *    rewritten `b` alone, `b` for real runs, and if it has some nullable
 *    prefix followed by a `Cut` (e.g. `("x"? ~ "y")`, or a rule reference
 *    to such a pattern), that `Cut` fires regardless of what the current
 *    character actually is (a nullable prefix matches zero-width on ANY
 *    input), and `b`'s subsequent failure -- on exactly this
 *    outside-`FIRST(b)` character -- becomes FATAL instead. A fatal
 *    failure and an ordinary one are NOT interchangeable to whatever
 *    encloses `!a b`/`b` (an enclosing `Choice`/`Optional`/`Star`/`Plus`
 *    treats them differently -- see `commit`'s doc comment,
 *    `packages/core/src/combinators.ts`), so this pass additionally
 *    requires `!canCommitWithoutConsuming(b, analysis)` (`./first-sets.ts`
 *    -- the same check `codegen-optimized.ts`'s `predictiveChoice`
 *    null-filter safety already relies on for an analogous reason) before
 *    firing. This was found and fixed via
 *    `packages/parser/src/codegen-differential.spec.ts`'s fuzzing harness,
 *    once its generator started producing negated multi-range character
 *    classes and cut-bearing rule bodies in the same random grammar.
 *
 *    Lower value on its own than clause 1: it only fires where the
 *    grammar already wrote a provably-redundant `!a`, and
 *    `isShapeSensitiveRule`'s action/transform gate (shared with clause 1
 *    below) additionally excludes every action-bearing rule -- measured
 *    zero effect on any grammar in this repo's own bench/example corpus.
 *    Included anyway because it falls out of FIRST-set machinery this
 *    module needed to reach for regardless, at a small, self-contained
 *    marginal cost.
 *
 * Both clauses change value shape the same way the original `!a .`
 * degeneration did (`Sequence` contributes `[undefined, bVal]`, two
 * slots; the replacement contributes one -- the matched character for
 * clause 1, `bVal` alone for clause 2), so both use the same
 * `isShapeSensitiveRule` gate `leftFactorChoices` uses (see
 * `ast-optimize.ts`'s module doc comment).
 */

import { isShapeSensitiveRule } from "./ast-optimize-shared";
import {
  ALL_CHARS,
  type CharSet,
  complement,
  difference,
  fromChar,
  fromCodePointRange,
  isEmpty,
  toCharRanges,
  union,
} from "./char-set";
import {
  type GrammarFirstSetAnalysis,
  analyzeFirstSets,
  canCommitWithoutConsuming,
  firstSetOfExpression,
  firstSetsDisjoint,
  isNullable,
} from "./first-sets";
import type {
  CharacterClass,
  Expression,
  GrammarDefinition,
  RuleDefinition,
} from "./types";
import { createChoice, createSequence } from "./types";

/** A single-code-point `CharSet` view of `expr`, or `null` if `expr`
 * doesn't denote exactly one code point based only on its own structure
 * (independent of any grammar-wide analysis) -- a `CharacterClass`, a
 * 1-character `StringLiteral`, or `AnyChar` (the universal set). Exact,
 * unlike `first-sets.ts`'s `alwaysMatchesSet` (a deliberately narrower
 * "guaranteed lower bound" used for a different purpose): every code
 * point returned here is one this expression matches, and every code
 * point this expression matches is returned here. */
const charSetView = (expr: Expression): CharSet | null => {
  if (expr.type === "AnyChar") return ALL_CHARS;
  if (expr.type === "CharacterClass") {
    let raw: CharSet = [];
    for (const r of expr.ranges) {
      raw = union(
        raw,
        r.end === undefined
          ? fromChar(r.start)
          : fromCodePointRange(r.start, r.end),
      );
    }
    return expr.negated ? complement(raw) : raw;
  }
  if (expr.type === "StringLiteral" && [...expr.value].length === 1) {
    return fromChar(expr.value);
  }
  return null;
};

/**
 * Renders `set` as a `CharacterClass` AST node, choosing whichever of
 * `set` itself or `complement(set)` (negated) has FEWER ranges. Matters
 * because `set` here is typically `B ∖ A` (a `difference`), and for the
 * common case `A` = a small class and `B` = `AnyChar` (`ALL_CHARS`),
 * `B ∖ A` is `complement(A)` -- a set covering nearly the entire Unicode
 * code space, carved only where `A` excludes it. Emitting THAT directly
 * (`negated: false`) would produce a sprawling multi-range
 * `CharacterClass` (and, at codegen time, a correspondingly bloated
 * `Uint8Array`/range-list construction); emitting it as `negated(A)`
 * instead reproduces exactly what the pre-generalization `!a . -> [^a]`
 * degeneration already produced -- one small range list either way,
 * whichever side of the negation happens to be smaller.
 */
const charSetToCharacterClass = (set: CharSet): CharacterClass => {
  const ranges = toCharRanges(set);
  const negatedRanges = toCharRanges(complement(set));
  return negatedRanges.length < ranges.length
    ? { type: "CharacterClass", ranges: negatedRanges, negated: true }
    : { type: "CharacterClass", ranges, negated: false };
};

/** Clause 2's precondition: `a` and `b` are both non-nullable, share no
 * possible starting character, AND `b` cannot commit (reach a `Cut`)
 * without consuming input -- see this module's doc comment for the proof
 * that `!a b` and `b` then agree on every input, including the fatal/
 * ordinary distinction the FIRST-set-only argument alone misses. */
const isFirstDisjointDeletable = (
  a: Expression,
  b: Expression,
  analysis: GrammarFirstSetAnalysis,
): boolean =>
  !isNullable(a, analysis.nullableRules) &&
  !isNullable(b, analysis.nullableRules) &&
  firstSetsDisjoint(
    firstSetOfExpression(a, analysis.firstSets, analysis.nullableRules),
    firstSetOfExpression(b, analysis.firstSets, analysis.nullableRules),
  ) &&
  !canCommitWithoutConsuming(b, analysis);

const degenerateSequenceElements = (
  elements: Expression[],
  analysis: GrammarFirstSetAnalysis,
): Expression[] => {
  const result: Expression[] = [];
  let i = 0;
  while (i < elements.length) {
    const el = elements[i] as Expression;
    const next = elements[i + 1];
    if (el.type === "NegativeLookahead" && next !== undefined) {
      const excludeSet = charSetView(el.expression);
      const targetSet = charSetView(next);
      if (excludeSet && targetSet) {
        // Clause 1: character-set difference.
        const resultSet = difference(targetSet, excludeSet);
        if (!isEmpty(resultSet)) {
          result.push(charSetToCharacterClass(resultSet));
          i += 2;
          continue;
        }
      } else if (isFirstDisjointDeletable(el.expression, next, analysis)) {
        // Clause 2: FIRST-disjoint deletion (only reachable when clause 1
        // didn't apply -- `next` isn't a single-code-point CharSet).
        result.push(next);
        i += 2;
        continue;
      }
    }
    result.push(el);
    i++;
  }
  return result;
};

const degenerateNegativeLookaheadsInExpression = (
  expr: Expression,
  analysis: GrammarFirstSetAnalysis,
): Expression => {
  switch (expr.type) {
    case "Sequence": {
      const elements = degenerateSequenceElements(
        expr.elements.map((el) =>
          degenerateNegativeLookaheadsInExpression(el, analysis),
        ),
        analysis,
      );
      // A `[NegativeLookahead, b]` pair degenerating out of a 2-element
      // Sequence leaves exactly 1 element -- unwrap to that bare element
      // rather than emitting a needless `Sequence([x])` wrapper (whose
      // own `.val` would be `[xval]`, a 1-tuple, instead of `xval`
      // directly). Safe under the same rule-level shape gate that
      // already covers this transform.
      return elements.length === 1
        ? (elements[0] as Expression)
        : createSequence(elements);
    }
    case "Choice":
      return createChoice(
        expr.alternatives.map((alt) =>
          degenerateNegativeLookaheadsInExpression(alt, analysis),
        ),
      );
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
    case "Quantified":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "LabeledExpression":
    case "ActionExpression":
      return {
        ...expr,
        expression: degenerateNegativeLookaheadsInExpression(
          expr.expression,
          analysis,
        ),
      };
    default:
      return expr;
  }
};

/** Returns a new `GrammarDefinition` with `!a b` degenerated (see this
 * module's doc comment for both clauses) throughout every rule that
 * isn't shape-sensitive (see `ast-optimize.ts`'s module doc comment and
 * `isShapeSensitiveRule`). */
export const degenerateNegativeLookaheads = (
  grammar: GrammarDefinition,
): GrammarDefinition => {
  // Computed once, from the ORIGINAL (pre-rewrite) grammar, and used
  // only to decide this pass's own local edits -- the same "one analysis
  // per pass, discarded afterward" pattern `insertAutomaticCuts`/
  // `promoteGlobalCuts` already use elsewhere in this pipeline. A rule's
  // FIRST set / nullability is a property of the rules it references
  // (fixed, whole-grammar facts), not of what this pass does to some
  // OTHER part of a sequence, so reusing one snapshot throughout is
  // sound; downstream passes that need FIRST sets on the rewritten
  // grammar (e.g. `promoteGlobalCuts` in the CLI pipeline) already
  // recompute fresh rather than reusing this one.
  const analysis = analyzeFirstSets(grammar);
  const rules: RuleDefinition[] = grammar.rules.map((rule) =>
    isShapeSensitiveRule(grammar, rule)
      ? rule
      : {
          ...rule,
          pattern: degenerateNegativeLookaheadsInExpression(
            rule.pattern,
            analysis,
          ),
        },
  );

  return { ...grammar, rules };
};
