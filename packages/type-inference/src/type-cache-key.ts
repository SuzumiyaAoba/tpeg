import type { Expression } from "@suzumiyaaoba/tpeg-core";

interface CacheShape {
  parts: unknown[];
  children: readonly Expression[];
  trackChildren?: boolean;
}

interface ShapeOptions {
  inferObjectTypes: boolean;
  inferUnionTypes: boolean;
}

interface DataField {
  node: object;
  name: string;
  value: unknown;
  present: boolean;
}

export type ExpressionCacheSnapshot = readonly DataField[];

function dataFields(
  node: object,
  names: readonly string[],
  snapshot?: DataField[],
): boolean {
  return names.every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(node, name);
    if (!descriptor || !("value" in descriptor)) return false;
    snapshot?.push({ node, name, value: descriptor.value, present: true });
    return true;
  });
}

function cacheShape(
  expression: Expression,
  options: ShapeOptions,
  snapshot?: DataField[],
): CacheShape | undefined {
  if (!dataFields(expression, ["type"], snapshot)) return undefined;
  const leaf = (parts: unknown[]): CacheShape => ({ parts, children: [] });
  const unary = (parts: unknown[]): CacheShape | undefined =>
    dataFields(expression, ["expression"], snapshot)
      ? {
          parts,
          children: [(expression as { expression: Expression }).expression],
        }
      : undefined;
  switch (expression.type) {
    case "StringLiteral":
      return dataFields(expression, ["value"], snapshot)
        ? leaf([expression.type, expression.value])
        : undefined;
    case "Identifier":
      return dataFields(expression, ["name"], snapshot)
        ? leaf([expression.type, expression.name])
        : undefined;
    case "QualifiedIdentifier":
      return dataFields(expression, ["module", "name"], snapshot)
        ? leaf([expression.type, expression.module, expression.name])
        : undefined;
    case "WordBoundary":
      return dataFields(expression, ["negated"], snapshot)
        ? leaf([expression.type, expression.negated])
        : undefined;
    case "LabeledExpression":
      return dataFields(expression, ["label"], snapshot)
        ? unary([expression.type, expression.label])
        : undefined;
    case "Quantified": {
      if (!dataFields(expression, ["min"], snapshot)) return undefined;
      const max = Object.getOwnPropertyDescriptor(expression, "max");
      if (max && !("value" in max)) return undefined;
      if (!max && "max" in expression) return undefined;
      snapshot?.push({
        node: expression,
        name: "max",
        value: max?.value,
        present: max !== undefined,
      });
      // String forms preserve the documentation's distinction between
      // NaN/Infinity and finite bounds, unlike JSON's number conversion.
      return unary([
        expression.type,
        String(expression.min),
        expression.max == null ? "" : String(expression.max),
      ]);
    }
    case "Sequence":
      if (!options.inferObjectTypes) return leaf([expression.type]);
      return dataFields(expression, ["elements"], snapshot)
        ? {
            parts: [expression.type],
            children: expression.elements,
            trackChildren: true,
          }
        : undefined;
    case "Choice":
      if (!dataFields(expression, ["alternatives"], snapshot)) return undefined;
      if (!options.inferUnionTypes && !options.inferObjectTypes) {
        if (!dataFields(expression.alternatives, ["length"], snapshot))
          return undefined;
        return leaf([expression.type, expression.alternatives.length === 0]);
      }
      return {
        parts: [expression.type],
        children: expression.alternatives,
        trackChildren: true,
      };
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
      return unary([expression.type]);
    case "CharacterClass":
    case "AnyChar":
    case "Cut":
    case "Skip":
    case "Span":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "ActionExpression":
      // These types do not depend on their ranges, code, or children.
      return leaf([expression.type]);
    default: {
      const exhaustive: never = expression;
      return leaf([(exhaustive as { type: string }).type]);
    }
  }
}

/** Capture the data fields inference uses without serializing a key again. */
export function expressionCacheSnapshot(
  expression: Expression,
  remainingDepth: number,
  options: ShapeOptions,
): ExpressionCacheSnapshot | undefined {
  const snapshot: DataField[] = [];
  const pending = [{ expression, depth: 0 }];
  while (pending.length > 0) {
    const entry = pending.pop()!;
    if (entry.depth > remainingDepth) return undefined;
    const shape = cacheShape(entry.expression, options, snapshot);
    if (!shape) return undefined;
    if (
      shape.trackChildren &&
      !dataFields(shape.children, ["length"], snapshot)
    )
      return undefined;
    for (let index = shape.children.length - 1; index >= 0; index--) {
      if (!dataFields(shape.children, [String(index)], snapshot))
        return undefined;
      pending.push({
        expression: shape.children[index]!,
        depth: entry.depth + 1,
      });
    }
  }
  return snapshot;
}

export function expressionSnapshotUnchanged(
  snapshot: ExpressionCacheSnapshot,
): boolean {
  for (const { node, name, value, present } of snapshot) {
    const descriptor = Object.getOwnPropertyDescriptor(node, name);
    if (present) {
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !Object.is(descriptor.value, value)
      )
        return false;
    } else if (descriptor || name in node) return false;
  }
  return true;
}

/**
 * A bounded, iterative structural key. Arity plus preorder tokens encode
 * the tree without recursively serializing it. Accessors and over-limit
 * subtrees bypass caching so inference can read values and enforce its
 * own recursion limit; cache lookup must not change their behavior.
 */
export function expressionCacheKey(
  expression: Expression,
  remainingDepth: number,
  options: ShapeOptions,
): string | undefined {
  const pending = [{ expression, depth: 0 }];
  const tokens: string[] = [];
  while (pending.length > 0) {
    const entry = pending.pop()!;
    if (entry.depth > remainingDepth) return undefined;
    const shape = cacheShape(entry.expression, options);
    if (!shape) return undefined;
    tokens.push(JSON.stringify([...shape.parts, shape.children.length]));
    for (let index = shape.children.length - 1; index >= 0; index--) {
      if (!dataFields(shape.children, [String(index)])) return undefined;
      pending.push({
        expression: shape.children[index]!,
        depth: entry.depth + 1,
      });
    }
  }
  return tokens.join("\n");
}
