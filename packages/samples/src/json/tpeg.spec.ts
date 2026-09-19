import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { tpegModuleFile } from "@suzumiyaaoba/tpeg-parser";
import { describe, expect, it } from "vite-plus/test";
import { generatedSource, loadGrammar } from "../tpeg-utils";
import { parseJSON } from "./json";
import { parseJSONTpeg } from "./tpeg";

/**
 * `.tpeg` twin of the JSON sample.
 *
 * `json.tpeg` expresses the same strict grammar as json.ts's fallback
 * parser; the committed `generated/json.generated.ts` is what
 * `generateTypeScriptParser` emits from it. These tests check the
 * grammar parses cleanly, the committed output is current, and the
 * generated parser agrees with `parseJSON` on a corpus.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR_PATH = join(HERE, "json.tpeg");
const GENERATED_PATH = join(HERE, "generated", "json.generated.ts");

describe("json .tpeg twin", () => {
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

  describe("generated parser agrees with parseJSON", () => {
    // parseJSON returns `null` on failure -- no need to catch.
    const corpus = [
      // valid: every JSON type, nesting, escapes, whitespace
      "null",
      "true",
      "false",
      "0",
      "-1",
      "3.14",
      "1e10",
      "-2.5E-3",
      '"hello"',
      '"esc \\" \\\\ \\/ \\b \\f \\n \\r \\t"',
      '"\\u0041\\u00e9"',
      "[]",
      "{}",
      "[1, 2, 3]",
      '{"name": "John", "age": 30}',
      '{"a": {"b": [true, null, {"c": "x"}]}}',
      '  {  "spaced" : [ 1 , 2 ]  }  ',
      '{"__proto__": 1, "nested": {"__proto__": 2}}',
      '"unicode é中😀"',
      "123",
      // invalid: strict-JSON rejections both parsers share
      "007",
      "-01",
      "01",
      '"unterminated',
      '"bad \\x escape"',
      '"\\u12"',
      '{"a":1,}',
      "[1,]",
      "{a:1}",
      "'single'",
      "true xyz",
      "123abc",
      '{"a" 1}',
      "[1 2]",
      "",
      "   ",
    ];

    for (const input of corpus) {
      it(`${JSON.stringify(input)}`, () => {
        expect(parseJSONTpeg(input)).toEqual(parseJSON(input));
      });
    }
  });
});
