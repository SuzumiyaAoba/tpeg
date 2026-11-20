import { describe, expect, it } from "vite-plus/test";
import fc from "fast-check";
import {
  type Expression,
  createActionExpression,
  createChoice,
  createGrammarDefinition,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createOptional,
  createQuantified,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import { TypeInferenceEngine, TypeInferenceError } from "./type-inference";

const literal = (value: string) => createStringLiteral(value, '"');
const wrappers: [string, (expression: Expression) => Expression][] = [
  ["reference", (expression) => expression],
  ["group", createGroup],
  ["array", createStar],
  ["tuple", (expression) => createSequence([expression, literal("end")])],
  ["choice", (expression) => createChoice([expression, literal("other")])],
  [
    "capture",
    (expression) =>
      createLabeledExpression("value", createOptional(expression)),
  ],
];

describe("cached rule references", () => {
  it.each([
    {},
    { inferObjectTypes: false },
    { inferUnionTypes: false },
    { inferObjectTypes: false, inferUnionTypes: false },
  ])("observes in-place child edits with options %j", (options) => {
    const value = literal("a");
    const choice = createChoice([value]);
    const sequence = createSequence([choice]);
    const leaf = createRuleDefinition("leaf", sequence);
    const grammar = createGrammarDefinition("G", [], [leaf]);
    const cached = new TypeInferenceEngine(options);
    const uncached = new TypeInferenceEngine({
      ...options,
      enableCaching: false,
    });
    cached.inferGrammarTypes(grammar);
    uncached.inferGrammarTypes(grammar);
    const expression = createStar(createIdentifier("leaf"));
    const verify = () => {
      const result = cached.inferExpressionType(expression);
      expect(result).toEqual(uncached.inferExpressionType(expression));
      expect(cached.inferExpressionType(expression)).toBe(result);
    };
    verify();
    value.value = "b";
    verify();
    choice.alternatives.push(literal("c"));
    verify();
    sequence.elements.push(literal("d"));
    verify();
    choice.alternatives.length = 0;
    verify();
    sequence.elements[0] = literal("e");
    verify();
  });

  it("observes changed and removed repetition bounds through a reference", () => {
    const pattern = createQuantified(literal("a"), 1, 3);
    const grammar = createGrammarDefinition(
      "G",
      [],
      [createRuleDefinition("leaf", pattern)],
    );
    const cached = new TypeInferenceEngine();
    const uncached = new TypeInferenceEngine({ enableCaching: false });
    cached.inferGrammarTypes(grammar);
    uncached.inferGrammarTypes(grammar);
    const expression = createIdentifier("leaf");
    const verify = () =>
      expect(cached.inferExpressionType(expression)).toEqual(
        uncached.inferExpressionType(expression),
      );
    verify();
    pattern.min = 0;
    verify();
    pattern.max = 1;
    verify();
    delete pattern.max;
    verify();
    pattern.max = 5;
    verify();
  });

  it("keeps a reference cache when ignored action children use getters", () => {
    const pattern = createActionExpression(literal("a"), "return undefined;");
    let reads = 0;
    Object.defineProperty(pattern, "expression", {
      get() {
        reads++;
        return literal("b");
      },
    });
    const engine = new TypeInferenceEngine();
    engine.inferGrammarTypes(
      createGrammarDefinition("G", [], [createRuleDefinition("leaf", pattern)]),
    );
    const expression = createStar(createIdentifier("leaf"));
    const result = engine.inferExpressionType(expression);
    expect(engine.inferExpressionType(expression)).toBe(result);
    expect(result.typeString).toBe("unknown[]");
    expect(reads).toBe(0);
  });

  it.each(wrappers)(
    "observes replacement and in-place mutation through a %s",
    (_name, wrap) => {
      const pattern = createGroup(literal("a"));
      const leaf = createRuleDefinition("leaf", pattern);
      const alias = createRuleDefinition("alias", createIdentifier("leaf"));
      const grammar = createGrammarDefinition("G", [], [leaf, alias]);
      const cached = new TypeInferenceEngine();
      const uncached = new TypeInferenceEngine({ enableCaching: false });
      cached.inferGrammarTypes(grammar);
      uncached.inferGrammarTypes(grammar);
      const expression = wrap(createIdentifier("alias"));
      const verify = () => {
        const result = cached.inferExpressionType(expression);
        expect(result).toEqual(uncached.inferExpressionType(expression));
        expect(cached.inferExpressionType(expression)).toBe(result);
      };
      verify();
      pattern.expression = literal("b");
      verify();
      leaf.pattern = createStar(literal("c"));
      verify();
      leaf.pattern = createLabeledExpression("value", literal("d"));
      verify();
      leaf.pattern = createChoice([literal("e"), literal("f")]);
      verify();
    },
  );

  it.each(["pattern", "value", "name"])(
    "does not skip a referenced %s getter or cache its parent",
    (point) => {
      const run = (enableCaching: boolean) => {
        const leaf = createRuleDefinition("leaf", literal("initial"));
        const alias = createRuleDefinition("alias", createIdentifier("leaf"));
        const engine = new TypeInferenceEngine({ enableCaching });
        engine.inferGrammarTypes(
          createGrammarDefinition("G", [], [leaf, alias]),
        );
        const expression = createStar(createIdentifier("alias"));
        engine.inferExpressionType(expression);
        let reads = 0;
        const values = () => (++reads % 2 === 1 ? "a" : "b");
        if (point === "pattern")
          Object.defineProperty(leaf, "pattern", {
            get() {
              return literal(values());
            },
          });
        else if (point === "value")
          Object.defineProperty(leaf.pattern, "value", { get: values });
        else {
          const reference = createIdentifier("leaf");
          Object.defineProperty(reference, "name", {
            get() {
              reads++;
              return "leaf";
            },
          });
          alias.pattern = reference;
        }
        return {
          types: [
            engine.inferExpressionType(expression),
            engine.inferExpressionType(expression),
          ],
          reads,
        };
      };
      const cached = run(true),
        uncached = run(false);
      expect(cached).toEqual(uncached);
      expect(cached.reads).toBe(2);
    },
  );

  it("preserves a referenced getter's original exception after warming", () => {
    const leaf = createRuleDefinition("leaf", literal("a"));
    const engine = new TypeInferenceEngine();
    engine.inferGrammarTypes(createGrammarDefinition("G", [], [leaf]));
    const reference = createIdentifier("leaf");
    engine.inferExpressionType(reference);
    const failure = new Error("referenced pattern failure");
    Object.defineProperty(leaf, "pattern", {
      configurable: true,
      get() {
        throw failure;
      },
    });
    expect(() => engine.inferExpressionType(reference)).toThrow(failure);
    Object.defineProperty(leaf, "pattern", {
      value: literal("b"),
      writable: true,
    });
    expect(engine.inferExpressionType(reference).typeString).toBe('"b"');
  });

  it.each([false, true])(
    "restores outer reference dependencies after a reentrant getter with caching %s",
    (enableCaching) => {
      const leaf = createRuleDefinition("leaf", literal("a"));
      const alias = createRuleDefinition("alias", createIdentifier("leaf"));
      const engine = new TypeInferenceEngine({ enableCaching });
      engine.inferGrammarTypes(
        createGrammarDefinition("Outer", [], [leaf, alias]),
      );
      const reference = createStar(createIdentifier("alias"));
      engine.inferExpressionType(reference);
      let reads = 0;
      Object.defineProperty(alias, "pattern", {
        get() {
          reads++;
          engine.inferGrammarTypes(
            createGrammarDefinition(
              "Inner",
              [],
              [createRuleDefinition("leaf", literal("inner"))],
            ),
          );
          leaf.pattern = literal("b");
          return createIdentifier("leaf");
        },
      });
      for (let call = 0; call < 2; call++)
        expect(engine.inferExpressionType(reference).typeString).toBe('"b"[]');
      expect(reads).toBe(2);
      expect(
        engine.inferExpressionType(createIdentifier("leaf")).typeString,
      ).toBe('"b"');
    },
  );

  it("observes a newly introduced cycle and recovers after it is removed", () => {
    const leaf = createRuleDefinition("leaf", literal("a"));
    const alias = createRuleDefinition("alias", createIdentifier("leaf"));
    const engine = new TypeInferenceEngine();
    engine.inferGrammarTypes(createGrammarDefinition("G", [], [leaf, alias]));
    const reference = createIdentifier("alias");
    engine.inferExpressionType(reference);
    leaf.pattern = createIdentifier("alias");
    expect(() => engine.inferExpressionType(reference)).toThrow(
      /Circular dependency detected/,
    );
    leaf.pattern = literal("b");
    expect(engine.inferExpressionType(reference).typeString).toBe('"b"');
  });

  it("enforces the depth limit when a warmed reference grows deeper", () => {
    const leaf = createRuleDefinition("leaf", literal("a"));
    const engine = new TypeInferenceEngine({ maxRecursionDepth: 2 });
    engine.inferGrammarTypes(createGrammarDefinition("G", [], [leaf]));
    const reference = createIdentifier("leaf");
    engine.inferExpressionType(reference);
    leaf.pattern = createGroup(createGroup(literal("b")));
    expect(() => engine.inferExpressionType(reference)).toThrow(
      TypeInferenceError,
    );
    leaf.pattern = literal("c");
    expect(engine.inferExpressionType(reference).typeString).toBe('"c"');
  });

  it("invalidates a missing reference when registration later supplies its rule", () => {
    const engine = new TypeInferenceEngine();
    const reference = createIdentifier("leaf");
    let early: string | undefined;
    const probe = createRuleDefinition(
      "probe",
      createActionExpression(literal("x"), "return undefined;"),
    );
    Object.defineProperty(probe, "name", {
      get() {
        early ??= engine.inferExpressionType(reference).typeString;
        return "probe";
      },
    });
    engine.inferGrammarTypes(
      createGrammarDefinition(
        "G",
        [],
        [probe, createRuleDefinition("leaf", literal("a"))],
      ),
    );
    expect(early).toBe("unknown");
    expect(engine.inferExpressionType(reference).typeString).toBe('"a"');
  });

  it("agrees with uncached inference through edits to an acyclic rule graph", () => {
    const edits = fc.array(
      fc.record({
        target: fc.nat({ max: 4 }),
        kind: fc.constantFrom("literal", "group", "array", "choice"),
        value: fc.constantFrom("a", "b", "c"),
      }),
      { minLength: 1, maxLength: 12 },
    );
    fc.assert(
      fc.property(edits, (changes) => {
        const rules = Array.from({ length: 5 }, (_, index) =>
          createRuleDefinition(
            `r${index}`,
            index === 0 ? literal("a") : createIdentifier(`r${index - 1}`),
          ),
        );
        const grammar = createGrammarDefinition("G", [], rules);
        const cached = new TypeInferenceEngine(),
          uncached = new TypeInferenceEngine({ enableCaching: false });
        cached.inferGrammarTypes(grammar);
        uncached.inferGrammarTypes(grammar);
        const expressions = rules.map((rule) => createIdentifier(rule.name));
        for (const expression of expressions)
          cached.inferExpressionType(expression);
        for (const change of changes) {
          const inner =
            change.target === 0
              ? literal(change.value)
              : createIdentifier(`r${change.target - 1}`);
          rules[change.target]!.pattern =
            change.kind === "literal"
              ? literal(change.value)
              : change.kind === "group"
                ? createGroup(inner)
                : change.kind === "array"
                  ? createStar(inner)
                  : createChoice([inner, literal(change.value)]);
          for (const expression of expressions)
            expect(cached.inferExpressionType(expression)).toEqual(
              uncached.inferExpressionType(expression),
            );
        }
      }),
      {
        seed: 20261010,
        numRuns: 200 * Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1),
      },
    );
  });
});
