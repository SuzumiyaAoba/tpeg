/**
 * Semantics-preserving AST -> AST rewrites, applied before codegen.
 *
 * This is a standalone utility, NOT wired into `generateTypeScriptParser`
 * or `generateOptimizedTypeScriptParser` -- call it explicitly (or via
 * `applyAstOptimizations`, which runs all three rewrites below) on a
 * `GrammarDefinition` before generating code from it. Keeping it opt-in
 * avoids repeating Phase 0's mistake (an "optimization" that silently
 * changed accepted behavior for every existing caller by default).
 *
 * Three independent rewrites live here: `leftFactorChoices` (below),
 * `mergeCharacterClasses` (`[a-z] / [A-Z]` -> `[a-zA-Z]`), and
 * `degenerateNegativeLookaheads` (`!a .` -> a negated character class) --
 * see each export's own doc comment for its specific reasoning. The
 * shape-safety discussion in this comment (rule-level action/transform
 * gate, label handling) applies to `leftFactorChoices` and
 * `degenerateNegativeLookaheads`; `mergeCharacterClasses` never changes
 * value shape and needs none of it.
 *
 * ## Left factoring
 *
 * `leftFactorChoices` targets exactly one PEG backtracking pattern: a
 * `Choice` whose alternatives all start with the same element, e.g.
 *
 *   sum = product "+" sum / product "-" sum / product
 *
 * A naive backtracking PEG implementation reparses `product` from
 * scratch for every alternative that's tried after the first fails --
 * `packages/parser/bench/grammars.ts`'s `BENCH_UNFACTORED_ARITHMETIC_GRAMMAR`
 * exists specifically to make this cost measurable (see
 * `packages/parser/bench/run.ts`). Rewriting the choice as
 *
 *   sum = product (("+" sum) / ("-" sum) / ())
 *
 * parses the shared prefix once. This is sound because every parser this
 * codebase generates is a pure, deterministic function of (input,
 * position) -- calling `product` twice at the same position is
 * guaranteed to reproduce the same result, so replacing "parse it twice"
 * with "parse it once and reuse the result" cannot change which inputs
 * are accepted or where a resulting parse stops.
 *
 * ## Soundness restrictions (deliberately conservative)
 *
 * Rewriting a `Choice(Sequence(P, X1, X2), Sequence(P, Y1))` into
 * `Sequence(P, Choice(Sequence(X1, X2), Y1))` preserves *language
 * accepted* and *stop position*, but changes the shape of `.val`: the
 * original produces a flat `[Pval, X1val, X2val]` for the first
 * alternative, the factored form produces `[Pval, [X1val, X2val]]` (an
 * extra nesting level from the inner choice). Nothing in this codebase's
 * runtime normalizes that away.
 *
 * That's harmless for a rule nobody reads `.val`/`$$` from, but codegen
 * (`packages/parser/src/codegen.ts`) exposes the raw value shape to two
 * things: an inline `expr { code }` action's `$$`, and a rule-name-matched
 * `transforms` function's `captures`. Both would silently start reading a
 * differently-shaped value after this rewrite. Rather than trying to
 * prove no ancestor action depends on a specific rule's shape (which
 * would require whole-grammar reachability analysis), this function
 * simply refuses to touch any rule that could plausibly be shape-
 * sensitive:
 *
 * - A rule is skipped entirely (no choice inside it is factored) if its
 *   pattern contains an `ActionExpression` anywhere, or if `grammar`
 *   attaches a `transforms` function with a matching name -- both read
 *   that rule's own `.val` as `$$`/`captures`.
 * - A `Choice` is skipped if it (or any of its alternatives, at any
 *   depth) contains a `LabeledExpression`, independent of the rule-level
 *   check above: `codegen.ts`'s `collectTopLevelLabels` looks for labels
 *   as *immediate* children of a `Sequence`, so demoting a label from
 *   top-level to nested-inside-a-newly-introduced-wrapper would silently
 *   break codegen's own label detection, regardless of whether any
 *   action or transform ever reads the result.
 *
 * The remaining, uncovered risk: a rule with no action/transform/label of
 * its own could still be referenced via `Identifier` from an ancestor
 * rule whose *own* action reads deep into a nested structure it expects
 * a specific shape from. This is not checked. Given that, treat this as
 * a narrowly-scoped, explicitly opt-in optimization for shape-insensitive
 * (recognizer-only, or known action/transform-free) grammars -- not a
 * general-purpose optimizer safe to wire into default codegen output.
 *
 * ## Alternative shapes handled
 *
 * Only a `Choice` where the shared prefix is one of `StringLiteral`,
 * `CharacterClass`, `AnyChar`, `Identifier`, or `QualifiedIdentifier` is
 * factored -- these are the terminal/reference node types that cannot
 * themselves embed an `ActionExpression`, so checking the prefix's own
 * type is enough without a subtree walk. `Sequence`/`Choice`/`Group`/
 * quantifiers etc. are never treated as a factorable prefix, even if two
 * alternatives happen to start with structurally identical ones.
 *
 * At most one alternative may be the bare shared prefix with nothing
 * following it (remainder length 0), and it must be the *last*
 * alternative -- e.g. the trailing `/ product` above. That case is folded
 * into `Sequence(P, Optional(inner))` rather than `Sequence(P, inner)`:
 * `product "+" sum / product "-" sum / product` becomes
 * `product (("+" sum) / ("-" sum))?`. This is sound for the same reason
 * as the non-bare case (calling `P` twice at one position reproduces the
 * same result) -- if `inner` fails to match right after `P`, `optional`
 * succeeds having consumed nothing, so the whole sequence still stops
 * exactly where the bare `P` alternative would have, without reparsing
 * `P` a second time to get there. Its `.val` shape becomes `[Pval,
 * [Xval]]` (`inner` matched) or `[Pval, []]` (it didn't) -- a different
 * shape from the non-bare case's `[Pval, Xval]`, on top of the difference
 * from the original grammar's unfactored shapes already described above;
 * still gated by the same `isShapeSensitiveRule` check. A bare-prefix
 * alternative anywhere other than last, or more than one of them, is left
 * untouched (not factored) -- handling arbitrary interleaving isn't
 * needed by any grammar in this repo and isn't implemented.
 *
 * ## Automatic cut insertion
 *
 * `insertAutomaticCuts` (below, separate from the three rewrites above
 * and NOT included in `applyAstOptimizations`'s default chain -- see its
 * own doc comment for why) inserts a `Cut` (`~`) into a `Choice`
 * alternative wherever one or more of its immediately-following siblings
 * are *provably* unreachable once the current one has matched a certain
 * prefix.
 *
 * The naive framing -- "search for the longest prefix that still lets
 * later alternatives be ruled out" -- turns out to collapse to a single
 * check: a non-nullable-terminated prefix's FIRST set never changes as
 * more elements are appended after it (`firstSetOfExpression`'s
 * `Sequence` handling breaks at the first non-nullable element
 * regardless of how many more elements follow), so there is exactly one
 * candidate cut *position* per alternative -- right after its first
 * non-nullable element -- not a range of positions to search over.
 *
 * This provides essentially zero benefit against expensive
 * re-computation (that's what `leftFactorChoices` and memoization are
 * for) -- a FIRST-disjoint sibling was already going to be rejected on
 * its very first character comparison, cut or not. The actual saving is
 * that a rejection is not free in this runtime: every failing
 * alternative -- even one that fails on its first character -- builds an
 * error object and an interpolated message string before `choice`
 * discards it (see `packages/core/src/combinators.ts`'s failure path).
 * Skipping N-1 of those constructions per backtrack is a measurable
 * constant-factor win despite each one being an O(1) check.
 *
 * ### Partial exclusion via ordered-choice associativity
 *
 * An alternative's *position* is unique, but which siblings it can
 * exclude is not all-or-nothing: it can only exclude a *contiguous run*
 * of siblings starting immediately after it (once a sibling fails the
 * disjointness/nullability check, nothing past it can be skipped either,
 * since skipping it would require proving IT can never match here too).
 * If that run doesn't reach all the way to the end of the `Choice`, a
 * bare `Cut` spliced into the alternative's own position can't be used
 * as-is: `choice`'s fatal-short-circuit (`packages/core/src/combinators.ts`)
 * stops trying literally everything after the committed alternative, not
 * just the ones proven excluded -- inserting a cut there would silently
 * reject input a genuinely-reachable later sibling could have matched.
 *
 * The fix is ordered choice's associativity: `choice(A,B,C,D)` behaves
 * identically to `choice(choice(A,B,C), D)` for any grouping of a
 * contiguous run (the two are literally the same accepted language and
 * stop position, by construction -- grouping changes nothing about which
 * alternative is tried when). So when `A` can prove `B` and `C` excluded
 * but not `D`, this regroups the `Choice`'s alternative list into
 * `choice(choice(A-with-cut, B, C), D)`: `A`'s cut can now fire freely
 * (fatal-stopping only the *inner* choice's remaining alternatives, `B`
 * and `C`), while the *inner* choice absorbs that `fatal` flag at its own
 * boundary (the same absorption `choice`/`captureChoice` always do for
 * any nested cut, per `commit`'s doc comment) before it ever reaches the
 * *outer* choice -- so `D` is unaffected and still tried normally. See
 * `computeCutCandidate`/`buildCutGroups` below for the implementation;
 * when a run happens to cover every remaining alternative (the case the
 * pre-Pillar-3 all-or-nothing check already handled), the result
 * collapses back to the same flat, unnested `Choice` shape as before --
 * this is a strict generalization, not a replacement, of the original
 * behavior.
 *
 * `buildCutGroups` is a greedy left-to-right grouping, not a globally
 * optimal one: once an alternative's excludable run is grouped, the
 * members INSIDE that run still get their own chance at excluding a
 * further sub-run of siblings within it (recursively), but the algorithm
 * never backtracks to ask whether a *different* starting alternative
 * would have excluded strictly more overall. This can't produce an
 * unsound result -- each individual (alternative, run) grouping is sound
 * on its own, by the associativity argument above, so any grouping this
 * function picks is sound regardless of which one it picks -- it can only
 * under-deliver relative to some other valid grouping, never over-deliver
 * incorrectly.
 *
 * A `Choice` containing a `LabeledExpression` anywhere in any alternative
 * (`containsLabel`, same helper `leftFactorChoices` uses) is NOT
 * regrouped at all: it falls back to the original, pre-Pillar-3
 * all-or-nothing check (`findCutPosition`, which never restructures the
 * `Choice`'s own shape, only splices a bare `Cut` into an alternative's
 * existing `Sequence`). Regrouping changes which `Choice` node a labeled
 * alternative sits as an immediate child of, and this module hasn't
 * proven that's safe for however codegen locates/merges labels within a
 * `Choice` -- the same conservative reasoning `leftFactorChoices` already
 * applies to a labeled `Choice`, reused here rather than re-derived.
 */

import type { GrammarFirstSetAnalysis } from "./first-sets";
import {
  analyzeFirstSets,
  firstSetOfExpression,
  firstSetsDisjoint,
  isNullable,
} from "./first-sets";
import type {
  CharacterClass,
  Choice,
  Expression,
  GrammarDefinition,
  Identifier,
  QualifiedIdentifier,
  RuleDefinition,
  Sequence,
  StringLiteral,
} from "./types";
import {
  createChoice,
  createCut,
  createOptional,
  createSequence,
} from "./types";

/** Node types that cannot themselves embed an `ActionExpression` or
 * `LabeledExpression`, so a single-type check on the node itself
 * (no subtree walk) is enough to know it's a safe factoring prefix. */
type FactorablePrefix =
  | StringLiteral
  | CharacterClass
  | { type: "AnyChar" }
  | Identifier
  | QualifiedIdentifier;

const isFactorablePrefixType = (expr: Expression): expr is FactorablePrefix =>
  expr.type === "StringLiteral" ||
  expr.type === "CharacterClass" ||
  expr.type === "AnyChar" ||
  expr.type === "Identifier" ||
  expr.type === "QualifiedIdentifier";

const charRangesEqual = (
  a: CharacterClass["ranges"],
  b: CharacterClass["ranges"],
): boolean =>
  a.length === b.length &&
  a.every((r, i) => r.start === b[i]?.start && r.end === b[i]?.end);

/** Structural equality for two factorable-prefix nodes of possibly
 * different types (returns false on a type mismatch). */
const prefixesEqual = (a: Expression, b: Expression): boolean => {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "StringLiteral":
      return a.value === (b as StringLiteral).value;
    case "AnyChar":
      return true;
    case "Identifier":
      return a.name === (b as Identifier).name;
    case "QualifiedIdentifier":
      return (
        a.module === (b as QualifiedIdentifier).module &&
        a.name === (b as QualifiedIdentifier).name
      );
    case "CharacterClass": {
      const other = b as CharacterClass;
      return (
        a.negated === other.negated && charRangesEqual(a.ranges, other.ranges)
      );
    }
    default:
      return false;
  }
};

/** Does `expr` contain a `LabeledExpression` anywhere in its subtree? */
const containsLabel = (expr: Expression): boolean => {
  switch (expr.type) {
    case "LabeledExpression":
      return true;
    case "Sequence":
      return expr.elements.some(containsLabel);
    case "Choice":
      return expr.alternatives.some(containsLabel);
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "Quantified":
      return containsLabel(expr.expression);
    case "ActionExpression":
      return containsLabel(expr.expression);
    default:
      return false;
  }
};

/** Does `expr` contain an `ActionExpression` anywhere in its subtree? */
const containsAction = (expr: Expression): boolean => {
  switch (expr.type) {
    case "ActionExpression":
      return true;
    case "Sequence":
      return expr.elements.some(containsAction);
    case "Choice":
      return expr.alternatives.some(containsAction);
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "Quantified":
    case "LabeledExpression":
      return containsAction(expr.expression);
    default:
      return false;
  }
};

const partsOf = (expr: Expression): Expression[] =>
  expr.type === "Sequence" ? (expr as Sequence).elements : [expr];

const toSingleExpression = (parts: Expression[]): Expression =>
  parts.length === 1 ? (parts[0] as Expression) : createSequence(parts);

/**
 * Attempts to left-factor a single `Choice` node. Returns the original
 * node unchanged if the safety/shape conditions above aren't met.
 */
const tryLeftFactorChoice = (choice: Choice): Expression => {
  const { alternatives } = choice;
  if (alternatives.length < 2) return choice;
  if (containsLabel(choice)) return choice;

  const partsList = alternatives.map(partsOf);
  if (partsList.some((parts) => parts.length === 0)) return choice;

  // At most one bare-prefix (remainder length 0) alternative, and only
  // as the last one -- see the "Alternative shapes handled" doc above.
  const bareIndices = partsList
    .map((parts, i) => (parts.length === 1 ? i : -1))
    .filter((i) => i >= 0);
  if (bareIndices.length > 1) return choice;
  if (bareIndices.length === 1 && bareIndices[0] !== partsList.length - 1) {
    return choice;
  }

  const groupedCount =
    bareIndices.length === 1 ? partsList.length - 1 : partsList.length;
  if (groupedCount < 2) return choice;

  const groupedParts = partsList.slice(0, groupedCount);
  const prefix = groupedParts[0]?.[0];
  if (!prefix || !isFactorablePrefixType(prefix)) return choice;
  if (
    !groupedParts.every((parts) =>
      prefixesEqual(parts[0] as Expression, prefix),
    )
  ) {
    return choice;
  }

  const innerAlternatives = groupedParts.map((parts) =>
    toSingleExpression(parts.slice(1)),
  );
  const innerExpr =
    innerAlternatives.length === 1
      ? (innerAlternatives[0] as Expression)
      : createChoice(innerAlternatives);

  if (bareIndices.length === 0) {
    return createSequence([prefix, innerExpr]);
  }
  // Trailing bare-prefix alternative: fold into `prefix (inner)?` rather
  // than reparsing `prefix` a second time for a separate bare alternative
  // -- see the module doc comment's "Alternative shapes handled" section.
  return createSequence([prefix, createOptional(innerExpr)]);
};

/** Recursively applies `tryLeftFactorChoice` to every `Choice` reachable
 * from `expr`, bottom-up (children first, so a factored inner choice is
 * itself eligible to be the target of an outer factoring). */
const leftFactorExpression = (expr: Expression): Expression => {
  switch (expr.type) {
    case "Sequence":
      return createSequence(expr.elements.map(leftFactorExpression));
    case "Choice": {
      const factoredAlternatives = expr.alternatives.map(leftFactorExpression);
      return tryLeftFactorChoice(createChoice(factoredAlternatives));
    }
    case "Group":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "Star":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "Plus":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "Optional":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "Quantified":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "PositiveLookahead":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "NegativeLookahead":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "LabeledExpression":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "ActionExpression":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    default:
      return expr;
  }
};

const grammarHasTransformFor = (
  grammar: GrammarDefinition,
  ruleName: string,
): boolean =>
  (grammar.transforms ?? []).some((def) =>
    def.transformSet.functions.some((fn) => fn.name === ruleName),
  );

/**
 * True if `rule`'s own `.val` could be read positionally -- by an inline
 * `ActionExpression` anywhere in its pattern (`$$`), or by a `transforms`
 * function matched to it by name (`captures`). Shared by every rewrite in
 * this module that can change a rule's value *shape* (element count or
 * nesting) without changing which inputs it accepts: `leftFactorChoices`
 * and `degenerateNegativeLookaheads`. `mergeCharacterClasses` doesn't use
 * this gate because it never changes value shape (see its own doc
 * comment).
 */
const isShapeSensitiveRule = (
  grammar: GrammarDefinition,
  rule: RuleDefinition,
): boolean =>
  containsAction(rule.pattern) || grammarHasTransformFor(grammar, rule.name);

/**
 * Returns a new `GrammarDefinition` with left factoring applied to every
 * rule that isn't shape-sensitive (see the module doc comment). Rules
 * that are skipped are returned unchanged (same object reference).
 */
export const leftFactorChoices = (
  grammar: GrammarDefinition,
): GrammarDefinition => {
  const rules: RuleDefinition[] = grammar.rules.map((rule) =>
    isShapeSensitiveRule(grammar, rule)
      ? rule
      : { ...rule, pattern: leftFactorExpression(rule.pattern) },
  );

  return { ...grammar, rules };
};

// ============================================================================
// Character class merging: `[a-z] / [A-Z]` -> `[a-zA-Z]`
// ============================================================================
//
// Unlike left factoring, this never changes value shape: a matching
// `CharacterClass` always returns the one matched character as its `.val`,
// whichever alternative of the original `Choice` it came from -- the
// merged class returns the exact same character for the exact same
// inputs. No rule-level safety gate is needed.
//
// Restricted to *non-negated* `CharacterClass` alternatives (plus
// single-character `StringLiteral`s, treated as a one-range class): a
// negated class already reads "any character NOT in these ranges", and
// merging two negated classes by unioning ranges would compute the wrong
// set (De Morgan's law wants an *intersection* of ranges there, not a
// union) -- rather than get that subtly wrong, negated classes are left
// untouched.

/** A `CharacterClass`-equivalent view of `expr`, or `null` if `expr`
 * isn't safely mergeable (negated classes excluded -- see doc above). */
const charClassView = (expr: Expression): CharacterClass | null => {
  if (expr.type === "CharacterClass" && !expr.negated) return expr;
  if (expr.type === "StringLiteral" && expr.value.length === 1) {
    return {
      type: "CharacterClass",
      ranges: [{ start: expr.value }],
      negated: false,
    };
  }
  return null;
};

const mergeCharacterClassRanges = (
  classes: CharacterClass[],
): CharacterClass => ({
  type: "CharacterClass",
  ranges: classes.flatMap((c) => c.ranges),
  negated: false,
});

/** Merges each maximal run of >=2 consecutive mergeable alternatives into
 * one `CharacterClass`; a lone mergeable alternative (no adjacent partner)
 * and any non-mergeable alternative are returned unchanged, in place. */
const mergeAdjacentCharacterClasses = (
  alternatives: Expression[],
): Expression[] => {
  const result: Expression[] = [];
  let i = 0;
  while (i < alternatives.length) {
    const view = charClassView(alternatives[i] as Expression);
    if (!view) {
      result.push(alternatives[i] as Expression);
      i++;
      continue;
    }
    const run: CharacterClass[] = [view];
    let j = i + 1;
    while (j < alternatives.length) {
      const nextView = charClassView(alternatives[j] as Expression);
      if (!nextView) break;
      run.push(nextView);
      j++;
    }
    result.push(
      run.length >= 2
        ? mergeCharacterClassRanges(run)
        : (alternatives[i] as Expression),
    );
    i = j;
  }
  return result;
};

const mergeCharacterClassesInExpression = (expr: Expression): Expression => {
  switch (expr.type) {
    case "Sequence":
      return createSequence(
        expr.elements.map(mergeCharacterClassesInExpression),
      );
    case "Choice": {
      const mergedAlternatives = mergeAdjacentCharacterClasses(
        expr.alternatives.map(mergeCharacterClassesInExpression),
      );
      return mergedAlternatives.length === 1
        ? (mergedAlternatives[0] as Expression)
        : createChoice(mergedAlternatives);
    }
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
        expression: mergeCharacterClassesInExpression(expr.expression),
      };
    default:
      return expr;
  }
};

/** Returns a new `GrammarDefinition` with adjacent mergeable
 * `CharacterClass`/single-character `StringLiteral` alternatives in every
 * `Choice` merged into one `CharacterClass`, throughout every rule. */
export const mergeCharacterClasses = (
  grammar: GrammarDefinition,
): GrammarDefinition => ({
  ...grammar,
  rules: grammar.rules.map((rule) => ({
    ...rule,
    pattern: mergeCharacterClassesInExpression(rule.pattern),
  })),
});

// ============================================================================
// Negative-lookahead degeneration: `!a .` -> a negated character class
// ============================================================================
//
// `Sequence([NegativeLookahead(a), AnyChar])` succeeds iff `a` does NOT
// match at the current position AND a character is available to consume,
// and then consumes exactly that one character -- exactly what a negated
// `CharacterClass` built from `a` does directly, provided `a` itself
// matches exactly one character based only on that character (a
// single-character `StringLiteral` or a `CharacterClass`; anything else,
// e.g. a multi-character literal or a rule reference, is left alone).
//
// This changes value shape (the `Sequence` contributes two array slots,
// `[undefined, char]`; the replacement contributes one, `char`), so it
// uses the same `isShapeSensitiveRule` gate as `leftFactorChoices`.

/** A negated-`CharacterClass` view of "not `expr`" for a single-character
 * `expr`, or `null` if `expr` doesn't match exactly one character based
 * only on that character's identity. */
const negatedCharClassView = (expr: Expression): CharacterClass | null => {
  if (expr.type === "CharacterClass") {
    return {
      type: "CharacterClass",
      ranges: expr.ranges,
      negated: !expr.negated,
    };
  }
  if (expr.type === "StringLiteral" && expr.value.length === 1) {
    return {
      type: "CharacterClass",
      ranges: [{ start: expr.value }],
      negated: true,
    };
  }
  return null;
};

const degenerateSequenceElements = (elements: Expression[]): Expression[] => {
  const result: Expression[] = [];
  let i = 0;
  while (i < elements.length) {
    const el = elements[i] as Expression;
    const next = elements[i + 1];
    if (el.type === "NegativeLookahead" && next?.type === "AnyChar") {
      const view = negatedCharClassView(el.expression);
      if (view) {
        result.push(view);
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
): Expression => {
  switch (expr.type) {
    case "Sequence": {
      const elements = degenerateSequenceElements(
        expr.elements.map(degenerateNegativeLookaheadsInExpression),
      );
      // A `[NegativeLookahead, AnyChar]` pair degenerating out of a
      // 2-element Sequence leaves exactly 1 element -- unwrap to that
      // bare element rather than emitting a needless `Sequence([x])`
      // wrapper (whose own `.val` would be `[xval]`, a 1-tuple, instead
      // of `xval` directly). Safe under the same rule-level shape gate
      // that already covers this transform.
      return elements.length === 1
        ? (elements[0] as Expression)
        : createSequence(elements);
    }
    case "Choice":
      return createChoice(
        expr.alternatives.map(degenerateNegativeLookaheadsInExpression),
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
        expression: degenerateNegativeLookaheadsInExpression(expr.expression),
      };
    default:
      return expr;
  }
};

/** Returns a new `GrammarDefinition` with `!a .` degenerated to a negated
 * character class throughout every rule that isn't shape-sensitive (see
 * the module doc comment and `isShapeSensitiveRule`). */
export const degenerateNegativeLookaheads = (
  grammar: GrammarDefinition,
): GrammarDefinition => {
  const rules: RuleDefinition[] = grammar.rules.map((rule) =>
    isShapeSensitiveRule(grammar, rule)
      ? rule
      : {
          ...rule,
          pattern: degenerateNegativeLookaheadsInExpression(rule.pattern),
        },
  );

  return { ...grammar, rules };
};

/**
 * Applies every rewrite in this module, in the order that lets later
 * passes see the earlier ones' output: degenerating `!a .` first can turn
 * two alternatives' prefixes into structurally-comparable character
 * classes that left factoring can then group, so it runs before
 * `leftFactorChoices`. `mergeCharacterClasses` has no such ordering
 * dependency and is run first.
 *
 * `insertAutomaticCuts` is deliberately NOT included here -- see its own
 * doc comment for why it's a separate, more cautious opt-in than the
 * three rewrites above.
 */
export const applyAstOptimizations = (
  grammar: GrammarDefinition,
): GrammarDefinition =>
  leftFactorChoices(
    degenerateNegativeLookaheads(mergeCharacterClasses(grammar)),
  );

// ============================================================================
// Automatic cut insertion
// ============================================================================
//
// See the module doc comment's "Automatic cut insertion" section for the
// theory (why this collapses to checking exactly one candidate position
// per alternative, and why the benefit is avoided failure-path
// allocation, not avoided re-computation).
//
// Soundness constraint, matching the danger `codegen-optimized.ts`
// documents around alternative reordering (`"==" / "="` reordered to
// `"=" / "=="` makes `==` permanently unmatchable): this rewrite must
// NEVER insert a cut based on a false claim of disjointness. Two guards
// enforce that:
// - `firstSetsDisjoint` treats `unknown` on either side as "not proven
//   disjoint" (see its own doc comment) -- it only returns `true` when
//   every character in one set is provably absent from the other.
// - A later alternative that is itself (possibly) nullable is NEVER
//   treated as excluded, however disjoint its FIRST set looks: a
//   nullable alternative can succeed by consuming nothing, and "the
//   input's next character doesn't start it" says nothing about whether
//   it could still match zero characters right here.
//
// Unlike `leftFactorChoices`/`degenerateNegativeLookaheads`, this needs
// no `isShapeSensitiveRule` gate: a `Cut` node occupies no tuple slot
// (`docs/peg-grammar.md`) and `codegen.ts`/`codegen-optimized.ts` already
// drop it from the emitted arguments, wrapping only the elements after it
// in `commit(...)` -- inserting one changes failure behavior, never
// `.val` shape.

/**
 * Finds the number of leading elements of `alternative` after which a
 * `Cut` is provably safe to insert, or `null` if there is no such
 * position, WITHOUT restructuring the enclosing `Choice` -- the original,
 * pre-Pillar-3 all-or-nothing check, kept as the fallback for a `Choice`
 * containing a `LabeledExpression` (see the module doc comment's
 * "Partial exclusion via ordered-choice associativity" section for why
 * that case doesn't use `computeCutCandidate`/`buildCutGroups` below).
 * Only considers a `Sequence` of >= 2 elements: a single-element
 * alternative either fully succeeds or fully fails atomically, so it has
 * no interior position to protect a later partial failure at, and a cut
 * as the very last element is a documented no-op.
 */
const findCutPosition = (
  alternative: Expression,
  laterAlternatives: readonly Expression[],
  analysis: GrammarFirstSetAnalysis,
): number | null => {
  if (alternative.type !== "Sequence") return null;
  const { elements } = alternative;
  if (elements.length < 2) return null;

  // The one candidate position: right after the first non-nullable
  // element (1-based count of elements up to and including it). Elements
  // before it are all nullable, so nothing is guaranteed consumed until
  // this one; elements after it can't change the prefix's FIRST set (see
  // module doc comment), so there is nothing to gain by looking further.
  let k = 0;
  while (
    k < elements.length &&
    isNullable(elements[k] as Expression, analysis.nullableRules)
  ) {
    k++;
  }
  k++;
  if (k >= elements.length) return null; // no-op-as-last, or fully nullable

  const prefix = createSequence(elements.slice(0, k));
  const prefixFirst = firstSetOfExpression(
    prefix,
    analysis.firstSets,
    analysis.nullableRules,
  );
  if (prefixFirst.unknown) return null;

  // For the LAST alternative of a Choice, `laterAlternatives` is empty,
  // and `[].every(...)` is vacuously `true` -- so this also inserts a cut
  // into the last alternative, where there is nothing left to exclude.
  // That's intentional, not an oversight: it changes nothing about which
  // alternatives get tried (there were none left either way), and it's
  // safe against leaking `fatal` to whatever encloses this `Choice`
  // because `choice`/`captureChoice` (`packages/core/src/combinators.ts`,
  // `packages/core/src/capture.ts`) absorb `fatal` at their own boundary
  // regardless of which alternative it came from. The only effect is a
  // more specific error message on failure (the committed alternative's
  // own error, via `choice`'s early-return path) instead of the usual
  // aggregated "none of the parsers matched."
  const allLaterExcluded = laterAlternatives.every((later) => {
    if (isNullable(later, analysis.nullableRules)) return false;
    const laterFirst = firstSetOfExpression(
      later,
      analysis.firstSets,
      analysis.nullableRules,
    );
    return firstSetsDisjoint(prefixFirst, laterFirst);
  });

  return allLaterExcluded ? k : null;
};

/**
 * Finds the cut position AND the length of the contiguous run of
 * immediately-following alternatives it can prove excluded, or `null` if
 * `alternative` has no valid cut position at all. `runLength` can be `0`
 * only when `laterAlternatives` is itself empty (the vacuous last-
 * alternative case `findCutPosition`'s doc comment describes) -- if there
 * ARE later alternatives but none of them survive the run (the first one
 * already breaks disjointness or is nullable), this returns `null`
 * entirely rather than `{ k, runLength: 0 }`: with nothing to group it
 * with, a cut inserted at this position would sit at the `Choice`'s own
 * top level (see `buildCutGroups`) and incorrectly fatal-stop every
 * alternative after it, not just the zero actually proven excluded.
 */
const computeCutCandidate = (
  alternative: Expression,
  laterAlternatives: readonly Expression[],
  analysis: GrammarFirstSetAnalysis,
): { k: number; runLength: number } | null => {
  if (alternative.type !== "Sequence") return null;
  const { elements } = alternative;
  if (elements.length < 2) return null;

  let k = 0;
  while (
    k < elements.length &&
    isNullable(elements[k] as Expression, analysis.nullableRules)
  ) {
    k++;
  }
  k++;
  if (k >= elements.length) return null;

  const prefix = createSequence(elements.slice(0, k));
  const prefixFirst = firstSetOfExpression(
    prefix,
    analysis.firstSets,
    analysis.nullableRules,
  );
  if (prefixFirst.unknown) return null;

  // Maximal CONTIGUOUS prefix run of `laterAlternatives` that's provably
  // excluded, stopping at the first one that isn't -- see the module doc
  // comment's associativity argument for why only a contiguous run
  // (never a run with a gap) can be grouped under this alternative's cut.
  let runLength = 0;
  for (const later of laterAlternatives) {
    if (isNullable(later, analysis.nullableRules)) break;
    const laterFirst = firstSetOfExpression(
      later,
      analysis.firstSets,
      analysis.nullableRules,
    );
    if (!firstSetsDisjoint(prefixFirst, laterFirst)) break;
    runLength++;
  }

  if (runLength === 0 && laterAlternatives.length > 0) return null;
  return { k, runLength };
};

/**
 * Greedily regroups `alts` (one `Choice`'s alternatives, already
 * recursively processed by `insertCutsInExpression`) into cut-protected
 * runs, using `computeCutCandidate` and ordered-choice associativity (see
 * the module doc comment). Scans left to right; whenever an alternative
 * has a positive-or-vacuous cut candidate, its excluded run is recursed
 * into (so members of the run still get their OWN chance at excluding a
 * further sub-run -- being reachable only via "this alternative failed
 * outright, fall through normally" doesn't make a member's own cut
 * pointless, see the module doc comment), and the result is either
 * flattened back into `result` directly (when the run happens to cover
 * every remaining alternative at this level -- the same flat shape the
 * pre-Pillar-3 all-or-nothing check already produced) or wrapped in its
 * own nested `Choice` (when it doesn't, so a sibling further out is left
 * reachable per the associativity argument).
 */
const buildCutGroups = (
  alts: readonly Expression[],
  analysis: GrammarFirstSetAnalysis,
): Expression[] => {
  const result: Expression[] = [];
  let i = 0;
  while (i < alts.length) {
    const alt = alts[i] as Expression;
    const laterAlternatives = alts.slice(i + 1);
    const candidate = computeCutCandidate(alt, laterAlternatives, analysis);
    if (candidate === null || alt.type !== "Sequence") {
      result.push(alt);
      i += 1;
      continue;
    }

    const { k, runLength } = candidate;
    const cutAlt = createSequence([
      ...alt.elements.slice(0, k),
      createCut(),
      ...alt.elements.slice(k),
    ]);
    const tail = buildCutGroups(alts.slice(i + 1, i + 1 + runLength), analysis);
    const group = [cutAlt, ...tail];

    if (group.length === 1) {
      // `runLength` was `0` (the vacuous last-alternative case) -- no
      // group to form, just the one cut-spliced alternative.
      result.push(cutAlt);
    } else if (i === 0 && runLength === alts.length - 1) {
      // This run covers every alternative at this level: there is no
      // sibling left outside it for a nested `Choice` boundary to
      // protect, so wrapping one here would be pure overhead -- push the
      // group's members directly, reproducing the exact flat shape the
      // pre-Pillar-3 all-or-nothing check already produced in this case.
      result.push(...group);
    } else {
      result.push(createChoice(group));
    }
    i += 1 + runLength;
  }
  return result;
};

const insertCutsInExpression = (
  expr: Expression,
  analysis: GrammarFirstSetAnalysis,
): Expression => {
  switch (expr.type) {
    case "Sequence":
      return createSequence(
        expr.elements.map((el) => insertCutsInExpression(el, analysis)),
      );
    case "Choice": {
      // Children first (bottom-up, matching the other rewrites in this
      // file) -- a `Cut` contributes nothing to FIRST/nullability (see
      // `first-sets.ts`), so processing order can't change any of this
      // level's own disjointness checks either way.
      const processed = expr.alternatives.map((alt) =>
        insertCutsInExpression(alt, analysis),
      );
      if (containsLabel(expr)) {
        // Labeled Choice: fall back to the original all-or-nothing,
        // no-restructuring cut insertion (see the module doc comment's
        // "Partial exclusion via ordered-choice associativity" section).
        const withCuts = processed.map((alt, i) => {
          const laterAlternatives = processed.slice(i + 1);
          const k = findCutPosition(alt, laterAlternatives, analysis);
          if (k === null || alt.type !== "Sequence") return alt;
          return createSequence([
            ...alt.elements.slice(0, k),
            createCut(),
            ...alt.elements.slice(k),
          ]);
        });
        return createChoice(withCuts);
      }
      return createChoice(buildCutGroups(processed, analysis));
    }
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
        expression: insertCutsInExpression(expr.expression, analysis),
      };
    default:
      return expr;
  }
};

/**
 * Returns a new `GrammarDefinition` with a `Cut` inserted into every
 * `Choice` alternative where a later sibling is provably unreachable past
 * some prefix (see the module doc comment). FIRST sets and nullability
 * are computed once, from the original (pre-rewrite) grammar -- a `Cut`
 * never changes either, so there is no need to recompute per rule or per
 * nesting level.
 *
 * Deliberately NOT part of `applyAstOptimizations`'s default chain and
 * not gated by `isShapeSensitiveRule` (see the "Automatic cut insertion"
 * section of the module doc comment for both).
 */
export const insertAutomaticCuts = (
  grammar: GrammarDefinition,
): GrammarDefinition => {
  const analysis = analyzeFirstSets(grammar);
  return {
    ...grammar,
    rules: grammar.rules.map((rule) => ({
      ...rule,
      pattern: insertCutsInExpression(rule.pattern, analysis),
    })),
  };
};

// ============================================================================
// Global cut promotion: marking a `Cut` safe for `commitAtTopLevel`
// ============================================================================
//
// See the plan's Pillar 7 for the full theory. Short version: today's
// codegen (`codegen.ts`/`codegen-optimized.ts`) only ever emits
// `commitAtTopLevel` (which lets `memoize`, `packages/combinator/src/
// logic.ts`, discard now-unreachable cache entries) for a `Cut` that is a
// *direct element of the start rule's own top-level `Sequence`* -- every
// other cut, however provably safe, compiles to the ordinary, purely-local
// `commit`. That condition is sufficient but far from necessary. This
// function marks additional `Cut` nodes `global: true` when a strictly
// broader -- but still narrow and deliberately under-approximate --
// condition holds, letting codegen extend `commitAtTopLevel` to them too.
//
// An earlier design for this drew on Mizushima et al.'s FOLLOW-set result
// directly (a new `follow-sets.ts` fixpoint, gating promotion through a
// repetition on "the repeated non-terminal's FOLLOW set is concrete and
// non-`unknown`"). Building that against this codebase's two target
// grammars (`BENCH_CUTTABLE_CONFIG_GRAMMAR`'s `entry+`, promotable;
// `BENCH_UNFACTORED_ARITHMETIC_GRAMMAR`'s `atom`, not) showed FOLLOW is
// never actually consulted by the predicate that gets the right answer on
// either: the promotion decision reduces entirely to (1) no lookahead
// ancestor and (2) FIRST-set disjointness against ancestor `Choice`
// siblings -- exactly `computeCutCandidate`'s existing check -- applied
// not just within the cut's own rule but transitively at every reference
// site of that rule, all the way up to the grammar's start rule. FOLLOW
// was dropped; no `follow-sets.ts` module exists.
//
// ## Why FIRST-disjointness at every reference site is enough
//
// A promoted cut's watermark advance is sound exactly when nothing above
// it can still need a position before it re-parsed. The one way that could
// happen is an ancestor `Choice` (anywhere from the cut's own rule up to
// the start rule) trying a sibling alternative after the branch containing
// the cut fails overall -- `choice`/`captureChoice` (`packages/core/src/
// combinators.ts`) always launder a *local* cut's `FAIL_FATAL` back to an
// ordinary `FAIL` at their own boundary (that's what "cut is scoped to its
// own enclosing choice" means, see `commitAtTopLevel`'s doc comment in
// `packages/combinator/src/logic.ts`), so this can occur one enclosing
// `Choice` at a time, all the way out to the start rule, regardless of how
// deep the cut sits.
//
// But if that sibling's FIRST set is provably disjoint from the branch
// containing the cut, trying it costs exactly one failed leaf-parser
// comparison: the very first character it checks cannot match (by
// disjointness), so it fails before recursing into anything, and in
// particular before looking up any `memoize` entry in the truncated range.
// A "wrongly" re-tried sibling that can never actually touch pruned memory
// is harmless -- which is why checking disjointness at *every* ancestor
// `Choice`, one level at a time, all the way to the start rule (rather
// than requiring *no* ancestor `Choice` exists at all) is enough, without
// needing FOLLOW or any other machinery.
//
// A repetition (`Star`/`Plus`/`Quantified`) wrapping a reference to the
// cut's rule needs no special-casing either: `zeroOrMore`/`oneOrMore`/
// `quantified` (`packages/core/src/repetition.ts`) all check
// `isFatalFailure` and *propagate* a fatal child failure rather than
// silently ending the loop -- verified by reading their implementations,
// not assumed -- so a promoted cut's `FAIL_FATAL` never gets absorbed by a
// repetition into "the loop just stops here, one iteration short of where
// the watermark already advanced to." Whether the repetition's own
// reference site sits under an ancestor `Choice` is still checked, same as
// any other reference site.
//
// ## The one place this can still go wrong, and why the guard is cheap
//
// The disjointness argument depends on the sibling being tried from the
// SAME starting position the cut's branch was tried from. An `Optional`,
// `Star`, or `Quantified{min: 0}` wrapping a `Cut` (directly, in the same
// rule, not through a reference) can complete zero iterations and report
// ordinary success having consumed nothing -- a fundamentally different
// shape of "recovery" than an ancestor `Choice` retrying a sibling, and
// this module has not carried out the same disjointness-based argument for
// it. Rather than reason it through, `Cut`s under such a construct are
// refused promotion outright: this is a stated conservatism (the
// zero-iteration case is simply not covered by the argument above), not a
// demonstrated unsoundness -- `Plus`/`Quantified{min >= 1}` are
// deliberately NOT included in this guard, since a required repetition's
// fatal-propagation (previous paragraph) already covers it.
//
// ## Cycle guard
//
// A reference-site walk that follows mutually-recursive rules forever
// would hang. Rules currently being visited are tracked and any cycle
// refuses promotion outright -- conservative, not a soundness argument
// (a cyclic reference graph may well be safe in specific cases), but cheap
// and this codebase's target grammars don't need it.

/** Per-site structural context, accumulated while walking down from a
 * rule's own root (or from a reference site within some other rule). */
interface CutSiteContext {
  readonly underLookahead: boolean;
  readonly underZeroableRepetition: boolean;
  /** The nearest enclosing `Choice`'s alternative that contains this site,
   * and that alternative's later siblings -- or `null` if no `Choice`
   * encloses this site at all (e.g. a bare top-level rule pattern). Only
   * the NEAREST one matters (see the module doc comment above): a cut's
   * `FAIL_FATAL` is absorbed by its immediately-enclosing `choice`, so no
   * `Choice` further out within the same rule ever sees it. */
  readonly nearestChoice: {
    readonly alternative: Expression;
    readonly laterSiblings: readonly Expression[];
  } | null;
}

const ROOT_CUT_SITE_CONTEXT: CutSiteContext = {
  underLookahead: false,
  underZeroableRepetition: false,
  nearestChoice: null,
};

interface IdentifierSite extends CutSiteContext {
  readonly name: string;
}

/** Walks `expr` (a rule's pattern, or a subtree of one), collecting every
 * `Identifier` reachable, each with the structural context (nearest
 * enclosing `Choice`, lookahead/zeroable-repetition ancestry) the
 * reference-site walk below needs. Bottom-up recursion order doesn't
 * matter here (unlike the rewrites above) -- this only reads the tree, it
 * never restructures it. */
const collectIdentifierSites = (
  expr: Expression,
  ctx: CutSiteContext,
  identifiers: IdentifierSite[],
): void => {
  switch (expr.type) {
    case "Identifier":
      identifiers.push({ ...ctx, name: expr.name });
      return;
    case "Sequence":
      for (const el of expr.elements) {
        collectIdentifierSites(el, ctx, identifiers);
      }
      return;
    case "Choice":
      expr.alternatives.forEach((alt, i) => {
        collectIdentifierSites(
          alt,
          {
            ...ctx,
            nearestChoice: {
              alternative: alt,
              laterSiblings: expr.alternatives.slice(i + 1),
            },
          },
          identifiers,
        );
      });
      return;
    case "Group":
    case "LabeledExpression":
    case "ActionExpression":
      collectIdentifierSites(expr.expression, ctx, identifiers);
      return;
    case "Optional":
    case "Star":
      collectIdentifierSites(
        expr.expression,
        { ...ctx, underZeroableRepetition: true },
        identifiers,
      );
      return;
    case "Plus":
      // Deliberately NOT marked zeroable -- see the module doc comment's
      // "cheap guard" section.
      collectIdentifierSites(expr.expression, ctx, identifiers);
      return;
    case "Quantified":
      collectIdentifierSites(
        expr.expression,
        {
          ...ctx,
          underZeroableRepetition:
            ctx.underZeroableRepetition || expr.min === 0,
        },
        identifiers,
      );
      return;
    case "PositiveLookahead":
    case "NegativeLookahead":
      collectIdentifierSites(
        expr.expression,
        { ...ctx, underLookahead: true },
        identifiers,
      );
      return;
    default:
      return;
  }
};

/** Clause 2: is the site's nearest-enclosing `Choice` alternative (if any)
 * proven FIRST-disjoint from every later sibling at that same level? A
 * nullable later sibling is NEVER treated as excluded (mirrors
 * `computeCutCandidate`'s identical guard above) -- it could match zero
 * characters, so "the next character doesn't start it" proves nothing. No
 * enclosing `Choice` at all (`nearestChoice === null`) is vacuously safe --
 * there is no sibling to worry about. */
const nearestChoiceIsDisjoint = (
  ctx: CutSiteContext,
  analysis: GrammarFirstSetAnalysis,
): boolean => {
  if (!ctx.nearestChoice) return true;
  const { alternative, laterSiblings } = ctx.nearestChoice;
  const ownFirst = firstSetOfExpression(
    alternative,
    analysis.firstSets,
    analysis.nullableRules,
  );
  if (ownFirst.unknown) return false;
  return laterSiblings.every((later) => {
    if (isNullable(later, analysis.nullableRules)) return false;
    const laterFirst = firstSetOfExpression(
      later,
      analysis.firstSets,
      analysis.nullableRules,
    );
    return firstSetsDisjoint(ownFirst, laterFirst);
  });
};

/** Clause 1 + the structural guard: no lookahead ancestor, no
 * `Optional`/`Star`/`Quantified{min: 0}` ancestor (see the module doc
 * comment's "cheap guard" section). */
const structurallyEligible = (ctx: CutSiteContext): boolean =>
  !ctx.underLookahead && !ctx.underZeroableRepetition;

/**
 * Clause 3: is every reference site of rule `ruleName`, transitively up to
 * the grammar's start rule (`grammar.rules[0]`), itself eligible (clause
 * 1 + structural guard) and FIRST-disjoint from its own ancestor `Choice`
 * siblings (clause 2)? `visiting` guards against a reference cycle (see
 * the module doc comment) -- encountering a rule already being visited
 * refuses promotion rather than looping forever.
 *
 * A rule with zero reference sites that is NOT the start rule is refused:
 * this codebase cannot prove such a rule is ever reachable from the start
 * rule at all (dead code, or reachable only through some mechanism this
 * walk doesn't model), so it cannot prove the one thing this whole
 * function exists to prove.
 */
const referenceChainIsSafe = (
  ruleName: string,
  grammar: GrammarDefinition,
  analysis: GrammarFirstSetAnalysis,
  referenceSites: ReadonlyMap<
    string,
    ReadonlyArray<{ fromRule: string; site: IdentifierSite }>
  >,
  visiting: Set<string>,
): boolean => {
  if (grammar.rules[0]?.name === ruleName) return true;
  if (visiting.has(ruleName)) return false;

  const sites = referenceSites.get(ruleName);
  if (!sites || sites.length === 0) return false;

  visiting.add(ruleName);
  try {
    return sites.every(
      ({ fromRule, site }) =>
        structurallyEligible(site) &&
        nearestChoiceIsDisjoint(site, analysis) &&
        referenceChainIsSafe(
          fromRule,
          grammar,
          analysis,
          referenceSites,
          visiting,
        ),
    );
  } finally {
    visiting.delete(ruleName);
  }
};

/** Builds a map from rule name to every site (across the whole grammar)
 * that references it by `Identifier`, tagged with which rule the reference
 * appears in. Computed once per `promoteGlobalCuts` call and reused for
 * every candidate `Cut`, rather than re-walking the grammar per cut. */
const buildReferenceSiteMap = (
  grammar: GrammarDefinition,
): Map<string, Array<{ fromRule: string; site: IdentifierSite }>> => {
  const map = new Map<
    string,
    Array<{ fromRule: string; site: IdentifierSite }>
  >();
  for (const rule of grammar.rules) {
    const identifiers: IdentifierSite[] = [];
    collectIdentifierSites(rule.pattern, ROOT_CUT_SITE_CONTEXT, identifiers);
    for (const site of identifiers) {
      const existing = map.get(site.name);
      const entry = { fromRule: rule.name, site };
      if (existing) {
        existing.push(entry);
      } else {
        map.set(site.name, [entry]);
      }
    }
  }
  return map;
};

const promoteCutsInExpression = (
  expr: Expression,
  ruleName: string,
  grammar: GrammarDefinition,
  analysis: GrammarFirstSetAnalysis,
  referenceSites: ReadonlyMap<
    string,
    ReadonlyArray<{ fromRule: string; site: IdentifierSite }>
  >,
): { expr: Expression; promotedCount: number } => {
  let promotedCount = 0;
  const visit = (e: Expression, ctx: CutSiteContext): Expression => {
    switch (e.type) {
      case "Cut":
        // A `Cut` reached here (rather than via the `Sequence` case below,
        // which is the only place that can prove `hasRealProgressBeforeCut`)
        // has no sibling to have made progress against -- never eligible.
        return e;
      case "Sequence": {
        let sawNonNullable = false;
        const elements = e.elements.map((el) => {
          if (el.type === "Cut") {
            const eligible =
              sawNonNullable &&
              structurallyEligible(ctx) &&
              nearestChoiceIsDisjoint(ctx, analysis) &&
              referenceChainIsSafe(
                ruleName,
                grammar,
                analysis,
                referenceSites,
                new Set(),
              );
            if (eligible) promotedCount++;
            return eligible ? { ...el, global: true } : el;
          }
          const rewritten = visit(el, ctx);
          if (!isNullable(el, analysis.nullableRules)) sawNonNullable = true;
          return rewritten;
        });
        return createSequence(elements);
      }
      case "Choice": {
        const alternatives = e.alternatives.map((alt, i) =>
          visit(alt, {
            ...ctx,
            nearestChoice: {
              alternative: alt,
              laterSiblings: e.alternatives.slice(i + 1),
            },
          }),
        );
        return createChoice(alternatives);
      }
      case "Group":
      case "LabeledExpression":
      case "ActionExpression":
        return { ...e, expression: visit(e.expression, ctx) };
      case "Optional":
      case "Star":
        return {
          ...e,
          expression: visit(e.expression, {
            ...ctx,
            underZeroableRepetition: true,
          }),
        };
      case "Plus":
        return { ...e, expression: visit(e.expression, ctx) };
      case "Quantified":
        return {
          ...e,
          expression: visit(e.expression, {
            ...ctx,
            underZeroableRepetition: ctx.underZeroableRepetition || e.min === 0,
          }),
        };
      case "PositiveLookahead":
      case "NegativeLookahead":
        return {
          ...e,
          expression: visit(e.expression, { ...ctx, underLookahead: true }),
        };
      default:
        return e;
    }
  };
  const result = visit(expr, ROOT_CUT_SITE_CONTEXT);
  return { expr: result, promotedCount };
};

/**
 * Returns a new `GrammarDefinition` with every provably-safe `Cut` marked
 * `global: true` (see the module doc comment for the full soundness
 * argument), and the total number of cuts promoted. Does not insert,
 * remove, or move any `Cut` -- run `insertAutomaticCuts` first if the
 * grammar doesn't already have the cuts you want considered for promotion.
 * `analysis` must come from `analyzeFirstSets(grammar)` run on the SAME
 * grammar (same rule set) `promoteGlobalCuts` is called with.
 */
export const promoteGlobalCuts = (
  grammar: GrammarDefinition,
  analysis: GrammarFirstSetAnalysis,
): { grammar: GrammarDefinition; promotedCount: number } => {
  const referenceSites = buildReferenceSiteMap(grammar);
  let promotedCount = 0;
  const rules: RuleDefinition[] = grammar.rules.map((rule) => {
    const { expr, promotedCount: ruleCount } = promoteCutsInExpression(
      rule.pattern,
      rule.name,
      grammar,
      analysis,
      referenceSites,
    );
    promotedCount += ruleCount;
    return { ...rule, pattern: expr };
  });
  return { grammar: { ...grammar, rules }, promotedCount };
};
