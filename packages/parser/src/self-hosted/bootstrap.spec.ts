import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as core from "@suzumiyaaoba/tpeg-core";
import { describe, expect, test } from "vite-plus/test";
import { generateTypeScriptParser } from "../codegen";
import { generateOptimizedTypeScriptParser } from "../codegen-optimized";
import { skipTrailingWhitespaceAndComments, tpegModuleFile } from "../grammar";

type ModuleFile = Extract<
  ReturnType<typeof tpegModuleFile>,
  { success: true }
>["val"];
type ReadModule = (source: string) => core.ParseResult<ModuleFile>;

const sources = [
  "01-leaf.tpeg",
  "02-action.tpeg",
  "03-composition.tpeg",
  "04-grammar.tpeg",
  "05-full.tpeg",
].map((name) => ({
  name,
  source: readFileSync(
    new URL(`grammar-source/${name}`, import.meta.url),
    "utf8",
  ),
}));
const metaSource = sources.at(-1)!.source;
const runtimeImports = readFileSync(
  new URL("runtime-imports.txt", import.meta.url),
  "utf8",
);

function readModule(parser: ReadModule, source: string): ModuleFile {
  const result = parser(source);
  if (!result.success) {
    throw new Error(
      `Self-hosted parsing failed: ${JSON.stringify(result.error)}`,
    );
  }
  expect(skipTrailingWhitespaceAndComments(source, result.next)).toBe(
    source.length,
  );
  return result.val;
}

function plainGrammar(module: ModuleFile): core.GrammarDefinition {
  return {
    ...module.grammar,
    type: "GrammarDefinition",
    // Parsing a large meta-grammar revisits the same lexical constructs
    // through many alternatives. Packrat memoization avoids exponential
    // work; the meta-grammar's actions are deterministic and input-only.
    rules: module.grammar.rules.map((rule) => ({
      ...rule,
      annotations: [
        ...(rule.annotations ?? []).filter((a) => a.key !== "memoize"),
        { type: "GrammarAnnotation", key: "memoize", value: "" },
      ],
    })),
  };
}

describe("self-compilation reaches a fixed point", () => {
  for (const [name, generate] of [
    ["base", generateTypeScriptParser],
    ["optimized", generateOptimizedTypeScriptParser],
  ] as const) {
    test(`${name}: generated parsers compile themselves and preserve every grammar layer`, async () => {
      const handwritten = core.parse(tpegModuleFile);
      const oracle = readModule(handwritten, metaSource);
      let grammar = plainGrammar(oracle);
      let previousCode: string | undefined;

      // Stage 0 uses the handwritten parser. Stages 1 and 2 use only the
      // parser compiled in the preceding stage to read the meta-grammar.
      const directory = mkdtempSync(
        join(dirname(fileURLToPath(import.meta.url)), ".tmp-bootstrap-"),
      );
      try {
        for (let stage = 0; stage < 3; stage++) {
          const generated = generate(grammar);
          if (previousCode !== undefined)
            expect(generated.code).toBe(previousCode);
          const path = join(directory, `stage-${stage}.generated.mjs`);
          writeFileSync(
            path,
            stripTypeScriptTypes(runtimeImports + generated.code) +
              '\nimport { parse as __tpegBootstrapParse } from "@suzumiyaaoba/tpeg-core";\nexport const __tpegReadModule = __tpegBootstrapParse(tpegFileNode);\n',
          );
          const module = (await import(pathToFileURL(path).href)) as {
            __tpegReadModule: ReadModule;
          };
          const parser = module.__tpegReadModule;

          const selfParsed = readModule(parser, metaSource);
          expect(selfParsed).toEqual(oracle);
          if (stage === 2) {
            for (const { name: layer, source } of sources.slice(0, -1)) {
              expect(readModule(parser, source), layer).toEqual(
                readModule(handwritten, source),
              );
            }
          }
          grammar = plainGrammar(selfParsed);
          previousCode = generated.code;
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }, 60000);
  }
});
