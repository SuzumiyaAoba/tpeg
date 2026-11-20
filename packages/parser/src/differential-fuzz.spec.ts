import { describe, expect, it } from "vite-plus/test";
import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import { type GeneratedCode, generateTypeScriptParser } from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { compileStart } from "./differential-fuzz";
import {
  createActionExpression,
  createGrammarDefinition,
  createIdentifier,
  createRuleDefinition,
  createStringLiteral,
} from "./types";

async function nativeStart({
  code,
  imports,
}: Pick<GeneratedCode, "code" | "imports">): Promise<core.Parser<unknown>> {
  const originalImports = imports.join("\n");
  if (!code.startsWith(originalImports)) {
    throw new Error("Generated import block is not at the start of the module");
  }
  // Resolve only the generator's actual import block. Action literals,
  // templates, property names and comments must remain byte-for-byte intact.
  const resolvedImports = imports.map((line) =>
    line
      .replace(
        '"@suzumiyaaoba/tpeg-core"',
        JSON.stringify(
          new URL("../../core/dist/index.js", import.meta.url).href,
        ),
      )
      .replace(
        '"@suzumiyaaoba/tpeg-combinator"',
        JSON.stringify(
          new URL("../../combinator/dist/index.js", import.meta.url).href,
        ),
      ),
  );
  const source =
    resolvedImports.join("\n") + code.slice(originalImports.length);
  const module = await import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  return module.start as core.Parser<unknown>;
}

describe("generated parser execution matches native modules", () => {
  for (const [label, generate] of [
    ["base", generateTypeScriptParser],
    ["optimized", generateOptimizedTypeScriptParser],
  ] as const) {
    it.each(["parse", "map", "number", "constructor", "toString", "__proto__"])(
      `allows an unreferenced helper's name as a rule: %s (${label})`,
      async (name) => {
        const grammar = createGrammarDefinition(
          "G",
          [],
          [
            createRuleDefinition("start", createIdentifier(name)),
            createRuleDefinition(name, createStringLiteral("a")),
          ],
        );
        const expected = await nativeStart(
          generate(grammar, { includeTypes: false }),
        );
        const start = compileStart(
          generate(grammar, { includeImports: false, includeTypes: false })
            .code,
          core,
          combinator,
        );
        expect(start("a", 0)).toEqual(expected("a", 0));
      },
    );

    it.each([
      ["module this", "return this === undefined;"],
      [
        "plain function this",
        "return (function () { return this === undefined; })();",
      ],
      [
        "export-like template text",
        'return `raw\nexport const fake = "text";\nexport { fake as start };\nexport { performanceMonitor };`;',
      ],
      ["export-like quoted text", "return 'raw\\\nexport const fake = 1;';"],
      ["direct eval of captures", 'const key = "$" + "$"; return eval(key);'],
      ["escaped capture identifier", "return \\u0024\\u0024;"],
      ["module arguments", "return typeof arguments;"],
      ["module arguments through eval", 'return eval("typeof arguments");'],
      [
        "arguments in a nested ordinary function",
        'return (function (value) { return arguments[0]; })("own argument");',
      ],
      [
        "new.target in an ordinary constructor",
        "function Own() { this.correct = new.target === Own; } return new Own().correct;",
      ],
      [
        "hidden loader locals",
        "return [typeof code, typeof scope, typeof factory, typeof compileFactory, typeof evaluateGeneratedModule];",
      ],
      [
        "hidden evaluator bindings through eval",
        'return eval("[typeof nativeRequire, typeof nativeEvaluator, typeof sourceKey, typeof evaluator]");',
      ],
      [
        "local helper name reassignment",
        "let literal = 7; literal += 1; return literal;",
      ],
      [
        "short-circuit helper assignment",
        "literal ||= undefined; literal ??= undefined; return typeof literal;",
      ],
      [
        "hidden binding implementation",
        'return eval("[typeof bind, typeof values, typeof stagedValues, typeof withEvaluationValue, typeof getGlobal]");',
      ],
      ["core package literal", 'return "@suzumiyaaoba/tpeg-core";'],
      ["Unicode action literal", 'return "日本語😀";'],
      ["combinator package literal", 'return "@suzumiyaaoba/tpeg-combinator";'],
      ["core package property", 'return { "@suzumiyaaoba/tpeg-core": $$ };'],
      [
        "combinator package property",
        'return { "@suzumiyaaoba/tpeg-combinator": $$ };',
      ],
      [
        "core import-like template text",
        'return `import { literal } from "@suzumiyaaoba/tpeg-core";`;',
      ],
      [
        "combinator import-like template text",
        'return `import { memoize } from "@suzumiyaaoba/tpeg-combinator";`;',
      ],
      [
        "package in a RegExp constructor",
        'return new RegExp("@suzumiyaaoba/tpeg-core").source;',
      ],
      [
        "package in function-source comments",
        'return (() => { /* "@suzumiyaaoba/tpeg-core" */ return $$; }).toString();',
      ],
    ])(`preserves %s (${label})`, async (_name, action) => {
      const grammar = createGrammarDefinition(
        "G",
        [],
        [
          createRuleDefinition(
            "start",
            createActionExpression(createStringLiteral("a"), action),
          ),
        ],
      );
      const expected = await nativeStart(
        generate(grammar, { includeTypes: false }),
      );
      const start = compileStart(
        generate(grammar, { includeImports: false, includeTypes: false }).code,
        core,
        combinator,
      );
      expect(start("a", 0)).toEqual(expected("a", 0));
    });

    it.each([
      "literal = undefined; return $$;",
      'eval("literal = undefined"); return $$;',
      "({ literal } = { literal: undefined }); return $$;",
      "literal++; return $$;",
    ])(`preserves immutable helper bindings: %s (${label})`, async (action) => {
      const grammar = createGrammarDefinition(
        "G",
        [],
        [
          createRuleDefinition(
            "start",
            createActionExpression(createStringLiteral("a"), action),
          ),
        ],
      );
      const expected = await nativeStart(
        generate(grammar, { includeTypes: false }),
      );
      const start = compileStart(
        generate(grammar, { includeImports: false, includeTypes: false }).code,
        core,
        combinator,
      );
      expect(() => expected("a", 0)).toThrow(TypeError);
      expect(() => start("a", 0)).toThrow(TypeError);
    });

    it.each(["return arguments;", 'return eval("arguments");'])(
      `preserves unbound module arguments errors: %s (${label})`,
      async (action) => {
        const grammar = createGrammarDefinition(
          "G",
          [],
          [
            createRuleDefinition(
              "start",
              createActionExpression(createStringLiteral("a"), action),
            ),
          ],
        );
        const expected = await nativeStart(
          generate(grammar, { includeTypes: false }),
        );
        const start = compileStart(
          generate(grammar, { includeImports: false, includeTypes: false })
            .code,
          core,
          combinator,
        );
        expect(() => expected("a", 0)).toThrow(ReferenceError);
        expect(() => start("a", 0)).toThrow(ReferenceError);
      },
    );

    it(`rejects module-level new.target (${label})`, async () => {
      const grammar = createGrammarDefinition(
        "G",
        [],
        [
          createRuleDefinition(
            "start",
            createActionExpression(
              createStringLiteral("a"),
              "return new.target;",
            ),
          ),
        ],
      );
      await expect(
        nativeStart(generate(grammar, { includeTypes: false })),
      ).rejects.toThrow(SyntaxError);
      expect(() =>
        compileStart(
          generate(grammar, { includeImports: false, includeTypes: false })
            .code,
          core,
          combinator,
        ),
      ).toThrow(SyntaxError);
    });
  }
});
