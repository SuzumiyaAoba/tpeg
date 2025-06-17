/**
 * TPEG String Literal Parser
 *
 * Implements parsing of string literals: "hello", 'world'
 * Based on docs/peg-grammar.md specification.
 * Note: Template literals (`template`) are planned for future extension
 */

import type { Parser } from "tpeg-core";
import {
  anyChar,
  charClass,
  choice,
  literal,
  map,
  notPredicate,
  seq,
  zeroOrMore,
} from "tpeg-core";
import type { StringLiteral } from "./types";

/**
 * Parses escape sequences within string literals.
 * Supports: \n, \r, \t, \\, \", \'
 */
const escapeSequence: Parser<string> = map(
  seq(literal("\\"), charClass("n", "r", "t", "\\", '"', "'")),
  ([_, char]) => {
    switch (char) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "\\":
        return "\\";
      case '"':
        return '"';
      case "'":
        return "'";
      default:
        return char;
    }
  },
);

/**
 * Parses a character within a double-quoted string.
 * Handles escape sequences and regular characters.
 */
const doubleQuoteChar: Parser<string> = choice(
  escapeSequence,
  // Any character except " and \
  map(
    seq(notPredicate(choice(literal('"'), literal("\\"))), anyChar()),
    ([_, char]) => char,
  ),
);

/**
 * Parses a character within a single-quoted string.
 * Handles escape sequences and regular characters.
 */
const singleQuoteChar: Parser<string> = choice(
  escapeSequence,
  // Any character except ' and \
  map(
    seq(notPredicate(choice(literal("'"), literal("\\"))), anyChar()),
    ([_, char]) => char,
  ),
);

/**
 * Parses double-quoted string literals: "hello world"
 */
const doubleQuotedString: Parser<StringLiteral> = map(
  seq(
    literal('"'),
    map(zeroOrMore(doubleQuoteChar), (chars) => chars.join("")),
    literal('"'),
  ),
  ([_, content, __]) => ({
    type: "StringLiteral" as const,
    value: content,
    quote: '"' as const,
  }),
);

/**
 * Parses single-quoted string literals: 'hello world'
 */
const singleQuotedString: Parser<StringLiteral> = map(
  seq(
    literal("'"),
    map(zeroOrMore(singleQuoteChar), (chars) => chars.join("")),
    literal("'"),
  ),
  ([_, content, __]) => ({
    type: "StringLiteral" as const,
    value: content,
    quote: "'" as const,
  }),
);

/**
 * Parses any valid TPEG string literal.
 * Supports double quotes and single quotes.
 *
 * @returns Parser<StringLiteral> Parser that matches string literals
 *
 * @example
 * ```typescript
 * const result1 = stringLiteral()("\"hello\"", { offset: 0, line: 1, column: 1 });
 * // result1.success === true, result1.val.value === "hello", result1.val.quote === '"'
 *
 * const result2 = stringLiteral()("'world'", { offset: 0, line: 1, column: 1 });
 * // result2.success === true, result2.val.value === "world", result2.val.quote === "'"
 * ```
 */
export const stringLiteral: Parser<StringLiteral> = choice(
  doubleQuotedString,
  singleQuotedString,
);
