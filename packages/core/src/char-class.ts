import type { NonEmptyArray, NonEmptyString, Parser } from "./types";
import { createFailure, getCharAndLength, nextPos } from "./utils";

/**
 * Parser that matches a character against a set of characters or character ranges.
 *
 * @param charOrRanges Array of characters or character ranges to match against
 * @returns Parser<string> A parser that succeeds if the input character matches any of the given ranges.
 * @example
 *   const digit = charClass(["0", "9"]); // matches any digit
 *   const vowel = charClass("a", "e", "i", "o", "u"); // matches any vowel
 */
export const charClass =
  (
    ...charOrRanges: NonEmptyArray<
      NonEmptyString | [NonEmptyString, NonEmptyString]
    >
  ): Parser<string> =>
  (input, pos) => {
    const [char, charLength] = getCharAndLength(input, pos.offset);

    if (!char) {
      const classToString = (charOrRange: string | [string, string]) => {
        if (typeof charOrRange === "string") {
          return charOrRange;
        }
        return `${charOrRange[0]}-${charOrRange[1]}`;
      };

      const expected = charOrRanges.map(classToString).join(", ");

      return createFailure(`Unexpected EOI, expected ${expected}`, pos, {
        expected,
        found: "end of input",
        parserName: "charClass",
      });
    }

    const charCode = char.codePointAt(0) ?? 0;

    // Check if the character matches any of the given ranges
    for (const charOrRange of charOrRanges) {
      if (typeof charOrRange === "string") {
        // Single character
        if (char === charOrRange) {
          return {
            success: true,
            val: char,
            current: pos,
            next: nextPos(char, pos),
          };
        }
      } else {
        // Character range
        const [start, end] = charOrRange;
        const startCode = start.codePointAt(0) ?? 0;
        const endCode = end.codePointAt(0) ?? 0;

        if (charCode >= startCode && charCode <= endCode) {
          return {
            success: true,
            val: char,
            current: pos,
            next: nextPos(char, pos),
          };
        }
      }
    }

    // No match found
    const classToString = (charOrRange: string | [string, string]) => {
      if (typeof charOrRange === "string") {
        return charOrRange;
      }
      return `${charOrRange[0]}-${charOrRange[1]}`;
    };

    const expected = charOrRanges.map(classToString).join(", ");

    return createFailure(
      `Unexpected character "${char}", expected one of ${expected}`,
      pos,
      {
        expected,
        found: char,
        parserName: "charClass",
      },
    );
  };
