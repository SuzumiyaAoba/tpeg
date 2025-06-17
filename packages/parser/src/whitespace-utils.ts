/**
 * Shared whitespace parsing utilities for TPEG parser
 *
 * This module provides standardized whitespace handling across all parser modules
 * to eliminate duplication and ensure consistent behavior.
 */

import type { Parser } from "tpeg-core";
import {
  choice,
  literal,
  map,
  oneOrMore,
  optional,
  seq,
  star as zeroOrMore,
} from "tpeg-core";

import { WHITESPACE_CHARS } from "./constants";

/**
 * Standard whitespace characters recognized by TPEG
 * Re-exported from constants for convenience
 */
export { WHITESPACE_CHARS } from "./constants";

/**
 * Parse one or more whitespace characters and return as a string
 */
export const whitespace: Parser<string> = map(
  oneOrMore(choice(...WHITESPACE_CHARS.map((char) => literal(char)))),
  (chars) => chars.join(""),
);

/**
 * Parse optional whitespace and return as a string (empty string if no whitespace)
 */
export const optionalWhitespace: Parser<string> = map(
  optional(whitespace),
  (ws) => ws[0] ?? "",
);

/**
 * Parse zero or more whitespace characters and return void
 * Used when whitespace is consumed but not needed in the result
 */
export const whitespaceVoid: Parser<void> = map(
  zeroOrMore(choice(...WHITESPACE_CHARS.map((char) => literal(char)))),
  () => undefined,
);

/**
 * Create a parser that consumes leading whitespace before running the given parser
 * @param parser The parser to run after consuming whitespace
 * @returns Parser that consumes optional leading whitespace then runs the given parser
 */
export const withLeadingWhitespace = <T>(parser: Parser<T>): Parser<T> =>
  map(seq(optionalWhitespace, parser), ([_, result]) => result);

/**
 * Create a parser that consumes trailing whitespace after running the given parser
 * @param parser The parser to run before consuming whitespace
 * @returns Parser that runs the given parser then consumes optional trailing whitespace
 */
export const withTrailingWhitespace = <T>(parser: Parser<T>): Parser<T> =>
  map(seq(parser, optionalWhitespace), ([result, _]) => result);

/**
 * Create a parser that consumes whitespace before and after the given parser
 * @param parser The parser to wrap with whitespace handling
 * @returns Parser that handles optional whitespace on both sides
 */
export const withSurroundingWhitespace = <T>(parser: Parser<T>): Parser<T> =>
  withLeadingWhitespace(withTrailingWhitespace(parser));

/**
 * Parse line-oriented whitespace including newlines for grammar blocks
 * This handles whitespace, newlines, and comments between grammar items
 */
export const grammarBlockWhitespace: Parser<string> = map(
  zeroOrMore(
    choice(
      literal(" "),
      literal("\t"),
      literal("\n"),
      literal("\r"),
      literal("\r\n"),
    ),
  ),
  (chars) => chars.join(""),
);
