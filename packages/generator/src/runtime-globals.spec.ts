import { describe, expect, it } from "vite-plus/test";
import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import {
  compileStart,
  createActionExpression,
  createGrammarDefinition,
  createIdentifier,
  createQuantified,
  createRuleDefinition,
  createStringLiteral,
  createTransformDefinition,
  createTransformFunction,
  createTransformReturnType,
  createTransformSet,
} from "@suzumiyaaoba/tpeg-parser";
import { EtaTPEGCodeGenerator } from "./eta-generator";

function transformGrammar(
  name: string,
  language = "typescript",
  actionCode?: string,
) {
  return createGrammarDefinition(
    "G",
    [],
    [
      createRuleDefinition("start", createIdentifier(name)),
      createRuleDefinition(
        name,
        actionCode === undefined
          ? createStringLiteral("a")
          : createActionExpression(createStringLiteral("a"), actionCode),
      ),
    ],
    [
      createTransformDefinition(
        createTransformSet("T", language, [
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

describe("Eta transform diagnostics and global names", () => {
  for (const optimize of [false, true]) {
    const generator = () =>
      new EtaTPEGCodeGenerator({
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize,
      });

    it.each([
      ["BigInt", "return 1n;"],
      ["cyclic object", "const value = {}; value.self = value; return value;"],
      [
        "throwing toJSON",
        'return { toJSON() { throw new Error("Serialization failed"); } };',
      ],
    ])(
      `preserves transform failures when captures contain %s (optimize: ${optimize})`,
      async (_kind, actionCode) => {
        const generated = await generator().generateGrammar(
          transformGrammar("value", "typescript", actionCode),
        );
        const start = compileStart(generated.code, core, combinator);
        expect(start("a", 0)).toMatchObject({
          success: false,
          error: {
            message: "Rejected",
            pos: 0,
            found: "<unserializable value>",
          },
        });
      },
    );

    it(`returns transform failures with a rule named JSON (optimize: ${optimize})`, async () => {
      const generated = await generator().generateGrammar(
        transformGrammar("JSON"),
      );
      const start = compileStart(generated.code, core, combinator);
      expect(start("a", 0)).toMatchObject({
        success: false,
        error: { message: "Rejected", found: '"a"', pos: 0 },
      });
    });

    it(`omits unavailable diagnostics with a rule named undefined (optimize: ${optimize})`, async () => {
      const generated = await generator().generateGrammar(
        transformGrammar("undefined", "typescript", "return void 0;"),
      );
      const result = compileStart(generated.code, core, combinator)("a", 0);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Rejected");
        expect(Object.hasOwn(result.error, "found")).toBe(false);
      }
    });

    it(`preserves an unbounded maximum with a rule named Infinity (optimize: ${optimize})`, async () => {
      for (const before of [false, true]) {
        const infinity = createRuleDefinition(
          "Infinity",
          createStringLiteral("u"),
        );
        const start = createRuleDefinition(
          "start",
          createQuantified(createStringLiteral("a"), 2, Infinity),
        );
        const generated = await generator().generateGrammar(
          createGrammarDefinition(
            "G",
            [],
            before ? [infinity, start] : [start, infinity],
          ),
        );
        const parser = compileStart(generated.code, core, combinator);
        expect(parser("aaa", 0)).toEqual({
          success: true,
          val: ["a", "a", "a"],
          current: 0,
          next: 3,
        });
        expect(parser("a", 0).success).toBe(false);
      }
    });

    it(`rejects a globalThis binding needed by diagnostics (optimize: ${optimize})`, async () => {
      await expect(
        generator().generateGrammar(transformGrammar("globalThis")),
      ).rejects.toThrow(/globalThis/);
      await expect(
        new EtaTPEGCodeGenerator({
          language: "typescript",
          includeTypes: false,
          namePrefix: "global",
          optimize,
        }).generateGrammar(transformGrammar("This")),
      ).rejects.toThrow(/globalThis/);
    });

    it(`accepts globalThis with only an unused language transform (optimize: ${optimize})`, async () => {
      const generated = await generator().generateGrammar(
        transformGrammar("globalThis", "python"),
      );
      const start = compileStart(generated.code, core, combinator);
      expect(start("a", 0).success).toBe(true);
    });
  }
});
