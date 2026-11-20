import { describe, expect, it } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import { generateTypeScriptParser } from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { compileStart } from "./differential-fuzz";
import { grammarDefinition } from "./grammar";
import type { GrammarDefinition } from "./types";

const options = (typed: boolean) => ({
  includeImports: typed,
  includeTypes: typed,
});
const generators = [
  [
    "base",
    (g: GrammarDefinition, typed = false) =>
      generateTypeScriptParser(g, options(typed)),
  ],
  [
    "optimized off",
    (g: GrammarDefinition, typed = false) =>
      generateOptimizedTypeScriptParser(g, {
        ...options(typed),
        optimize: false,
      }),
  ],
  [
    "optimized on",
    (g: GrammarDefinition, typed = false) =>
      generateOptimizedTypeScriptParser(g, {
        ...options(typed),
        optimize: true,
      }),
  ],
  [
    "fusion rule",
    (g: GrammarDefinition, typed = false) =>
      generateOptimizedTypeScriptParser(g, {
        ...options(typed),
        enableRegexFusion: true,
        regexFusionScope: "rule",
      }),
  ],
  [
    "fusion subtree",
    (g: GrammarDefinition, typed = false) =>
      generateOptimizedTypeScriptParser(g, {
        ...options(typed),
        enableRegexFusion: true,
        regexFusionScope: "subtree",
      }),
  ],
] as const;

function grammar(pattern: string): GrammarDefinition {
  const result = grammarDefinition(`grammar G { start = ${pattern}\n}`, 0);
  if (!result.success) throw new Error(JSON.stringify(result.error));
  return result.val;
}

const cases: {
  pattern: string;
  input: string;
  value: unknown;
  next?: number;
}[] = [
  { pattern: '""', input: "", value: "" },
  { pattern: "''", input: "", value: "" },
  { pattern: '""', input: "tail", value: "", next: 0 },
  { pattern: '"" "a"', input: "a", value: ["", "a"] },
  { pattern: '"a" ""', input: "a", value: ["a", ""] },
  { pattern: '"" "a" ""', input: "a", value: ["", "a", ""] },
  { pattern: 'empty:""', input: "", value: { empty: "" } },
  { pattern: 'x:"a" (x:"" "d")', input: "ad", value: { x: "a" } },
  { pattern: '"a" / ""', input: "", value: "" },
  { pattern: '"a" / ""', input: "b", value: "", next: 0 },
  { pattern: '""?', input: "", value: "" },
  { pattern: '&"" "a"', input: "a", value: [undefined, "a"] },
  { pattern: '""{2,3}', input: "", value: ["", "", ""] },
  { pattern: '"a" empty\n empty = ""', input: "a", value: ["a", ""] },
  { pattern: '"" { return $$; }', input: "", value: "" },
  { pattern: '"a" ~ ""', input: "a", value: ["a", ""] },
];

describe("empty grammar string literals", () => {
  it.each(cases)(
    "matches $pattern on '$input' without consuming the empty literal",
    ({ pattern, input, value, next }) => {
      const ast = grammar(pattern);
      for (const [name, generate] of generators) {
        const start = compileStart(generate(ast).code, core, combinator);
        expect(start(input, 0), name).toEqual({
          success: true,
          val: value,
          current: 0,
          next: next ?? input.length,
        });
      }
    },
  );

  it("matches at every valid UTF-16 offset and rejects invalid positions", () => {
    for (const [name, generate] of generators) {
      const start = compileStart(
        generate(grammar('""')).code,
        core,
        combinator,
      );
      for (const pos of [0, 1, 2, 3])
        expect(start("😀x", pos), name).toEqual({
          success: true,
          val: "",
          current: pos,
          next: pos,
        });
      for (const pos of [-1, 0.5, NaN, Infinity, 4])
        expect(start("😀x", pos).success, name).toBe(false);
    }
  });

  it("preserves negative lookahead and failures after an empty prefix", () => {
    for (const [, generate] of generators) {
      expect(
        compileStart(generate(grammar('!""')).code, core, combinator)("", 0)
          .success,
      ).toBe(false);
      expect(
        compileStart(generate(grammar('"" "a"')).code, core, combinator)("", 0)
          .success,
      ).toBe(false);
      expect(
        compileStart(
          generate(grammar('"a" / ""')).code,
          core,
          combinator,
        )("a", 0),
      ).toMatchObject({ success: true, val: "a", next: 1 });
    }
  });

  it.each(['""*', '""+', '""{0,}'])(
    "still rejects unbounded nullable repetition %s",
    (pattern) => {
      for (const [, generate] of generators)
        expect(() => generate(grammar(pattern))).toThrow(/nullable|empty/i);
    },
  );

  it.each(["map", "sequence"])(
    "validates the %s binding required by empty literals",
    (name) => {
      for (const [, generate] of generators.slice(0, 3)) {
        expect(() => generate(grammar(`""\n ${name} = "a"`))).toThrow(
          new RegExp(name),
        );
        expect(() => generate(grammar(`"a"\n ${name} = "b"`))).not.toThrow();
      }
    },
  );

  it("compiles typed parsers and retains exact literal inference without fusion", () => {
    const dir = mkdtempSync(join(tmpdir(), "tpeg-empty-string-"));
    try {
      const corePath = fileURLToPath(
        new URL("../../core/dist/index.js", import.meta.url),
      );
      const files = generators.map(([, generate], i) => {
        const file = join(dir, `parser-${i}.ts`);
        const code = generate(grammar('""'), true)
          .code.replace("start: Parser<any>", "start")
          .replaceAll('"@suzumiyaaoba/tpeg-core"', JSON.stringify(corePath));
        writeFileSync(
          file,
          `${code}\nexport const exact: Parser<${i === 3 ? "string" : '""'}> = start;\n// @ts-expect-error: the result cannot be assumed to be "a".\nexport const wrong: Parser<"a"> = start;\n`,
        );
        return file;
      });
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
