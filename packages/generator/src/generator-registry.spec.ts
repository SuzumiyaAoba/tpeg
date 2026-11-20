import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import {
  compileStart,
  grammarDefinition,
  parseGrammarFile,
  toGrammarDefinition,
} from "@suzumiyaaoba/tpeg-parser";
import { expect, test } from "vite-plus/test";
import { generateEtaTypeScriptParser } from "./eta-generator";
import {
  CodeGeneratorRegistry,
  createGeneratorRegistry,
  generateParser,
} from "./generator-registry";

const grammar = core.parse(grammarDefinition)(
  'grammar G { start = digits:[0-9]+ { return (digits as string[]).join("") + suffix; } }',
);
if (!grammar.success) throw new Error(grammar.error.message);
const definition = grammar.val;

test("untyped Eta output executes typed actions through the direct generator API", async () => {
  const generated = await generateEtaTypeScriptParser(definition, {
    includeTypes: false,
    includeImports: false,
  });
  expect(generated.code).not.toContain("as string[]");
  expect(
    core.parse(
      compileStart(generated.code, { ...core, suffix: "" }, combinator),
    )("12"),
  ).toMatchObject({ success: true, val: "12", next: 2 });
});

test.each(["javascript", "typescript"])(
  "%s generation producing .js removes types in actions and headers",
  async (language) => {
    const generated = await generateParser(definition, {
      language,
      includeTypes: false,
      includeImports: false,
      header: 'const suffix: string = "!";',
    });
    const parser = compileStart(generated.code, core, combinator);
    expect(core.parse(parser)("123")).toMatchObject({
      success: true,
      val: "123!",
      next: 3,
    });
    expect(generated.extension).toBe(".js");
    expect(generated.code).not.toContain("as string[]");
    expect(generated.code).not.toContain("suffix: string");
  },
);

const generators = [
  { language: "javascript", optimize: false },
  { language: "javascript", optimize: true },
  { language: "typescript", optimize: false },
] as const;

test.each(generators)(
  "$language optimize=$optimize absorbs a cut in a one-branch choice",
  async (options) => {
    const a = core.createStringLiteral("a", '"');
    const inner = core.createChoice([
      core.createSequence([
        a,
        core.createCut(),
        core.createStringLiteral("b", '"'),
      ]),
    ]);
    const grammar = core.createGrammarDefinition(
      "G",
      [],
      [core.createRuleDefinition("start", core.createChoice([inner, a]))],
    );
    const generated = await generateParser(grammar, {
      ...options,
      includeTypes: false,
    });
    expect(generated.code).toMatch(/import\s*\{[^}]*\bchoice\b[^}]*\}\s*from/);
    const start = core.parse(compileStart(generated.code, core, combinator));
    expect(start("a")).toMatchObject({ success: true, val: "a", next: 1 });
    expect(start("ab")).toMatchObject({
      success: true,
      val: ["a", "b"],
      next: 2,
    });
  },
);

test.each(generators)(
  "$language optimize=$optimize backtracks after an external cut or a transform rejection",
  async (options) => {
    const external = core.commit(core.literal("z"));
    const bindings = { ...core, external, other: { word: external } };
    const sources = [
      'grammar G { start = (external / "x"?) / "fallback" }',
      'grammar G { start = (other.word / "x"?) / "fallback" }',
      'grammar G { start = alias / "fallback"\n alias = maybe\n maybe = "x"? }\ntransforms T@typescript { maybe(v: any) -> Result<any> { return { success: false, error: "absent" }; } }',
    ];
    for (const source of sources) {
      const parsed = parseGrammarFile("G.tpeg", source);
      if (!parsed.success) throw new Error(parsed.error.message);
      const generated = await generateParser(
        toGrammarDefinition(parsed.val.grammars[0]),
        { ...options, includeImports: false, includeTypes: false },
      );
      const start = core.parse(
        compileStart(generated.code, bindings, combinator),
      );
      expect(start("fallback"), source).toMatchObject({
        success: true,
        val: "fallback",
        next: 8,
      });
    }
  },
);

test("a custom language plugin generates output without modifying other registries", async () => {
  const registry = createGeneratorRegistry().register({
    language: "json",
    extension: ".json",
    generate(ast) {
      return {
        code: JSON.stringify(ast),
        language: "json",
        extension: ".json",
        exports: [],
        warnings: [],
      };
    },
  });
  expect(registry.languages().map((plugin) => plugin.language)).toEqual([
    "typescript",
    "javascript",
    "python",
    "go",
    "rust",
    "json",
  ]);
  expect(
    JSON.parse(
      (await registry.generate(definition, { language: "json" })).code,
    ),
  ).toEqual(definition);
  await expect(
    createGeneratorRegistry().generate(definition, { language: "json" }),
  ).rejects.toThrow("Unsupported target language");
  expect(() =>
    registry.register({
      language: "json",
      extension: ".json",
      generate() {
        throw new Error("unused");
      },
    }),
  ).toThrow("already registered");
  await expect(
    new CodeGeneratorRegistry().generate(definition),
  ).rejects.toThrow("Unsupported target language");
});
