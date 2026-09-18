/**
 * Property-based (`fast-check`) round-trip tests for `escapeStringLiteral`
 * in `escape.ts` -- see `pbt-invariants.spec.ts`'s module doc comment for
 * the shared rationale behind this repo's `pbt-*.spec.ts` files.
 *
 * `utils.spec.ts` pins the escape table with fixed examples (quotes,
 * control characters, lone surrogates) but never checks the property that
 * actually matters to its callers: `escapeStringLiteral` exists to embed
 * an arbitrary string -- which can come from a grammar file's string
 * literal or a char-class bound, and can therefore contain lone
 * surrogates via `\uXXXX` escapes -- into generated TypeScript source as
 * a double-quoted literal. For EVERY possible input string, the escaped
 * output must (a) re-evaluate to the identical string when a JS engine
 * parses it as a `"..."` literal, and (b) itself be well-formed UTF-16 --
 * a raw lone surrogate in generated source can't be written to disk as
 * UTF-8 (`fs.writeFile` would throw or silently emit U+FFFD), so the
 * generated file would either fail to write or decode to a parser that
 * matches the wrong character.
 *
 * `fc.string({ unit: "binary" })` generates arbitrary UTF-16 code-unit
 * sequences -- including unpaired surrogates and NUL -- which is exactly
 * the domain `escapeStringLiteral` must cover.
 */

import { describe, expect, it } from "vite-plus/test";
import fc from "fast-check";
import { escapeStringLiteral } from "./escape";

const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const FC_PARAMS = { seed: 20260821, numRuns: 300 * FUZZ_SCALE };

// Any UTF-16 code-unit sequence -- `binary` units deliberately include
// unpaired surrogates, which is precisely the case `escapeStringLiteral`
// must escape rather than emit raw.
const utf16Arb = fc.string({ unit: "binary", maxLength: 32 });

// True iff `s` is well-formed UTF-16: every lead surrogate is immediately
// followed by a trail surrogate and no trail surrogate appears alone.
const isWellFormedUtf16 = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      // `charCodeAt` past the end is NaN, which fails both range checks
      // below -- NaN must count as unpaired, hence the negated range test.
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
};

// Re-parse the escaped text the way generated-code consumers do: embed it
// verbatim inside a double-quoted string literal and evaluate it.
const evaluateEscapedLiteral = (escaped: string): unknown =>
  new Function(`"use strict"; return "${escaped}"`)();

describe("escapeStringLiteral (fast-check)", () => {
  it("re-evaluates to the identical string for arbitrary UTF-16 input", () => {
    fc.assert(
      fc.property(utf16Arb, (value) => {
        expect(evaluateEscapedLiteral(escapeStringLiteral(value))).toBe(value);
      }),
      FC_PARAMS,
    );
  });

  it("never emits a lone surrogate -- the output is always well-formed UTF-16 and survives a UTF-8 encode/decode round trip", () => {
    fc.assert(
      fc.property(utf16Arb, (value) => {
        const escaped = escapeStringLiteral(value);
        expect(isWellFormedUtf16(escaped)).toBe(true);
        expect(Buffer.from(escaped, "utf8").toString("utf8")).toBe(escaped);
      }),
      FC_PARAMS,
    );
  });
});
