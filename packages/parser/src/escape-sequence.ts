/**
 * Shared escape-sequence parsers for TPEG grammar syntax
 *
 * Used by `string-literal.ts` (characters inside `"..."`/`'...'`) and
 * `character-class.ts` (characters inside `[...]`) so both contexts
 * accept the exact same set of escapes -- previously the two drifted:
 * `[\b]` worked where `"\b"` was a syntax error, and no numeric escape
 * (`\xNN`, `\uXXXX`, `\u{...}`) existed anywhere.
 *
 * Unified escape set:
 * - Named: `\n` `\r` `\t` `\b` `\f` `\v` `\0`
 * - Hex byte: `\xNN` (exactly two hex digits)
 * - BMP code point: `\uXXXX` (exactly four hex digits)
 * - Code point: `\u{X...}` (1-6 hex digits, value <= 0x10FFFF)
 * - Literal escapes: context-specific (`\"` `\'` `\\` in strings;
 *   `\]` `\\` `\^` `\-` `\"` `\'` in classes)
 */

import type { NonEmptyArray, Parser } from "@suzumiyaaoba/tpeg-core";
import {
  charClass,
  choice,
  createFailure,
  isValidOffset,
  literal,
  map,
  seq,
} from "@suzumiyaaoba/tpeg-core";

/**
 * Decoded value of each single-letter named escape.
 */
const NAMED_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

/**
 * `\n` `\r` `\t` `\b` `\f` `\v` `\0` -- identical in every context.
 */
export const namedEscapeSequence: Parser<string> = map(
  seq(literal("\\"), charClass("n", "r", "t", "b", "f", "v", "0")),
  ([_, char]) => NAMED_ESCAPES[char] ?? char,
);

const isHexDigit = (char: string | undefined): boolean =>
  char !== undefined && /[0-9a-fA-F]/.test(char);

const UNICODE_MAX = 0x10ffff;

/**
 * `\xNN` `\uXXXX` `\u{X...}` -- byte and code-point escapes. Written as a
 * hand parser rather than combinators because the prefix commits: once
 * `\x` or `\u{` has matched, a malformed body is a hard (fatal+abort)
 * syntax error rather than a generic "expected a character" miss -- the
 * same "clearly an attempted X" reasoning as `charRange`'s `[z-a]`
 * rejection in `./character-class.ts`. Returns a single code point as a
 * one-code-point string (astral values survive as a surrogate pair,
 * exactly like a raw astral character in the source).
 */
export const numericEscapeSequence: Parser<string> = (input, pos) => {
  if (!isValidOffset(pos) || pos > input.length) {
    return createFailure("Expected a valid position", pos, {
      parserName: "numericEscapeSequence",
    });
  }
  if (input[pos] !== "\\") {
    return createFailure('Expected "\\"', pos, {
      parserName: "numericEscapeSequence",
    });
  }
  const kind = input[pos + 1];
  if (kind !== "x" && kind !== "u") {
    return createFailure("Expected an escape sequence", pos, {
      parserName: "numericEscapeSequence",
    });
  }

  const fail = (message: string, failPos: number) =>
    createFailure(message, failPos, {
      parserName: "numericEscapeSequence",
      fatal: true,
      abort: true,
    });

  // \xNN -- exactly two hex digits.
  if (kind === "x") {
    const h1 = input[pos + 2];
    const h2 = input[pos + 3];
    if (!isHexDigit(h1) || !isHexDigit(h2)) {
      return fail(
        `Invalid escape sequence: \\x requires exactly two hex digits`,
        pos,
      );
    }
    return {
      success: true,
      val: String.fromCodePoint(parseInt(`${h1}${h2}`, 16)),
      current: pos,
      next: pos + 4,
    };
  }

  // \u{...} -- 1-6 hex digits inside braces, code point <= U+10FFFF.
  if (input[pos + 2] === "{") {
    let i = pos + 3;
    let digits = "";
    while (i < input.length && isHexDigit(input[i]) && digits.length < 7) {
      digits += input[i] as string;
      i++;
    }
    if (digits.length === 0 || digits.length > 6 || input[i] !== "}") {
      return fail(
        'Invalid escape sequence: \\u{...} requires 1-6 hex digits and a closing "}"',
        pos,
      );
    }
    const codePoint = parseInt(digits, 16);
    if (codePoint > UNICODE_MAX) {
      return fail(
        `Invalid Unicode code point: \\u{${digits}} is above U+10FFFF`,
        pos,
      );
    }
    return {
      success: true,
      val: String.fromCodePoint(codePoint),
      current: pos,
      next: i + 1,
    };
  }

  // \uXXXX -- exactly four hex digits.
  const digits = input.slice(pos + 2, pos + 6);
  if (
    digits.length < 4 ||
    !(
      isHexDigit(digits[0]) &&
      isHexDigit(digits[1]) &&
      isHexDigit(digits[2]) &&
      isHexDigit(digits[3])
    )
  ) {
    return fail(
      `Invalid escape sequence: \\u requires exactly four hex digits`,
      pos,
    );
  }
  return {
    success: true,
    val: String.fromCodePoint(parseInt(digits, 16)),
    current: pos,
    next: pos + 6,
  };
};

/**
 * `\\c` where `c` is one of `chars` -- the context-specific literal
 * escapes (a `"` inside `"..."` needs one; a `-` or `]` inside `[...]`
 * needs one; `\\` itself appears in both lists).
 */
export const literalEscapeSequence = (
  chars: NonEmptyArray<string>,
): Parser<string> =>
  map(seq(literal("\\"), charClass(...chars)), ([_, char]) => char);

/**
 * The full unified escape: named + numeric + the caller's literal set.
 * `numericEscapeSequence` is tried before `literalEscapeSequence` so a
 * literal set that happens to contain `x`/`u` cannot shadow the numeric
 * forms (neither context's set does today, but the order keeps that
 * from ever becoming a silent bug).
 */
export const unifiedEscapeSequence = (
  literalChars: NonEmptyArray<string>,
): Parser<string> =>
  choice(
    namedEscapeSequence,
    numericEscapeSequence,
    literalEscapeSequence(literalChars),
  );
