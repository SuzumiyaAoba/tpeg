import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  anyChar,
  charClass,
  choice,
  getCharAt,
  literal,
  map,
  nextPos,
  notPredicate,
  seq,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import { labeled, named } from "./error";

/** A single hex digit, for `\uXXXX` escapes below. */
const hexDigit = charClass(["0", "9"], ["a", "f"], ["A", "F"]);

/**
 * `\uXXXX` Unicode escape (same shape JSON/JS string literals use): four
 * hex digits decoded as one UTF-16 code unit via `String.fromCharCode`.
 * An astral character is written as a surrogate PAIR of two consecutive
 * `\uXXXX` escapes (e.g. `😀`), same as JSON -- each decodes to
 * its own lone surrogate code unit here, and joining them back-to-back
 * (`makeQuotedString`'s final `chars.join("")`) reconstitutes the correct
 * astral character, since a JS string is itself just a UTF-16 code unit
 * sequence. Tried before the generic single-character `escapeSeq` fallback
 * below, so `A` decodes to `"A"` instead of silently passing through
 * as the literal text `"u0041"` (`escapeSeq`'s `default` branch, meant for
 * an escape it doesn't otherwise recognize, previously had no `u` case at
 * all and passed `\u` through the same way).
 */
const unicodeEscape = map(
  seq(literal("\\u"), hexDigit, hexDigit, hexDigit, hexDigit),
  ([, h1, h2, h3, h4]) =>
    String.fromCharCode(Number.parseInt(`${h1}${h2}${h3}${h4}`, 16)),
);

/**
 * Parser that consumes characters until a condition is met.
 *
 * Checks the condition parser at each position and consumes characters until the condition succeeds.
 *
 * The matched text is sliced directly from `input` rather than built up
 * character by character. On engines where substrings can retain a reference
 * to their parent string's buffer, a small token extracted from a very large
 * document may keep that whole document alive in memory for as long as the
 * token is reachable.
 */
export const takeUntil =
  <T>(condition: Parser<T>, _parserName?: string): Parser<string> =>
  (input: string, pos: number) => {
    const startPos = pos;

    let currentPos = startPos;

    while (currentPos < input.length) {
      const condResult = condition(input, currentPos);
      if (condResult.success) {
        break;
      }

      const char = getCharAt(input, currentPos);
      if (!char) break;

      currentPos = nextPos(char, currentPos);
    }

    return {
      success: true,
      val: input.slice(startPos, currentPos),
      current: startPos,
      next: currentPos,
    } as const;
  };

/**
 * Parser for matching content between two parsers.
 *
 * Efficiently extracts content between opening and closing parsers.
 */
export const between = <O, C>(
  open: Parser<O>,
  close: Parser<C>,
  parserName?: string,
): Parser<string> => {
  const base = map(
    seq(open, takeUntil(close), close),
    ([_, content]) => content,
  );
  const parser = named(base, parserName);

  return (input: string, pos: number) => parser(input, pos);
};

/**
 * Builds a quoted-string parser for the given quote character, with escape
 * sequence support. Shared by {@link quotedString} and {@link singleQuotedString},
 * which differ only in the quote character and error label.
 */
const makeQuotedString = (quoteChar: string, label: string): Parser<string> => {
  const escapeSeq = map(seq(literal("\\"), anyChar()), ([_, char]) => {
    switch (char) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "\\":
        return "\\";
      case quoteChar:
        return quoteChar;
      default:
        return char;
    }
  });

  const stringChar = choice(
    unicodeEscape,
    escapeSeq,
    map(
      seq(notPredicate(choice(literal(quoteChar), literal("\\"))), anyChar()),
      ([_, char]) => char,
    ),
  );

  return labeled(
    map(
      seq(literal(quoteChar), zeroOrMore(stringChar), literal(quoteChar)),
      ([_, chars]) => chars.join(""),
    ),
    label,
  );
};

/**
 * Parser for matching a double-quoted string with escape sequence support.
 */
export const quotedString: Parser<string> = makeQuotedString(
  '"',
  "Expected valid double-quoted string",
);

/**
 * Parser for matching a single-quoted string with escape sequence support.
 */
export const singleQuotedString: Parser<string> = makeQuotedString(
  "'",
  "Expected valid single-quoted string",
);

/**
 * Parser for matching a string with either single or double quotes.
 */
export const anyQuotedString: Parser<string> = choice(
  quotedString,
  singleQuotedString,
);
