/**
 * Helpers shared by more than one of `ast-optimize.ts`'s rewrite passes.
 * See that module's doc comment for the overall design (soundness
 * restrictions, shape-sensitivity gating).
 */

import type { Expression, GrammarDefinition, RuleDefinition } from "./types";

/** Does `expr` contain a `LabeledExpression` anywhere in its subtree?
 * Used by `ast-optimize-left-factor.ts`'s `leftFactorChoices` and
 * `ast-optimize-cut-insertion.ts`'s `insertAutomaticCuts` -- both need to
 * detect a labeled `Choice` to fall back to a more conservative rewrite. */
export const containsLabel = (expr: Expression): boolean => {
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
 * function matched to it by name (`captures`). Shared by every rewrite that
 * can change a rule's value *shape* (element count or nesting) without
 * changing which inputs it accepts: `leftFactorChoices` and
 * `degenerateNegativeLookaheads`. `mergeCharacterClasses` doesn't use this
 * gate because it never changes value shape (see its own doc comment).
 */
export const isShapeSensitiveRule = (
  grammar: GrammarDefinition,
  rule: RuleDefinition,
): boolean =>
  containsAction(rule.pattern) || grammarHasTransformFor(grammar, rule.name);
