/**
 * Compiling a whole rule's
 * pattern into a single `regexFused` call (`packages/core/src/
 * regex-fused.ts`) when that pattern denotes a regular language -- i.e.
 * contains no non-terminal references -- so a `Sequence` of N leaf
 * combinators (each allocating a `Pos`/`ParseSuccess` per character) is
 * replaced by one `RegExp.exec`.
 *
 * The gate measurement backing this found ~82-87% of leaf-parser
 * invocations in the JSON and unfactored-arithmetic bench grammars
 * (`packages/parser/bench/grammars.ts`) belong to wholly-clean rules, with
 * a ~6.7x collapse factor (leaf invocations per rule entry) -- both
 * numbers high enough to justify this module.
 *
 * ## Two independent conditions, both required
 *
 * 1. **Structural**: the rule's pattern contains no `Identifier` /
 *    `QualifiedIdentifier` / `ActionExpression` / `LabeledExpression` /
 *    lookahead / `Cut` (see `isStructurallyFusable`). This is what makes
 *    "compile to a regex" meaningful at all -- a subtree with a
 *    non-terminal reference isn't a regular language, and an action's
 *    code is opaque to this module by construction.
 *
 *    A further, narrower structural restriction applies to `Star`/`Plus`/
 *    `Quantified`: their wrapped expression must be a *simple* leaf
 *    (`CharacterClass`, `AnyChar`, or a single-code-point `StringLiteral`)
 *    -- see "Shape reconstruction" below for why.
 *
 * 2. **Determinism**: for every repetition (`Star`/`Plus`/`Quantified`)
 *    and every `Choice` inside the fusable subtree, the translation to a
 *    JS regex's greedy/backtracking behavior must coincide with PEG's
 *    possessive one (see `checkFusionSafe`). `./char-set.ts`'s exact
 *    `CharSet` intersection (via `firstSetsDisjoint`) is what makes this
 *    checkable at all -- an earlier, approximate FIRST-set representation
 *    couldn't prove disjointness for negated classes or lookahead-derived
 *    subtraction.
 *
 *    The classic counterexample (fixed in this module's test suite):
 *    `[a-z]* "x"` against `"abcx"`. PEG's `*` is possessive -- it
 *    consumes "abcx" in full and then fails to find an "x", so the whole
 *    match fails. A naive `/[a-z]*x/` backtracks `[a-z]*` down by one and
 *    succeeds. `FIRST([a-z]) ∩ FIRST("x") = {x} ≠ ∅` catches this.
 *
 *    Two refinements over the original two-clause wording
 *    (`FIRST(e) ∩ FIRST(next) = ∅ AND next non-nullable`), both found
 *    while investigating the gate measurement above and confirmed by
 *    hand-tracing before being coded here:
 *
 *    - The correct "what follows" isn't just the single adjacent sibling
 *      -- it's the *properly composed* FIRST set of everything remaining
 *      in the fused region from that point on, folding nullable elements
 *      through exactly the way `sequenceFirstSetFrom` (in `first-sets.ts`)
 *      already does internally for cut placement. `checkFusionSafe`
 *      reimplements that fold locally (via the exported `unionFirstSets`)
 *      because it needs to inject an externally-supplied `tail` at the
 *      base case, which the un-exported `sequenceFirstSetFrom` doesn't
 *      accept. With this, a trailing repetition -- nothing left in the
 *      fused region after it -- is automatically safe (its computed
 *      "follow" first-set is empty, and an empty first-set is disjoint
 *      from everything), matching the more fundamental reason it's safe:
 *      a JS regex engine never backtracks a quantifier to satisfy
 *      something that isn't even in the pattern.
 *    - `Choice` needs the analogous check, not just repetitions: `(?:a|b)`
 *      can also backtrack from `a` into `b` on a downstream failure,
 *      diverging from PEG's non-backtracking alternative commitment. Pairwise
 *      FIRST-disjointness among alternatives is necessary but not
 *      sufficient -- if `tail` (what follows the whole `Choice` in the
 *      fused region) is non-empty, no alternative may ALSO be nullable
 *      (a nullable alternative can always match empty regardless of
 *      disjointness, so the regex engine can reach it and continue into
 *      `tail` from the original position, something PEG's ordered choice
 *      would never do once an earlier alternative already matched a
 *      non-empty prefix and then failed downstream).
 *    - `Optional` is a QUANTIFIER (a greedy `{0,1}`, exactly like `?` in
 *      `checkFusionSafe`'s `Star`/`Plus`/`Quantified` case below), not a
 *      transparent wrapper like `Group` -- it needs the identical
 *      `firstSetsDisjoint(innerFirst, tail)` check, for the identical
 *      reason: `emit` compiles it to `(?:(X))?`, which backtracks to the
 *      empty branch on downstream failure, while PEG's `optional` is
 *      possessive. (Fixed after this module shipped -- see
 *      `checkFusionSafe`'s `Optional` case for the worked counterexample
 *      this closes: `"a"? "ab"` wrongly accepting `"ab"`.)
 *
 *    "Nothing outside the fused region can be part of the same regex" is
 *    the other half of why this is checkable at all: since `regexFused`
 *    is one atomic `exec()` from its caller's perspective (like any other
 *    leaf `Parser`), nothing outside a rule's own fused pattern can ever
 *    cause the *regex engine itself* to backtrack into a decision made
 *    inside it -- ordinary PEG-level backtracking (a caller's enclosing
 *    `Choice` retrying with a different alternative, or the whole rule
 *    being re-invoked from scratch) is unaffected either way. This is why
 *    the top-level call always starts with `tail = EMPTY_FIRST_SET`.
 *
 * ## Shape reconstruction (no cross-rule analysis needed)
 *
 * A rule's return VALUE shape must not change just because it happens to
 * be implemented with a regex internally -- any other rule that
 * references it (possibly via an `ActionExpression` that destructures a
 * `Sequence`'s positional tuple) must see byte-identical values whether
 * or not fusion happened. Rather than proving no caller depends on the
 * old shape (a whole-grammar analysis this module doesn't do), fusion
 * reconstructs the *exact* original shape from the regex's own capture
 * groups, computed once at codegen time from the same AST subtree that
 * generated the regex source:
 *
 * - `StringLiteral` needs no group -- codegen already knows its value.
 * - `CharacterClass`/`AnyChar`, standing alone, get their own capturing
 *   group (their value is exactly what that group captured).
 * - `Sequence` needs no group of its own; its value is an array of its
 *   elements' reconstructed values, in order (matches `sequence()`'s
 *   tuple shape).
 * - `Choice` wraps each alternative in a marker group (even a bare
 *   `StringLiteral` alternative, which otherwise has nothing to check);
 *   reconstruction picks the first alternative whose marker matched
 *   (exactly one will, given condition 2's disjointness) and yields its
 *   value.
 * - `Optional` gets a marker group around its wrapped expression;
 *   reconstruction yields `[value]` or `[]` (matches `optional()`'s
 *   `[T] | []` shape, NOT `T | null`).
 * - `Star`/`Plus`/`Quantified` capture their *entire* run in one group
 *   and reconstruct via `Array.from(capturedRun)` -- splitting the run
 *   back into one array entry per code point. This is exactly correct
 *   when the repeated element is a single code point per iteration
 *   (`CharacterClass`, `AnyChar`, a 1-code-point `StringLiteral`), and
 *   is why the structural condition above restricts repetitions to
 *   those three leaf kinds: JS regex has no way to recover *per-iteration*
 *   captures from a repeated *group* (a pattern like `(?:(a)(b))*`
 *   applied repeatedly only keeps the LAST iteration's submatch), so a
 *   repetition over anything
 *   compound (a `Sequence`, a multi-character `StringLiteral`, a nested
 *   repetition) can't be shape-reconstructed this way and is left
 *   unfused instead.
 *
 * Because reconstruction reproduces the pre-fusion shape exactly, no
 * caller-side analysis is needed -- unlike `leftFactorChoices`'s
 * `isShapeSensitiveRule` gate (which exists because THAT rewrite
 * genuinely changes value shape and has no reconstruction step).
 */

import {
  EMPTY_FIRST_SET,
  type FirstSet,
  type GrammarFirstSetAnalysis,
  firstSetOfExpression,
  firstSetsDisjoint,
  isNullable,
  unionFirstSets,
} from "./first-sets";
import type {
  CharacterClass,
  Expression,
  GrammarDefinition,
  RuleDefinition,
} from "./types";

const STRUCTURALLY_DISQUALIFYING = new Set<Expression["type"]>([
  "Identifier",
  "QualifiedIdentifier",
  "ActionExpression",
  "LabeledExpression",
  "PositiveLookahead",
  "NegativeLookahead",
  "Cut",
]);

/** A leaf that `Star`/`Plus`/`Quantified` may wrap and still be fusable
 * -- see the module doc comment's "Shape reconstruction" section for why
 * this excludes compound expressions and multi-code-point literals. */
const isSimpleRepeatable = (expr: Expression): boolean => {
  if (expr.type === "CharacterClass" || expr.type === "AnyChar") return true;
  if (expr.type === "StringLiteral") {
    return [...expr.value].length === 1;
  }
  return false;
};

/** Structural half of fusability -- see the module doc comment's
 * condition 1. Independent of input/grammar state, so it's checked once
 * per rule regardless of how many times `isRuleFusable` might otherwise
 * re-derive it. */
const isStructurallyFusable = (expr: Expression): boolean => {
  if (STRUCTURALLY_DISQUALIFYING.has(expr.type)) return false;
  switch (expr.type) {
    case "Sequence":
      return expr.elements.every(isStructurallyFusable);
    case "Choice":
      return expr.alternatives.every(isStructurallyFusable);
    case "Group":
    case "Optional":
      return isStructurallyFusable(expr.expression);
    case "Star":
    case "Plus":
    case "Quantified":
      return (
        isSimpleRepeatable(expr.expression) &&
        isStructurallyFusable(expr.expression)
      );
    case "StringLiteral":
    case "CharacterClass":
    case "AnyChar":
      return true;
    default:
      return false;
  }
};

const isEmptyFirst = (fs: FirstSet): boolean =>
  !fs.unknown && fs.set.length === 0;

/**
 * Determinism half of fusability -- see the module doc comment's
 * condition 2. `tail` is the already-composed `FirstSet` of whatever
 * follows `expr` within the fused region (NOT outside it -- see the
 * module doc comment for why the top-level call always passes
 * `EMPTY_FIRST_SET`).
 */
const checkFusionSafe = (
  expr: Expression,
  tail: FirstSet,
  analysis: GrammarFirstSetAnalysis,
): boolean => {
  switch (expr.type) {
    case "StringLiteral":
    case "CharacterClass":
    case "AnyChar":
      return true;
    case "Group":
      return checkFusionSafe(expr.expression, tail, analysis);
    case "Optional": {
      // `Optional` is a QUANTIFIER, not a transparent wrapper like
      // `Group`: `emit` compiles it to `(?:(X))?`, a greedy {0,1} regex
      // quantifier that backtracks to the empty branch on downstream
      // failure -- exactly like `*`/`+`/`{n,m}` below. PEG's `optional`
      // is possessive (it never gives X back once matched). Without
      // this check, `"a"? "ab"` fuses to `(?:(a))?ab`, which accepts
      // "ab" (backtracking the `?` to empty, then matching "ab") even
      // though the unfused parser requires `optional(literal("a"))` to
      // consume before `literal("ab")` runs at the SAME offset it
      // started at -- "ab" only has "a" available there, so the second
      // literal fails and the whole rule fails. Same disjointness
      // condition as Star/Plus/Quantified, same reason: if `FIRST(X)`
      // and `tail` are disjoint, `tail` can never be what a backtracked
      // empty branch was "supposed to" match, so the engine's greedy
      // choice and PEG's possessive one always agree.
      // Independent of the disjointness check above: when the wrapped
      // expression is itself nullable (can match zero-width -- e.g. a
      // nested `Optional`, an `Optional(Star(...))`, or a nullable
      // `Choice`/`Sequence`), `emit`'s `(?:(X))?` hits an ECMA-262
      // `RepeatMatcher` quirk. A `?`/`{0,1}` quantifier's continuation
      // rejects a zero-width match of its own body (the same rule that
      // stops `(a*)*` from looping forever), so when `X` matches only by
      // consuming nothing, the outer `?` backtracks to "didn't match" --
      // the marker group comes back `undefined` even though `X` legitimately
      // matched with zero width. Reconstruction then wrongly reports `[]`
      // instead of `[value]` (e.g. `("-"?)?` on "" reconstructs to `[]`
      // instead of the correct `[[]]`). No regex rewrite closes this, so
      // fusion is simply declined here; the rule falls back to the
      // (correct) unfused combinator path.
      if (isNullable(expr.expression, analysis.nullableRules)) return false;
      const innerFirst = firstSetOfExpression(
        expr.expression,
        analysis.firstSets,
        analysis.nullableRules,
      );
      if (!firstSetsDisjoint(innerFirst, tail)) return false;
      return checkFusionSafe(expr.expression, tail, analysis);
    }
    case "Sequence": {
      let follow = tail;
      for (let i = expr.elements.length - 1; i >= 0; i--) {
        const element = expr.elements[i] as Expression;
        if (!checkFusionSafe(element, follow, analysis)) return false;
        const elementFirst = firstSetOfExpression(
          element,
          analysis.firstSets,
          analysis.nullableRules,
        );
        follow = isNullable(element, analysis.nullableRules)
          ? unionFirstSets(elementFirst, follow)
          : elementFirst;
      }
      return true;
    }
    case "Choice": {
      const { alternatives } = expr;
      // Both checks below only matter when something follows the whole
      // Choice within the fused region: once ANY alternative succeeds
      // and nothing remains to satisfy, the match is immediately
      // complete for both a JS regex engine and PEG's ordered choice --
      // neither has a reason to reconsider, so neither pairwise overlap
      // nor a nullable alternative can cause a divergence. (Symmetric to
      // why a trailing repetition needs no disjointness check either.)
      // The discriminating case that DOES need these when `tail` is
      // non-empty: `Choice["ab", "a"]` followed by `"b"`, on input
      // "ab" -- PEG commits to "ab" (the first alternative that
      // matches), then fails to find "b" afterward, and never
      // reconsiders "a" (PEG's ordered choice doesn't backtrack once
      // matched). A naive `/(?:ab|a)b/` DOES backtrack the alternation
      // into "a", then succeeds on "b" -- a real divergence pairwise
      // FIRST-disjointness (which "ab" and "a" fail) correctly catches.
      if (!isEmptyFirst(tail)) {
        const firsts = alternatives.map((alt) =>
          firstSetOfExpression(alt, analysis.firstSets, analysis.nullableRules),
        );
        for (let i = 0; i < alternatives.length; i++) {
          for (let j = i + 1; j < alternatives.length; j++) {
            if (
              !firstSetsDisjoint(firsts[i] as FirstSet, firsts[j] as FirstSet)
            ) {
              return false;
            }
          }
        }
        for (const alt of alternatives) {
          if (isNullable(alt, analysis.nullableRules)) return false;
        }
      }
      return alternatives.every((alt) => checkFusionSafe(alt, tail, analysis));
    }
    case "Star":
    case "Plus":
    case "Quantified": {
      // No recursive `checkFusionSafe(inner, ...)` call here: `inner`
      // can only be a CharacterClass/AnyChar/1-code-point StringLiteral
      // (isStructurallyFusable's `isSimpleRepeatable` restriction, the
      // OTHER, independent gate `isRuleFusable` also runs) -- none of
      // which have any internal Choice/repetition of their own to check.
      // If that structural restriction is ever loosened to allow a
      // compound repeated element, this case must start recursing too.
      const inner = expr.expression;
      const isBounded =
        expr.type === "Quantified" &&
        expr.max !== undefined &&
        expr.max <= expr.min;
      if (!isBounded) {
        const innerFirst = firstSetOfExpression(
          inner,
          analysis.firstSets,
          analysis.nullableRules,
        );
        if (!firstSetsDisjoint(innerFirst, tail)) return false;
      }
      return true;
    }
    default:
      return false;
  }
};

/** Whether `rule`'s entire pattern can be compiled to a single fused
 * regex -- both conditions from the module doc comment. */
export const isRuleFusable = (
  rule: RuleDefinition,
  analysis: GrammarFirstSetAnalysis,
): boolean =>
  isStructurallyFusable(rule.pattern) &&
  checkFusionSafe(rule.pattern, EMPTY_FIRST_SET, analysis);

// ============================================================================
// Sub-expression fusion: soundness, profitability, and planning
//
// Everything above this point proves ONE thing: a fusable `Expression` e,
// substituted for itself, preserves the whole grammar's semantics
// (accepted language, stop position, and value) at ANY nesting depth --
// not just at rule top level. The "nothing outside a `regexFused`/
// `regexFusedMap` node can make the regex engine backtrack into it"
// argument (module doc comment, "Nothing outside the fused region...")
// is a property of `RegExp.exec` itself, not of where the node sits; the
// lift from "this one node's match/value is correct" to "the whole
// grammar's semantics are preserved" is ordinary PEG compositionality --
// every combinator in `packages/core` computes its result purely from
// its children's results at the offset it invoked them at, and can only
// ever ask a child to run again at a NEW offset (`zeroOrMore` re-
// invoking, an enclosing `choice` retrying a different alternative from
// the same start) -- never "give me a different answer for the same
// invocation." A child that is extensionally equal (same success/
// failure, same stop offset, same value) is therefore substitutable
// anywhere in the tree.
//
// `isRuleFusable`/`emitFusedRule` above apply that theorem at exactly
// one root per rule (`rule.pattern` itself). `planFusion` below applies
// it at every MAXIMAL fusable node reachable by walking a rule's pattern
// top-down -- "maximal" meaning: once a node qualifies, its children are
// never independently considered, both because a bigger fused region
// removes strictly more leaf-parser invocations than gluing several
// smaller ones together with combinators in between would, and because
// (S2 below) the structural gate that keeps `Star`/`Plus`/`Quantified`
// bodies to a single simple leaf must not be second-guessed by trying to
// fuse "each half separately" inside one.
//
// Required side conditions (beyond the two structural/determinism gates
// already enforced by `isStructurallyFusable`/`checkFusionSafe`):
//
// (S1) Every `checkFusionSafe` case -- Star/Plus/Quantified/Optional/
//      Choice -- must be sound (see that function's cases). Sub-
//      expression fusion multiplies the number of fused regions per
//      grammar roughly 10x over whole-rule fusion, so it multiplies
//      exposure to a soundness bug in any one of those cases
//      proportionally -- this is why the `Optional` gap (see the module
//      doc comment's condition-2 section) had to be closed first.
// (S2) `isSimpleRepeatable` (the extra restriction on what `Star`/
//      `Plus`/`Quantified` may wrap) must not be loosened to admit a
//      compound repeated element. `checkFusionSafe`'s own `Star`/`Plus`/
//      `Quantified` case deliberately does not recurse into `inner`,
//      relying on that restriction -- if it's ever loosened, that case
//      must start recursing too.
// (S3) Fusing narrows the farthest-failure watermark's precision (the
//      same way whole-rule fusion already does): a fused node that fails
//      partway through records the watermark at its OWN start offset,
//      not at the offset the sub-match actually diverged at. Never
//      affects success/value/stop-position -- only diagnostic precision
//      -- but sub-expression fusion means this can now happen in the
//      MIDDLE of a rule, not only at a rule boundary.
// (S4) Each fusion root gets its own fresh `GroupCounter` (`{next: 0}`)
//      -- `emitFusedExpression` already does this per call.
// ============================================================================

/** Sentinel weight for a node whose leaf-invocation count depends on the
 * INPUT, not just the grammar (any node containing an unbounded
 * repetition) -- always large enough to be worth fusing once it matches
 * more than a couple of characters. Kept as `Infinity` rather than an
 * arbitrary large finite number so `weight(e) === UNBOUNDED` reads as
 * exactly what it means, with no magic-constant comparison. */
const UNBOUNDED = Number.POSITIVE_INFINITY;

/**
 * Static estimate of how many leaf-parser (`literal`/`charClass`/
 * `negatedCharClass`/`anyChar`) INVOCATIONS fusing `expr` would remove --
 * `isProfitable`'s cost/benefit input. Not a prediction of the exact
 * count (that depends on the input at parse time); just enough to
 * distinguish "a bare leaf" (never worth fusing on its own -- see
 * `isProfitable`'s doc comment) from "several leaves in sequence" or
 * "anything with an unbounded repetition" (clearly worth it).
 */
const weight = (expr: Expression): number => {
  switch (expr.type) {
    case "StringLiteral":
    case "CharacterClass":
    case "AnyChar":
      return 1;
    case "Sequence":
      return expr.elements.reduce((sum, el) => sum + weight(el), 0);
    case "Choice":
      // Only one alternative ever runs per match -- fusing removes
      // whichever one the input actually takes, so the relevant figure
      // is the most expensive alternative, not their sum.
      return Math.max(...expr.alternatives.map(weight));
    case "Group":
    case "Optional":
      return weight(expr.expression);
    case "Star":
    case "Plus":
      return UNBOUNDED;
    case "Quantified":
      return expr.max === undefined
        ? UNBOUNDED
        : expr.max * weight(expr.expression);
    default:
      return 0;
  }
};

/**
 * Default minimum `weight` for a node to be worth fusing at all. A fused
 * node costs roughly 5 fixed allocations per successful match (regex
 * engine entry + `RegExpExecArray`, one substring per participating
 * capture group, one `ParseSuccess`) against roughly 2 for an unfused
 * leaf (one closure call, one `ParseSuccess` -- zero on the failure
 * path). Weight 1 (a bare `CharacterClass`/`StringLiteral`/`AnyChar`) is
 * a clear pessimization; weight 2 is roughly break-even; weight >= 3
 * wins. Anything containing an unbounded repetition (`weight` =
 * `UNBOUNDED`) clears this as soon as it matches more than a couple of
 * characters, which dominates in practice -- see `planFusion`'s doc
 * comment for how this interacts with `scope: "rule"`.
 */
export const MIN_FUSION_WEIGHT = 3;

const isProfitable = (expr: Expression, minWeight: number): boolean =>
  weight(expr) === UNBOUNDED || weight(expr) >= minWeight;

export interface FusionPlan {
  /** Fusion roots, by node IDENTITY (`===`), not structural equality --
   * two syntactically identical subtrees at different grammar positions
   * are different `Expression` objects with independent entries. A node
   * in this set compiles to one `regexFusedMap` call via
   * `emitFusedExpression`; its children are never generated/imported
   * separately. */
  readonly roots: ReadonlySet<Expression>;
  /** One entry per root, in discovery order -- for diagnostics/tests
   * that want to inspect what was planned without re-deriving it. */
  readonly sites: readonly {
    readonly expr: Expression;
    readonly weight: number;
  }[];
}

const EMPTY_FUSION_PLAN: FusionPlan = { roots: new Set(), sites: [] };

/**
 * Walks every rule in `grammar` top-down, marking the highest (maximal)
 * fusable node on each path as a fusion root and not descending into it
 * -- see the section comment above this function for the soundness
 * argument and required side conditions.
 *
 * `scope: "rule"` (byte-identical to this module's original whole-rule-
 * only behavior): considers only each rule's own top-level pattern,
 * using `isRuleFusable`'s exact predicate -- NOT gated by `isProfitable`,
 * so a rule like `boolean = "true" / "false"` (weight 1, a plain
 * `Choice` of literals) still fuses whole, matching every existing
 * `enableRegexFusion` behavior/test exactly.
 *
 * `scope: "subtree"` (the default, and the only mode that reaches
 * anything `scope: "rule"` couldn't): performs the full top-down walk,
 * descending into `LabeledExpression`/`ActionExpression` (the only way
 * to reach real, action-bearing grammars) and gating EVERY candidate --
 * including a whole rule's own top-level pattern -- on `isProfitable`.
 * That means `scope: "subtree"` can legitimately fuse LESS than
 * `scope: "rule"` for a rule whose entire pattern is a single bare leaf
 * (e.g. `nullLiteral = "null"`, weight 1): whole-rule mode fused it
 * unconditionally, subtree mode correctly declines, because a
 * `regexFusedMap` call there would be a pessimization relative to
 * `literal("null")`'s own zero-allocation success path. This is a
 * deliberate correction bundled into `scope: "subtree"`, not a
 * regression -- switching scopes is not guaranteed to be a superset in
 * either direction, it is two independently-computed, independently-
 * correct decisions.
 */
export const planFusion = (
  grammar: GrammarDefinition,
  analysis: GrammarFirstSetAnalysis,
  options: {
    readonly minWeight?: number;
    readonly scope?: "rule" | "subtree";
  } = {},
): FusionPlan => {
  const minWeight = options.minWeight ?? MIN_FUSION_WEIGHT;
  const scope = options.scope ?? "subtree";
  const roots = new Set<Expression>();
  const sites: { expr: Expression; weight: number }[] = [];

  const tryRoot = (expr: Expression, gateOnProfitability: boolean): boolean => {
    if (
      !isStructurallyFusable(expr) ||
      !checkFusionSafe(expr, EMPTY_FIRST_SET, analysis)
    ) {
      return false;
    }
    if (gateOnProfitability && !isProfitable(expr, minWeight)) return false;
    roots.add(expr);
    sites.push({ expr, weight: weight(expr) });
    return true;
  };

  const visit = (expr: Expression): void => {
    if (tryRoot(expr, true)) return; // maximal: do not descend into a root
    switch (expr.type) {
      case "Sequence":
        for (const el of expr.elements) visit(el);
        return;
      case "Choice":
        for (const alt of expr.alternatives) visit(alt);
        return;
      case "Group":
      case "Optional":
      case "Star":
      case "Plus":
      case "Quantified":
      case "PositiveLookahead":
      case "NegativeLookahead":
      case "LabeledExpression":
      case "ActionExpression":
        visit(expr.expression);
        return;
      default:
        // True leaves -- StringLiteral/CharacterClass/AnyChar/
        // Identifier/QualifiedIdentifier/Cut -- have no children to
        // recurse into, whether or not they themselves passed `tryRoot`
        // (an Identifier/QualifiedIdentifier/Cut always fails it; that's
        // the whole point of the structural gate). `Sequence`/`Choice`
        // are handled above and always recurse per-child even when the
        // node itself wasn't fusable as a whole, since one non-fusable
        // sibling (e.g. an `Identifier`) doesn't disqualify the others.
        return;
    }
  };

  if (scope === "rule") {
    for (const rule of grammar.rules) tryRoot(rule.pattern, false);
  } else {
    for (const rule of grammar.rules) visit(rule.pattern);
  }

  return roots.size === 0 ? EMPTY_FUSION_PLAN : { roots, sites };
};

// ============================================================================
// Regex source + reconstruction-expression emission
// ============================================================================

/** Escapes `s` for literal inclusion in a `u`-flag regex pattern. Plain
 * (non-astral, non-metacharacter) text and astral characters both pass
 * through unescaped -- only the fixed set of regex metacharacters needs
 * a backslash. */
const escapeRegexLiteral = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `\u{...}` escape for one code point -- valid inside a `u`-flag
 * pattern (including inside a bracket expression's range endpoints),
 * and side-steps needing to individually escape whichever of
 * `] ^ - \` a raw range endpoint might happen to be. */
const codePointEscape = (cp: number): string => `\\u{${cp.toString(16)}}`;

/** Renders a `CharacterClass`'s ranges as a `[...]`/`[^...]` bracket
 * expression body (no enclosing capturing group). */
const charClassBracketExpr = (expr: CharacterClass): string => {
  const body = expr.ranges
    .map((r) => {
      const startCp = r.start.codePointAt(0) as number;
      if (r.end === undefined) return codePointEscape(startCp);
      const endCp = r.end.codePointAt(0) as number;
      return `${codePointEscape(startCp)}-${codePointEscape(endCp)}`;
    })
    .join("");
  return `[${expr.negated ? "^" : ""}${body}]`;
};

/** Regex source for a *simple repeatable* leaf (see `isSimpleRepeatable`)
 * with NO capturing group of its own -- used only as the immediate
 * inner pattern of `Star`/`Plus`/`Quantified`, whose own group captures
 * the whole run instead (see the module doc comment's "Shape
 * reconstruction" section). */
const simpleLeafSource = (expr: Expression): string => {
  switch (expr.type) {
    case "CharacterClass":
      return charClassBracketExpr(expr);
    case "AnyChar":
      return "[\\s\\S]";
    case "StringLiteral":
      return escapeRegexLiteral(expr.value);
    default:
      throw new Error(
        `simpleLeafSource: unexpected node type ${expr.type} (isSimpleRepeatable should have rejected this earlier)`,
      );
  }
};

/** A mutable, shared group-index allocator: capturing-group numbers are
 * assigned in the same left-to-right order their opening parens appear
 * in the emitted regex source, so a single counter incremented at each
 * allocation site (always BEFORE recursing into that group's own
 * contents) reproduces the regex engine's own numbering exactly. */
interface GroupCounter {
  next: number;
}

interface Emitted {
  /** Regex source for this node (no enclosing delimiters/flags). */
  readonly pattern: string;
  /** A JS expression (source text) that evaluates to this node's
   * reconstructed value, given a variable named `m` in scope holding the
   * raw `RegExpExecArray` from the match (`m[0]` is the whole match,
   * `m[i + 1]` is capture group `i` -- `regexFusedMap`'s own indexing,
   * `packages/core/src/regex-fused.ts`). */
  readonly valueExpr: string;
}

/** `groupIndex` (0-based, in emission order) -> the expression reading
 * that capture group off the raw match array `regexFusedMap` hands its
 * callback. Centralized so the one index->expression mapping this module
 * depends on has exactly one place to get right. */
const groupRef = (groupIndex: number): string => `m[${groupIndex + 1}]`;

const emit = (expr: Expression, counter: GroupCounter): Emitted => {
  switch (expr.type) {
    case "StringLiteral":
      return {
        pattern: escapeRegexLiteral(expr.value),
        valueExpr: JSON.stringify(expr.value),
      };
    case "CharacterClass": {
      const groupIndex = counter.next++;
      return {
        pattern: `(${charClassBracketExpr(expr)})`,
        valueExpr: groupRef(groupIndex),
      };
    }
    case "AnyChar": {
      const groupIndex = counter.next++;
      return { pattern: "([\\s\\S])", valueExpr: groupRef(groupIndex) };
    }
    case "Group":
      return emit(expr.expression, counter);
    case "Sequence": {
      const parts = expr.elements.map((el) => emit(el, counter));
      return {
        pattern: parts.map((p) => p.pattern).join(""),
        valueExpr: `[${parts.map((p) => p.valueExpr).join(", ")}]`,
      };
    }
    case "Choice": {
      const markerIndices: number[] = [];
      const altPatterns: string[] = [];
      const altValueExprs: string[] = [];
      for (const alt of expr.alternatives) {
        const markerIndex = counter.next++;
        markerIndices.push(markerIndex);
        const { pattern, valueExpr } = emit(alt, counter);
        altPatterns.push(`(${pattern})`);
        altValueExprs.push(valueExpr);
      }
      // `reduceRight` without an initial value seeds the accumulator with
      // the LAST element untouched (never passed through the callback)
      // and folds right-to-left from there -- exactly the "no check
      // needed on the final fallback" shape this ternary chain wants,
      // since condition 2 already guarantees exactly one marker is
      // defined at runtime.
      const valueExpr = altValueExprs.reduceRight(
        (elseBranch, altExpr, i) =>
          `${groupRef(markerIndices[i] as number)} !== undefined ? ${altExpr} : ${elseBranch}`,
      );
      return { pattern: `(?:${altPatterns.join("|")})`, valueExpr };
    }
    case "Optional": {
      const markerIndex = counter.next++;
      const inner = emit(expr.expression, counter);
      return {
        pattern: `(?:(${inner.pattern}))?`,
        valueExpr: `${groupRef(markerIndex)} !== undefined ? [${inner.valueExpr}] : []`,
      };
    }
    case "Star":
    case "Plus":
    case "Quantified": {
      const groupIndex = counter.next++;
      const leafSource = simpleLeafSource(expr.expression);
      const quantifier =
        expr.type === "Star"
          ? "*"
          : expr.type === "Plus"
            ? "+"
            : expr.max === undefined
              ? `{${expr.min},}`
              : `{${expr.min},${expr.max}}`;
      const ref = groupRef(groupIndex);
      return {
        pattern: `((?:${leafSource})${quantifier})`,
        valueExpr: `${ref} === undefined ? [] : Array.from(${ref})`,
      };
    }
    default:
      throw new Error(
        `emit: unexpected node type ${expr.type} (isStructurallyFusable should have rejected this earlier)`,
      );
  }
};

export interface FusedRule {
  /** Regex source for the fused node (no enclosing delimiters/flags),
   * suitable for `regexFusedMap(source, description, (m) => valueExpr)`. */
  readonly source: string;
  /** A JS expression (source text) reconstructing the fused node's
   * original value shape from `m`, the raw `RegExpExecArray` a
   * `regexFusedMap` callback receives (`m[0]` = whole match, `m[i + 1]` =
   * capture group `i`). */
  readonly valueExpr: string;
}

/** Compiles `expr` (already confirmed fusable via `isStructurallyFusable`
 * + `checkFusionSafe`) to a regex source string and a value-reconstruction
 * expression -- the general form `emitFusedRule` (a whole rule's pattern
 * is just one particular `expr`) and sub-expression fusion (`planFusion`)
 * both build on. */
export const emitFusedExpression = (expr: Expression): FusedRule => {
  const counter: GroupCounter = { next: 0 };
  const { pattern, valueExpr } = emit(expr, counter);
  return { source: pattern, valueExpr };
};

/** Compiles `rule.pattern` (already confirmed fusable via `isRuleFusable`)
 * to a regex source string and a value-reconstruction expression. Thin
 * alias over `emitFusedExpression` kept for callers (and existing tests)
 * that think in terms of "fuse this whole rule." */
export const emitFusedRule = (rule: RuleDefinition): FusedRule =>
  emitFusedExpression(rule.pattern);
