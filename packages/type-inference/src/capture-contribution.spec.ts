import { describe, expect, it } from "vite-plus/test";
import { transformWithOxc } from "vite-plus";
import {
  type Expression,
  createChoice,
  createCut,
  createGrammarDefinition,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createOptional,
  createRuleDefinition,
  createSequence,
  createStringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import { TypeInferenceEngine, TypeInferenceError } from "./type-inference";
import { TypeIntegrationEngine } from "./type-integration";

const text = (value: string) => createStringLiteral(value, '"');
const label = (name: string, child: Expression) =>
  createLabeledExpression(name, child);
const parent = (child: Expression) =>
  createSequence([label("x", text("a")), child]);
const wrappers: [string, (child: Expression) => Expression][] = [
  ["group", createGroup],
  ["optional", createOptional],
  ["choice", (child) => createChoice([child, text("c")])],
  ["singleton sequence", (child) => createSequence([createCut(), child])],
  ["tuple", (child) => createSequence([child, text("c")])],
  [
    "merged sequence",
    (child) => createSequence([label("y", text("b")), child]),
  ],
];
function groups(child: Expression, count: number) {
  for (let i = 0; i < count; i++) child = createGroup(child);
  return child;
}

describe("capture-only contribution inference", () => {
  it.each(wrappers)(
    "does not read a local rule pattern through %s",
    (_name, wrap) => {
      for (const enableCaching of [false, true])
        for (const inferUnionTypes of [false, true]) {
          const rule = createRuleDefinition("inner", text("b"));
          const engine = new TypeInferenceEngine({
            enableCaching,
            inferUnionTypes,
          });
          engine.inferGrammarTypes(createGrammarDefinition("G", [], [rule]));
          let reads = 0;
          Object.defineProperty(rule, "pattern", {
            get() {
              reads++;
              throw new Error("irrelevant rule pattern");
            },
          });
          const expression = parent(wrap(createIdentifier("inner")));
          expect(engine.inferExpressionType(expression).typeString).toBe(
            '{ x: "a" }',
          );
          expect(engine.inferExpressionType(expression).typeString).toBe(
            '{ x: "a" }',
          );
          expect(reads).toBe(0);
        }
    },
  );

  it("skips scalar values and fields inside nested merged objects", () => {
    for (const enableCaching of [false, true]) {
      const ignored = text("unused");
      let reads = 0;
      Object.defineProperty(ignored, "value", {
        get() {
          reads++;
          throw new Error("irrelevant scalar value");
        },
      });
      for (const shape of [
        createGroup(ignored),
        createOptional(ignored),
        createChoice([ignored, text("c")]),
        createSequence([label("y", ignored), text("b")]),
      ]) {
        expect(
          new TypeInferenceEngine({ enableCaching }).inferExpressionType(
            parent(shape),
          ).typeString,
        ).toBe('{ x: "a" }');
      }
      expect(reads).toBe(0);
    }
  });

  it("still reads values of fields that actually contribute", () => {
    for (const enableCaching of [false, true]) {
      let reads = 0;
      const important = text("b");
      Object.defineProperty(important, "value", {
        get() {
          reads++;
          throw new Error("required field value");
        },
      });
      const engine = new TypeInferenceEngine({ enableCaching });
      expect(() =>
        engine.inferExpressionType(
          parent(createChoice([label("y", important), text("c")])),
        ),
      ).toThrow("required field value");
      expect(reads).toBe(1);
      expect(engine.inferExpressionType(parent(text("c"))).typeString).toBe(
        '{ x: "a" }',
      );
    }
  });

  it("ignores recursion and depth in discarded rule values", () => {
    for (const enableCaching of [false, true]) {
      const rule = createRuleDefinition("inner", text("b"));
      const engine = new TypeInferenceEngine({
        enableCaching,
        maxRecursionDepth: 4,
      });
      engine.inferGrammarTypes(createGrammarDefinition("G", [], [rule]));
      rule.pattern = groups(text("b"), 1000);
      expect(
        engine.inferExpressionType(
          parent(createOptional(createIdentifier("inner"))),
        ).typeString,
      ).toBe('{ x: "a" }');
      expect(() =>
        engine.inferExpressionType(createIdentifier("inner")),
      ).toThrow(TypeInferenceError);
      rule.pattern = createIdentifier("inner");
      expect(
        engine.inferExpressionType(
          parent(createChoice([createIdentifier("inner"), text("c")])),
        ).typeString,
      ).toBe('{ x: "a" }');
      expect(() =>
        engine.inferExpressionType(createIdentifier("inner")),
      ).toThrow(/Circular dependency/);
    }
  });

  it("infers recursive captures precisely when only nested rule values recur", async () => {
    const pattern = parent(createOptional(createIdentifier("start")));
    const ast = createGrammarDefinition(
      "G",
      [],
      [createRuleDefinition("start", pattern)],
    );
    const inferred = new TypeInferenceEngine().inferGrammarTypes(ast);
    expect(inferred.ruleTypes.get("start")?.typeString).toBe('{ x: "a" }');
    expect(inferred.warnings).toEqual([]);
    expect(inferred.circularDependencies).toEqual([]);
    const integration = new TypeIntegrationEngine({
      generateTypeGuards: true,
      includeDocumentation: false,
    });
    const typed = integration.createTypedGrammar(ast);
    expect(integration.getDependencies(typed, "start")).toEqual(["start"]);
    expect(integration.hasCircularDependency(typed, "start")).toBe(false);
    const definitions = typed.typeDefinitions;
    const js = (await transformWithOxc(definitions, "recursive-captures.ts"))
      .code;
    const guard = (
      await import(
        `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
      )
    ).isStartResult;
    expect(guard({ x: "a" })).toBe(true);
    expect(guard({ x: "b" })).toBe(false);
    expect(guard({})).toBe(false);
    const necessary = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "start",
          label("value", createIdentifier("start")),
        ),
      ],
    );
    expect(
      new TypeInferenceEngine().inferGrammarTypes(necessary)
        .circularDependencies,
    ).toEqual([["start"]]);
  });

  it.each([false, true])(
    "keeps value and capture caches separate with values warmed first=%s",
    (valueFirst) => {
      const child = createGroup(text("b"));
      const engine = new TypeInferenceEngine();
      if (valueFirst)
        expect(engine.inferExpressionType(child).typeString).toBe('"b"');
      expect(engine.inferExpressionType(parent(child)).typeString).toBe(
        '{ x: "a" }',
      );
      expect(engine.inferExpressionType(child).typeString).toBe('"b"');
      expect(engine.inferExpressionType(parent(child)).typeString).toBe(
        '{ x: "a" }',
      );
    },
  );

  it("only observes mappings for values that contribute", () => {
    const seen: string[] = [];
    class Mappings extends Map<string, string> {
      override get(key: string) {
        seen.push(key);
        if (key === "") throw new Error("capture-only mapping lookup");
        return super.get(key);
      }
    }
    const mappings = new Mappings([['"b"', "number"]]);
    const engine = new TypeInferenceEngine({ customTypeMappings: mappings });
    const child = createGroup(text("b"));
    const expression = parent(child);
    expect(engine.inferExpressionType(expression).typeString).toBe(
      '{ x: "a" }',
    );
    expect(engine.inferExpressionType(expression).typeString).toBe(
      '{ x: "a" }',
    );
    expect(seen).not.toContain('"b"');
    expect(engine.inferExpressionType(child).typeString).toBe("number");
    mappings.set('"b"', "boolean");
    expect(engine.inferExpressionType(child).typeString).toBe("boolean");
    const contributed = parent(
      createChoice([label("y", text("b")), text("c")]),
    );
    expect(engine.inferExpressionType(contributed).typeString).toContain(
      "y: boolean",
    );
    mappings.set('"b"', "string");
    expect(engine.inferExpressionType(contributed).typeString).toContain(
      "y: string",
    );
  });

  it.each(wrappers.slice(0, 4))(
    "observes later registration through %s",
    (_name, wrap) => {
      const engine = new TypeInferenceEngine();
      const expression = parent(wrap(createIdentifier("external")));
      let early: string | undefined;
      const probe = createRuleDefinition("probe", text("p"));
      Object.defineProperty(probe, "name", {
        get() {
          early ??= engine.inferExpressionType(expression).typeString;
          return "probe";
        },
      });
      engine.inferGrammarTypes(
        createGrammarDefinition(
          "G",
          [],
          [probe, createRuleDefinition("external", text("b"))],
        ),
      );
      expect(early).toContain("[key: string]: unknown");
      expect(engine.inferExpressionType(expression).typeString).toBe(
        '{ x: "a" }',
      );
    },
  );

  it.each([false, true])(
    "enforces capture traversal depth and recovers with caching=%s",
    (enableCaching) => {
      const engine = new TypeInferenceEngine({
        enableCaching,
        maxRecursionDepth: 8,
      });
      const expression = parent(groups(createIdentifier("external"), 3));
      expect(engine.inferExpressionType(expression).typeString).toContain(
        "unknown",
      );
      expect(() => engine.inferExpressionType(groups(expression, 6))).toThrow(
        /Maximum recursion depth/,
      );
      expect(() =>
        engine.inferExpressionType(
          parent(groups(createIdentifier("external"), 2000)),
        ),
      ).toThrow(TypeInferenceError);
      expect(engine.inferExpressionType(expression).typeString).toContain(
        "unknown",
      );
    },
  );
});
