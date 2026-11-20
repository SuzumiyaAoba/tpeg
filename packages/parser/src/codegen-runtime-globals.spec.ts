import { describe, expect, it, vi } from "vite-plus/test";
import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import {
  collectTopLevelLabels,
  collectRequiredTopLevelLabels,
  generateTypeScriptParser,
  wrapWithAction,
  wrapWithTransform,
} from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { compileStart } from "./differential-fuzz";
import {
  createActionExpression,
  createChoice,
  createGroup,
  createLabeledExpression,
  createSequence,
  createCharRange,
  createCharacterClass,
  createGrammarDefinition,
  createIdentifier,
  createPlus,
  createQuantified,
  createRuleDefinition,
  createStar,
  createStringLiteral,
  createTransformDefinition,
  createTransformFunction,
  createTransformParameter,
  createTransformReturnType,
  createTransformSet,
} from "./types";

const plainOptions = { includeImports: false, includeTypes: false };

describe("action label presence", () => {
  it("collects possible and required labels through repeated groups", () => {
    const pattern = createGroup(
      createGroup(
        createChoice([
          createGroup(
            createGroup(
              createSequence([
                createLabeledExpression("shared", createStringLiteral("a")),
                createLabeledExpression("optional", createStringLiteral("b")),
              ]),
            ),
          ),
          createLabeledExpression("shared", createStringLiteral("c")),
        ]),
      ),
    );
    expect(collectTopLevelLabels(pattern)).toEqual(["shared", "optional"]);
    expect(collectRequiredTopLevelLabels(pattern)).toEqual(["shared"]);
    expect([pattern, pattern].map(collectTopLevelLabels)).toEqual([
      ["shared", "optional"],
      ["shared", "optional"],
    ]);
    const cyclic = createGroup(createStringLiteral("a"));
    cyclic.expression = cyclic;
    expect(() => collectTopLevelLabels(cyclic)).toThrow(/cyclic/i);
  });

  it("reads the requested own getter once and preserves positions", () => {
    let reads = 0;
    const value = {
      get chosen() {
        reads++;
        result.next = 2;
        return "a";
      },
      get unrelated(): never {
        throw new Error("Unrelated field must not be read");
      },
    };
    const result = { success: true as const, current: 0, next: 1, val: value };
    const start = compileStart(
      `export const start = ${wrapWithAction("externalParser", "return chosen;", ["chosen"], false)};`,
      { ...core, externalParser: () => result },
      combinator,
    );
    expect(start("ab", 0)).toEqual({
      success: true,
      val: "a",
      current: 0,
      next: 1,
    });
    expect(reads).toBe(1);
  });

  it("does not execute an inherited or non-enumerable getter for an absent label", () => {
    const value = Object.create({
      get chosen(): never {
        throw new Error("Inherited field must not be read");
      },
    }) as Record<string, unknown>;
    Object.defineProperty(value, "hidden", {
      get() {
        throw new Error("Hidden field must not be read");
      },
      enumerable: false,
    });
    const start = compileStart(
      `export const start = ${wrapWithAction("externalParser", "return [chosen, hidden];", ["chosen", "hidden"], false)};`,
      {
        ...core,
        externalParser: () => ({
          success: true,
          current: 0,
          next: 1,
          val: value,
        }),
      },
      combinator,
    );
    expect(start("a", 0)).toEqual({
      success: true,
      val: [undefined, undefined],
      current: 0,
      next: 1,
    });
  });
});
const generators = [
  ["base", generateTypeScriptParser],
  ["optimized", generateOptimizedTypeScriptParser],
] as const;

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

describe("generated code and standard global names", () => {
  for (const scope of ["rule", "subtree"] as const) {
    for (const repeat of [
      createStar,
      createPlus,
      (expr: Parameters<typeof createStar>[0]) => createQuantified(expr, 1, 3),
    ]) {
      it(`reconstructs fused repetition with rules named Array and globalThis (${scope}, ${repeat.name})`, () => {
        const grammar = createGrammarDefinition(
          "G",
          [],
          [
            createRuleDefinition(
              "start",
              repeat(
                createCharacterClass([
                  createCharRange("a"),
                  createCharRange("😀"),
                ]),
              ),
            ),
            createRuleDefinition("Array", createStringLiteral("x")),
            createRuleDefinition("globalThis", createStringLiteral("g")),
          ],
        );
        const generated = generateOptimizedTypeScriptParser(grammar, {
          ...plainOptions,
          enableRegexFusion: true,
          regexFusionScope: scope,
        });
        expect(generated.code).toContain("regexFusedMap(");
        const start = compileStart(generated.code, core, combinator);
        expect(start("a😀a", 0)).toEqual({
          success: true,
          val: ["a", "😀", "a"],
          current: 0,
          next: 4,
        });
      });
    }
  }

  it.each(["Map", "performance", "console"])(
    "monitors and reports with a rule named %s",
    (name) => {
      const grammar = createGrammarDefinition(
        "G",
        [],
        [
          createRuleDefinition("start", createIdentifier(name)),
          createRuleDefinition(name, createStringLiteral("a")),
        ],
      );
      const generated = generateOptimizedTypeScriptParser(grammar, {
        ...plainOptions,
        includeMonitoring: true,
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const start = compileStart(
          `${generated.code}\nperformanceMonitor.report();`,
          core,
          combinator,
        );
        expect(start("a", 0).success).toBe(true);
        expect(start("z", 0).success).toBe(false);
        expect(log).toHaveBeenCalledWith("Parser Performance Report:");
      } finally {
        log.mockRestore();
      }
    },
  );

  for (const [label, generate] of generators) {
    it.each([
      ["BigInt", "return 1n;"],
      ["cyclic object", "const value = {}; value.self = value; return value;"],
      [
        "throwing toJSON",
        'return { toJSON() { throw new Error("Serialization failed"); } };',
      ],
    ])(
      `preserves transform failures when captures contain %s (${label})`,
      (_kind, actionCode) => {
        const start = compileStart(
          generate(
            transformGrammar("value", "typescript", actionCode),
            plainOptions,
          ).code,
          core,
          combinator,
        );
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

    it(`returns a transform failure with a rule named JSON (${label})`, () => {
      const start = compileStart(
        generate(transformGrammar("JSON"), plainOptions).code,
        core,
        combinator,
      );
      expect(start("a", 0)).toMatchObject({
        success: false,
        error: { message: "Rejected", found: '"a"', pos: 0 },
      });
    });

    it(`rejects a globalThis binding needed by transform diagnostics (${label})`, () => {
      expect(() =>
        generate(transformGrammar("globalThis"), plainOptions),
      ).toThrow(/globalThis/);
      expect(() =>
        generate(transformGrammar("This"), {
          ...plainOptions,
          namePrefix: "global",
        }),
      ).toThrow(/globalThis/);
      const prefixed = generate(transformGrammar("globalThis"), {
        ...plainOptions,
        namePrefix: "g_",
      });
      const start = compileStart(
        prefixed.code.replace(/\bg_start\b/g, "start"),
        core,
        combinator,
      );
      expect(start("a", 0).success).toBe(false);
    });

    it(`accepts globalThis when only an unused language transform exists (${label})`, () => {
      const start = compileStart(
        generate(transformGrammar("globalThis", "python"), plainOptions).code,
        core,
        combinator,
      );
      expect(start("a", 0).success).toBe(true);
    });
  }

  it("rejects a globalThis binding needed by monitoring", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [createRuleDefinition("globalThis", createStringLiteral("a"))],
    );
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, {
        ...plainOptions,
        includeMonitoring: true,
      }),
    ).toThrow(/globalThis/);
  });
});

describe("generated transform input access", () => {
  function compileTransform(body: string, result: core.ParseSuccess<string>) {
    const transform = createTransformFunction(
      "start",
      [createTransformParameter("captures", "string")],
      createTransformReturnType("Result", "string"),
      body,
    );
    return compileStart(
      `export const start = ${wrapWithTransform("start", "externalParser", transform)};`,
      { ...core, externalParser: () => result },
      combinator,
    );
  }

  it("captures positions before reading the transform input", () => {
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
    const start = compileTransform(
      "return { success: true, value: captures };",
      result,
    );
    expect(start("abc", 0)).toEqual({
      success: true,
      val: "original",
      current: 0,
      next: 1,
    });
    expect(reads).toBe(1);
  });

  it("reads the transform input once and uses that value in rejection diagnostics", () => {
    let reads = 0;
    const result: core.ParseSuccess<string> = {
      success: true,
      current: 0,
      next: 1,
      get val() {
        return ++reads === 1 ? "original" : "different";
      },
    };
    const start = compileTransform(
      "return { success: false, error: captures };",
      result,
    );
    expect(start("abc", 0)).toMatchObject({
      success: false,
      error: { message: "original", pos: 0, found: '"original"' },
    });
    expect(reads).toBe(1);
  });
});
