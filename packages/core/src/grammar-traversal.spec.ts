import { someExpression } from "./expression-traversal";
import { describe, expect, it } from "vite-plus/test";
import {
  createActionExpression,
  createAnyChar,
  createCharacterClass,
  createChoice,
  createCut,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createNegativeLookahead,
  createOptional,
  createPlus,
  createPositiveLookahead,
  createQualifiedIdentifier,
  createQuantified,
  createSequence,
  createStar,
  createSkip,
  createSpan,
  createWordBoundary,
  createStringLiteral,
} from "./grammar-builders";
import type { Expression } from "./grammar-nodes";
import { expressionChildren, walkExpression } from "./grammar-traversal";

describe("grammar expression traversal", () => {
  const child = createIdentifier("item");
  const cases: Record<Expression["type"], Expression> = {
    StringLiteral: createStringLiteral("x", '"'),
    CharacterClass: createCharacterClass([]),
    Identifier: child,
    QualifiedIdentifier: createQualifiedIdentifier("external", "item"),
    AnyChar: createAnyChar(),
    Cut: createCut(),
    Skip: createSkip(child),
    Span: createSpan(child),
    WordBoundary: createWordBoundary(),
    Sequence: createSequence([child]),
    Choice: createChoice([child]),
    Group: createGroup(child),
    Star: createStar(child),
    Plus: createPlus(child),
    Optional: createOptional(child),
    Quantified: createQuantified(child, 1, 3),
    PositiveLookahead: createPositiveLookahead(child),
    NegativeLookahead: createNegativeLookahead(child),
    LabeledExpression: createLabeledExpression("value", child),
    ActionExpression: createActionExpression(child, "return $$;"),
  };

  it("handles every expression kind, treating rule references as leaves", () => {
    const leaves = new Set([
      "StringLiteral",
      "CharacterClass",
      "Identifier",
      "QualifiedIdentifier",
      "AnyChar",
      "Cut",
      "WordBoundary",
    ]);
    for (const [kind, expression] of Object.entries(cases)) {
      expect(expressionChildren(expression)).toEqual(
        leaves.has(kind) ? [] : [child],
      );
    }
  });

  it("visits shared children at every occurrence, in source order with depth", () => {
    const expression = createSequence([
      createActionExpression(createGroup(child), "return $$;"),
      createChoice([child, createCut()]),
    ]);
    const visited: [string, number][] = [];
    walkExpression(expression, (node, depth) => {
      visited.push([node.type, depth]);
    });
    expect(visited).toEqual([
      ["Sequence", 0],
      ["ActionExpression", 1],
      ["Group", 2],
      ["Identifier", 3],
      ["Choice", 1],
      ["Identifier", 2],
      ["Cut", 2],
    ]);
    expect(expression.elements[1]).toEqual(createChoice([child, createCut()]));
  });

  it("prunes a selected subtree while still visiting later siblings", () => {
    const expression = createSequence([createGroup(child), createCut()]);
    const visited: string[] = [];
    walkExpression(expression, (node) => {
      visited.push(node.type);
      return node.type !== "Group";
    });
    expect(visited).toEqual(["Sequence", "Group", "Cut"]);
  });

  it("stops searching immediately at the first match", () => {
    const expression = createSequence([createCut(), child]);
    const visited: string[] = [];
    expect(
      someExpression(expression, (node) => {
        visited.push(node.type);
        return node.type === "Cut";
      }),
    ).toBe(true);
    expect(visited).toEqual(["Sequence", "Cut"]);
    expect(someExpression(expression, (node) => node.type === "Star")).toBe(
      false,
    );
  });

  it("handles deep trees without consuming the JavaScript call stack", () => {
    let expression: Expression = child;
    for (let i = 0; i < 20_000; i++) expression = createGroup(expression);
    let nodeCount = 0;
    let maxDepth = 0;
    walkExpression(expression, (_node, depth) => {
      nodeCount++;
      maxDepth = depth;
    });
    expect(nodeCount).toBe(20_001);
    expect(maxDepth).toBe(20_000);
    expect(someExpression(expression, (node) => node === child)).toBe(true);
  });
});
