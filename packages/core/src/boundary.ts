/**
 * Word-boundary assertion parsers.
 *
 * Zero-width primitives behind the `\b` / `\B` expression-level syntax
 * (`WordBoundary` in `grammar-types.ts`): they consume no input and
 * succeed exactly when the character immediately before the current
 * position and the character immediately after it differ in word-ness
 * (`\b`), or agree in word-ness (`\B`). A "word character" is the ASCII
 * regex set `[A-Za-z0-9_]`, matching JavaScript `\b`/`\B` semantics --
 * including the rule that both start-of-input and end-of-input count as
 * non-word positions (so `\b` succeeds at offset 0 when `input[0]` is a
 * word character, and at `input.length` when the last character is).
 */

import { fail } from "./failure";
import type { Expectation } from "./failure";
import type { Parser } from "./types";
import { isValidOffset } from "./utils";

/**
 * `true` iff the UTF-16 code unit is an ASCII word character
 * (`[A-Za-z0-9_]` -- the JavaScript `\w` set). Called per code unit:
 * a surrogate pair's lead or trail unit is never a word character,
 * which matches how JS regexes treat astral characters for `\b`.
 */
export const isWordChar = (codeUnit: number): boolean =>
  (codeUnit >= 48 && codeUnit <= 57) || // 0-9
  (codeUnit >= 65 && codeUnit <= 90) || // A-Z
  codeUnit === 95 || // _
  (codeUnit >= 97 && codeUnit <= 122); // a-z

/**
 * `true` iff `pos` in `input` sits on a word boundary: exactly one of
 * the characters immediately before and after `pos` is a word
 * character. Out-of-input positions (`pos === 0`'s "before", `pos ===
 * input.length`'s "after") count as non-word.
 */
const isAtWordBoundary = (input: string, pos: number): boolean => {
  const beforeIsWord = pos > 0 && isWordChar(input.charCodeAt(pos - 1));
  const afterIsWord = pos < input.length && isWordChar(input.charCodeAt(pos));
  return beforeIsWord !== afterIsWord;
};

const wordBoundaryParser =
  (negated: boolean, expectation: Expectation): Parser<undefined> =>
  (input: string, pos: number) => {
    // A zero-width assertion still requires a valid offset -- `pos`
    // equal to `input.length` is legal (the boundary check handles it),
    // but a negative/fractional/past-end offset is out of contract, the
    // same guard every leaf parser applies (`./utils.ts`).
    if (!isValidOffset(pos) || pos > input.length) {
      return fail(input, pos, expectation);
    }

    if (isAtWordBoundary(input, pos) === negated) {
      return fail(input, pos, expectation);
    }

    return { success: true, val: undefined, current: pos, next: pos };
  };

/**
 * `\b` -- succeeds (consuming nothing) when the current position is a
 * word boundary: a word character on exactly one side. Fails when both
 * neighbors are word characters or both are non-word/absent.
 */
export const wordBoundary: Parser<undefined> = wordBoundaryParser(false, {
  label: "word boundary",
  parserName: "wordBoundary",
});

/**
 * `\B` -- succeeds (consuming nothing) when the current position is NOT
 * a word boundary: both neighbors are word characters, or both are
 * non-word/absent.
 */
export const nonWordBoundary: Parser<undefined> = wordBoundaryParser(true, {
  label: "non-word-boundary position",
  parserName: "nonWordBoundary",
});
