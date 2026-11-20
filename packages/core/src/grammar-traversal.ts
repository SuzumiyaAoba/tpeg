import type { Expression } from "./grammar-nodes";

import { childExpressions } from "./expression-traversal";

/** Alias for the shared exhaustive child enumeration. */
export const expressionChildren = childExpressions;

/**
 * Visits each expression occurrence in depth-first, source order (root depth 0).
 * Shared child objects are visited at each occurrence. Returning false skips
 * that node's children, without skipping its siblings. The tree is not mutated.
 */
export const walkExpression = (
  expression: Expression,
  visit: (expression: Expression, depth: number) => unknown,
): void => {
  const ancestors = new Set<Expression>();
  const stack: { node: Expression; leaving?: boolean }[] = [
    { node: expression },
  ];
  while (stack.length > 0) {
    const { node, leaving } = stack.pop()!;
    if (leaving) {
      ancestors.delete(node);
      continue;
    }
    if (ancestors.has(node)) {
      throw new TypeError("Cyclic expression AST encountered during traversal");
    }
    if (visit(node, ancestors.size) === false) continue;
    const children = expressionChildren(node);
    if (children.length === 0) continue;
    ancestors.add(node);
    stack.push({ node, leaving: true });
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push({ node: child });
    }
  }
};
