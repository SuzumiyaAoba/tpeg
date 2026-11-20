import { describe, expect, it } from "vite-plus/test";
import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import {
  compileStart,
  createActionExpression,
  createChoice,
  createGrammarDefinition,
  createIdentifier,
  createLabeledExpression,
  createRuleDefinition,
  createSequence,
  createStringLiteral,
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
  type Expression,
  type GrammarDefinition,
} from "@suzumiyaaoba/tpeg-parser";
import { EtaTPEGCodeGenerator } from "./eta-generator";
import {
  objectMethodModifierFixtures,
  objectMethodReferenceFixtures,
} from "../../parser/test-fixtures/object-methods.mjs";

const plainOptions = { includeImports: false, includeTypes: false };
const generators = [
  {
    name: "base",
    generate: (grammar: GrammarDefinition) =>
      generateTypeScriptParser(grammar, plainOptions).code,
  },
  {
    name: "optimized",
    generate: (grammar: GrammarDefinition) =>
      generateOptimizedTypeScriptParser(grammar, plainOptions).code,
  },
  ...[false, true].map((optimize) => ({
    name: `Eta (optimize: ${optimize})`,
    generate: async (grammar: GrammarDefinition) =>
      (
        await new EtaTPEGCodeGenerator({
          ...plainOptions,
          language: "typescript",
          optimize,
        }).generateGrammar(grammar)
      ).code,
  })),
];

function grammar(pattern: Expression, body: string) {
  return createGrammarDefinition(
    "G",
    [],
    [createRuleDefinition("start", createActionExpression(pattern, body))],
  );
}

const labeled = createLabeledExpression("value", createStringLiteral("a"));
const cases = [
  ...objectMethodReferenceFixtures.map((fixture) => ({
    name: fixture.name,
    pattern: createLabeledExpression(fixture.label, createStringLiteral("a")),
    body: fixture.body
      .replaceAll("__VALUE__", "a")
      .replaceAll("__JOIN__", "")
      .replaceAll("__TYPE__", ""),
    input: "a",
    expected: "a",
  })),
  ...[
    'const object={*class(){value; yield "a";}}; return object.class().next().value;',
    'class Read {*class(){value; yield "a";}} return new Read().class().next().value;',
  ].map((body, index) => ({
    name: `a generator named class (${index})`,
    pattern: labeled,
    body,
    input: "a",
    expected: "a",
  })),
  ...[
    "length",
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
  ].flatMap((label) => [
    {
      name: `an absent ${label} label on a scalar alternative`,
      pattern: createChoice([
        createLabeledExpression(label, createStringLiteral("a")),
        createStringLiteral("b"),
      ]),
      body: `return typeof ${label};`,
      input: "b",
      expected: "undefined",
    },
    {
      name: `a present ${label} label`,
      pattern: createChoice([
        createLabeledExpression(label, createStringLiteral("a")),
        createStringLiteral("b"),
      ]),
      body: `return ${label};`,
      input: "a",
      expected: "a",
    },
    {
      name: `an absent ${label} label on another capture alternative`,
      pattern: createChoice([
        createLabeledExpression(label, createStringLiteral("a")),
        createLabeledExpression("other", createStringLiteral("b")),
      ]),
      body: `return eval(${JSON.stringify(label)});`,
      input: "b",
      expected: undefined,
    },
  ]),
  {
    name: "labels on a repeatedly grouped choice",
    pattern: {
      type: "Group" as const,
      expression: {
        type: "Group" as const,
        expression: createChoice([
          createLabeledExpression("left", createStringLiteral("a")),
          createLabeledExpression("right", createStringLiteral("b")),
        ]),
      },
    },
    body: "return left ?? right;",
    input: "b",
    expected: "b",
  },
  ...[
    "__base",
    "__result",
    "__transformed",
    "__val",
    "__current",
    "__next",
    "input",
    "pos",
  ].map((label) => ({
    name: `a label named ${label}`,
    pattern: createLabeledExpression(label, createStringLiteral("a")),
    body: `return ${label};`,
    input: "a",
    expected: "a",
  })),
  ...[
    'const __result = "owned"; return [$$, __result];',
    'let __result = "owned"; return [$$, __result];',
    'var __result = "owned"; return [$$, __result];',
    'function __result() { return "owned"; } return [$$, __result()];',
    'class __result { static value = "owned"; } return [$$, __result.value];',
    "const { length: __result } = $$; return [$$, String(__result)];",
  ].map((body, index) => ({
    name: `an action-local result binding (${index})`,
    pattern: createStringLiteral("a"),
    body,
    input: "a",
    expected: ["a", index === 5 ? "1" : "owned"],
  })),
  {
    name: "an internal-name label through direct eval",
    pattern: createLabeledExpression("__result", createStringLiteral("a")),
    body: 'return eval("__result");',
    input: "a",
    expected: "a",
  },
  {
    name: "an escaped action-local result binding",
    pattern: createStringLiteral("a"),
    body: 'const \\u005f_result = "owned"; return [$$, \\u005f_result];',
    input: "a",
    expected: ["a", "owned"],
  },
  {
    name: "raw capture through direct eval",
    pattern: createStringLiteral("a"),
    body: 'return eval("$$");',
    input: "a",
    expected: "a",
  },
  {
    name: "label through a computed eval argument",
    pattern: labeled,
    body: 'const name = ["val", "ue"].join(""); return eval(name);',
    input: "a",
    expected: "a",
  },
  {
    name: "mixed static and dynamic labels",
    pattern: createSequence([
      createLabeledExpression("left", createStringLiteral("a")),
      createLabeledExpression("right", createStringLiteral("b")),
      createLabeledExpression("unused", createStringLiteral("c")),
    ]),
    body: 'return left + eval("right");',
    input: "abc",
    expected: "ab",
  },
  {
    name: "direct eval in a nested closure",
    pattern: labeled,
    body: 'return (() => eval("value"))();',
    input: "a",
    expected: "a",
  },
  {
    name: "direct eval in a template interpolation",
    pattern: labeled,
    body: 'return `${eval("value")}`;',
    input: "a",
    expected: "a",
  },
  {
    name: "an absent label from another choice alternative",
    pattern: createChoice([labeled, createStringLiteral("b")]),
    body: 'return eval("value") ?? "missing";',
    input: "b",
    expected: "missing",
  },
  {
    name: "an escaped eval identifier",
    pattern: labeled,
    body: 'return \\u0065val("value");',
    input: "a",
    expected: "a",
  },
  {
    name: "an escaped static label identifier",
    pattern: labeled,
    body: "return v\\u{61}lue;",
    input: "a",
    expected: "a",
  },
  {
    name: "an escaped raw capture identifier",
    pattern: createStringLiteral("a"),
    body: "return \\u0024\\u0024;",
    input: "a",
    expected: "a",
  },
  {
    name: "direct eval in a class field initializer",
    pattern: labeled,
    body: 'class Read { static result = eval("value"); } return Read.result;',
    input: "a",
    expected: "a",
  },
];

for (const { name, generate } of generators) {
  describe(`action capture scope: ${name}`, () => {
    it.each(cases)("preserves $name", async (fixture) => {
      const start = compileStart(
        await generate(grammar(fixture.pattern, fixture.body)),
        core,
        combinator,
      );
      expect(start(fixture.input, 0)).toEqual({
        success: true,
        val: fixture.expected,
        current: 0,
        next: fixture.input.length,
      });
    });

    it.each(objectMethodModifierFixtures)(
      "discards captures for $name",
      async (fixture) => {
        const result: core.ParseSuccess<never> = {
          success: true,
          current: 0,
          next: 1,
          get val(): never {
            throw new Error("Discarded capture must not be read");
          },
        };
        const pattern = createChoice([
          createLabeledExpression(fixture.label, createStringLiteral("a")),
          createIdentifier("externalParser"),
        ]);
        const body = fixture.body
          .replaceAll("__VALUE__", "a")
          .replaceAll("__TYPE__", "");
        const start = compileStart(
          await generate(grammar(pattern, body)),
          { ...core, externalParser: () => result },
          combinator,
        );
        expect(start("b", 0)).toEqual({
          success: true,
          val: "a",
          current: 0,
          next: 1,
        });
      },
    );

    it.each([
      'const name = "eval"; return name.length;',
      ...["eval", "$$"].flatMap((key) => [
        `const object = { *${key}() { yield 4; } }; return object.${key}().next().value;`,
        `const object = { async *${key}() { yield 4; } }; return 4;`,
        `class Read { *${key}() { yield 4; } } return new Read().${key}().next().value;`,
        `class Read { static *${key}() { yield 4; } } return Read.${key}().next().value;`,
        `class Read { async *${key}() { yield 4; } } return 4;`,
        `class Read { static async *${key}() { yield 4; } } return 4;`,
        `const object = { *${key === "eval" ? "\\u0065val" : "\\u0024\\u0024"}() { yield 4; } }; return object.${key}().next().value;`,
      ]),
      "// eval does not run here\nreturn 4;",
      'return /eval/.test("test") ? 0 : 4;',
      "const object = { eval() { return 4; } }; return object.eval();",
      'return globalThis.eval("2 + 2");',
      "const πeval = () => 4; return πeval();",
      "const 𝒜eval = () => 4; return 𝒜eval();",
      "class Read { eval() { return 4; } } return new Read().eval();",
      "class Read { #eval() { return 4; } run() { return this.#eval(); } } return new Read().run();",
      "class Read { value = 1\n eval() { return 4; } } return new Read().eval();",
      "class Read { value = 1 /*\n*/ eval() { return 4; } } return new Read().eval();",
    ])("does not read discarded captures for %s", async (body) => {
      const result: core.ParseSuccess<never> = {
        success: true,
        current: 0,
        next: 1,
        get val(): never {
          throw new Error("Discarded capture must not be read");
        },
      };
      const start = compileStart(
        await generate(grammar(createIdentifier("externalParser"), body)),
        { ...core, externalParser: () => result },
        combinator,
      );
      expect(start("a", 0)).toEqual({
        success: true,
        val: 4,
        current: 0,
        next: 1,
      });
    });
  });
}
