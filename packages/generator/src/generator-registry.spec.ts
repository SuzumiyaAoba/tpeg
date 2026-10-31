import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import { compileStart, grammarDefinition } from "@suzumiyaaoba/tpeg-parser";
import { expect, test } from "vite-plus/test";
import {
  CodeGeneratorRegistry,
  createGeneratorRegistry,
  generateParser,
} from "./generator-registry";

const grammar = core.parse(grammarDefinition)(
  'grammar G { start = digits:[0-9]+ { return (digits as string[]).join(""); } }',
);
if (!grammar.success) throw new Error(grammar.error.message);
const definition = grammar.val;

test("JavaScript generation removes types in semantic actions and executes the result", async () => {
  const generated = await generateParser(definition, {
    language: "javascript",
    includeImports: false,
  });
  const parser = compileStart(generated.code, core, combinator);
  expect(core.parse(parser)("123")).toMatchObject({
    success: true,
    val: "123",
    next: 3,
  });
  expect(generated.extension).toBe(".js");
  expect(generated.code).not.toContain("as string[]");
});

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
