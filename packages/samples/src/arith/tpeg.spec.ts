import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { tpegModuleFile } from "@suzumiyaaoba/tpeg-parser";
import { describe, expect, it } from "vite-plus/test";
import { generatedSource, loadGrammar } from "../tpeg-utils";
import { parseToAST } from "./calculator";
import { parseToASTTpeg } from "./tpeg";

/**
 * `.tpeg` twin of the arithmetic sample.
 *
 * `arith.tpeg` expresses the same grammar as calculator.ts; the
 * committed `generated/arith.generated.ts` is what
 * `generateTypeScriptParser` emits from it. These tests check the
 * grammar parses cleanly, the committed output is current, and the
 * generated parser agrees with the hand-written one on a corpus.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR_PATH = join(HERE, "arith.tpeg");
const GENERATED_PATH = join(HERE, "generated", "arith.generated.ts");

// Result-or-error, so agreement on REJECTION is compared too. Error
// messages differ between implementations -- only the ok flag and the
// value (when both succeed) are asserted equal.
const attempt = (fn: (input: string) => unknown, input: string) => {
  try {
    return { ok: true, val: fn(input) } as const;
  } catch {
    return { ok: false } as const;
  }
};

describe("arith .tpeg twin", () => {
  describe("grammar", () => {
    it("parses and consumes the whole file", () => {
      const source = readFileSync(GRAMMAR_PATH, "utf8");
      const result = parse(tpegModuleFile)(source);
      expect(result.success).toBe(true);
    });

    it("committed generated file is current -- regenerate with `bun run regen`", () => {
      expect(readFileSync(GENERATED_PATH, "utf8")).toBe(
        generatedSource(loadGrammar(GRAMMAR_PATH)),
      );
    });
  });

  describe("generated parser agrees with calculator.ts", () => {
    const corpus = [
      // valid: numbers, precedence, parens, signs, whitespace
      "42",
      "3.14",
      "1 + 2 * 3",
      "(1 + 2) * 3",
      "2 * (3 + 1)",
      "10 % 3",
      "10 / 4",
      "-5 + 3",
      "+5 - 3",
      "- 5",
      "5 - -3",
      "((1 + 2) * 3 - 4) / 2",
      "  1\n +\t2  ",
      "1",
      // invalid: trailing garbage, unbalanced, unsupported shapes
      "1 +",
      "(1 + 2",
      "-(2 + 3)",
      "1 . 5",
      "1 2",
      "abc",
      "",
      "* 3",
    ];

    for (const input of corpus) {
      it(`${JSON.stringify(input)}`, () => {
        const gen = attempt(parseToASTTpeg, input);
        const hw = attempt(parseToAST, input);

        expect(gen.ok).toBe(hw.ok);
        if (gen.ok && hw.ok) {
          expect(gen.val).toEqual(hw.val);
        }
      });
    }
  });
});
