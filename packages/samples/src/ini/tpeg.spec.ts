import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { tpegModuleFile } from "@suzumiyaaoba/tpeg-parser";
import { describe, expect, it } from "vite-plus/test";
import { generatedSource, loadGrammar } from "../tpeg-utils";
import { formatINI, parseINI } from "./ini";
import { parseINITpeg } from "./tpeg";

/**
 * `.tpeg` twin of the INI sample.
 *
 * `ini.tpeg` expresses the same grammar as ini.ts; the committed
 * `generated/ini.generated.ts` is what `generateTypeScriptParser`
 * emits from it. These tests check the grammar parses cleanly, the
 * committed output is current, and the generated parser agrees with
 * the hand-written one on a corpus.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR_PATH = join(HERE, "ini.tpeg");
const GENERATED_PATH = join(HERE, "generated", "ini.generated.ts");

const attempt = (fn: (input: string) => unknown, input: string) => {
  try {
    return { ok: true, val: fn(input) } as const;
  } catch {
    return { ok: false } as const;
  }
};

describe("ini .tpeg twin", () => {
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

  describe("generated parser agrees with ini.ts", () => {
    const corpus = [
      // valid: globals, sections, comments, line endings, edges
      "host = example.com",
      "a=1",
      "key = value ; trailing comment",
      "key = value # hash comment",
      "; whole-line comment\nk = v",
      "# whole-line comment\nk = v",
      "password = a#b",
      "token = a;b",
      "[section]\nk = v",
      "g = 1\n[s]\na = 2\nb = 3",
      "[ s ]\nk = v",
      "[a] = b",
      "key=v\n[__proto__]\nx = 1",
      "__proto__ = data",
      "k = v\r\n[s]\ra = 1",
      "k = v", // no trailing newline
      "k = v\n", // trailing newline
      "   \n\t\nk = v", // blank lines
      "key   =   spaced",
      "empty =",
      "= value", // missing key -> invalid
      "[oops", // unclosed section -> invalid
      "[a]\n= 1", // empty key inside section -> invalid
      "k v", // no `=` -> invalid
      "k = v\njunk line", // malformed last line -> invalid
      "",
      "  \n\n",
    ];

    for (const input of corpus) {
      it(`${JSON.stringify(input)}`, () => {
        const gen = attempt(parseINITpeg, input);
        const hw = attempt(parseINI, input);

        expect(gen.ok).toBe(hw.ok);
        if (gen.ok && hw.ok) {
          expect(gen.val).toEqual(hw.val);
        }
      });
    }
  });

  describe("round trip", () => {
    it("formatINI output re-parses identically under both parsers", () => {
      const data = parseINI("g = 1\n[s]\na = 2\nb = 3\n");
      const text = formatINI(data);

      expect(parseINITpeg(text)).toEqual(parseINI(text));
      expect(parseINITpeg(text)).toEqual(data);
    });
  });
});
