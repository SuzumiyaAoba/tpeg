import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type GrammarDefinition,
  type Parser,
  parse,
} from "@suzumiyaaoba/tpeg-core";
import {
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
  skipTrailingWhitespaceAndComments,
  tpegModuleFile,
} from "@suzumiyaaoba/tpeg-parser";
import { describe, expect, it } from "vite-plus/test";
import {
  expression,
  start as generatedStart,
  top,
} from "./generated/calc.generated";
import { start as optimizedStart } from "./generated/calc.optimized.generated";

// `import.meta.dir` is Bun-only -- derive the directory from
// `import.meta.url` so this spec also runs under the vitest runner.
const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR_PATH = join(HERE, "calc.tpeg");
const GENERATED_PATH = join(HERE, "generated", "calc.generated.ts");
const OPTIMIZED_PATH = join(HERE, "generated", "calc.optimized.generated.ts");

const loadGrammar = (): GrammarDefinition => {
  const source = readFileSync(GRAMMAR_PATH, "utf8");
  const result = parse(tpegModuleFile)(source);

  if (!result.success) {
    throw new Error(`calc.tpeg failed to parse: ${result.error.message}`);
  }

  const mod = result.val;
  return {
    type: "GrammarDefinition",
    name: mod.grammar.name,
    annotations: mod.grammar.annotations,
    rules: mod.grammar.rules,
    ...(mod.grammar.transforms !== undefined
      ? { transforms: mod.grammar.transforms }
      : {}),
  };
};

const asSource = (code: string): string =>
  code.endsWith("\n") ? code : `${code}\n`;

describe("codegen sample", () => {
  describe("grammar file", () => {
    it("parses and consumes the whole file", () => {
      const source = readFileSync(GRAMMAR_PATH, "utf8");
      const result = parse(tpegModuleFile)(source);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(skipTrailingWhitespaceAndComments(source, result.next)).toBe(
          source.length,
        );
      }
    });

    it("resolves @start to the top rule", () => {
      const grammar = loadGrammar();
      const start = grammar.annotations.find((a) => a.key === "start");

      expect(grammar.name).toBe("Calculator");
      expect(start?.value).toBe("top");
    });
  });

  describe("generation", () => {
    it("produces every rule plus the start alias", () => {
      const grammar = loadGrammar();
      const generated = generateTypeScriptParser(grammar, {});

      expect(generated.warnings).toEqual([]);
      expect(generated.exports).toEqual([
        "top",
        "expression",
        "term",
        "factor",
        "number",
        "add_op",
        "mul_op",
        "ws",
        "start",
      ]);
      expect(generated.code).toContain("export { top as start }");
    });

    it("committed generated files are current -- regenerate with `bun run codegen`", () => {
      // The generated/*.ts files are checked in so they are inspectable
      // and statically importable. If this test fails, codegen output
      // changed -- re-run the demo to refresh them.
      const grammar = loadGrammar();

      expect(readFileSync(GENERATED_PATH, "utf8")).toBe(
        asSource(generateTypeScriptParser(grammar, {}).code),
      );
      expect(readFileSync(OPTIMIZED_PATH, "utf8")).toBe(
        asSource(generateOptimizedTypeScriptParser(grammar, {}).code),
      );
    });
  });

  describe("generated parsers", () => {
    const cases: [string, number][] = [
      ["1", 1],
      ["1 + 2 * 3", 7],
      ["(1 + 2) * 3", 9],
      ["-5 + 3", -2],
      ["3.14 * 2", 6.28],
      ["10 / 4", 2.5],
      ["2 * (3 + 4) - 1", 13],
    ];

    const evaluate = (parser: Parser<unknown>, input: string) => {
      const result = parse(parser)(input);
      return result.success ? result.val : `ERR:${result.error.message}`;
    };

    for (const [input, expected] of cases) {
      it(`${JSON.stringify(input)} = ${expected}`, () => {
        expect(evaluate(generatedStart, input)).toBe(expected);
        expect(evaluate(optimizedStart, input)).toBe(expected);
      });
    }

    it("handles whitespace via @skip", () => {
      expect(evaluate(generatedStart, "  1\n +\t2  ")).toBe(3);
    });

    it("rejects malformed input instead of a silent prefix match", () => {
      for (const input of ["1 +", "(1 + 2", "1 . 5", "- 12", "1 2"]) {
        const result = parse(generatedStart)(input);
        expect(result.success).toBe(false);
      }
    });

    it("keeps @noskip rules lexical", () => {
      // `number` is @noskip: "- 12" must not skip whitespace between the
      // sign and the digits.
      expect(parse(generatedStart)("- 12").success).toBe(false);
      expect(evaluate(generatedStart, "-12")).toBe(-12);
    });

    it("exposes individual rules alongside the start alias", () => {
      // `start` is the @start alias for `top`; the mid-level rules are
      // also exported for callers that want a sub-grammar entry point.
      expect(evaluate(top, "4 * 5")).toBe(20);
      expect(evaluate(expression, "4 * 5")).toBe(20);
    });

    it("base and optimized generators agree on values", () => {
      const inputs = ["1 + 2 * 3", "(8 - 2) / 3", "-4.5 * 2 + 1"];
      for (const input of inputs) {
        expect(evaluate(optimizedStart, input)).toBe(
          evaluate(generatedStart, input),
        );
      }
    });
  });
});
