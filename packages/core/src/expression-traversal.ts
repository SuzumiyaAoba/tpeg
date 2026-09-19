import type { Expression, LabeledExpression } from "./grammar-types";

/**
 * Returns the direct child expressions of `expr`: `elements` for a
 * `Sequence`, `alternatives` for a `Choice`, the single wrapped
 * `expression` for every unary node (`Group`, `Star`, `Plus`, `Optional`,
 * `Quantified`, `PositiveLookahead`, `NegativeLookahead`, `Skip`,
 * `LabeledExpression`, `ActionExpression`), and nothing for leaf nodes.
 *
 * This is the ONE place in the codebase that enumerates an expression
 * node's children. Before it existed, every subtree walk (dependency
 * collection in `tpeg-parser`'s `performance-utils.ts` and
 * `tpeg-type-inference`'s `type-integration.ts`, complexity analysis,
 * `contains*` predicates in `codegen.ts`/`ast-optimize-shared.ts`)
 * re-implemented the same `switch (expr.type)` boilerplate independently --
 * and each copy could silently miss a union member. The `ActionExpression`
 * case was the recurring casualty: several walks treated it as a leaf, so
 * a rule reference reachable only through a semantic action's own wrapped
 * expression (e.g. `x = ( y ) { ... }`) was invisible to them, and the gap
 * was found and fixed independently in three separate copies.
 *
 * The `default` case is a compile-time exhaustiveness check: adding a new
 * `Expression` union member without updating this function fails
 * type-checking here, instead of silently not-traversing the new node.
 */
export const childExpressions = (expr: Expression): readonly Expression[] => {
  switch (expr.type) {
    case "Sequence":
      return expr.elements;
    case "Choice":
      return expr.alternatives;
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
    case "Quantified":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "Skip":
    case "Span":
    case "LabeledExpression":
    case "ActionExpression":
      return [expr.expression];
    case "StringLiteral":
    case "CharacterClass":
    case "Identifier":
    case "QualifiedIdentifier":
    case "AnyChar":
    case "Cut":
    case "WordBoundary":
      return [];
    default: {
      const exhaustiveCheck: never = expr;
      throw new Error(
        `Unhandled expression type: ${(exhaustiveCheck as { type: string }).type}`,
      );
    }
  }
};

/**
 * Calls `fn` on `expr` and every descendant expression, pre-order.
 * Use for "collect X from the whole subtree" walks that used to be
 * hand-written `switch` recursions (see {@link childExpressions} for why
 * sharing the traversal matters).
 */
export const forEachExpression = (
  expr: Expression,
  fn: (node: Expression) => void,
): void => {
  fn(expr);
  for (const child of childExpressions(expr)) {
    forEachExpression(child, fn);
  }
};

/**
 * `true` iff `predicate` holds for `expr` or any descendant expression,
 * pre-order, short-circuiting on the first match. Covers the "does this
 * subtree contain a node like X" walks (`containsLabel`/`containsCut`/
 * `containsAction`/`containsReferenceTo`-shaped functions).
 */
export const someExpression = (
  expr: Expression,
  predicate: (node: Expression) => boolean,
): boolean =>
  predicate(expr) ||
  childExpressions(expr).some((child) => someExpression(child, predicate));

/**
 * Returns `expr` with `fn` applied to each direct child, rebuilding the
 * node via spread so untouched fields (a `Quantified`'s `min`/`max`, a
 * `LabeledExpression`'s `label`, a `Cut`'s `global`) are preserved.
 * Leaf nodes are returned unchanged. This is the shared skeleton for the
 * "children first, bottom-up rewrite" passes in `tpeg-parser`'s
 * `ast-optimize-*.ts` modules: a pass handles its special node types
 * explicitly and delegates the uniform recursion to this function.
 */
export const mapChildExpressions = (
  expr: Expression,
  fn: (child: Expression) => Expression,
): Expression => {
  switch (expr.type) {
    case "Sequence":
      return { ...expr, elements: expr.elements.map(fn) };
    case "Choice":
      return { ...expr, alternatives: expr.alternatives.map(fn) };
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
    case "Quantified":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "Span":
    case "LabeledExpression":
    case "ActionExpression":
      return { ...expr, expression: fn(expr.expression) };
    case "Skip": {
      // `expression` is typed `Identifier` (a resolved rule reference),
      // narrower than the `Expression` `fn` returns -- so the generic
      // `{ ...expr, expression: fn(...) }` arm can't cover it. Apply
      // `fn` like every other unary node, but verify the rewrite kept
      // the reference an `Identifier`: a pass that rewrote it to
      // anything else would build a `Skip` node violating its own
      // invariant, which is a bug to surface rather than store.
      const mapped = fn(expr.expression);
      if (mapped.type !== "Identifier") {
        throw new Error(
          `mapChildExpressions: a rewrite turned a Skip's Identifier child into ${mapped.type} -- a Skip must keep referencing a rule by name`,
        );
      }
      return { ...expr, expression: mapped };
    }
    case "StringLiteral":
    case "CharacterClass":
    case "Identifier":
    case "QualifiedIdentifier":
    case "AnyChar":
    case "Cut":
    case "WordBoundary":
      return expr;
    default: {
      const exhaustiveCheck: never = expr;
      throw new Error(
        `Unhandled expression type: ${(exhaustiveCheck as { type: string }).type}`,
      );
    }
  }
};

/**
 * Peels away transparent `Group` wrappers to see if `expr` is (or wraps)
 * a `LabeledExpression` -- a `Group` is transparent at codegen time, so
 * `(x:"a")` labels exactly like `x:"a"`. Returns the unwrapped
 * `LabeledExpression` node (its `.label` is the bound name), or
 * `undefined` when `expr` isn't a labeled expression at all.
 *
 * Shared by `tpeg-parser`'s `labelOf`/`collectTopLevelLabels`
 * (codegen.ts -- which of a sequence's elements name a label for the
 * `captureSequence` merge) and `tpeg-type-inference` (the same decision
 * for inferring merged-object field types); both previously kept their
 * own copy of this walk.
 */
export const unwrapToLabeledExpression = (
  expr: Expression,
): LabeledExpression | undefined => {
  if (expr.type === "LabeledExpression") {
    return expr;
  }
  if (expr.type === "Group") {
    return unwrapToLabeledExpression(expr.expression);
  }
  return undefined;
};
