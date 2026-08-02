import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  anyChar,
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
