/**
 * Shared whitespace parsing utilities for TPEG parser
 *
 * This module provides standardized whitespace handling across all parser modules
 * to eliminate duplication and ensure consistent behavior.
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  choice,
  createFailure,
  isValidOffset,
  literal,
  map,
  oneOrMore,
  optional,
  star as zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";

import { findBlockCommentEnd, skipLineComment } from "./brace-scanner";
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
  (ws) => ws ?? "",
);

/** Return the first offset after consecutive grammar whitespace and complete comments. */
export function skipGrammarTrivia(
  input: string,
  start: number,
  documentation?: string[],
): number {
  let pos = start;
  while (pos < input.length) {
    const char = input[pos];
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      pos++;
    } else if (char === "/" && input[pos + 1] === "/") {
      const end = skipLineComment(input, pos);
      if (documentation && input[pos + 2] === "/") {
        documentation.push(input.slice(pos + 3, end).trim());
      }
      pos = end;
    } else if (char === "/" && input[pos + 1] === "*") {
      const end = findBlockCommentEnd(input, pos);
      if (end === -1) break;
      pos = end;
    } else {
      break;
    }
  }
  return pos;
}

/** Consume grammar trivia between syntactic elements. */
export const optionalWhitespaceOrComment: Parser<void> = (input, pos) => {
  if (!isValidOffset(pos) || pos > input.length) {
    return createFailure("Expected a valid position", pos, {
      parserName: "optionalWhitespaceOrComment",
    });
  }
  return {
    success: true,
    val: undefined,
    current: pos,
    next: skipGrammarTrivia(input, pos),
  };
};

/** Require a separator between a keyword and the following name. */
export const requiredWhitespaceOrComment: Parser<void> = (input, pos) => {
  const result = optionalWhitespaceOrComment(input, pos);
  if (!result.success) return result;
  if (result.next === pos) {
    return createFailure("Expected whitespace or a comment", pos, {
      expected: [" ", "\t", "\n", "//", "/*"],
      found: input[pos] ?? "end of input",
      parserName: "requiredWhitespaceOrComment",
    });
  }
  return result;
};

/**
 * Parse line-oriented whitespace including newlines for grammar blocks
 * This handles whitespace and newlines between grammar items
 */
export const grammarBlockWhitespace: Parser<string> = map(
  zeroOrMore(
    choice(
      literal("\r\n"),
      literal("\r"),
      literal("\n"),
      literal("\t"),
      literal(" "),
    ),
  ),
  (chars) => chars.join(""),
);
