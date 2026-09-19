import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { tpegModuleFile } from "@suzumiyaaoba/tpeg-parser";
import { describe, expect, it } from "vite-plus/test";
import { generatedSource, loadGrammar } from "../tpeg-utils";
import { parseCSV } from "./csv";
import { parseCSVTpeg } from "./tpeg";

/**
 * `.tpeg` twin of the CSV sample.
 *
 * `csv.tpeg` expresses the same grammar as csv.ts; the committed
 * `generated/csv.generated.ts` is what `generateTypeScriptParser`
 * emits from it. These tests check the grammar parses cleanly, the
 * committed output is current, and the generated parser agrees with
 * the hand-written one on a corpus.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR_PATH = join(HERE, "csv.tpeg");
const GENERATED_PATH = join(HERE, "generated", "csv.generated.ts");

const attempt = (fn: (input: string) => unknown, input: string) => {
  try {
    return { ok: true, val: fn(input) } as const;
  } catch {
    return { ok: false } as const;
  }
};

describe("csv .tpeg twin", () => {
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

  describe("generated parser agrees with csv.ts", () => {
    const corpus = [
      // valid: plain rows, quoting, escapes, line endings, edges
      "a,b,c",
      "name,age\nJohn,30\nJane,25",
      'x,"a,b",y',
      '"say ""hi""",ok',
      '"line1\nline2",z',
      "a,b\r\nc,d\r\n",
      "a,b\rc,d\r",
      "a,b\n",
      "a,b\n\n",
      ",,",
      '"",""',
      "a,,b",
      " padded , fields ",
      "single",
      "",
      '"quoted at eof"',
      // invalid: unterminated quote, stray quote mid-field
      '"unterminated',
      'a,"b',
      'a,b\nc,"d',
      'trailing"junk',
    ];

    for (const input of corpus) {
      it(`${JSON.stringify(input)}`, () => {
        const gen = attempt(parseCSVTpeg, input);
        const hw = attempt(parseCSV, input);

        expect(gen.ok).toBe(hw.ok);
        if (gen.ok && hw.ok) {
          expect(gen.val).toEqual(hw.val);
        }
      });
    }
  });
});
