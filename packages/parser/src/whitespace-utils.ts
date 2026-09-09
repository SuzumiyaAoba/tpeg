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
  literal,
  map,
  oneOrMore,
  optional,
  star as zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";

import { skipBlockComment, skipLineComment } from "./brace-scanner";
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
 * Like {@link optionalWhitespace}, but also skips `//`/`///` line comments
 * and `/* ... *\/` block comments -- for the specific grammar-HEADER
 * positions (`grammarBlock` in `./grammar.ts`: between the grammar
 * keyword/name/extends/includes clauses and the opening `{`) that need
 * comment tolerance there too, without changing `optionalWhitespace`
 * itself (63 other call sites across this package rely on its existing,
 * comment-free behavior). Comments BETWEEN grammar items (rules,
 * annotations, transforms) don't need this: `grammarItem`
 * (`./grammar.ts`) already accepts a comment as a standalone item in its
 * own right, interleaved by `grammarBlockWhitespace` below exactly like
 * any other item.
 *
 * Returns void rather than the consumed text (unlike `optionalWhitespace`):
 * every call site this exists for already discards the value.
 */
export const optionalWhitespaceOrComment: Parser<void> = (input, pos) => {
  let i = pos;
  while (i < input.length) {
    const char = input[i] as (typeof WHITESPACE_CHARS)[number] | undefined;
    if (
      char !== undefined &&
      (WHITESPACE_CHARS as readonly string[]).includes(char)
    ) {
      i++;
      continue;
    }
    if (input[i] === "/" && input[i + 1] === "/") {
      i = skipLineComment(input, i);
      continue;
    }
    if (input[i] === "/" && input[i + 1] === "*") {
      i = skipBlockComment(input, i);
      continue;
    }
    break;
  }
  return { success: true, val: undefined, current: pos, next: i };
};

/**
 * Like {@link optionalWhitespaceOrComment}, but requires consuming at
 * least one character (whitespace or comment) -- for the one grammar-
 * header position (`grammar.ts`'s `dottedGrammarDefinitionHeader`,
 * between the "grammar" keyword and the grammar's own name) that is a
 * MANDATORY separator: unlike every other header position (already
 * comment-tolerant via `optionalWhitespaceOrComment` above, since those
 * are all optional separators bracketed by punctuation), a bare
 * `optionalWhitespaceOrComment` here would let "grammarG {" (no
 * separator at all) parse, silently merging the keyword and the name.
 */
export const requiredWhitespaceOrComment: Parser<void> = (input, pos) => {
  // `optionalWhitespaceOrComment` always succeeds (see its own doc
  // comment), so `result.next` is always defined here -- narrowed
  // explicitly since its return type is the general `ParseResult<void>`
  // union.
  const result = optionalWhitespaceOrComment(input, pos);
  if (!result.success || result.next === pos) {
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
