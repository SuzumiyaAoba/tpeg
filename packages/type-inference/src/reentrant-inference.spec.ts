import { describe, expect, it, vi } from "vite-plus/test";
import {
  type GrammarDefinition,
  createGrammarDefinition,
  createGroup,
  createIdentifier,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import {
  type GrammarTypeInference,
  TypeInferenceEngine,
} from "./type-inference";

const literal = (value: string) => createStringLiteral(value, '"');
const grammar = (name: string, value: string) =>
  createGrammarDefinition(
    name,
    [],
    [
      createRuleDefinition("leaf", literal(value)),
      createRuleDefinition(`${name}Only`, createIdentifier("leaf")),
    ],
  );
type HookPoint = "literal" | "pattern" | "name" | "rules";

function hookedGrammar(
  point: HookPoint,
  hook: () => void,
  value = "outer",
): GrammarDefinition {
  let called = false;
  const trigger = () => {
    if (!called) {
      called = true;
      hook();
    }
  };
  const leaf = literal(value);
  const rules = [
    createRuleDefinition("leaf", leaf),
    createRuleDefinition("start", createIdentifier("leaf")),
  ];
  const ast = createGrammarDefinition("Outer", [], rules);
  const targets = {
    literal: [leaf, "value", value],
    pattern: [rules[0]!, "pattern", leaf],
    name: [rules[0]!, "name", "leaf"],
    rules: [ast, "rules", rules],
  } as const;
  const [target, property, result] = targets[point];
  Object.defineProperty(target, property, {
    get() {
      trigger();
      return result;
    },
  });
  return ast;
}

function withoutTime(result: GrammarTypeInference) {
  const { inferenceTime: _time, ...stats } = result.stats;
  return { ...result, stats };
}

describe.each([false, true])(
  "reentrant type inference, caching %s",
  (enableCaching) => {
    it.each<HookPoint>(["literal", "pattern", "name", "rules"])(
      "isolates rules, caches, and statistics when a %s getter infers another grammar",
      (point) => {
        const engine = new TypeInferenceEngine({ enableCaching });
        let inner: GrammarTypeInference | undefined;
        const outer = engine.inferGrammarTypes(
          hookedGrammar(point, () => {
            inner = engine.inferGrammarTypes(grammar("Inner", "inner"));
          }),
        );
        const control = new TypeInferenceEngine({ enableCaching });
        expect(withoutTime(outer)).toEqual(
          withoutTime(
            control.inferGrammarTypes(hookedGrammar(point, () => {})),
          ),
        );
        expect(withoutTime(inner!)).toEqual(
          withoutTime(control.inferGrammarTypes(grammar("Inner", "inner"))),
        );
        expect(
          engine.inferExpressionType(createIdentifier("leaf")).typeString,
        ).toBe('"outer"');
        expect(
          engine.inferExpressionType(createIdentifier("InnerOnly")).typeString,
        ).toBe("unknown");
      },
    );

    it("restores the outer grammar after a caught inner exception", () => {
      const engine = new TypeInferenceEngine({ enableCaching });
      const failure = new Error("inner literal");
      const broken = Object.defineProperty(literal("inner"), "value", {
        get() {
          throw failure;
        },
      });
      const outer = engine.inferGrammarTypes(
        hookedGrammar("literal", () => {
          expect(() =>
            engine.inferGrammarTypes(
              createGrammarDefinition(
                "Broken",
                [],
                [createRuleDefinition("leaf", broken)],
              ),
            ),
          ).toThrow(failure);
        }),
      );
      const control = new TypeInferenceEngine({ enableCaching });
      expect(withoutTime(outer)).toEqual(
        withoutTime(
          control.inferGrammarTypes(hookedGrammar("literal", () => {})),
        ),
      );
      expect(
        engine.inferExpressionType(createIdentifier("leaf")).typeString,
      ).toBe('"outer"');
    });

    it("keeps the outer grammar available when an inner exception propagates", () => {
      const engine = new TypeInferenceEngine({ enableCaching });
      const failure = new Error("inner literal");
      const broken = Object.defineProperty(literal("inner"), "value", {
        get() {
          throw failure;
        },
      });
      expect(() =>
        engine.inferGrammarTypes(
          hookedGrammar("literal", () => {
            engine.inferGrammarTypes(
              createGrammarDefinition(
                "Broken",
                [],
                [createRuleDefinition("leaf", broken)],
              ),
            );
          }),
        ),
      ).toThrow(failure);
      expect(
        engine.inferExpressionType(createIdentifier("leaf")).typeString,
      ).toBe('"outer"');
    });

    it("does not transfer an inner depth failure into the outer result", () => {
      const engine = new TypeInferenceEngine({
        enableCaching,
        maxRecursionDepth: 2,
      });
      let inner: GrammarTypeInference | undefined;
      const outer = engine.inferGrammarTypes(
        hookedGrammar("literal", () => {
          inner = engine.inferGrammarTypes(
            createGrammarDefinition(
              "Deep",
              [],
              [
                createRuleDefinition(
                  "leaf",
                  createGroup(createGroup(createGroup(literal("inner")))),
                ),
              ],
            ),
          );
        }),
      );
      expect(inner?.warnings).toEqual(["Maximum recursion depth exceeded (2)"]);
      expect(outer.warnings).toEqual([]);
      expect(outer.ruleTypes.get("start")?.typeString).toBe('"outer"');
      expect(
        engine.inferExpressionType(createIdentifier("leaf")).typeString,
      ).toBe('"outer"');
    });

    it("keeps an actual inner cycle separate from nonrecursive outer references", () => {
      const engine = new TypeInferenceEngine({ enableCaching });
      let inner: GrammarTypeInference | undefined;
      const outer = engine.inferGrammarTypes(
        hookedGrammar("literal", () => {
          inner = engine.inferGrammarTypes(
            createGrammarDefinition(
              "Loop",
              [],
              [createRuleDefinition("leaf", createIdentifier("leaf"))],
            ),
          );
        }),
      );
      expect(inner?.circularDependencies).toEqual([["leaf"]]);
      expect(outer.circularDependencies).toEqual([]);
      expect(outer.warnings).toEqual([]);
      expect(outer.ruleTypes.get("start")?.typeString).toBe('"outer"');
    });

    it("preserves the previous grammar during standalone expression inference", () => {
      const engine = new TypeInferenceEngine({ enableCaching });
      engine.inferGrammarTypes(grammar("Previous", "previous"));
      const hooked = Object.defineProperty(literal("a"), "value", {
        get() {
          engine.inferGrammarTypes(grammar("Inner", "inner"));
          return "a";
        },
      });
      const type = engine.inferExpressionType(
        createSequence([hooked, createIdentifier("leaf")]),
      );
      expect(type.typeString).toBe('["a", "previous"]');
      expect(
        engine.inferExpressionType(createIdentifier("leaf")).typeString,
      ).toBe('"previous"');
    });

    it("restores the depth budget after reentering from a standalone expression", () => {
      const engine = new TypeInferenceEngine({
        enableCaching,
        maxRecursionDepth: 0,
      });
      const hooked = Object.defineProperty(literal("a"), "value", {
        get() {
          engine.inferGrammarTypes(createGrammarDefinition("Empty", [], []));
          return "a";
        },
      });
      expect(engine.inferExpressionType(hooked).typeString).toBe('"a"');
      expect(() =>
        engine.inferExpressionType(createGroup(literal("b"))),
      ).toThrow("Maximum recursion depth exceeded (0)");
      expect(engine.inferExpressionType(literal("c")).typeString).toBe('"c"');
    });

    it("restores each context across three nested grammar runs", () => {
      const engine = new TypeInferenceEngine({ enableCaching });
      let middle: GrammarTypeInference | undefined;
      let deep: GrammarTypeInference | undefined;
      const outer = engine.inferGrammarTypes(
        hookedGrammar("literal", () => {
          middle = engine.inferGrammarTypes(
            hookedGrammar(
              "literal",
              () => {
                deep = engine.inferGrammarTypes(grammar("Deep", "deep"));
              },
              "middle",
            ),
          );
        }),
      );
      expect(deep?.ruleTypes.get("DeepOnly")?.typeString).toBe('"deep"');
      expect(middle?.ruleTypes.get("start")?.typeString).toBe('"middle"');
      expect(outer.ruleTypes.get("start")?.typeString).toBe('"outer"');
      expect(
        engine.inferExpressionType(createIdentifier("leaf")).typeString,
      ).toBe('"outer"');
    });

    it("preserves warm reference results and their required depth across a nested run", () => {
      const engine = new TypeInferenceEngine({
        enableCaching,
        maxRecursionDepth: 2,
      });
      const make = (hook: () => void) => {
        const trigger = Object.defineProperty(literal("trigger"), "value", {
          get() {
            hook();
            return "trigger";
          },
        });
        return createGrammarDefinition(
          "Outer",
          [],
          [
            createRuleDefinition("leaf", literal("a")),
            createRuleDefinition("alias", createIdentifier("leaf")),
            createRuleDefinition("trigger", trigger),
            createRuleDefinition("warm", createStar(createIdentifier("leaf"))),
            createRuleDefinition(
              "deep",
              createGroup(createStar(createIdentifier("leaf"))),
            ),
          ],
        );
      };
      const result = engine.inferGrammarTypes(
        make(() => {
          engine.inferGrammarTypes(grammar("Inner", "inner"));
        }),
      );
      const control = new TypeInferenceEngine({
        enableCaching,
        maxRecursionDepth: 2,
      });
      expect(withoutTime(result)).toEqual(
        withoutTime(control.inferGrammarTypes(make(() => {}))),
      );
      expect(result.warnings).toEqual(["Maximum recursion depth exceeded (2)"]);
      if (enableCaching) {
        expect(result.ruleTypes.get("warm")?.arrayElement).toBe(
          result.ruleTypes.get("alias"),
        );
      }
      expect(result.ruleTypes.get("deep")?.typeString).toBe("unknown");
    });

    it("measures each grammar from its own start time", () => {
      let now = 0;
      const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
      try {
        const engine = new TypeInferenceEngine({ enableCaching });
        let inner: GrammarTypeInference | undefined;
        const outer = engine.inferGrammarTypes(
          hookedGrammar("literal", () => {
            now = 100;
            const innerLiteral = Object.defineProperty(
              literal("inner"),
              "value",
              {
                get() {
                  now = 105;
                  return "inner";
                },
              },
            );
            inner = engine.inferGrammarTypes(
              createGrammarDefinition(
                "Inner",
                [],
                [createRuleDefinition("leaf", innerLiteral)],
              ),
            );
            now = 150;
          }),
        );
        expect(inner?.stats.inferenceTime).toBe(5);
        expect(outer.stats.inferenceTime).toBe(150);
      } finally {
        clock.mockRestore();
      }
    });
  },
);
