import { describe, expect, it } from "vite-plus/test";
import {
  type Expression,
  createActionExpression,
  createGrammarDefinition,
  createIdentifier,
  createGroup,
  createLabeledExpression,
  createRuleDefinition,
  createSequence,
  createStringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import { TypeInferenceEngine, TypeInferenceError } from "./type-inference";
import { TypeIntegrationEngine } from "./type-integration";

const literal = (value: string) => createStringLiteral(value, '"');
function deepGroups(leaf: Expression, count = 20_000): Expression {
  let expression = leaf;
  for (let index = 0; index < count; index++)
    expression = createGroup(expression);
  return expression;
}

describe("type inference cache boundaries", () => {
  it.each([false, true])(
    "reads a dynamic literal once and keeps its cached neighbors correct with caching %s",
    (enableCaching) => {
      let reads = 0;
      const expression = Object.defineProperty(literal("ignored"), "value", {
        get: () => (++reads === 1 ? "a" : "b"),
      });
      const engine = new TypeInferenceEngine({ enableCaching });
      const first = engine.inferExpressionType(expression);
      expect(first.typeString).toBe('"a"');
      expect(first.documentation).toBe('String literal: "a"');
      expect(reads).toBe(1);
      expect(engine.inferExpressionType(literal("a")).typeString).toBe('"a"');
      const second = engine.inferExpressionType(expression);
      expect(second.typeString).toBe('"b"');
      expect(second.documentation).toBe('String literal: "b"');
      expect(reads).toBe(2);
    },
  );

  it.each([false, true])(
    "keeps a dynamic capture label consistent with caching %s",
    (enableCaching) => {
      let reads = 0;
      const expression = Object.defineProperty(
        createLabeledExpression("ignored", literal("a")),
        "label",
        { get: () => (++reads === 1 ? "value" : "other") },
      );
      const result = new TypeInferenceEngine({
        enableCaching,
      }).inferExpressionType(expression);
      expect(result.typeString).toBe('{ value: "a" }');
      expect([...result.objectProperties!.keys()]).toEqual(["value"]);
      expect(result.documentation).toBe("Labeled expression: value");
      expect(reads).toBe(1);
    },
  );

  it("does not cache an array with a dynamic child", () => {
    let reads = 0;
    const children: Expression[] = [literal("ignored")];
    Object.defineProperty(children, "0", {
      get: () => literal(++reads === 1 ? "a" : "b"),
    });
    const expression = createSequence(children);
    const engine = new TypeInferenceEngine();
    expect(engine.inferExpressionType(expression).typeString).toBe('"a"');
    expect(engine.inferExpressionType(expression).typeString).toBe('"b"');
    expect(reads).toBe(2);
  });

  it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid maxRecursionDepth %s",
    (maxRecursionDepth) => {
      expect(() => new TypeInferenceEngine({ maxRecursionDepth })).toThrow(
        /maxRecursionDepth must be a non-negative safe integer/,
      );
    },
  );

  it.each([false, true])(
    "ignores nonstructural getters with caching %s",
    (enableCaching) => {
      const expression = Object.defineProperty(literal("a"), "metadata", {
        enumerable: true,
        get() {
          throw new Error("unnecessary metadata read");
        },
      });
      const engine = new TypeInferenceEngine({ enableCaching });
      expect(engine.inferExpressionType(expression).typeString).toBe('"a"');
    },
  );

  it.each([false, true])(
    "never invokes AST toJSON with caching %s",
    (enableCaching) => {
      let calls = 0;
      const toJSON = () => {
        calls++;
        return "same";
      };
      const engine = new TypeInferenceEngine({ enableCaching });
      const firstExpression = { ...literal("a"), toJSON };
      const secondExpression = { ...literal("b"), toJSON };
      const first = engine.inferExpressionType(firstExpression);
      const second = engine.inferExpressionType(secondExpression);
      expect(first.typeString).toBe('"a"');
      expect(second.typeString).toBe('"b"');
      expect(calls).toBe(0);
    },
  );

  it.each([false, true])(
    "reports its depth limit before overflowing with caching %s",
    (enableCaching) => {
      const engine = new TypeInferenceEngine({
        enableCaching,
        maxRecursionDepth: 8,
      });
      expect(() =>
        engine.inferExpressionType(deepGroups(literal("a"))),
      ).toThrow(TypeInferenceError);
      expect(engine.inferExpressionType(literal("b")).typeString).toBe('"b"');
    },
  );

  it.each([false, true])(
    "keeps grammar inference usable after a deeply nested rule with caching %s",
    (enableCaching) => {
      const grammar = createGrammarDefinition(
        "G",
        [],
        [
          createRuleDefinition("deep", deepGroups(literal("a"))),
          createRuleDefinition("next", literal("b")),
        ],
      );
      const result = new TypeInferenceEngine({
        enableCaching,
        maxRecursionDepth: 8,
      }).inferGrammarTypes(grammar);
      expect(result.ruleTypes.get("deep")?.typeString).toBe("unknown");
      expect(result.ruleTypes.get("next")?.typeString).toBe('"b"');
      expect(result.warnings).toEqual(["Maximum recursion depth exceeded (8)"]);
    },
  );

  it.each([false, true])(
    "does not inspect an action's deep child for type inference with caching %s",
    (enableCaching) => {
      const expression = createActionExpression(
        deepGroups(literal("a")),
        "return undefined;",
      );
      const result = new TypeInferenceEngine({
        enableCaching,
        maxRecursionDepth: 0,
      }).inferExpressionType(expression);
      expect(result.typeString).toBe("unknown");
    },
  );

  it.each([false, true])(
    "unwraps deep transparent groups around a capture with caching %s",
    (enableCaching) => {
      const expression = createSequence([
        deepGroups(createLabeledExpression("value", literal("a"))),
        literal("b"),
      ]);
      const result = new TypeInferenceEngine({
        enableCaching,
        maxRecursionDepth: 8,
      }).inferExpressionType(expression);
      expect(result.typeString).toBe('{ value: "a" }');
    },
  );

  it("uses structural keys independently of property insertion order", () => {
    const engine = new TypeInferenceEngine();
    const first = engine.inferExpressionType(literal("a"));
    const second = engine.inferExpressionType({
      value: "a",
      quote: '"',
      type: "StringLiteral",
    });
    expect(second).toBe(first);
  });

  it("tracks mutations to fields that affect inferred types", () => {
    const engine = new TypeInferenceEngine();
    const expression = createGroup(literal("a"));
    expect(engine.inferExpressionType(expression).typeString).toBe('"a"');
    expression.expression = literal("b");
    expect(engine.inferExpressionType(expression).typeString).toBe('"b"');
  });

  it("collects dependencies through a deep child whose action result is unknown", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "start",
          createActionExpression(
            deepGroups(createIdentifier("target")),
            "return undefined;",
          ),
        ),
        createRuleDefinition("target", literal("a")),
      ],
    );
    const typed = new TypeIntegrationEngine({
      generateTypeGuards: true,
    }).createTypedGrammar(grammar);
    expect(typed.typeInference.ruleTypes.get("start")?.typeString).toBe(
      "unknown",
    );
    expect(typed.rules[0]?.dependencies).toEqual(["target"]);
  });
});
