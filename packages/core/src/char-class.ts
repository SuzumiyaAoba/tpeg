import type { NonEmptyArray, NonEmptyString, Parser, Pos } from "./types";
import { createFailure, getCharAt, nextPos } from "./utils";

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

type CompiledSpec =
  | { readonly isSingle: true; readonly char: NonEmptyString }
  | { readonly isSingle: false; readonly start: number; readonly end: number };

/**
 * Pre-compiles character class specifications into code points for high performance
 */
const compileSpecs = (charOrRanges: readonly CharClassSpec[]): CompiledSpec[] =>
  charOrRanges.map((spec) => {
    if (typeof spec === "string") {
      return { isSingle: true, char: spec };
    }
    const startCode = spec[0].codePointAt(0) ?? 0;
    const endCode = spec[1].codePointAt(0) ?? 0;
    return { isSingle: false, start: startCode, end: endCode };
  });

/**
 * Checks whether a character matches any of the compiled specifications
 */
const matchesSpecs = (
  char: string,
  charCode: number,
  compiledSpecs: readonly CompiledSpec[],
): boolean =>
  compiledSpecs.some((spec) =>
    spec.isSingle
      ? char === spec.char
      : charCode >= spec.start && charCode <= spec.end,
  );

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
  const compiledSpecs = compileSpecs(charOrRanges);

  return (input: string, pos: Pos) => {
    const char = getCharAt(input, pos.offset);

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

    if (matchesSpecs(char, charCode, compiledSpecs)) {
      return {
        success: true,
        val: char,
        current: pos,
        next: nextPos(char, pos),
      } as const;
    }

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
};

/**
 * Parser that matches a character NOT belonging to a set of characters or character ranges
 * (the runtime counterpart of a PEG negated character class, e.g. `[^a-z]`).
 *
 * @param charOrRanges Array of characters or character ranges to exclude
 * @returns Parser<string> A parser that succeeds with the current character if it matches none of the given ranges.
 * @example
 *   const notDigit = negatedCharClass(["0", "9"]); // matches any non-digit character
 */
export const negatedCharClass = (
  ...charOrRanges: NonEmptyArray<CharClassSpec>
): Parser<string> => {
  const expected = `not one of: ${charOrRanges.map(classToString).join(", ")}`;
  const compiledSpecs = compileSpecs(charOrRanges);

  return (input: string, pos: Pos) => {
    const char = getCharAt(input, pos.offset);

    if (!char) {
      return createFailure(
        `Unexpected end of input, expected ${expected}`,
        pos,
        {
          expected,
          found: "end of input",
          parserName: "negatedCharClass",
        },
      );
    }

    const charCode = char.codePointAt(0) ?? 0;

    if (matchesSpecs(char, charCode, compiledSpecs)) {
      return createFailure(
        `Unexpected character "${char}", expected ${expected}`,
        pos,
        {
          expected,
          found: char,
          parserName: "negatedCharClass",
        },
      );
    }

    return {
      success: true,
      val: char,
      current: pos,
      next: nextPos(char, pos),
    } as const;
  };
};
