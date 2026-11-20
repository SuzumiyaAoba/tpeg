import { describe, expect, it } from "vite-plus/test";
import { transformWithOxc } from "vite-plus";
import fc from "fast-check";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Expression,
  type Parser,
  capture,
  captureSequence,
  choice,
  literal,
  map,
  optional,
  untagCapture,
  zeroOrMore,
  createActionExpression,
  createChoice,
  createCut,
  createGrammarDefinition,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createOptional,
  createQualifiedIdentifier,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import { TypeInferenceEngine } from "./type-inference";
import { TypeIntegrationEngine } from "./type-integration";

const text = (value: string) => createStringLiteral(value, '"');
const label = (name: string, value: string) =>
  createLabeledExpression(name, text(value));
const action = createActionExpression(label("x", "b"), "return $$;");
const runtimeAction = map(capture("x", literal("b")), (value) => value);
const wildcard = "{ [key: string]: unknown; x: unknown }";
const fixtures: {
  name: string;
  pattern: Expression;
  runtime: Parser<unknown>;
  inputs: string[];
  expected: string;
}[] = [
  {
    name: "action overwrites an earlier capture",
    pattern: createSequence([label("x", "a"), action]),
    runtime: captureSequence(capture("x", literal("a")), runtimeAction),
    inputs: ["ab"],
    expected: wildcard,
  },
  {
    name: "later capture restores a precise field",
    pattern: createSequence([action, label("x", "a")]),
    runtime: captureSequence(runtimeAction, capture("x", literal("a"))),
    inputs: ["ba"],
    expected: '{ [key: string]: unknown; x: "a" }',
  },
  {
    name: "action can mutate and add tagged fields",
    pattern: createSequence([
      label("x", "a"),
      createActionExpression(
        label("x", "b"),
        'return Object.assign($$, { x: 42, y: "new" });',
      ),
    ]),
    runtime: captureSequence(
      capture("x", literal("a")),
      map(capture("x", literal("b")), (value) =>
        Object.assign(value, { x: 42, y: "new" }),
      ),
    ),
    inputs: ["ab"],
    expected: wildcard,
  },
  {
    name: "plain action objects do not merge",
    pattern: createSequence([
      label("x", "a"),
      createActionExpression(text("b"), 'return { x: "c" };'),
    ]),
    runtime: captureSequence(
      capture("x", literal("a")),
      map(literal("b"), () => ({ x: "c" })),
    ),
    inputs: ["ab"],
    expected: wildcard,
  },
  {
    name: "optional actions preserve the absent branch",
    pattern: createSequence([label("x", "a"), createOptional(action)]),
    runtime: captureSequence(
      capture("x", literal("a")),
      optional(runtimeAction),
    ),
    inputs: ["a", "ab"],
    expected: wildcard + ' | { x: "a" }',
  },
  {
    name: "choices preserve action effects",
    pattern: createSequence([
      label("x", "a"),
      createChoice([action, label("y", "c")]),
    ]),
    runtime: captureSequence(
      capture("x", literal("a")),
      choice(runtimeAction, capture("y", literal("c"))),
    ),
    inputs: ["ab", "ac"],
    expected: wildcard + ' | { x: "a", y: "c" }',
  },
  {
    name: "singleton groups and sequences forward effects",
    pattern: createSequence([
      label("x", "a"),
      createGroup(createSequence([createCut(), action])),
    ]),
    runtime: captureSequence(capture("x", literal("a")), runtimeAction),
    inputs: ["ab"],
    expected: wildcard,
  },
  {
    name: "arrays contain effects within their values",
    pattern: createSequence([label("x", "a"), createStar(action)]),
    runtime: captureSequence(
      capture("x", literal("a")),
      zeroOrMore(runtimeAction),
    ),
    inputs: ["a", "abb"],
    expected: '{ x: "a" }',
  },
  {
    name: "labels contain the whole action value",
    pattern: createSequence([
      label("x", "a"),
      createLabeledExpression("nested", action),
    ]),
    runtime: captureSequence(
      capture("x", literal("a")),
      capture("nested", runtimeAction),
    ),
    inputs: ["ab"],
    expected: '{ x: "a", nested: unknown }',
  },
  {
    name: "external identifiers may forward captures",
    pattern: createSequence([label("x", "a"), createIdentifier("external")]),
    runtime: captureSequence(capture("x", literal("a")), runtimeAction),
    inputs: ["ab"],
    expected: wildcard,
  },
  {
    name: "qualified identifiers may forward captures",
    pattern: createSequence([
      label("x", "a"),
      createQualifiedIdentifier("M", "external"),
    ]),
    runtime: captureSequence(capture("x", literal("a")), runtimeAction),
    inputs: ["ab"],
    expected: wildcard,
  },
];

function grammar(pattern: Expression) {
  return createGrammarDefinition(
    "G",
    [],
    [createRuleDefinition("start", pattern)],
  );
}
async function guardFor(
  pattern: Expression,
  engine = new TypeIntegrationEngine({
    generateTypeGuards: true,
    includeDocumentation: false,
  }),
) {
  const code = engine.createTypedGrammar(grammar(pattern)).typeDefinitions;
  const js = (await transformWithOxc(code, "action-captures.ts")).code;
  return (
    await import(
      `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
    )
  ).isStartResult as (value: unknown) => boolean;
}

describe("arbitrary same-level capture effects", () => {
  it.each(fixtures)("$name", async ({ pattern, runtime, inputs, expected }) => {
    for (const enableCaching of [false, true]) {
      const engine = new TypeInferenceEngine({ enableCaching });
      expect(
        engine.inferGrammarTypes(grammar(pattern)).ruleTypes.get("start")
          ?.typeString,
      ).toBe(expected);
      expect(
        engine.inferGrammarTypes(grammar(pattern)).ruleTypes.get("start")
          ?.typeString,
      ).toBe(expected);
    }
    const guard = await guardFor(pattern);
    for (const input of inputs) {
      const result = runtime(input, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.next).toBe(input.length);
        expect(guard(result.val)).toBe(true);
      }
    }
    expect(guard({})).toBe(false);
    expect(guard(null)).toBe(false);
  });

  it("keeps registered rule boundaries untagged", async () => {
    const pattern = createSequence([
      label("x", "a"),
      createIdentifier("inner"),
    ]);
    const ast = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition("start", pattern),
        createRuleDefinition("inner", action),
      ],
    );
    const integration = new TypeIntegrationEngine({
      generateTypeGuards: true,
      includeDocumentation: false,
    });
    const output = integration.createTypedGrammar(ast);
    expect(output.typeDefinitions).toContain('StartResult = { x: "a" }');
    const js = (await transformWithOxc(output.typeDefinitions, "boundary.ts"))
      .code;
    const guard = (
      await import(
        `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
      )
    ).isStartResult;
    const result = captureSequence(
      capture("x", literal("a")),
      untagCapture(runtimeAction),
    )("ab", 0);
    if (result.success) expect(guard(result.val)).toBe(true);
    else expect(result.success).toBe(true);
    expect(guard({ x: "b" })).toBe(false);
  });

  it("preserves action effects when ordinary choice unions are disabled", () => {
    const pattern = createSequence([
      label("x", "a"),
      createChoice([action, text("c")]),
    ]);
    expect(
      new TypeInferenceEngine({ inferUnionTypes: false }).inferExpressionType(
        pattern,
      ).typeString,
    ).toBe(wildcard + ' | { x: "a" }');
  });

  it("preserves effects through custom mappings of the whole action value", () => {
    const engine = new TypeInferenceEngine({
      customTypeMappings: new Map([["unknown", "string"]]),
    });
    expect(
      engine.inferExpressionType(createSequence([label("x", "a"), action]))
        .typeString,
    ).toBe(wildcard);
  });

  it("does not read arbitrary action source or its wrapped expression", () => {
    let reads = 0;
    const opaque = Object.create(null) as Expression;
    Object.defineProperty(opaque, "type", { value: "ActionExpression" });
    for (const key of ["code", "expression"])
      Object.defineProperty(opaque, key, {
        get() {
          reads++;
          throw new Error("ignored action getter");
        },
      });
    expect(
      new TypeInferenceEngine().inferExpressionType(
        createSequence([label("x", "a"), opaque]),
      ).typeString,
    ).toBe(wildcard);
    expect(reads).toBe(0);
  });

  it("only checks existence of bare local rules when merging fields", () => {
    const inner = createRuleDefinition("inner", text("b"));
    const engine = new TypeInferenceEngine();
    engine.inferGrammarTypes(createGrammarDefinition("G", [], [inner]));
    let reads = 0;
    Object.defineProperty(inner, "pattern", {
      get() {
        reads++;
        throw new Error("irrelevant pattern getter");
      },
    });
    const pattern = createSequence([
      label("x", "a"),
      createIdentifier("inner"),
      createIdentifier("inner"),
    ]);
    const result = engine.inferExpressionType(pattern);
    expect(result.typeString).toBe('{ x: "a" }');
    expect(engine.inferExpressionType(pattern)).toBe(result);
    expect(reads).toBe(0);
  });

  it("invalidates external effects when registration later supplies a rule", () => {
    const pattern = createSequence([
      label("x", "a"),
      createIdentifier("external"),
      createIdentifier("known"),
    ]);
    const engine = new TypeInferenceEngine();
    let early: string | undefined;
    const probe = createRuleDefinition("probe", action);
    Object.defineProperty(probe, "name", {
      get() {
        early ??= engine.inferExpressionType(pattern).typeString;
        return "probe";
      },
    });
    engine.inferGrammarTypes(
      createGrammarDefinition(
        "G",
        [],
        [
          createRuleDefinition("known", text("b")),
          probe,
          createRuleDefinition("external", action),
        ],
      ),
    );
    expect(early).toBe(wildcard);
    expect(engine.inferExpressionType(pattern).typeString).toBe('{ x: "a" }');
  });

  it.each(["before", "after"])(
    "keeps widened optional fields sound when an action appears %s them",
    async (position) => {
      const options: Expression[] = [],
        parsers: Parser<unknown>[] = [];
      for (let i = 0; i < 12; i++) {
        options.push(createOptional(label(`v${i}`, "a")));
        parsers.push(optional(capture(`v${i}`, literal("a"))));
      }
      const effect = createActionExpression(
        label("x", "b"),
        "return Object.assign($$, { v0: 123 });",
      );
      const effectParser = map(capture("x", literal("b")), (value) =>
        Object.assign(value, { v0: 123 }),
      );
      const pattern = createSequence([
        label("anchor", "!"),
        ...(position === "before"
          ? [effect, ...options]
          : [...options, effect]),
        label("anchor", "end"),
      ]);
      const runtime = captureSequence(
        capture("anchor", literal("!")),
        ...(position === "before"
          ? [effectParser, ...parsers]
          : [...parsers, effectParser]),
        capture("anchor", literal("end")),
      );
      const type = new TypeInferenceEngine().inferExpressionType(pattern);
      expect(type.typeString).toContain("[key: string]: unknown");
      expect(type.objectProperties?.get("v0")?.typeString).toContain("unknown");
      expect(type.objectProperties?.get("anchor")?.typeString).toBe('"end"');
      expect(type.optionalObjectProperties?.has("v0")).toBe(true);
      const guard = await guardFor(pattern);
      const result = runtime("!bend", 0);
      expect(result.success).toBe(true);
      if (result.success) expect(guard(result.val)).toBe(true);
      expect(guard({ anchor: "wrong" })).toBe(false);
    },
  );

  it("compiles exact fields alongside unknown string keys strictly", () => {
    const dir = mkdtempSync(join(tmpdir(), "tpeg-action-capture-types-"));
    try {
      const files: string[] = [];
      for (const [i, fixture] of fixtures.entries())
        for (const namespace of ["", "Object.Array"]) {
          const definitions = new TypeIntegrationEngine({
            generateTypeGuards: true,
            includeDocumentation: false,
            typeNamespace: namespace,
          }).createTypedGrammar(grammar(fixture.pattern)).typeDefinitions;
          const actual = namespace ? `${namespace}.StartResult` : "StartResult";
          const file = join(dir, `case-${i}-${namespace.length}.ts`);
          const read =
            fixture.expected.includes("[key:") &&
            !fixture.expected.includes(" | ")
              ? `export function read(value: ${actual}): unknown { return value["arbitrary"]; }`
              : "";
          writeFileSync(
            file,
            `${definitions}\ntype Expected = ${fixture.expected};\ntype Assert<T extends true> = T;\nexport type Check = Assert<[${actual}] extends [Expected] ? [Expected] extends [${actual}] ? true : false : false>;\n${read}\n`,
          );
          files.push(file);
        }
      const compiler = fileURLToPath(
        new URL("../../../node_modules/typescript/bin/tsc", import.meta.url),
      );
      const result = spawnSync(
        process.execPath,
        [
          compiler,
          "--noEmit",
          "--strict",
          "--noUnusedLocals",
          "--noUnusedParameters",
          "--exactOptionalPropertyTypes",
          "--noUncheckedIndexedAccess",
          "--skipLibCheck",
          "--target",
          "ES2022",
          "--module",
          "ESNext",
          ...files,
        ],
        { cwd: dir, encoding: "utf8", timeout: 15000 },
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts generated capture overwrite histories with opaque actions", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.constantFrom("x", "y", "__proto__"),
            action: fc.boolean(),
            tagged: fc.boolean(),
            optional: fc.boolean(),
            present: fc.boolean(),
          }),
          { minLength: 1, maxLength: 7 },
        ),
        async (steps) => {
          const elements: Expression[] = [label("anchor", "!")];
          const parsers: Parser<unknown>[] = [capture("anchor", literal("!"))];
          let input = "!";
          for (const [i, step] of steps.entries()) {
            const value = `<${i}>`;
            let expression: Expression = label(step.name, value);
            let runtime: Parser<unknown> = capture(step.name, literal(value));
            if (step.action) {
              expression = createActionExpression(expression, "return $$;");
              runtime = step.tagged
                ? map(runtime, (item) =>
                    Object.assign(item as object, { [step.name]: i }),
                  )
                : map(runtime, () => ({ [step.name]: i }));
            }
            if (step.optional) {
              expression = createOptional(expression);
              runtime = optional(runtime);
            }
            elements.push(expression);
            parsers.push(runtime);
            if (!step.optional || step.present) input += value;
          }
          elements.push(label("anchor", "end"));
          parsers.push(capture("anchor", literal("end")));
          input += "end";
          const pattern = createSequence(elements);
          const cached = new TypeInferenceEngine().inferExpressionType(pattern);
          expect(cached).toEqual(
            new TypeInferenceEngine({
              enableCaching: false,
            }).inferExpressionType(pattern),
          );
          const guard = await guardFor(pattern);
          const result = captureSequence(...parsers)(input, 0);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.next).toBe(input.length);
            expect(guard(result.val)).toBe(true);
            expect(
              guard({
                ...(result.val as Record<string, unknown>),
                anchor: "wrong",
              }),
            ).toBe(false);
          }
        },
      ),
      {
        seed: 20261012,
        numRuns: 100 * Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1),
      },
    );
  });
});
