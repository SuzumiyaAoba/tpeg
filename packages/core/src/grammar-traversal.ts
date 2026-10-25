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
  const stack = [{ expression, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (visit(current.expression, current.depth) === false) continue;
    const children = expressionChildren(current.expression);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push({ expression: child, depth: current.depth + 1 });
    }
  }
};
