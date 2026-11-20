import { describe, expect, it } from "vite-plus/test";
import { transformWithOxc } from "vite-plus";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { type InferredType, TypeInferenceEngine } from "./type-inference";
import { TypeIntegrationEngine } from "./type-integration";

const literal = (value: string) => createStringLiteral(value, '"');

function expectNoDocumentation(type: InferredType): void {
  expect(type.documentation).toBeUndefined();
  for (const child of [
    ...(type.arrayElement ? [type.arrayElement] : []),
    ...(type.mappedFrom ? [type.mappedFrom] : []),
    ...(type.unionMembers ?? []),
    ...(type.tupleMembers ?? []),
    ...(type.tupleVariants?.flat() ?? []),
    ...(type.objectProperties?.values() ?? []),
  ])
    expectNoDocumentation(child);
}

const failures: [string, () => Expression, number, boolean][] = [
  ["cycle", () => createIdentifier("start"), 10, true],
  ["depth", () => createGroup(literal("a")), 0, true],
  ["cycle detection disabled", () => createIdentifier("start"), 2, false],
  [
    "plain circular error",
    () =>
      Object.defineProperty(literal("a"), "value", {
        get() {
          throw new Error("Circular dependency from an AST getter");
        },
      }),
    10,
    true,
  ],
];

describe("documentation options", () => {
  it.each(failures)(
    "omits %s fallback documentation while retaining diagnostics",
    (_name, pattern, maxRecursionDepth, detectCircularDependencies) => {
      const run = (generateDocumentation: boolean) =>
        new TypeInferenceEngine({
          generateDocumentation,
          maxRecursionDepth,
          detectCircularDependencies,
        }).inferGrammarTypes(
          createGrammarDefinition(
            "G",
            [],
            [createRuleDefinition("start", pattern())],
          ),
        );
      const enabled = run(true);
      const disabled = run(false);
      expect(enabled.ruleTypes.get("start")?.documentation).toBeTruthy();
      expectNoDocumentation(disabled.ruleTypes.get("start")!);
      expect(disabled.warnings.length).toBeGreaterThan(0);
      expect(disabled.warnings).toEqual(enabled.warnings);
      expect(disabled.circularDependencies).toEqual(
        enabled.circularDependencies,
      );
      expect(disabled.ruleTypes.get("start")?.typeString).toBe("unknown");
    },
  );

  it.each(["FutureNode", undefined])(
    "omits documentation for unsupported expression kind %s",
    (kind) => {
      const expression = (
        kind === undefined ? {} : { type: kind }
      ) as Expression;
      const enabled = new TypeInferenceEngine().inferExpressionType(expression);
      const disabled = new TypeInferenceEngine({
        generateDocumentation: false,
      }).inferExpressionType(expression);
      expect(enabled.documentation).toContain("Unknown expression type:");
      expectNoDocumentation(disabled);
      expect(disabled.typeString).toBe(enabled.typeString);
    },
  );

  it("omits documentation from nested type information and mapping origins", () => {
    const pattern = createChoice([
      createSequence([
        createLabeledExpression("value", createOptional(literal("a"))),
        literal("ignored"),
      ]),
      createStar(literal("b")),
    ]);
    const type = new TypeInferenceEngine({
      generateDocumentation: false,
      customTypeMappings: new Map([['"b"[]', "unknown"]]),
    }).inferExpressionType(pattern);
    expectNoDocumentation(type);
    expect(type.unionMembers?.[1]?.mappedFrom).toBeDefined();
  });

  for (const typeNamespace of ["", "Array", "globalThis.Array"]) {
    for (const generateTypeGuards of [false, true]) {
      it(`omits every generated JSDoc block with namespace '${typeNamespace}' and guards ${generateTypeGuards}`, async () => {
        const engine = new TypeIntegrationEngine({
          includeDocumentation: false,
          typeNamespace,
          generateTypeGuards,
        });
        const typed = engine.createTypedGrammar(
          createGrammarDefinition(
            "G",
            [],
            [
              createRuleDefinition("start", literal("a")),
              createRuleDefinition(
                "items",
                createStar(createIdentifier("start")),
              ),
              createRuleDefinition("loop", createIdentifier("loop")),
            ],
          ),
        );
        expect(typed.typeInference.circularDependencies).toEqual([["loop"]]);
        const source = `${typed.typeDefinitions}\n${engine.generateParserInterface(typed)}`;
        expect(source).not.toMatch(/^\s*\/\*\*/m);
        for (const rule of typed.rules)
          expectNoDocumentation(rule.inferredType);
        expect(source).toContain("export type ParserResult =");
        expect(source).toContain("export interface GParser");
        const result = await transformWithOxc(
          source,
          "documentation-disabled.ts",
        );
        expect(result.code.includes("isStartResult")).toBe(generateTypeGuards);
      });
    }
  }

  it.each([false, true])(
    "respects includeDocumentation when a changed rule has no inferred type: %s",
    (includeDocumentation) => {
      const rule = createRuleDefinition("start", literal("a"));
      const grammar = createGrammarDefinition("G", [], [rule]);
      let reads = 0;
      Object.defineProperty(grammar, "rules", {
        get() {
          // The rule changes after inference and before typed-rule creation.
          if (++reads === 3) rule.name = "renamed";
          return [rule];
        },
      });
      const typed = new TypeIntegrationEngine({
        includeDocumentation,
      }).createTypedGrammar(grammar);
      expect(typed.typeInference.ruleTypes.has("start")).toBe(true);
      expect(typed.rules[0]?.name).toBe("renamed");
      expect(typed.rules[0]?.inferredType.typeString).toBe("unknown");
      if (includeDocumentation) {
        expect(typed.rules[0]?.inferredType.documentation).toBe(
          "No type information available for rule renamed",
        );
      } else {
        expectNoDocumentation(typed.rules[0]!.inferredType);
      }
    },
  );

  it.each([false, true])(
    "respects includeDocumentation for empty grammar output: %s",
    async (includeDocumentation) => {
      const engine = new TypeIntegrationEngine({ includeDocumentation });
      const typed = engine.createTypedGrammar(
        createGrammarDefinition("Empty", [], []),
      );
      const source = `${typed.typeDefinitions}\n${engine.generateParserInterface(typed)}`;
      expect(/^\s*\/\*\*/m.test(source)).toBe(includeDocumentation);
      expect(source).toContain("ParserResult = never;");
      await transformWithOxc(source, "empty-documentation.ts");
      const dir = mkdtempSync(join(tmpdir(), "tpeg-empty-documentation-"));
      try {
        writeFileSync(join(dir, "empty.ts"), source);
        writeFileSync(
          join(dir, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              strict: true,
              noUnusedLocals: true,
              noEmit: true,
              skipLibCheck: true,
              module: "ESNext",
              moduleResolution: "Bundler",
              types: [],
              paths: {
                "@suzumiyaaoba/tpeg-core": [
                  fileURLToPath(
                    new URL("../../core/dist/index.d.ts", import.meta.url),
                  ),
                ],
              },
            },
            files: ["empty.ts"],
          }),
        );
        const result = spawnSync(
          process.execPath,
          [
            fileURLToPath(
              new URL(
                "../../../node_modules/typescript/bin/tsc",
                import.meta.url,
              ),
            ),
            "-p",
            join(dir, "tsconfig.json"),
          ],
          { encoding: "utf8", timeout: 15_000 },
        );
        expect(
          result.status,
          result.stdout || result.stderr || result.error?.message,
        ).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.each([false, true])(
    "preserves literal comment delimiters with includeDocumentation %s",
    async (includeDocumentation) => {
      const value = "/**\n*/ and */\r\nnext";
      const engine = new TypeIntegrationEngine({
        includeDocumentation,
        generateTypeGuards: true,
      });
      const typed = engine.createTypedGrammar(
        createGrammarDefinition(
          "G",
          [],
          [createRuleDefinition("start", literal(value))],
        ),
      );
      const source = `${typed.typeDefinitions}\n${engine.generateParserInterface(typed)}`;
      const { code } = await transformWithOxc(
        source,
        "literal-documentation.ts",
      );
      const exported = await import(
        /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
      );
      expect(exported["isStartResult"](value)).toBe(true);
      expect(exported["isStartResult"]("different")).toBe(false);
      expect(/^\s*\/\*\*/m.test(source)).toBe(includeDocumentation);
    },
  );
});
