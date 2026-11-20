import { describe, expect, it } from "vite-plus/test";
import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import {
  compileStart,
  createActionExpression,
  createGrammarDefinition,
  createIdentifier,
  createRuleDefinition,
  createTransformDefinition,
  createTransformFunction,
  createTransformParameter,
  createTransformReturnType,
  createTransformSet,
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
  type GrammarDefinition,
} from "@suzumiyaaoba/tpeg-parser";
import { EtaTPEGCodeGenerator } from "./eta-generator";

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

function actionGrammar(body: string): GrammarDefinition {
  return createGrammarDefinition(
    "G",
    [],
    [
      createRuleDefinition(
        "start",
        createActionExpression(createIdentifier("externalParser"), body),
      ),
    ],
  );
}

function transformGrammar(body: string): GrammarDefinition {
  return createGrammarDefinition(
    "G",
    [],
    [createRuleDefinition("start", createIdentifier("externalParser"))],
    [
      createTransformDefinition(
        createTransformSet("T", "typescript", [
          createTransformFunction(
            "start",
            [createTransformParameter("captures", "string")],
            createTransformReturnType("Result", "string"),
            body,
          ),
        ]),
      ),
    ],
  );
}

function reusedParser() {
  const result: core.ParseSuccess<string> = {
    success: true,
    val: "",
    current: 0,
    next: 0,
  };
  const externalParser: core.Parser<string> = (_input, pos) => {
    result.val = `value-${pos}`;
    result.current = pos;
    result.next = pos + 1;
    return result;
  };
  return {
    result,
    externalParser,
    again: () => externalParser("abc", 1),
  };
}

for (const { name, generate } of generators) {
  describe(`generated result snapshots: ${name}`, () => {
    async function compile(
      grammar: GrammarDefinition,
      scope: Record<string, unknown>,
    ) {
      return compileStart(
        await generate(grammar),
        { ...core, ...scope },
        combinator,
      );
    }

    it("preserves the original consumption when an action reenters its child", async () => {
      const fixture = reusedParser();
      const start = await compile(
        actionGrammar("const value = $$; again(); return value;"),
        fixture,
      );
      expect(start("abc", 0)).toEqual({
        success: true,
        val: "value-0",
        current: 0,
        next: 1,
      });
      expect(fixture.result.next).toBe(2);
    });

    it("captures action positions before accessing the child value", async () => {
      let reads = 0;
      const result: core.ParseSuccess<string> = {
        success: true,
        current: 0,
        next: 1,
        get val() {
          reads++;
          result.current = 1;
          result.next = 2;
          return "original";
        },
      };
      const start = await compile(actionGrammar("return $$;"), {
        externalParser: () => result,
      });
      expect(start("abc", 0)).toEqual({
        success: true,
        val: "original",
        current: 0,
        next: 1,
      });
      expect(reads).toBe(1);
    });

    it("keeps positions without reading a value ignored by the action", async () => {
      const result: core.ParseSuccess<string> = {
        success: true,
        current: 0,
        next: 1,
        get val(): string {
          throw new Error("Discarded value must not be read");
        },
      };
      const start = await compile(
        actionGrammar('again(); return "constant";'),
        {
          externalParser: () => result,
          again: () => {
            result.current = 1;
            result.next = 2;
          },
        },
      );
      expect(start("abc", 0)).toEqual({
        success: true,
        val: "constant",
        current: 0,
        next: 1,
      });
    });

    it("preserves the original consumption when a transform reenters its child", async () => {
      const fixture = reusedParser();
      const start = await compile(
        transformGrammar("again(); return { success: true, value: captures };"),
        fixture,
      );
      expect(start("abc", 0)).toEqual({
        success: true,
        val: "value-0",
        current: 0,
        next: 1,
      });
      expect(fixture.result.next).toBe(2);
    });

    it("reports the original position and value when a reentrant transform rejects", async () => {
      const fixture = reusedParser();
      const start = await compile(
        transformGrammar(
          'again(); return { success: false, error: "Rejected" };',
        ),
        fixture,
      );
      expect(start("abc", 0)).toEqual({
        success: false,
        error: {
          message: "Rejected",
          pos: 0,
          parserName: "start",
          expected: "successful transform",
          found: '"value-0"',
        },
      });
      expect(fixture.result.next).toBe(2);
    });

    it("keeps consumption when the transformed value getter reuses the child result", async () => {
      const fixture = reusedParser();
      const start = await compile(
        transformGrammar(
          "return { success: true, get value() { again(); return captures; } };",
        ),
        fixture,
      );
      expect(start("abc", 0)).toEqual({
        success: true,
        val: "value-0",
        current: 0,
        next: 1,
      });
    });

    for (const [kind, grammar] of [
      ["action", actionGrammar("return explode();")],
      ["transform", transformGrammar("return explode();")],
    ] as const) {
      it(`returns child failures unchanged without calling the ${kind}`, async () => {
        const failure: core.ParseFailure = {
          success: false,
          error: {
            message: "Committed failure",
            pos: 0,
            fatal: true,
            abort: true,
          },
        };
        const start = await compile(grammar, {
          externalParser: () => failure,
          explode: () => {
            throw new Error("Callback must not run");
          },
        });
        expect(start("abc", 0)).toBe(failure);
      });

      it(`propagates exceptions from the ${kind}`, async () => {
        const error = new Error("Callback failed");
        const start = await compile(grammar, {
          externalParser: reusedParser().externalParser,
          explode: () => {
            throw error;
          },
        });
        expect(() => start("abc", 0)).toThrow(error);
      });
    }
  });
}
