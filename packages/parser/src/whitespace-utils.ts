/**
 * Shared whitespace parsing utilities for TPEG parser
 * 
 * This module provides standardized whitespace handling across all parser modules
 * to eliminate duplication and ensure consistent behavior.
 */

import type { Parser } from "tpeg-core";
import { choice, literal, map, oneOrMore, optional, star as zeroOrMore } from "tpeg-core";

/**
 * Standard whitespace characters recognized by TPEG
 */
export const WHITESPACE_CHARS = [" ", "\t", "\n", "\r"] as const;

/**
 * Parse one or more whitespace characters and return as a string
 */
export const whitespace: Parser<string> = map(
  oneOrMore(choice(literal(" "), literal("\t"), literal("\n"), literal("\r"))),
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
  zeroOrMore(choice(literal(" "), literal("\t"), literal("\n"), literal("\r"))),
  () => undefined,
);

/**
 * Create a parser that consumes leading whitespace before running the given parser
 * @param parser The parser to run after consuming whitespace
 * @returns Parser that consumes optional leading whitespace then runs the given parser
 */
export const withLeadingWhitespace = <T>(parser: Parser<T>): Parser<T> => 
  map(
    [optionalWhitespace, parser] as const,
    ([_, result]) => result,
  );

/**
 * Create a parser that consumes trailing whitespace after running the given parser
 * @param parser The parser to run before consuming whitespace
 * @returns Parser that runs the given parser then consumes optional trailing whitespace
 */
export const withTrailingWhitespace = <T>(parser: Parser<T>): Parser<T> =>
  map(
    [parser, optionalWhitespace] as const,
    ([result, _]) => result,
  );

/**
 * Create a parser that consumes whitespace before and after the given parser
 * @param parser The parser to wrap with whitespace handling
 * @returns Parser that handles optional whitespace on both sides
 */
export const withSurroundingWhitespace = <T>(parser: Parser<T>): Parser<T> =>
  withLeadingWhitespace(withTrailingWhitespace(parser));