import type { NonEmptyArray, NonEmptyString, Parser, Pos } from "./types";
import { createFailure, getCharAndLength, nextPos } from "./utils";

/**
 * Represents a character class specification - either a single character or a range
 */
type CharClassSpec = NonEmptyString | [NonEmptyString, NonEmptyString];

/**
 * Converts a character class specification to a readable string representation
 * @param charOrRange Character or character range specification
 * @returns String representation for display purposes
 */
const classToString = (charOrRange: CharClassSpec): string => {
  if (typeof charOrRange === "string") {
    return charOrRange;
  }
  return `${charOrRange[0]}-${charOrRange[1]}`;
};

/**
 * Checks if a character matches a single character class specification
 * @param char The character to test
 * @param charCode The character's Unicode code point
 * @param spec The character class specification
 * @returns true if the character matches the specification
 */
const matchesSpec = (
  char: string,
  charCode: number,
  spec: CharClassSpec,
): boolean => {
  if (typeof spec === "string") {
    return char === spec;
  }

  const [start, end] = spec;
  const startCode = start.codePointAt(0) ?? 0;
  const endCode = end.codePointAt(0) ?? 0;

  return charCode >= startCode && charCode <= endCode;
};

/**
 * Parser that matches a character against a set of characters or character ranges.
 *
 * @param charOrRanges Array of characters or character ranges to match against
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<string> A parser that succeeds if the input character matches any of the given ranges.
 * @example
 *   const digit = charClass(["0", "9"]); // matches any digit
 *   const vowel = charClass("a", "e", "i", "o", "u"); // matches any vowel
 *   const alphaNumeric = charClass(["a", "z"], ["A", "Z"], ["0", "9"]); // matches alphanumeric
 */
export const charClass = (
  ...charOrRanges: NonEmptyArray<CharClassSpec>
): Parser<string> => {
  const expected = charOrRanges.map(classToString).join(", ");

  const charClassParser = (input: string, pos: Pos) => {
    const [char] = getCharAndLength(input, pos.offset);

    if (!char) {
      return createFailure(
        `Unexpected end of input, expected one of: ${expected}`,
        pos,
        {
          expected,
          found: "end of input",
          parserName: "charClass",
        },
      );
    }

    const charCode = char.codePointAt(0) ?? 0;

    // Check if the character matches any of the given specifications
    for (const spec of charOrRanges) {
      if (matchesSpec(char, charCode, spec)) {
        return {
          success: true,
          val: char,
          current: pos,
          next: nextPos(char, pos),
        } as const;
      }
    }

    // No match found
    return createFailure(
      `Unexpected character "${char}", expected one of: ${expected}`,
      pos,
      {
        expected,
        found: char,
        parserName: "charClass",
      },
    );
  };

  return charClassParser;
};
