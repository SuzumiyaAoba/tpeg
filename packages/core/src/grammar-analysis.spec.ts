import { describe, expect, it } from "vite-plus/test";
import {
  collectRuleReferences,
  collectTopLevelLabels,
  findRecursiveRuleNames,
  measureExpression,
} from "./grammar-analysis";
import {
  createActionExpression,
  createChoice,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createQualifiedIdentifier,
  createQuantified,
  createSequence,
  createStar,
} from "./grammar-builders";

describe("shared grammar analysis", () => {
  it("collects unique local references through actions and repetition in source order", () => {
    const expression = createSequence([
      createActionExpression(createIdentifier("first"), "return $$;"),
      createQuantified(createIdentifier("second"), 0, 4),
      createIdentifier("first"),
      createQualifiedIdentifier("external", "third"),
    ]);
    expect([...collectRuleReferences(expression)]).toEqual(["first", "second"]);
    expect(measureExpression(expression)).toEqual({ depth: 2, nodeCount: 7 });
  });

  it("counts shared expression objects per occurrence", () => {
    const child = createIdentifier("child");
    expect(measureExpression(createChoice([child, child]))).toEqual({
      depth: 1,
      nodeCount: 3,
    });
  });

  it("finds cycle members without flagging their callers or external references", () => {
    const graph = new Map([
      ["caller", new Set(["a", "external"])],
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
      ["self", new Set(["self"])],
      ["leaf", new Set<string>()],
    ]);
    expect([...findRecursiveRuleNames(graph)]).toEqual(["a", "b", "self"]);
    expect([...findRecursiveRuleNames(new Map())]).toEqual([]);
  });

  it("does not mistake converging acyclic paths for a cycle", () => {
    const graph = new Map([
      ["start", new Set(["left", "right"])],
      ["left", new Set(["end"])],
      ["right", new Set(["end"])],
      ["end", new Set<string>()],
    ]);
    expect([...findRecursiveRuleNames(graph)]).toEqual([]);
  });

  it("collects direct labels and preserves the sequence capture scope", () => {
    const value = createIdentifier("value");
    const expression = createSequence([
      createGroup(createLabeledExpression("first", value)),
      createLabeledExpression("second", value),
      createStar(createLabeledExpression("nested", value)),
      createActionExpression(
        createLabeledExpression("action", value),
        "return $$;",
      ),
    ]);
    expect(collectTopLevelLabels(expression)).toEqual(["first", "second"]);
    expect(collectTopLevelLabels(createGroup(expression))).toEqual([
      "first",
      "second",
    ]);
  });

  it("unions labels across choice alternatives in first-occurrence order", () => {
    const value = createIdentifier("value");
    const expression = createChoice([
      createLabeledExpression("first", value),
      createGroup(createLabeledExpression("second", value)),
      createLabeledExpression("first", value),
    ]);
    expect(collectTopLevelLabels(expression)).toEqual(["first", "second"]);
    expect(collectTopLevelLabels(value)).toEqual([]);
  });
});
