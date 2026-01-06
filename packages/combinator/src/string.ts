import type {
  Parser,
  Pos,
} from "@suzumiyaaoba/tpeg-core";
import {
  anyChar,
  choice,
  getCharAndLength,
  literal,
  map,
  nextPos,
  notPredicate,
  seq,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import { labeled, withDetailedError } from "./error";

/**
 * Parser that consumes characters until a condition is met.
 *
 * Checks the condition parser at each position and consumes characters until the condition succeeds.
 */
export const takeUntil =
  <T>(condition: Parser<T>, _parserName?: string): Parser<string> =>
  (input: string, pos: Pos) => {
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    let currentPos = startPos;
    const chars: string[] = [];

    while (currentPos.offset < input.length) {
      const condResult = condition(input, currentPos);
      if (condResult.success) {
        break;
      }

      const [char, _len] = getCharAndLength(input, currentPos.offset);
      if (!char) break;

      chars.push(char);
      currentPos = nextPos(char, currentPos);
    }

    const result = {
      success: true,
      val: chars.join(""),
      current: startPos,
      next: currentPos,
    } as const;

    return result;
  };

/**
 * Parser for matching content between two parsers.
 *
 * Efficiently extracts content between opening and closing parsers.
 */
export const between =
  <O, C>(
    open: Parser<O>,
    close: Parser<C>,
    parserName?: string,
  ): Parser<string> =>
  (input: string, pos: Pos) => {
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    const base = map(
      seq(open, takeUntil(close), close),
      ([_, content]) => content,
    );
    const parser = parserName ? withDetailedError(base, parserName) : base;
    return parser(input, startPos);
  };

/**
 * Parser for matching a double-quoted string with escape sequence support.
 */
export const quotedString: Parser<string> = (() => {
  const createEscapeHandler = (quoteChar: string) =>
    map(seq(literal("\\"), anyChar()), ([_, char]) => {
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

  const escapeSeq = createEscapeHandler('"');

  const stringChar = choice(
    escapeSeq,
    map(
      seq(notPredicate(choice(literal('"'), literal("\\"))), anyChar()),
      ([_, char]) => char,
    ),
  );

  return labeled(
    map(
      seq(literal('"'), zeroOrMore(stringChar), literal('"')),
      ([_, chars]) => chars.join(""),
    ),
    "Expected valid double-quoted string",
  );
})();

/**
 * Parser for matching a single-quoted string with escape sequence support.
 */
export const singleQuotedString: Parser<string> = (() => {
  const createEscapeHandler = (quoteChar: string) =>
    map(seq(literal("\\"), anyChar()), ([_, char]) => {
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

  const escapeSeq = createEscapeHandler("'");

  const stringChar = choice(
    escapeSeq,
    map(
      seq(notPredicate(choice(literal("'"), literal("\\"))), anyChar()),
      ([_, char]) => char,
    ),
  );

  return labeled(
    map(
      seq(literal("'"), zeroOrMore(stringChar), literal("'")),
      ([_, chars]) => chars.join(""),
    ),
    "Expected valid single-quoted string",
  );
})();

/**
 * Parser for matching a string with either single or double quotes.
 */
export const anyQuotedString: Parser<string> = choice(
  quotedString,
  singleQuotedString,
);
