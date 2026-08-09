/**
 * TPEG Character Class Parser
 *
 * Implements parsing of character classes: [a-z], [A-Z], [0-9], [^0-9], .
 * Based on docs/peg-grammar.md specification.
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  charClass,
  choice,
  createFailure,
  literal,
  map,
  oneOrMore,
  optional,
  seq,
} from "@suzumiyaaoba/tpeg-core";
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
  // Regular characters (excluding special characters). Only "-" (the
  // range operator, 0x2D) needs to be excluded from this run -- the
  // boundary below stops at "," (0x2C), one code point short of "-", and
  // picks back up at "." (0x2E), one past it. A previous version of this
  // range stopped at "+" (0x2B) instead of ",", which excluded the comma
  // too even though it has no special meaning inside a character class,
  // making a literal "," impossible to write in one (`[a,b]` and even the
  // escaped `[a\,b]` both failed to parse -- no escape sequence covered it
  // either, see the escape charClass above).
  charClass([" ", ","], [".", "["], ["_", "~"]),
);

/**
 * Parses a character range within a character class.
 * Can be a single character or a range like 'a-z'.
 */
const charRange: Parser<CharRange> = choice(
  // Character range: a-z. Not a plain `map` (which can't turn a success
  // into a failure): a range written backwards (e.g. `[z-a]`) must be
  // rejected here rather than silently accepted as a `CharRange` that
  // matches nothing -- `char-set.ts`'s `fromCodePointRange` and core's
  // `compileSpecs`/`matchesSpecsSlow` (`packages/core/src/char-class.ts`)
  // both treat `start > end` as vacuously empty with no diagnostic
  // anywhere, silently turning a plausible typo (meaning `[a-z]`) into a
  // character class that can never match.
  (input, pos) => {
    const result = seq(charClassChar, literal("-"), charClassChar)(input, pos);
    if (!result.success) return result;
    const [start, , end] = result.val;
    if ((start.codePointAt(0) ?? 0) > (end.codePointAt(0) ?? 0)) {
      // `fatal: true`, not an ordinary failure: syntactically, this
      // clearly WAS an attempted range (`charClassChar "-" charClassChar`
      // matched in full) -- letting `choice` below fall back to the
      // "single character" alternative would silently reparse "z-a" as
      // three unrelated single-character ranges (`z`, `-`, `a`) instead of
      // rejecting the backwards range outright. The `fatal` flag is
      // absorbed at `characterClass`'s own enclosing `choice` boundary
      // (see `commit`'s doc comment, `@suzumiyaaoba/tpeg-core`), so this
      // doesn't leak past this one character class into unrelated
      // grammar constructs -- it just prevents the local, wrong
      // reinterpretation.
      return createFailure(
        `Invalid character range: "${start}-${end}" (start must not be greater than end)`,
        pos,
        { parserName: "charRange", fatal: true },
      );
    }
    return {
      success: true,
      val: { start, end },
      current: result.current,
      next: result.next,
    };
  },
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
 * const result1 = characterClass()("[a-z]", 0);
 * // result1.success === true, result1.val.type === "CharacterClass"
 * // result1.val.ranges === [{ start: 'a', end: 'z' }]
 * // result1.val.negated === false
 *
 * const result2 = characterClass()("[^0-9]", 0);
 * // result2.success === true, result2.val.negated === true
 *
 * const result3 = characterClass()(".", 0);
 * // result3.success === true, result3.val.type === "AnyChar"
 * ```
 */
export const characterClass: Parser<CharacterClass | AnyChar> = choice(
  characterClassBrackets,
  anyCharDot,
);
