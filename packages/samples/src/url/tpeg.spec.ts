import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { tpegModuleFile } from "@suzumiyaaoba/tpeg-parser";
import { describe, expect, it } from "vite-plus/test";
import { generatedSource, loadGrammar } from "../tpeg-utils";
import { parseUrl } from "./url";
import { parseUrlTpeg } from "./tpeg";

/**
 * `.tpeg` twin of the URL sample.
 *
 * `url.tpeg` expresses the same grammar as url.ts; the committed
 * `generated/url.generated.ts` is what `generateTypeScriptParser`
 * emits from it. These tests check the grammar parses cleanly, the
 * committed output is current, and the generated parser agrees with
 * the hand-written one on a corpus.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR_PATH = join(HERE, "url.tpeg");
const GENERATED_PATH = join(HERE, "generated", "url.generated.ts");

const attempt = (fn: (input: string) => unknown, input: string) => {
  try {
    return { ok: true, val: fn(input) } as const;
  } catch {
    return { ok: false } as const;
  }
};

describe("url .tpeg twin", () => {
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

  describe("generated parser agrees with url.ts", () => {
    const corpus = [
      // valid: full and partial component combinations
      "https://example.com",
      "https://user@example.com:8443/a/b?x=1&y=2#top",
      "http://host:80/",
      "ftp://h",
      "a://u:p@h:1/p?q#f",
      "x+y.z://h",
      "mailto:user@example.com",
      "tel:+1234",
      "scheme:opaque/path?query#frag",
      "s://h/",
      "s://h?only-query",
      "s://h#only-frag",
      "s:path#frag?order",
      "s:?q",
      "s:#f",
      "s:",
      // invalid: the rejections the `~` cut preserves
      "x://host:abc", // non-numeric port -- committed, no fallback
      "x://",
      "x://u@",
      "x://h:8x",
      "://no-scheme",
      "1abc://h", // scheme must start with ALPHA
      "not a url",
      "s://h w",
      "s://h/p x",
      "",
      "s://h:80:90",
    ];

    for (const input of corpus) {
      it(`${JSON.stringify(input)}`, () => {
        const gen = attempt(parseUrlTpeg, input);
        const hw = attempt(parseUrl, input);

        expect(gen.ok).toBe(hw.ok);
        if (gen.ok && hw.ok) {
          expect(gen.val).toEqual(hw.val);
        }
      });
    }
  });
});
