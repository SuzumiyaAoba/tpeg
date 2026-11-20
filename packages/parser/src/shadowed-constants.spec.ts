import { describe, expect, it } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import { generateTypeScriptParser, type CodeGenOptions } from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { compileStart } from "./differential-fuzz";
import { evaluateGeneratedModule } from "./generated-runtime";
import { grammarDefinition } from "./grammar";
import {
  createActionExpression,
  createGrammarDefinition,
  createTransformDefinition,
  createTransformFunction,
  createTransformReturnType,
  createTransformSet,
  createQuantified,
  createRuleDefinition,
  createStringLiteral,
  type GrammarDefinition,
} from "./types";

const generators = [
  ["base", generateTypeScriptParser],
  [
    "optimized off",
    (g: GrammarDefinition, o: Partial<CodeGenOptions>) =>
      generateOptimizedTypeScriptParser(g, { ...o, optimize: false }),
  ],
  ["optimized on", generateOptimizedTypeScriptParser],
  [
    "fusion rule",
    (g: GrammarDefinition, o: Partial<CodeGenOptions>) =>
      generateOptimizedTypeScriptParser(g, {
        ...o,
        enableRegexFusion: true,
        regexFusionScope: "rule",
      }),
  ],
  [
    "fusion subtree",
    (g: GrammarDefinition, o: Partial<CodeGenOptions>) =>
      generateOptimizedTypeScriptParser(g, {
        ...o,
        enableRegexFusion: true,
        regexFusionScope: "subtree",
        regexFusionMinWeight: 1,
      }),
  ],
] as const;
const plain = { includeTypes: false, includeImports: false };
function grammar(pattern: string, name = "undefined", prefix = "") {
  const parsed = grammarDefinition(
    `grammar G { start = ${pattern}\n ${name} = "u"\n}`,
    0,
  );
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error));
  return { grammar: parsed.val, options: { ...plain, namePrefix: prefix } };
}
function unbounded(before: boolean) {
  const rule = createRuleDefinition("Infinity", createStringLiteral("u"));
  const start = createRuleDefinition(
    "start",
    createQuantified(createStringLiteral("a"), 2, Infinity),
  );
  return createGrammarDefinition(
    "G",
    [],
    before ? [rule, start] : [start, rule],
  );
}
function transformed(empty: boolean) {
  return createGrammarDefinition(
    "G",
    [],
    [
      createRuleDefinition(
        "start",
        empty
          ? createActionExpression(createStringLiteral("a"), "return void 0;")
          : createStringLiteral("a"),
      ),
      createRuleDefinition("undefined", createStringLiteral("u")),
    ],
    [
      createTransformDefinition(
        createTransformSet("T", "typescript", [
          createTransformFunction(
            "start",
            [],
            createTransformReturnType("Result", "string"),
            'return { success: false, error: "Rejected" };',
          ),
        ]),
      ),
    ],
  );
}
const fixtures: [string, string, unknown][] = [
  ['"a"? "b"', "b", [null, "b"]],
  ['"a"? "b"', "ab", ["a", "b"]],
  ['("a" / "b") "c"', "bc", ["b", "c"]],
  ['("a" / "b") "c"', "ac", ["a", "c"]],
  ['("a" / "b" / "c") "d"', "cd", ["c", "d"]],
  ['[a😀]* "b"', "b", [[], "b"]],
  ['[a😀]* "b"', "a😀b", [["a", "😀"], "b"]],
];

describe("generated constants with shadowing rule bindings", () => {
  for (const [name, generate] of generators) {
    it(`preserves choice, optional and repetition values (${name})`, () => {
      for (const [rule, prefix] of [
        ["undefined", ""],
        ["defined", "un"],
      ]) {
        for (const [pattern, input, value] of fixtures) {
          const config = grammar(pattern, rule, prefix);
          const module = evaluateGeneratedModule(
            generate(config.grammar, config.options).code,
            { ...combinator, ...core },
          );
          const start = module[`${prefix}start`] as core.Parser<unknown>;
          expect(start(input, 0)).toEqual({
            success: true,
            val: value,
            current: 0,
            next: input.length,
          });
          expect(start("z", 0).success).toBe(false);
        }
      }
    });

    it.each([false, true])(
      `accepts an unbounded maximum with Infinity declared first: %s (${name})`,
      (before) => {
        const start = compileStart(
          generate(unbounded(before), plain).code,
          core,
          combinator,
        );
        expect(start("aaa", 0)).toEqual({
          success: true,
          val: ["a", "a", "a"],
          current: 0,
          next: 3,
        });
        expect(start("a", 0).success).toBe(false);
      },
    );
  }

  it("omits unavailable transform diagnostics with a rule named undefined", () => {
    for (const [, generate] of generators) {
      const start = compileStart(
        generate(transformed(true), plain).code,
        core,
        combinator,
      );
      const result = start("a", 0);
      expect(result.success).toBe(false);
      if (!result.success)
        expect(Object.hasOwn(result.error, "found")).toBe(false);
    }
  });

  it("finishes absent monitoring operations with a rule named undefined", () => {
    const generated = generateOptimizedTypeScriptParser(
      grammar('"a"').grammar,
      { ...plain, includeMonitoring: true },
    );
    const module = evaluateGeneratedModule(generated.code, {
      ...combinator,
      ...core,
    });
    const monitor = module["performanceMonitor"] as {
      end(name: string): number;
    };
    expect(monitor.end("missing")).toBe(0);
    const start = module["start"] as core.Parser<unknown>;
    expect(start("a", 0).success).toBe(true);
    expect(monitor.end("start")).toBe(0);
  });

  it("compiles typed output with both constant names and transform diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "tpeg-shadowed-constants-"));
    try {
      const corePath = fileURLToPath(
        new URL("../../core/dist/index.js", import.meta.url),
      );
      const files: string[] = [];
      for (const [name, generate] of generators) {
        for (const [label, g] of [
          ["fusion", grammar('("a" / "b") "c"').grammar],
          ["transform", transformed(false)],
          ["maximum", unbounded(false)],
        ] as const) {
          const path = join(dir, `${name}-${label}.ts`);
          writeFileSync(
            path,
            generate(g, {
              includeTypes: true,
              includeImports: true,
            }).code.replaceAll(
              '"@suzumiyaaoba/tpeg-core"',
              JSON.stringify(corePath),
            ),
          );
          files.push(path);
        }
      }
      const monitoring = join(dir, "monitoring.ts");
      writeFileSync(
        monitoring,
        generateOptimizedTypeScriptParser(grammar('"a"').grammar, {
          includeTypes: true,
          includeImports: true,
          includeMonitoring: true,
        }).code.replaceAll(
          '"@suzumiyaaoba/tpeg-core"',
          JSON.stringify(corePath),
        ),
      );
      files.push(monitoring);
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
