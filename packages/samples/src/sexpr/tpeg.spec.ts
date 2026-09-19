import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { tpegModuleFile } from "@suzumiyaaoba/tpeg-parser";
import { describe, expect, it } from "vite-plus/test";
import { generatedSource, loadGrammar } from "../tpeg-utils";
import { parseSExprs, printSExp } from "./sexpr";
import { parseSExprTpeg, parseSExprsTpeg } from "./tpeg";

/**
 * `.tpeg` twin of the S-expression sample.
 *
 * `sexpr.tpeg` expresses the same grammar as sexpr.ts; the committed
 * `generated/sexpr.generated.ts` is what `generateTypeScriptParser`
 * emits from it. These tests check the grammar parses cleanly, the
 * committed output is current, and the generated parser agrees with
 * the hand-written one on a corpus.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR_PATH = join(HERE, "sexpr.tpeg");
const GENERATED_PATH = join(HERE, "generated", "sexpr.generated.ts");

const attempt = (fn: (input: string) => unknown, input: string) => {
  try {
    return { ok: true, val: fn(input) } as const;
  } catch {
    return { ok: false } as const;
  }
};

describe("sexpr .tpeg twin", () => {
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

  describe("generated parser agrees with sexpr.ts", () => {
    const corpus = [
      // valid: atoms, lists, nesting, quote, comments, strings
      "x",
      "42",
      "-3.14",
      "+7",
      '"hello"',
      '"esc \\" \\\\ \\n \\t"',
      '"\\u0041"',
      '"permissive \\q escape"',
      "(a b c)",
      "()",
      "(define (f x) (+ x 1))",
      "((nested (deeply (1 2) 3)) end)",
      "'x",
      "'(a b)",
      "''x",
      "x (y) ; trailing comment",
      "; leading comment\nform",
      "foo;comment-after-symbol",
      'foo"bar"',
      "-5abc",
      "a'b",
      "  spaced  out  ",
      "one two three",
      "",
      "   ",
      // invalid: the edges both parsers reject
      "' x", // quote must be adjacent to its form
      "(",
      ")",
      "(a",
      "a)",
      '"unterminated',
      "(a . b)", // `.` is just a symbol here -- actually valid
    ];

    for (const input of corpus) {
      it(`${JSON.stringify(input)}`, () => {
        const gen = attempt(parseSExprsTpeg, input);
        const hw = attempt(parseSExprs, input);

        expect(gen.ok).toBe(hw.ok);
        if (gen.ok && hw.ok) {
          expect(gen.val).toEqual(hw.val);
        }
      });
    }
  });

  describe("exactly-one and round trip", () => {
    it("parseSExprTpeg enforces exactly one form", () => {
      expect(() => parseSExprTpeg("one two")).toThrow();
      expect(() => parseSExprTpeg("")).toThrow();
      expect(parseSExprTpeg("(a)")).toEqual(parseSExprs("(a)")[0]);
    });

    it("printSExp output re-parses identically under both parsers", () => {
      for (const input of ['(a (b 1) "c")', "'x", "(define f 42)"]) {
        const forms = parseSExprsTpeg(input);
        expect(forms.map(printSExp)).toEqual(parseSExprs(input).map(printSExp));
      }
    });
  });
});
