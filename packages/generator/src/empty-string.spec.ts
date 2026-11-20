import { describe, expect, it } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import { compileStart, grammarDefinition } from "@suzumiyaaoba/tpeg-parser";
import { generateEtaTypeScriptParser } from "./eta-generator";

function grammar(pattern: string) {
  const result = grammarDefinition(`grammar G { start = ${pattern}\n}`, 0);
  if (!result.success) throw new Error(JSON.stringify(result.error));
  return result.val;
}

describe("Eta generation of empty string literals", () => {
  it.each([false, true])(
    "preserves values and nullable semantics with optimize=%s",
    async (optimize) => {
      const options = { optimize, includeImports: false, includeTypes: false };
      const cases: [string, string, unknown][] = [
        ['""', "", ""],
        ["''", "", ""],
        ['"a" ""', "a", ["a", ""]],
        ['"" "a"', "a", ["", "a"]],
        ['empty:""', "", { empty: "" }],
        ['"a" / ""', "", ""],
        ['""?', "", ""],
        ['&"" "a"', "a", [undefined, "a"]],
        ['""{2,3}', "", ["", "", ""]],
        ['"a" empty\n empty = ""', "a", ["a", ""]],
        ['"" { return $$; }', "", ""],
        ['"a" ~ ""', "a", ["a", ""]],
      ];
      for (const [pattern, input, value] of cases) {
        const output = await generateEtaTypeScriptParser(
          grammar(pattern),
          options,
        );
        expect(
          compileStart(output.code, core, combinator)(input, 0),
          pattern,
        ).toEqual({
          success: true,
          val: value,
          current: 0,
          next: input.length,
        });
      }
      const start = compileStart(
        (await generateEtaTypeScriptParser(grammar('""'), options)).code,
        core,
        combinator,
      );
      for (const pos of [0, 1, 2, 3])
        expect(start("😀x", pos)).toEqual({
          success: true,
          val: "",
          current: pos,
          next: pos,
        });
      for (const pos of [-1, 0.5, NaN, Infinity, 4])
        expect(start("😀x", pos).success).toBe(false);
      const negative = await generateEtaTypeScriptParser(
        grammar('!""'),
        options,
      );
      expect(compileStart(negative.code, core, combinator)("", 0).success).toBe(
        false,
      );
      for (const pattern of ['""*', '""+', '""{0,}'])
        await expect(
          generateEtaTypeScriptParser(grammar(pattern), options),
        ).rejects.toThrow(/nullable|empty/i);
      for (const name of ["map", "sequence"])
        await expect(
          generateEtaTypeScriptParser(grammar(`""\n ${name} = "a"`), options),
        ).rejects.toThrow(new RegExp(name));
    },
  );

  it("compiles typed Eta outputs as Parser of the empty string", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tpeg-eta-empty-string-"));
    try {
      const corePath = fileURLToPath(
        new URL("../../core/dist/index.js", import.meta.url),
      );
      const files: string[] = [];
      for (const optimize of [false, true]) {
        const output = await generateEtaTypeScriptParser(grammar('""'), {
          optimize,
        });
        const file = join(dir, `parser-${optimize}.ts`);
        writeFileSync(
          file,
          `${output.code.replace("start: Parser<any>", "start").replaceAll('"@suzumiyaaoba/tpeg-core"', JSON.stringify(corePath))}\nexport const exact: Parser<""> = start;\n// @ts-expect-error: the parser captures only the empty string.\nexport const wrong: Parser<"a"> = start;\n`,
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
          "--skipLibCheck",
          "--target",
          "ES2022",
          "--module",
          "ESNext",
          "--moduleResolution",
          "bundler",
          ...files,
        ],
        { cwd: dir, encoding: "utf8" },
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
