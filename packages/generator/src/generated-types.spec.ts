import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import {
  compileStart,
  createActionExpression,
  createCharRange,
  createCharacterClass,
  createGrammarDefinition,
  createChoice,
  createGroup,
  createLabeledExpression,
  createOptional,
  createPlus,
  createRuleDefinition,
  createSequence,
  createStringLiteral,
  createTransformDefinition,
  createTransformFunction,
  createTransformParameter,
  createTransformReturnType,
  createTransformSet,
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
} from "@suzumiyaaoba/tpeg-parser";
import { EtaTPEGCodeGenerator } from "./eta-generator";
import {
  objectMethodModifierFixtures,
  objectMethodReferenceFixtures,
} from "../../parser/test-fixtures/object-methods.mjs";

it("strictly compiles and executes generated transforms, actions, monitoring and literal fusion", async () => {
  const input = "a😀a";
  const pattern = createPlus(
    createCharacterClass([createCharRange("a"), createCharRange("😀")]),
  );
  const rules = ["Array", "JSON", "Map", "performance", "console"].map((name) =>
    createRuleDefinition(name, createStringLiteral("x")),
  );
  const grammars = [
    ...[
      'return { success: false, error: "Rejected" };',
      'return { success: true, value: captures.join("") };',
      'return { success: true, value: eval("captures").join("") };',
    ].map((body, index) => {
      const parameter = ["captures", "__current", "__next"][index]!;
      return createGrammarDefinition(
        "G",
        [],
        [createRuleDefinition("start", pattern), ...rules],
        [
          createTransformDefinition(
            createTransformSet("T", "typescript", [
              createTransformFunction(
                "start",
                [createTransformParameter(parameter, "string[]")],
                createTransformReturnType("Result", "string"),
                body.replace(/\bcaptures\b/g, parameter),
              ),
            ]),
          ),
        ],
      );
    }),
    ...["get", "set", "async"].map((parameter) => {
      const fixture = objectMethodModifierFixtures.find(
        (item) => item.name === `${parameter} identifier`,
      )!;
      const body = fixture.body
        .replaceAll("__VALUE__", input)
        .replaceAll("__TYPE__", ": string");
      return createGrammarDefinition(
        "G",
        [],
        [createRuleDefinition("start", pattern)],
        [
          createTransformDefinition(
            createTransformSet("T", "typescript", [
              createTransformFunction(
                "start",
                [createTransformParameter(parameter, "string[]")],
                createTransformReturnType("Result", "string"),
                `return { success: true, value: (() => { ${body} })() };`,
              ),
            ]),
          ),
        ],
      );
    }),
    createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "start",
          createActionExpression(pattern, 'return $$.join("");'),
        ),
        ...rules,
      ],
    ),
    ...[
      "__base",
      "__result",
      "__transformed",
      "__val",
      "__current",
      "__next",
      "input",
      "pos",
    ].map((label) =>
      createGrammarDefinition(
        "G",
        [],
        [
          createRuleDefinition(
            "start",
            createActionExpression(
              createLabeledExpression(label, pattern),
              `return ${label}.join("");`,
            ),
          ),
        ],
      ),
    ),
    ...[
      ...[
        "length",
        "constructor",
        "toString",
        "__proto__",
        "hasOwnProperty",
      ].flatMap((label) => [
        {
          pattern: createChoice([
            createLabeledExpression(label, createStringLiteral("b")),
            pattern,
          ]),
          body: `return typeof ${label} === "undefined" ? $$.join("") : "!";`,
        },
        {
          pattern: createChoice([
            createLabeledExpression(label, createStringLiteral("b")),
            createLabeledExpression("other", pattern),
          ]),
          body: `return typeof ${label} === "undefined" ? other.join("") : "!";`,
        },
        {
          pattern: createChoice([
            createLabeledExpression(label, pattern),
            createStringLiteral("b"),
          ]),
          body: `return ${label}.join("");`,
        },
      ]),
      {
        pattern: createGroup(
          createGroup(
            createChoice([
              createLabeledExpression("left", pattern),
              createLabeledExpression("right", createStringLiteral("b")),
            ]),
          ),
        ),
        body: 'return left.join("");',
      },
      ...[
        'const __result = 1; return $$.join("") + (__result === 1 ? "" : "!");',
        'let __result = 1; return $$.join("") + (__result === 1 ? "" : "!");',
        'var __result = 1; return $$.join("") + (__result === 1 ? "" : "!");',
        'function __result() { return 1; } return $$.join("") + (__result() === 1 ? "" : "!");',
        'class __result { static suffix = ""; } return $$.join("") + __result.suffix;',
        'const [__result] = $$; return __result + $$.slice(1).join("");',
      ].map((body) => ({ pattern, body })),
      {
        pattern: createLabeledExpression("__result", pattern),
        body: 'return eval("__result").join("");',
      },
      { pattern, body: 'return eval("$$").join("");' },
      {
        pattern: createLabeledExpression("__next", pattern),
        body: 'const name = ["__", "next"].join(""); return eval(name).join("");',
      },
      {
        pattern: createSequence([
          createLabeledExpression("__current", pattern),
          createLabeledExpression(
            "unused",
            createOptional(createStringLiteral("x")),
          ),
        ]),
        body: 'return eval("__current").join("");',
      },
      {
        pattern: createLabeledExpression("value", pattern),
        body: 'return \\u0065val("value").join("");',
      },
      { pattern, body: 'return \\u0024\\u0024.join("");' },
      {
        pattern: createLabeledExpression("value", pattern),
        body: 'return { value: "a😀a" }.value;',
      },
      {
        pattern: createLabeledExpression("value", pattern),
        body: 'return { value() { return "a😀a"; } }.value();',
      },
      {
        pattern: createLabeledExpression("value", pattern),
        body: 'class Read { static result = eval("value"); } return Read.result.join("");',
      },
      {
        pattern: createLabeledExpression("value", pattern),
        body: 'class Read { value() { return "a😀a"; } } return new Read().value();',
      },
      ...["value", "$$"].flatMap((key) =>
        [
          `const object = { *${key}() { yield "a😀a"; } }; return object.${key}().next().value;`,
          `const object = { async *${key}() { yield "a😀a"; } }; void object.${key}; return "a😀a";`,
          `class Read { *${key}() { yield "a😀a"; } } return new Read().${key}().next().value;`,
          `class Read { static *${key}() { yield "a😀a"; } } return Read.${key}().next().value;`,
          `class Read { async *${key}() { yield "a😀a"; } } void new Read().${key}; return "a😀a";`,
          `class Read { static async *${key}() { yield "a😀a"; } } void Read.${key}; return "a😀a";`,
          `const object = { *${key === "value" ? "v\\u0061lue" : "\\u0024\\u0024"}() { yield "a😀a"; } }; return object.${key}().next().value;`,
        ].map((body) => ({
          pattern:
            key === "value" ? createLabeledExpression(key, pattern) : pattern,
          body,
        })),
      ),
      ...[
        'const async = 1; return { key: async * value.length }.key === 3 ? "a😀a" : "!";',
        'const async = 1; class Read { key = async\n * value.length; } return new Read().key === 3 ? "a😀a" : "!";',
        'class Read { key = 1\n * value.length; } return new Read().key === 3 ? "a😀a" : "!";',
      ].map((body) => ({
        pattern: createLabeledExpression("value", pattern),
        body,
      })),
      ...[
        'const object={*class(){value; yield "a😀a";}}; return object.class().next().value;',
        'class Read {*class(){value; yield "a😀a";}} return new Read().class().next().value;',
      ].map((body) => ({
        pattern: createLabeledExpression("value", pattern),
        body,
      })),
      ...[
        ...objectMethodModifierFixtures,
        ...objectMethodReferenceFixtures,
      ].map((fixture) => ({
        pattern: createLabeledExpression(fixture.label, pattern),
        body: fixture.body
          .replaceAll("__VALUE__", "a😀a")
          .replaceAll("__JOIN__", '.join("")')
          .replaceAll("__TYPE__", ": string"),
      })),
    ].map((fixture) =>
      createGrammarDefinition(
        "G",
        [],
        [
          createRuleDefinition(
            "start",
            createActionExpression(fixture.pattern, fixture.body),
          ),
        ],
      ),
    ),
  ];
  const dir = mkdtempSync(join(tmpdir(), "tpeg-generated-types-"));
  try {
    const fixtures = [];
    for (let index = 0; index < grammars.length; index++) {
      const grammar = grammars[index]!;
      const generated = [
        generateTypeScriptParser(grammar),
        generateOptimizedTypeScriptParser(grammar, {
          includeMonitoring: true,
          enableRegexFusion: true,
          regexFusionScope: "rule",
        }),
        await new EtaTPEGCodeGenerator({
          language: "typescript",
          optimize: false,
        }).generateGrammar(grammar),
        await new EtaTPEGCodeGenerator({
          language: "typescript",
          optimize: true,
        }).generateGrammar(grammar),
      ];
      for (let variant = 0; variant < generated.length; variant++) {
        const name = `parser-${index}-${variant}`;
        writeFileSync(join(dir, `${name}.ts`), generated[variant]!.code);
        fixtures.push({ name, success: index !== 0 });
      }
    }
    const declarationPath = (packageName: string) =>
      fileURLToPath(
        new URL(`../../${packageName}/dist/index.d.ts`, import.meta.url),
      );
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
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          types: [],
          lib: ["ES2022", "DOM"],
          outDir: "compiled",
          paths: {
            "@suzumiyaaoba/tpeg-core": [declarationPath("core")],
            "@suzumiyaaoba/tpeg-combinator": [declarationPath("combinator")],
          },
        },
        include: ["*.ts"],
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../../node_modules/typescript/bin/tsc", import.meta.url),
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
    for (const fixture of fixtures) {
      const code = readFileSync(
        join(dir, "compiled", `${fixture.name}.js`),
        "utf8",
      ).replace(/^import[^\n]*\n/gm, "");
      const start = compileStart(code, core, combinator);
      const parsed = start(input, 0);
      expect(parsed.success, fixture.name).toBe(fixture.success);
      if (parsed.success) expect(parsed.val, fixture.name).toBe(input);
      else expect(parsed.error.message, fixture.name).toBe("Rejected");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
