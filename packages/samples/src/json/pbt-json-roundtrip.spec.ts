/**
 * Property-based (`fast-check`) round-trip fuzzing for `jsonParser()` --
 * this repo's `pbt-*.spec.ts` convention (see
 * `packages/core/src/pbt-invariants.spec.ts`'s module doc comment) had so
 * far only reached `tpeg-core`/`tpeg-combinator`/`tpeg-parser`/
 * `tpeg-type-inference`; this extends it to `tpeg-samples`, whose hand-
 * written parsers had no property-based coverage at all -- only
 * `json.spec.ts`'s fixed example strings.
 *
 * The property: for any JS value built from JSON's own value grammar,
 * `jsonParser()` must parse `JSON.stringify(value)` back to a value deeply
 * equal to the original -- checked against the CUSTOM TPEG parser
 * specifically (calling it directly, bypassing `parseJSON`'s `JSON.parse`
 * fast path -- see `json.ts`'s `parseJSON`, which only ever reaches the
 * custom parser when `JSON.parse` itself rejects the input, so a value
 * produced by `JSON.stringify` would never exercise `jsonParser()` through
 * that entry point).
 *
 * `SAFE_CHARS` covers the full C0 control range (U+0000-U+001F, which
 * `JSON.stringify` emits as `\n \r \t \b \f` where it has a short alias and
 * `\u00XX` otherwise) plus printable ASCII and a handful of ordinary
 * multi-byte code points (emoji, accented Latin, Japanese) that
 * `JSON.stringify` never escapes at all -- deliberately exercising
 * `quotedString`'s `\uXXXX` decoding (`packages/combinator/src/string.ts`'s
 * `unicodeEscape`, tried before the plain single-character `escapeSeq`
 * switch), not just the short aliases.
 */

import { describe, expect, it } from "vite-plus/test";
import fc from "fast-check";
import { jsonParser } from "./json";
import type { JSONValue } from "./json";

const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
// Deliberately not the same fixed default as
// `packages/type-inference/src/pbt-invariants.spec.ts` -- see
// `packages/generator/src/eta-differential.spec.ts`'s `SEED` doc comment
// for why two fuzz files shouldn't share a seed (so a fixed-seed run of
// each explores different generated values, not the same ones twice).
const FC_PARAMS = { seed: 20260909, numRuns: 200 * FUZZ_SCALE };

const SAFE_CHARS = [
  // U+0000-U+001F: JSON.stringify emits most of these as `\u00XX`, decoded
  // by `unicodeEscape`; `\n \r \t \b \f` get a short alias instead, decoded
  // by `escapeSeq`'s switch. Both paths are exercised by including the
  // whole range rather than special-casing the five aliased ones out.
  ...Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i)),
  ...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) =>
    String.fromCharCode(0x20 + i),
  ),
  "あ",
  "日",
  "é",
  "🎉",
];
const safeStringArb = fc.string({
  unit: fc.constantFrom(...SAFE_CHARS),
  maxLength: 8,
});

const numberArb = fc
  .double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 })
  .map((n) => (Object.is(n, -0) ? 0 : n));

const { jsonValue } = fc.letrec<{ jsonValue: JSONValue }>((tie) => ({
  jsonValue: fc.oneof(
    { maxDepth: 3, depthIdentifier: "tpeg-json-pbt-value" },
    fc.constant(null),
    fc.boolean(),
    numberArb,
    safeStringArb,
    fc.array(tie("jsonValue"), { maxLength: 4 }),
    fc.dictionary(safeStringArb, tie("jsonValue"), { maxKeys: 4 }),
  ),
}));

describe("jsonParser() round-trip (fast-check), generalized from json.spec.ts's fixed examples", () => {
  it("parses JSON.stringify(value) back to a value deeply equal to the original", () => {
    const parser = jsonParser();
    fc.assert(
      fc.property(jsonValue, (value) => {
        const input = JSON.stringify(value);
        const result = parser(input, 0);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toEqual(value);
        }
      }),
      FC_PARAMS,
    );
  });

  // `JSON.stringify(value)` alone emits no whitespace at all, so the plain
  // round-trip above never exercises `token`/`skipWhitespace` (or whatever
  // `commaSeparated` does around its separators) inside the array/object
  // parsers. Indenting adds only spaces and newlines between tokens -- no
  // new escapes -- so this is the cheap way to cover that path without a
  // second value generator.
  it("parses an indented JSON.stringify(value, null, 2) back to a value deeply equal to the original", () => {
    const parser = jsonParser();
    fc.assert(
      fc.property(jsonValue, (value) => {
        const input = JSON.stringify(value, null, 2);
        const result = parser(input, 0);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toEqual(value);
        }
      }),
      FC_PARAMS,
    );
  });
});
