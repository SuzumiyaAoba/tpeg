import { describe, expect, it } from "vite-plus/test";
import fc from "fast-check";
import {
  type Expression,
  createChoice,
  createGrammarDefinition,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createOptional,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import { TypeInferenceEngine } from "./type-inference";

const literal = (value: string) => createStringLiteral(value, '"');
const fixtures: [string, () => Expression][] = [
  ["literal", () => literal("a")],
  ["group", () => createGroup(literal("a"))],
  ["array", () => createStar(literal("a"))],
  ["tuple", () => createSequence([literal("a"), literal("b")])],
  ["choice", () => createChoice([literal("a"), literal("b")])],
  [
    "capture",
    () => createLabeledExpression("value", createOptional(literal("a"))),
  ],
];

describe("mutable type mappings and cached inference", () => {
  it.each(fixtures)(
    "observes mapping edits for a cached %s",
    (_name, factory) => {
      const customTypeMappings = new Map<string, string>();
      const cached = new TypeInferenceEngine({ customTypeMappings });
      const uncached = new TypeInferenceEngine({
        customTypeMappings,
        enableCaching: false,
      });
      const expression = factory();
      const verify = () => {
        const result = cached.inferExpressionType(expression);
        expect(result).toEqual(uncached.inferExpressionType(expression));
        expect(cached.inferExpressionType(expression)).toBe(result);
        return result;
      };
      verify();
      customTypeMappings.set('"a"', "number");
      verify();
      customTypeMappings.set("number[]", "boolean");
      verify();
      customTypeMappings.set('"a"', "symbol");
      verify();
      customTypeMappings.delete('"a"');
      verify();
      customTypeMappings.clear();
      const warm = verify();
      customTypeMappings.set("unrelated", "number");
      expect(verify()).toBe(warm);
      customTypeMappings.set("unrelated", "boolean");
      expect(verify()).toBe(warm);
      customTypeMappings.clear();
      expect(verify()).toBe(warm);
    },
  );

  it("tracks additional mapping applications in groups and rule references", () => {
    const customTypeMappings = new Map([['"a"', "number"]]);
    const cached = new TypeInferenceEngine({ customTypeMappings });
    const uncached = new TypeInferenceEngine({
      customTypeMappings,
      enableCaching: false,
    });
    const leaf = literal("a");
    const grammar = createGrammarDefinition(
      "G",
      [],
      [createRuleDefinition("leaf", leaf)],
    );
    cached.inferGrammarTypes(grammar);
    uncached.inferGrammarTypes(grammar);
    const expressions = [
      leaf,
      createGroup(leaf),
      createGroup(createGroup(leaf)),
      createIdentifier("leaf"),
    ];
    const first = expressions.map((expression) =>
      cached.inferExpressionType(expression),
    );
    customTypeMappings.set("number", "boolean");
    expect(cached.inferExpressionType(leaf)).toBe(first[0]);
    for (const expression of expressions)
      expect(cached.inferExpressionType(expression)).toEqual(
        uncached.inferExpressionType(expression),
      );
    customTypeMappings.set("boolean", "symbol");
    for (const expression of expressions)
      expect(cached.inferExpressionType(expression)).toEqual(
        uncached.inferExpressionType(expression),
      );
    expect(cached.inferExpressionType(expressions[2]!).typeString).toBe(
      "symbol",
    );
  });

  it.each(["before", "between", "reentrant"])(
    "observes a mapping change %s sibling inference and restores outer bookkeeping",
    (kind) => {
      const run = (enableCaching: boolean) => {
        const customTypeMappings = new Map<string, string>();
        const engine = new TypeInferenceEngine({
          customTypeMappings,
          enableCaching,
        });
        engine.inferExpressionType(literal("a"));
        const trigger = Object.defineProperty(literal("b"), "value", {
          get() {
            customTypeMappings.set('"a"', "number");
            if (kind === "reentrant")
              engine.inferGrammarTypes(
                createGrammarDefinition(
                  "Inner",
                  [],
                  [createRuleDefinition("inner", literal("a"))],
                ),
              );
            return "b";
          },
        });
        const elements =
          kind === "before"
            ? [trigger, literal("a")]
            : [literal("a"), trigger, literal("a")];
        return engine.inferExpressionType(createSequence(elements));
      };
      expect(run(true)).toEqual(run(false));
      expect(run(true).typeString).toBe(
        kind === "before" ? '["b", number]' : '["a", "b", number]',
      );
    },
  );

  it("recomputes a cached reference whose children observed different mapping values", () => {
    const customTypeMappings = new Map<string, string>();
    const engine = new TypeInferenceEngine({ customTypeMappings });
    let changed = false;
    const trigger = Object.defineProperty(literal("b"), "value", {
      get() {
        if (!changed) {
          changed = true;
          customTypeMappings.set('"a"', "number");
        }
        return "b";
      },
    });
    const pattern = createSequence([literal("a"), trigger, literal("a")]);
    // Register the target, then omit it from the second rules read so it stays uninferred.
    const grammar = createGrammarDefinition("G", [], []);
    let reads = 0;
    Object.defineProperty(grammar, "rules", {
      get() {
        return ++reads === 1 ? [createRuleDefinition("target", pattern)] : [];
      },
    });
    engine.inferGrammarTypes(grammar);
    const reference = createIdentifier("target");
    const first = engine.inferExpressionType(reference);
    expect(first.typeString).toBe('["a", "b", number]');
    const second = engine.inferExpressionType(reference);
    expect(second.typeString).toBe('[number, "b", number]');
    // The referenced getter must still run, so the reference itself is not cached.
    expect(engine.inferExpressionType(reference)).toEqual(second);
  });

  it("agrees with uncached inference through arbitrary mapping edits", () => {
    const edit = fc.record({
      kind: fc.constantFrom("set", "delete", "clear"),
      source: fc.constantFrom(
        '"a"',
        '"b"',
        '"a"[]',
        '"a" | "b"',
        "number",
        "number[]",
        "boolean",
        "unused",
      ),
      replacement: fc.constantFrom(
        "number",
        "boolean",
        "unknown",
        "null",
        "undefined",
        "symbol",
        '"mapped"',
        "",
      ),
    });
    fc.assert(
      fc.property(fc.array(edit, { minLength: 1, maxLength: 12 }), (edits) => {
        const customTypeMappings = new Map<string, string>();
        const cached = new TypeInferenceEngine({ customTypeMappings });
        const uncached = new TypeInferenceEngine({
          customTypeMappings,
          enableCaching: false,
        });
        const expressions = fixtures.map(([, factory]) => factory());
        for (const expression of expressions)
          cached.inferExpressionType(expression);
        for (const { kind, source, replacement } of edits) {
          if (kind === "set") customTypeMappings.set(source, replacement);
          else if (kind === "delete") customTypeMappings.delete(source);
          else customTypeMappings.clear();
          for (const expression of expressions)
            expect(cached.inferExpressionType(expression)).toEqual(
              uncached.inferExpressionType(expression),
            );
        }
      }),
      {
        seed: 20261009,
        numRuns: 200 * Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1),
      },
    );
  });
});
