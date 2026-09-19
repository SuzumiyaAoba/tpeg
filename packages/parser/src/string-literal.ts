/**
 * TPEG String Literal Parser
 *
 * Implements parsing of string literals: "hello", 'world'
 * Based on docs/peg-grammar.md specification.
 * Note: Template literals (`template`) are planned for future extension
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  anyChar,
  choice,
  literal,
  map,
  notPredicate,
  seq,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import { unifiedEscapeSequence } from "./escape-sequence";
import type { StringLiteral } from "./types";
import { createStringLiteral } from "./types";

/**
 * Parses escape sequences within string literals.
 * Supports the full unified set (`./escape-sequence.ts`): the named
 * escapes `\n \r \t \b \f \v \0`, the numeric escapes `\xNN` `\uXXXX`
 * `\u{...}`, and the literal escapes `\"` `\'` `\\`. `\b` is BACKSPACE
 * inside a string (JS's own semantics) -- the word-boundary assertion
 * `\b` is a pattern-level construct, not an escape.
 */
const escapeSequence: Parser<string> = unifiedEscapeSequence(['"', "'", "\\"]);

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
  ([_, content, __]) => createStringLiteral(content, '"'),
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
  ([_, content, __]) => createStringLiteral(content, "'"),
);

/**
 * Parses any valid TPEG string literal.
 * Supports double quotes and single quotes.
 *
 * @returns Parser<StringLiteral> Parser that matches string literals
 *
 * @example
 * ```typescript
 * const result1 = stringLiteral()("\"hello\"", 0);
 * // result1.success === true, result1.val.value === "hello", result1.val.quote === '"'
 *
 * const result2 = stringLiteral()("'world'", 0);
 * // result2.success === true, result2.val.value === "world", result2.val.quote === "'"
 * ```
 */
export const stringLiteral: Parser<StringLiteral> = choice(
  doubleQuotedString,
  singleQuotedString,
);
