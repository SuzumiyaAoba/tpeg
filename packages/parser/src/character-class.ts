/**
 * TPEG Character Class Parser
 *
 * Implements parsing of character classes: [a-z], [A-Z], [0-9], [^0-9], .
 * Based on docs/peg-grammar.md specification.
 */

import type { Parser } from "tpeg-core";
import {
  charClass,
  choice,
  literal,
  map,
  oneOrMore,
  optional,
  seq,
} from "tpeg-core";
import type { AnyChar, CharRange, CharacterClass } from "./types";

/**
 * Parses a single character within a character class.
 * Handles escape sequences for special characters and standard escape sequences.
 */
const charClassChar: Parser<string> = choice(
  // Standard escape sequences
  map(
    seq(literal("\\"), charClass("t", "n", "r", "b", "f", "v", "0")),
    ([_, char]) => {
      switch (char) {
        case "t":
          return "\t";
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "b":
          return "\b";
        case "f":
          return "\f";
        case "v":
          return "\v";
        case "0":
          return "\0";
        default:
          return char;
      }
    },
  ),
  // Escape sequences for special characters in character classes
  map(
    seq(literal("\\"), charClass("]", "\\", "^", "-", '"', "'")),
    ([_, char]) => {
      switch (char) {
        case "]":
          return "]";
        case "\\":
          return "\\";
        case "^":
          return "^";
        case "-":
          return "-";
        case '"':
          return '"';
        case "'":
          return "'";
        default:
          return char;
      }
    },
  ),
  // Regular characters (excluding special characters)
  charClass([" ", "+"], [".", "["], ["_", "~"]),
);

/**
 * Parses a character range within a character class.
 * Can be a single character or a range like 'a-z'.
 */
const charRange: Parser<CharRange> = choice(
  // Character range: a-z
  map(seq(charClassChar, literal("-"), charClassChar), ([start, _, end]) => ({
    start,
    end,
  })),
  // Single character
  map(charClassChar, (start) => ({ start })),
);

/**
 * Parses the content of a character class (inside the brackets).
 */
const charClassContent: Parser<CharRange[]> = oneOrMore(charRange);

/**
 * Parses a character class: [a-z], [^abc], etc.
 */
const characterClassBrackets: Parser<CharacterClass> = map(
  seq(literal("["), optional(literal("^")), charClassContent, literal("]")),
  ([_, negation, ranges, __]) => ({
    type: "CharacterClass" as const,
    ranges,
    negated: negation.length > 0,
  }),
);

/**
 * Parses the any character dot (.).
 */
const anyCharDot: Parser<AnyChar> = map(literal("."), () => ({
  type: "AnyChar" as const,
}));

/**
 * Parses any valid TPEG character class or any character dot.
 * Supports bracketed character classes and the dot operator.
 *
 * @returns Parser<CharacterClass | AnyChar> Parser that matches character classes
 *
 * @example
 * ```typescript
 * const result1 = characterClass()("[a-z]", { offset: 0, line: 1, column: 1 });
 * // result1.success === true, result1.val.type === "CharacterClass"
 * // result1.val.ranges === [{ start: 'a', end: 'z' }]
 * // result1.val.negated === false
 *
 * const result2 = characterClass()("[^0-9]", { offset: 0, line: 1, column: 1 });
 * // result2.success === true, result2.val.negated === true
 *
 * const result3 = characterClass()(".", { offset: 0, line: 1, column: 1 });
 * // result3.success === true, result3.val.type === "AnyChar"
 * ```
 */
export const characterClass: Parser<CharacterClass | AnyChar> = choice(
  characterClassBrackets,
  anyCharDot,
);
