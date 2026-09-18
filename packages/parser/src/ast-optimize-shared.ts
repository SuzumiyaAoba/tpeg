/**
 * Helpers shared by more than one of `ast-optimize.ts`'s rewrite passes.
 * See that module's doc comment for the overall design (soundness
 * restrictions, shape-sensitivity gating).
 */

import { someExpression } from "@suzumiyaaoba/tpeg-core";
import type { Expression, GrammarDefinition, RuleDefinition } from "./types";

/** Does `expr` contain a `LabeledExpression` anywhere in its subtree?
 * Used by `ast-optimize-left-factor.ts`'s `leftFactorChoices` and
 * `ast-optimize-cut-insertion.ts`'s `insertAutomaticCuts` -- both need to
 * detect a labeled `Choice` to fall back to a more conservative rewrite. */
export const containsLabel = (expr: Expression): boolean =>
  someExpression(expr, (node) => node.type === "LabeledExpression");

/** Does `expr` contain a `Cut` anywhere in its subtree? Used by
 * `ast-optimize-cut-insertion.ts`'s `buildCutGroups`/`computeCutCandidate`
 * to refuse regrouping a `Choice` alternative that already carries a
 * `Cut` (whether hand-written `~` or from an earlier pass) into a newly
 * nested `Choice` -- doing so would renarrow that existing `Cut`'s
 * fatal-absorption boundary from the enclosing (flat) `Choice` to the new
 * inner one, changing which sibling alternatives it suppresses. Same
 * shape as `containsLabel` above, checking for a different node type. */
export const containsCut = (expr: Expression): boolean =>
  someExpression(expr, (node) => node.type === "Cut");

/** Does `expr` contain an `ActionExpression` anywhere in its subtree? */
const containsAction = (expr: Expression): boolean =>
  someExpression(expr, (node) => node.type === "ActionExpression");

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
