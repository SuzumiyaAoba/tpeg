import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  any,
  charClass,
  choice,
  literal,
  map,
  not,
  oneOrMore,
  optional,
  seq,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import { labeled, withDetailedError } from "./error";

/**
 * Parser that matches a single whitespace character (space, tab, newline, carriage return).
 */
export const whitespace = charClass(" ", "\t", "\n", "\r");

/**
 * Parser that matches zero or more whitespace characters.
 */
export const spaces = map(zeroOrMore(whitespace), (chars) => chars.join(""));

/**
 * Creates a parser that automatically handles surrounding whitespace.
 *
 * Wraps a parser with automatic whitespace consumption before and after the main parser.
 * Useful for creating token-based parsers that ignore whitespace automatically.
 *
 * @template T Type of the parser result
 * @param parser The parser to apply
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T> A parser that handles surrounding whitespace automatically
 */
export const token = <T>(parser: Parser<T>, parserName?: string): Parser<T> => {
  const tokenParser = map(seq(spaces, parser, spaces), ([_, value]) => value);
  return parserName ? withDetailedError(tokenParser, parserName) : tokenParser;
};

/**
 * Parser for matching a JavaScript/JSON-style number with validation.
 *
 * Supports integers, decimals, and scientific notation with proper error handling.
 */
export const number: Parser<number> = (() => {
  const digits = map(oneOrMore(charClass(["0", "9"])), (chars) =>
    chars.join(""),
  );
  const integer = map(
    seq(optional(literal("-")), digits),
    ([sign, num]) => (sign.length > 0 ? "-" : "") + num,
  );

  const fraction = map(seq(literal("."), digits), ([_, frac]) => `.${frac}`);

  const exponent = map(
    seq(charClass("e", "E"), optional(charClass("+", "-")), digits),
    ([e, sign, exp]) => e + (sign.length > 0 ? sign[0] : "") + exp,
  );

  return map(
    seq(integer, optional(fraction), optional(exponent)),
    ([int, frac, exp]) => {
      const numStr =
        int + (frac.length > 0 ? frac[0] : "") + (exp.length > 0 ? exp[0] : "");

      const parsed = Number(numStr);

      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid number format: ${numStr}`);
      }

      return parsed;
    },
  );
})();

/**
 * Parse an integer number with validation.
 *
 * Supports negative integers and provides proper error handling for invalid formats.
 */
export const int: Parser<number> = map(
  seq(optional(literal("-")), oneOrMore(charClass(["0", "9"]))),
  ([sign, digits]) => {
    const numStr = (sign.length > 0 ? "-" : "") + digits.join("");
    const parsed = Number.parseInt(numStr, 10);

    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid integer format: ${numStr}`);
    }

    return parsed;
  },
);

/**
 * Parser that matches a single alphabetic character (a-z, A-Z).
 */
export const alpha = charClass(["a", "z"], ["A", "Z"]);

/**
 * Alias for alpha.
 */
export const letter = alpha;

/**
 * Parser that matches a single digit character (0-9).
 */
export const digit = charClass(["0", "9"]);

/**
 * Parser that matches a single alphanumeric character (a-z, A-Z, 0-9).
 */
export const alphaNum = charClass(["a", "z"], ["A", "Z"], ["0", "9"]);

/**
 * Parser that matches the start of input or start of a line.
 */
export const startOfLine = (): Parser<null> => (input: string, pos) => {
  if (pos.offset === 0 || input[pos.offset - 1] === "\n") {
    return {
      success: true,
      val: null,
      current: pos,
      next: pos,
    };
  }
  return {
    success: false,
    error: {
      message: "Expected start of line",
      pos,
    },
  };
};

/**
 * Parser that checks for end of input (EOF).
 *
 * Succeeds only if the input is completely consumed. Useful for ensuring
 * that no additional content follows the parsed structure.
 */
export const EOF = not(any);

/**
 * Parser that matches the end of input or a newline.
 */
export const endOfLine = (): Parser<string> =>
  labeled(
    choice(
      map(literal("\r\n"), () => "\n"),
      literal("\n"),
      literal("\r"),
      map(EOF, () => ""),
    ),
    "Expected end of line",
  );

/**
 * Parser that matches a simple identifier (starts with letter or underscore, followed by letters, digits, or underscores).
 */
export const identifier = map(
  seq(
    charClass(["a", "z"], ["A", "Z"], "_"),
    zeroOrMore(charClass(["a", "z"], ["A", "Z"], ["0", "9"], "_")),
  ),
  ([first, rest]) => first + rest.join(""),
);
