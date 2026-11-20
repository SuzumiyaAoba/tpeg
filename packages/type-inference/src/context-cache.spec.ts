import { describe, expect, it } from "vite-plus/test";
import {
  type Expression,
  type GrammarDefinition,
  createAnyChar,
  createChoice,
  createGrammarDefinition,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import { TypeInferenceEngine } from "./type-inference";

const literal = (value: string) => createStringLiteral(value, '"');
const reference = () => createIdentifier("leaf");
const wrappers: [string, (inner: Expression) => Expression][] = [
  ["group", createGroup],
  ["repetition", createStar],
  ["choice", (inner) => createChoice([inner])],
  ["tuple", (inner) => createSequence([inner, literal("b")])],
  ["capture", (inner) => createLabeledExpression("value", inner)],
  [
    "capture sequence",
    (inner) =>
      createSequence([
        createLabeledExpression("value", inner),
        createAnyChar(),
      ]),
  ],
];

function infer(
  grammar: GrammarDefinition,
  enableCaching: boolean,
  maxRecursionDepth: number,
) {
  const { stats: _stats, ...result } = new TypeInferenceEngine({
    enableCaching,
    maxRecursionDepth,
  }).inferGrammarTypes(grammar);
  return result;
}

describe("type inference context and cached recursion depth", () => {
  it.each(wrappers)(
    "does not let a warm reference bypass the limit inside a %s",
    (_name, wrap) => {
      const grammar = createGrammarDefinition(
        "G",
        [],
        [
          createRuleDefinition("leaf", literal("a")),
          createRuleDefinition("alias", reference()),
          createRuleDefinition("start", wrap(reference())),
        ],
      );
      const uncached = infer(grammar, false, 1);
      expect(uncached.ruleTypes.get("alias")?.typeString).toBe('"a"');
      expect(uncached.ruleTypes.get("start")?.typeString).toBe("unknown");
      expect(uncached.warnings).toEqual([
        "Maximum recursion depth exceeded (1)",
      ]);
      expect(infer(grammar, true, 1)).toEqual(uncached);
    },
  );

  it.each(wrappers)(
    "still accepts a warm reference exactly at the limit inside a %s",
    (_name, wrap) => {
      const grammar = createGrammarDefinition(
        "G",
        [],
        [
          createRuleDefinition("leaf", literal("a")),
          createRuleDefinition("alias", reference()),
          createRuleDefinition("start", wrap(reference())),
        ],
      );
      const uncached = infer(grammar, false, 2);
      expect(uncached.warnings).toEqual([]);
      expect(infer(grammar, true, 2)).toEqual(uncached);
    },
  );

  it("includes every referenced rule in the cached depth", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition("leaf", literal("a")),
        createRuleDefinition("alias", reference()),
        createRuleDefinition("warm", createIdentifier("alias")),
        createRuleDefinition("start", createGroup(createIdentifier("alias"))),
      ],
    );
    const uncached = infer(grammar, false, 2);
    expect(uncached.warnings).toEqual(["Maximum recursion depth exceeded (2)"]);
    expect(uncached.ruleTypes.get("start")?.typeString).toBe("unknown");
    expect(infer(grammar, true, 2)).toEqual(uncached);
  });

  it("propagates the depth of cache hits into an enclosing cached result", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition("leaf", literal("a")),
        createRuleDefinition("alias", reference()),
        createRuleDefinition("warm", createStar(reference())),
        createRuleDefinition("start", createGroup(createStar(reference()))),
      ],
    );
    const uncached = infer(grammar, false, 2);
    expect(uncached.ruleTypes.get("warm")?.typeString).toBe('"a"[]');
    expect(uncached.ruleTypes.get("start")?.typeString).toBe("unknown");
    expect(infer(grammar, true, 2)).toEqual(uncached);
  });

  it("keeps the limit independent of rule order", () => {
    const leaf = createRuleDefinition("leaf", literal("a"));
    const alias = createRuleDefinition("alias", reference());
    const start = createRuleDefinition("start", createGroup(reference()));
    for (const rules of [
      [leaf, alias, start],
      [leaf, start, alias],
      [alias, leaf, start],
      [alias, start, leaf],
      [start, leaf, alias],
      [start, alias, leaf],
    ]) {
      const grammar = createGrammarDefinition("G", [], rules);
      const result = infer(grammar, true, 1);
      expect(result.ruleTypes.get("start")?.typeString).toBe("unknown");
      expect(result).toEqual(infer(grammar, false, 1));
    }
  });

  it("reuses a result at different depths when the budget is sufficient", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition("leaf", literal("a")),
        createRuleDefinition("alias", reference()),
        createRuleDefinition("start", createGroup(reference())),
      ],
    );
    const result = new TypeInferenceEngine({
      maxRecursionDepth: 2,
    }).inferGrammarTypes(grammar);
    expect(result.ruleTypes.get("start")).toBe(result.ruleTypes.get("alias"));
    expect(result.stats.cacheHits).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it("uses actual inference depth when transparent groups are unwrapped", () => {
    let capture: Expression = createLabeledExpression("value", literal("a"));
    for (let index = 0; index < 200; index++) capture = createGroup(capture);
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition("leaf", literal("a")),
        createRuleDefinition(
          "start",
          createSequence([capture, createAnyChar()]),
        ),
      ],
    );
    const result = infer(grammar, true, 1);
    expect(result.warnings).toEqual([]);
    expect(result.ruleTypes.get("start")?.typeString).toBe('{ value: "a" }');
    expect(result).toEqual(infer(grammar, false, 1));
  });

  it.each(["unknown", "void", "number", "External"])(
    "does not shorten the required depth when a custom mapping produces %s",
    (mappedType) => {
      const grammar = createGrammarDefinition(
        "G",
        [],
        [
          createRuleDefinition("leaf", literal("a")),
          createRuleDefinition("alias", reference()),
          createRuleDefinition("start", createGroup(reference())),
        ],
      );
      const run = (enableCaching: boolean) => {
        const { stats: _stats, ...result } = new TypeInferenceEngine({
          customTypeMappings: new Map([['"a"', mappedType]]),
          maxRecursionDepth: 1,
          enableCaching,
        }).inferGrammarTypes(grammar);
        return result;
      };
      const uncached = run(false);
      expect(uncached.ruleTypes.get("alias")?.typeString).toBe(mappedType);
      expect(uncached.warnings).toEqual([
        "Maximum recursion depth exceeded (1)",
      ]);
      expect(run(true)).toEqual(uncached);
    },
  );

  it.each([false, true])(
    "clears the active rule after a handled depth failure with caching %s",
    (enableCaching) => {
      const engine = new TypeInferenceEngine({
        enableCaching,
        maxRecursionDepth: 1,
      });
      const result = engine.inferGrammarTypes(
        createGrammarDefinition(
          "G",
          [],
          [
            createRuleDefinition("leaf", literal("a")),
            createRuleDefinition("start", createGroup(reference())),
          ],
        ),
      );
      expect(result.warnings).toEqual(["Maximum recursion depth exceeded (1)"]);
      expect(() =>
        engine.inferExpressionType(createIdentifier("start")),
      ).toThrow("Maximum recursion depth exceeded (1)");
      expect(engine.inferExpressionType(reference()).typeString).toBe('"a"');
    },
  );

  it.each([false, true])(
    "clears the active rule after a grammar run with caching %s",
    (enableCaching) => {
      const engine = new TypeInferenceEngine({ enableCaching });
      engine.inferGrammarTypes(
        createGrammarDefinition(
          "G",
          [],
          [createRuleDefinition("leaf", literal("a"))],
        ),
      );
      const type = engine.inferExpressionType(reference());
      expect(type.typeString).toBe('"a"');
      expect(type.documentation).toBe("Result of rule leaf");
    },
  );

  it.each([false, true])(
    "clears the active rule after an unexpected failure with caching %s",
    (enableCaching) => {
      const failure = new Error("literal getter");
      const broken = Object.defineProperty(literal("a"), "value", {
        get() {
          throw failure;
        },
      });
      const engine = new TypeInferenceEngine({ enableCaching });
      expect(() =>
        engine.inferGrammarTypes(
          createGrammarDefinition(
            "G",
            [],
            [createRuleDefinition("leaf", broken)],
          ),
        ),
      ).toThrow(failure);
      expect(() => engine.inferExpressionType(reference())).toThrow(failure);
    },
  );
});
