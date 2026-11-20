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
  optional,
  sequence,
  untagCapture,
  zeroOrMore,
  createChoice,
  createCut,
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
import { TypeIntegrationEngine } from "./type-integration";

const text = (value: string) => createStringLiteral(value, '"');
const label = (name: string, value: string) =>
  createLabeledExpression(name, text(value));
const alternative = createChoice([label("x", "b"), text("c")]);
const runtimeAlternative = choice(capture("x", literal("b")), literal("c"));
const fixtures: {
  name: string;
  pattern: Expression;
  parser: Parser<unknown>;
  inputs: string[];
  type: string;
  rejected: unknown[];
}[] = [
  {
    name: "later choice overwrites a label",
    pattern: createSequence([label("x", "a"), alternative]),
    parser: captureSequence(capture("x", literal("a")), runtimeAlternative),
    inputs: ["ab", "ac"],
    type: '{ x: "b" } | { x: "a" }',
    rejected: [{ x: "c" }, {}],
  },
  {
    name: "later direct capture overwrites every choice",
    pattern: createSequence([alternative, label("x", "a")]),
    parser: captureSequence(runtimeAlternative, capture("x", literal("a"))),
    inputs: ["ba", "ca"],
    type: '{ x: "a" }',
    rejected: [{ x: "b" }, {}],
  },
  {
    name: "optional capture can overwrite a label",
    pattern: createSequence([label("x", "a"), createOptional(label("x", "b"))]),
    parser: captureSequence(
      capture("x", literal("a")),
      optional(capture("x", literal("b"))),
    ),
    inputs: ["a", "ab"],
    type: '{ x: "b" } | { x: "a" }',
    rejected: [{ x: null }, { x: "c" }],
  },
  {
    name: "choice preserves correlated field sets",
    pattern: createSequence([
      label("x", "a"),
      createChoice([label("y", "b"), label("z", "c")]),
    ]),
    parser: captureSequence(
      capture("x", literal("a")),
      choice(capture("y", literal("b")), capture("z", literal("c"))),
    ),
    inputs: ["ab", "ac"],
    type: '{ x: "a", y: "b" } | { x: "a", z: "c" }',
    rejected: [{ x: "a" }, { x: "a", y: "c", z: "b" }],
  },
  {
    name: "group forwards raw captures",
    pattern: createSequence([
      createGroup(label("x", "a")),
      createGroup(alternative),
    ]),
    parser: captureSequence(capture("x", literal("a")), runtimeAlternative),
    inputs: ["ab", "ac"],
    type: '{ x: "b" } | { x: "a" }',
    rejected: [{ x: "c" }],
  },
  {
    name: "singleton unlabeled sequence forwards raw choice",
    pattern: createSequence([
      label("x", "a"),
      createSequence([createCut(), alternative]),
    ]),
    parser: captureSequence(capture("x", literal("a")), runtimeAlternative),
    inputs: ["ab", "ac"],
    type: '{ x: "b" } | { x: "a" }',
    rejected: [{ x: "c" }],
  },
  {
    name: "nested merged sequence is untagged",
    pattern: createSequence([
      label("x", "a"),
      createSequence([label("x", "b")]),
    ]),
    parser: captureSequence(
      capture("x", literal("a")),
      captureSequence(capture("x", literal("b"))),
    ),
    inputs: ["ab"],
    type: '{ x: "a" }',
    rejected: [{ x: "b" }],
  },
  {
    name: "arrays of captures are untagged",
    pattern: createSequence([label("x", "a"), createStar(label("x", "b"))]),
    parser: captureSequence(
      capture("x", literal("a")),
      zeroOrMore(capture("x", literal("b"))),
    ),
    inputs: ["a", "abb"],
    type: '{ x: "a" }',
    rejected: [{ x: "b" }],
  },
  {
    name: "ordinary tuple alternative is untagged",
    pattern: createSequence([
      label("x", "a"),
      createChoice([label("x", "b"), createSequence([text("c"), text("d")])]),
    ]),
    parser: captureSequence(
      capture("x", literal("a")),
      choice(capture("x", literal("b")), sequence(literal("c"), literal("d"))),
    ),
    inputs: ["ab", "acd"],
    type: '{ x: "b" } | { x: "a" }',
    rejected: [{ x: "d" }],
  },
  {
    name: "nested labels remain nested values",
    pattern: createSequence([
      createLabeledExpression("nested", label("x", "a")),
      alternative,
    ]),
    parser: captureSequence(
      capture("nested", capture("x", literal("a"))),
      runtimeAlternative,
    ),
    inputs: ["ab", "ac"],
    type: '{ nested: { x: "a" }, x: "b" } | { nested: { x: "a" } }',
    rejected: [{ nested: { x: "b" } }, { nested: null }],
  },
];

async function guardFor(pattern: Expression) {
  const definitions = new TypeIntegrationEngine({
    generateTypeGuards: true,
    includeDocumentation: false,
  }).createTypedGrammar(
    createGrammarDefinition("G", [], [createRuleDefinition("start", pattern)]),
  ).typeDefinitions;
  const { code } = await transformWithOxc(definitions, "conditional-guards.ts");
  const module = await import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
  return module.isStartResult as (value: unknown) => boolean;
}

describe("conditional capture merging", () => {
  it.each(fixtures)(
    "$name agrees with runtime values and guards",
    async ({ pattern, parser, inputs, type, rejected }) => {
      for (const enableCaching of [false, true]) {
        const engine = new TypeInferenceEngine({ enableCaching });
        const inferred = engine.inferExpressionType(pattern);
        expect(inferred.typeString).toBe(type);
        expect(engine.inferExpressionType(pattern)).toEqual(inferred);
      }
      const guard = await guardFor(pattern);
      for (const input of inputs) {
        const result = parser(input, 0);
        expect(result.success).toBe(true);
        if (result.success)
          expect(guard(result.val), JSON.stringify(result.val)).toBe(true);
      }
      for (const value of rejected)
        expect(guard(value), JSON.stringify(value)).toBe(false);
    },
  );

  it("does not merge captures through rule boundaries", () => {
    const inner = createRuleDefinition("inner", alternative);
    const pattern = createSequence([
      label("x", "a"),
      createIdentifier("inner"),
    ]);
    const engine = new TypeInferenceEngine();
    const result = engine.inferGrammarTypes(
      createGrammarDefinition(
        "G",
        [],
        [createRuleDefinition("start", pattern), inner],
      ),
    );
    expect(result.ruleTypes.get("start")?.typeString).toBe('{ x: "a" }');
    expect(
      captureSequence(
        capture("x", literal("a")),
        untagCapture(runtimeAlternative),
      )("ab", 0),
    ).toMatchObject({ success: true, val: { x: "a" } });
  });

  it("keeps the original captured fields when a whole capture is mapped", () => {
    const pattern = createSequence([label("x", "a"), alternative]);
    const engine = new TypeInferenceEngine({
      customTypeMappings: new Map([['{ x: "b" }', "unknown"]]),
    });
    expect(engine.inferExpressionType(pattern).typeString).toBe(
      '{ x: "b" } | { x: "a" }',
    );
  });

  it("revalidates mappings used by a conditional captured value", () => {
    const mappings = new Map<string, string>();
    const pattern = createSequence([label("x", "a"), alternative]);
    const cached = new TypeInferenceEngine({ customTypeMappings: mappings });
    const uncached = new TypeInferenceEngine({
      enableCaching: false,
      customTypeMappings: mappings,
    });
    for (const value of [undefined, "string", "unknown", undefined]) {
      if (value === undefined) mappings.delete('"b"');
      else mappings.set('"b"', value);
      expect(cached.inferExpressionType(pattern)).toEqual(
        uncached.inferExpressionType(pattern),
      );
    }
    expect(cached.inferExpressionType(pattern).typeString).toBe(
      '{ x: "b" } | { x: "a" }',
    );
  });

  it("bounds independent combinations while keeping required and optional fields", async () => {
    const elements: Expression[] = [label("anchor", "!")];
    for (let index = 0; index < 12; index++)
      elements.push(
        createOptional(label(`v${index}`, String.fromCharCode(97 + index))),
      );
    const pattern = createSequence(elements);
    const inferred = new TypeInferenceEngine().inferExpressionType(pattern);
    expect(inferred.baseType).toBe("object");
    expect(inferred.objectProperties?.size).toBe(13);
    expect(inferred.optionalObjectProperties?.size).toBe(12);
    expect(inferred.typeString.length).toBeLessThan(600);
    const guard = await guardFor(pattern);
    expect(guard({ anchor: "!" })).toBe(true);
    expect(guard({ anchor: "!", v0: "a", v11: "l" })).toBe(true);
    expect(guard({ anchor: "!", v0: undefined })).toBe(false);
    expect(guard({ anchor: "!", v0: "b" })).toBe(false);
    expect(guard({ v0: "a" })).toBe(false);
    let reads = 0;
    expect(
      guard(
        Object.create({
          anchor: "!",
          get v0() {
            reads++;
            return "a";
          },
        }),
      ),
    ).toBe(true);
    expect(reads).toBe(1);
  });

  it("keeps captured choice fields when ordinary union inference is disabled", () => {
    const captured = label("x", "b");
    const alternatives = createChoice([captured, text("c")]);
    const pattern = createSequence([label("x", "a"), alternatives]);
    const cached = new TypeInferenceEngine({ inferUnionTypes: false });
    const uncached = new TypeInferenceEngine({
      inferUnionTypes: false,
      enableCaching: false,
    });
    expect(cached.inferExpressionType(alternatives).typeString).toBe("string");
    expect(cached.inferExpressionType(pattern).typeString).toBe(
      '{ x: "b" } | { x: "a" }',
    );
    captured.expression = text("d");
    expect(cached.inferExpressionType(pattern)).toEqual(
      uncached.inferExpressionType(pattern),
    );
    expect(cached.inferExpressionType(pattern).typeString).toBe(
      '{ x: "d" } | { x: "a" }',
    );
  });

  it("does not read ordinary choice values when union inference is disabled", () => {
    const ordinary = text("unused");
    let reads = 0;
    Object.defineProperty(ordinary, "value", {
      get() {
        reads++;
        throw new Error("unused value");
      },
    });
    const alternatives = createChoice([ordinary, label("x", "b")]);
    for (const enableCaching of [false, true]) {
      const engine = new TypeInferenceEngine({
        inferUnionTypes: false,
        enableCaching,
      });
      expect(engine.inferExpressionType(alternatives).typeString).toBe(
        "string",
      );
      const pattern = createSequence([label("x", "a"), alternatives]);
      expect(engine.inferExpressionType(pattern).typeString).toBe(
        '{ x: "a" } | { x: "b" }',
      );
    }
    expect(reads).toBe(0);
  });

  it("applies later overwrites after widening a large combination", () => {
    const elements: Expression[] = [label("anchor", "!")];
    for (let i = 0; i < 12; i++)
      elements.push(createOptional(label(`v${i}`, "a")));
    for (let i = 0; i < 12; i++) elements.push(label(`v${i}`, "b"));
    const result = new TypeInferenceEngine().inferExpressionType(
      createSequence(elements),
    );
    expect(result.optionalObjectProperties).toBeUndefined();
    for (let i = 0; i < 12; i++)
      expect(result.objectProperties?.get(`v${i}`)?.typeString).toBe('"b"');
  });

  it("allows absent optional never properties in a widened guard", async () => {
    const elements: Expression[] = [label("anchor", "!")];
    for (let i = 0; i < 12; i++)
      elements.push(
        createOptional(
          i === 0
            ? createLabeledExpression("dead", createChoice([]))
            : label(`v${i}`, "a"),
        ),
      );
    const guard = await guardFor(createSequence(elements));
    expect(guard({ anchor: "!" })).toBe(true);
    expect(guard({ anchor: "!", dead: undefined })).toBe(false);
  });

  it.each(["__proto__", "constructor", "toString"])(
    "keeps valid objects when widened optional %s is inherited",
    async (name) => {
      const elements: Expression[] = [label("anchor", "!")];
      const parsers: Parser<unknown>[] = [capture("anchor", literal("!"))];
      for (let i = 0; i < 12; i++) {
        const key = i === 0 ? name : `v${i}`;
        elements.push(createOptional(label(key, "a")));
        parsers.push(optional(capture(key, literal("a"))));
      }
      const pattern = createSequence(elements);
      const guard = await guardFor(pattern);
      const result = captureSequence(...parsers)("!", 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(Object.hasOwn(result.val as object, name)).toBe(false);
        expect(guard(result.val)).toBe(true);
      }
      const inferred = new TypeInferenceEngine().inferExpressionType(pattern);
      expect(inferred.optionalObjectProperties?.has(name)).toBe(true);
      expect(inferred.objectProperties?.get(name)?.typeString).toContain(
        "unknown",
      );

      // A later guaranteed capture shadows the inherited value and restores
      // its precise type, even after the other fields have been widened.
      const overwritten = createSequence([...elements, label(name, "b")]);
      const overwrittenType = new TypeInferenceEngine().inferExpressionType(
        overwritten,
      );
      expect(overwrittenType.optionalObjectProperties?.has(name)).toBe(false);
      expect(overwrittenType.objectProperties?.get(name)?.typeString).toBe(
        '"b"',
      );
      const overwrittenGuard = await guardFor(overwritten);
      const overwrittenResult = captureSequence(
        ...parsers,
        capture(name, literal("b")),
      )("!b", 0);
      if (overwrittenResult.success)
        expect(overwrittenGuard(overwrittenResult.val)).toBe(true);
      else expect(overwrittenResult.success).toBe(true);
      expect(overwrittenGuard({ anchor: "!", [name]: "wrong" })).toBe(false);
    },
  );

  it("compiles exact capture unions and widened optional fields strictly", () => {
    const elements: Expression[] = [label("anchor", "!")];
    for (let i = 0; i < 12; i++)
      elements.push(createOptional(label(`v${i}`, "a")));
    const patterns = [
      ...fixtures.map(({ pattern, type }) => ({ pattern, type })),
      {
        pattern: createSequence(elements),
        type: `{ anchor: "!", ${Array.from({ length: 12 }, (_, i) => `v${i}?: "a"`).join(", ")} }`,
      },
    ];
    for (const name of ["__proto__", "constructor", "toString"]) {
      const prototypeElements: Expression[] = [label("anchor", "!")];
      for (let i = 0; i < 12; i++)
        prototypeElements.push(
          createOptional(label(i === 0 ? name : `v${i}`, "a")),
        );
      patterns.push({
        pattern: createSequence(prototypeElements),
        type: `{ anchor: "!", ${name}?: unknown, ${Array.from({ length: 11 }, (_, i) => `v${i + 1}?: "a"`).join(", ")} }`,
      });
    }
    const dir = mkdtempSync(join(tmpdir(), "tpeg-conditional-types-"));
    try {
      const files: string[] = [];
      for (const [index, { pattern, type }] of patterns.entries())
        for (const namespace of ["", "Object.Array"]) {
          const definitions = new TypeIntegrationEngine({
            generateTypeGuards: true,
            includeDocumentation: false,
            typeNamespace: namespace,
          }).createTypedGrammar(
            createGrammarDefinition(
              "G",
              [],
              [createRuleDefinition("start", pattern)],
            ),
          ).typeDefinitions;
          const actual = namespace ? `${namespace}.StartResult` : "StartResult";
          const file = join(dir, `result-${index}-${namespace.length}.ts`);
          writeFileSync(
            file,
            `${definitions}\ntype Expected = ${type};\ntype Assert<T extends true> = T;\nexport type Check = Assert<[${actual}] extends [Expected] ? [Expected] extends [${actual}] ? true : false : false>;\n`,
          );
          files.push(file);
        }
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              "../../../node_modules/typescript/bin/tsc",
              import.meta.url,
            ),
          ),
          "--strict",
          "--noEmit",
          "--skipLibCheck",
          "--target",
          "ES2022",
          "--module",
          "ESNext",
          "--noUnusedLocals",
          "--noUnusedParameters",
          "--exactOptionalPropertyTypes",
          "--noUncheckedIndexedAccess",
          ...files,
        ],
        { cwd: dir, encoding: "utf8", timeout: 15000 },
      );
      expect(
        result.status,
        result.stdout || result.stderr || result.error?.message,
      ).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches generated overwrite histories against core parsing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.constantFrom("anchor", "x", "y", "__proto__"),
            value: fc.constantFrom("a", "b", "c"),
            optional: fc.boolean(),
            present: fc.boolean(),
          }),
          { minLength: 1, maxLength: 7 },
        ),
        async (entries) => {
          const ast: Expression[] = [label("anchor", "!")];
          const parsers: Parser<unknown>[] = [capture("anchor", literal("!"))];
          let input = "!";
          for (const [index, entry] of entries.entries()) {
            // Distinct prefixes keep an absent optional from consuming a
            // later element's witness, even when values happen to be equal.
            const value = `${index}:${entry.value}`;
            ast.push(
              entry.optional
                ? createOptional(label(entry.name, value))
                : createChoice([label(entry.name, value), text("-")]),
            );
            const captured = capture(entry.name, literal(value));
            parsers.push(
              entry.optional
                ? optional(captured)
                : choice(captured, literal("-")),
            );
            if (entry.present) input += value;
            else if (!entry.optional) input += "-";
          }
          const pattern = createSequence(ast);
          expect(
            new TypeInferenceEngine().inferExpressionType(pattern),
          ).toEqual(
            new TypeInferenceEngine({
              enableCaching: false,
            }).inferExpressionType(pattern),
          );
          const result = captureSequence(...parsers)(input, 0);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.next).toBe(input.length);
            const guard = await guardFor(pattern);
            expect(guard(result.val)).toBe(true);
            expect(guard(Object.assign({}, result.val, { anchor: null }))).toBe(
              false,
            );
          }
        },
      ),
      {
        seed: 20261011,
        numRuns: 100 * Number(process.env.TPEG_FUZZ_SCALE ?? 1),
      },
    );
  });
});
