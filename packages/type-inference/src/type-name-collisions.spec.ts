import { describe, expect, it } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGrammarDefinition,
  createIdentifier,
  createRuleDefinition,
  createStar,
  createStringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import { TypeIntegrationEngine } from "./type-integration";

const literal = (value: string) => createStringLiteral(value, '"');
const namespaces = [
  "",
  "Types",
  "ParseResult",
  "ParseResult.Nested",
  "ParseResult.__tpegParseResult",
  "__tpegParseResult.ParseResult",
  "N.ParseResult",
  "ParserResult",
];

describe("generated type name collisions", () => {
  for (const generateTypeGuards of [false, true]) {
    it.each(["parser", "Parser", "_parser", "parser-"])(
      `reports the reserved ParserResult type for '%s' with guards ${generateTypeGuards}`,
      (name) => {
        for (const typeNamespace of ["", "Types", "ParserResult"]) {
          const engine = new TypeIntegrationEngine({
            generateTypeGuards,
            typeNamespace,
          });
          expect(() =>
            engine.createTypedGrammar(
              createGrammarDefinition(
                "G",
                [],
                [createRuleDefinition(name, literal("a"))],
              ),
            ),
          ).toThrow(/ParserResult.*reserved.*union/i);
        }
      },
    );

    it(`compiles core-name collisions and preserves interface return types with guards ${generateTypeGuards}`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "tpeg-type-name-collisions-"));
      try {
        const cases: { typeNamespace: string; file: string }[] = [];
        for (const typeNamespace of namespaces) {
          for (const includeDocumentation of [false, true]) {
            const engine = new TypeIntegrationEngine({
              typeNamespace,
              generateTypeGuards,
              includeDocumentation,
            });
            const grammar = createGrammarDefinition(
              "G",
              [],
              [
                createRuleDefinition("parse", literal("a")),
                createRuleDefinition(
                  "items",
                  createStar(createIdentifier("parse")),
                ),
              ],
            );
            const typed = engine.createTypedGrammar(grammar);
            const source = `${typed.typeDefinitions}\n${engine.generateParserInterface(typed)}
import type { ParseResult as CoreResult } from "@suzumiyaaoba/tpeg-core";
type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Assert<T extends true> = T;
export type ParseCheck = Assert<Same<ReturnType<GParser["parse"]>, CoreResult<"a">>>;
export type ItemsCheck = Assert<Same<ReturnType<GParser["items"]>, CoreResult<"a"[]>>>;`;
            const file = `case-${cases.length}`;
            writeFileSync(join(dir, `${file}.ts`), source);
            cases.push({ typeNamespace, file });
          }
        }
        writeFileSync(
          join(dir, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              strict: true,
              noUnusedLocals: true,
              noUnusedParameters: true,
              exactOptionalPropertyTypes: true,
              noUncheckedIndexedAccess: true,
              skipLibCheck: true,
              module: "ESNext",
              target: "ES2022",
              moduleResolution: "Bundler",
              types: [],
              outDir: "compiled",
              paths: {
                "@suzumiyaaoba/tpeg-core": [
                  fileURLToPath(
                    new URL("../../core/dist/index.d.ts", import.meta.url),
                  ),
                ],
              },
            },
            include: ["*.ts"],
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
        for (const { typeNamespace, file } of cases) {
          const code = readFileSync(
            join(dir, "compiled", `${file}.js`),
            "utf8",
          );
          const exported = await import(
            /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
          );
          if (!generateTypeGuards) {
            expect(Object.keys(exported)).toEqual([]);
            continue;
          }
          let api = exported;
          for (const segment of typeNamespace ? typeNamespace.split(".") : [])
            api = api[segment];
          expect(api["isParseResult"]("a")).toBe(true);
          expect(api["isParseResult"]("b")).toBe(false);
          expect(api["isItemsResult"](["a", "a"])).toBe(true);
          expect(api["isItemsResult"](["b"])).toBe(false);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
