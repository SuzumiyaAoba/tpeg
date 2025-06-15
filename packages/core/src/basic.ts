import type {
  NonEmptyString,
  ParseResult,
  Parser,
  Pos,
} from "./types";
import { createFailure, getCharAndLength, nextPos } from "./utils";

/**
 * Parser that parses any single character from the input.
 *
 * @returns Parser<string> A parser that succeeds if any character is present at the current position, or fails at end of input.
 */
export const anyChar =
  (parserName = "anyChar"): Parser<string> =>
  (input: string, pos: Pos) => {
    const [char] = getCharAndLength(input, pos.offset);

    if (!char) {
      return createFailure("Unexpected EOI", pos, {
        expected: "any character",
        found: "end of input",
        parserName,
      });
    }

    return {
      success: true,
      val: char,
      current: pos,
      next: nextPos(char, pos),
    };
  };

/**
 * Alias for {@link anyChar}.
 *
 * @returns Parser<string> A parser that succeeds if any character is present at the current position, or fails at end of input.
 * @see anyChar
 */
export const any = anyChar("any");

/**
 * Checks if a string can be processed by the optimized string parsing path.
 *
 * @param str The string to check
 * @returns Whether the string can use the optimized path
 */
const canUseOptimizedPath = (str: string): boolean => {
  // Use a more efficient check for ASCII-only strings without newlines
  // Check for ASCII printable characters (32-126) plus common whitespace (except newline)
  return /^[ -~\t\r]*$/.test(str) && !str.includes("\n");
};

/**
 * Simple implementation for string literals that don't need complex Unicode handling.
 */
const parseSimpleString = <T extends string>(
  str: NonEmptyString<T>,
  input: string,
  pos: Pos,
  parserName = "literal",
): ParseResult<T> => {
  // Fast path for ASCII-only strings with no newlines
  const { offset, column, line } = pos;

  // Check if the input has enough characters left
  if (offset + str.length > input.length) {
    return createFailure(`Expected "${str}" but got end of input`, pos, {
      expected: str,
      found: "end of input",
      parserName,
    });
  }

  // Use slice for more efficient string comparison
  const inputSlice = input.slice(offset, offset + str.length);
  if (inputSlice !== str) {
    // Find the first mismatched character for better error reporting
    for (let i = 0; i < str.length; i++) {
      if (input[offset + i] !== str[i]) {
        const errorPos = {
          offset: offset + i,
          column: column + i,
          line,
        };
        const foundChar = input[offset + i] ?? "EOF";
        const expectedChar = str[i] ?? "EOF";
        return createFailure(
          `Unexpected character "${foundChar}" at position ${
            offset + i
          }, expected "${expectedChar}"`,
          errorPos,
          {
            ...(str[i] !== undefined && { expected: str[i] }),
            ...(input[offset + i] !== undefined && {
              found: input[offset + i],
            }),
            ...(parserName && { parserName }),
          },
        );
      }
    }
  }

  // Success - all characters matched
  return {
    success: true,
    val: str,
    current: pos,
    next: {
      offset: offset + str.length,
      column: column + str.length,
      line,
    },
  };
};

/**
 * Complex implementation for string literals that need proper Unicode handling.
 */
const parseComplexString = <T extends string>(
  str: NonEmptyString<T>,
  input: string,
  pos: Pos,
  parserName = "literal",
): ParseResult<T> => {
  let currentPos = { ...pos };
  let i = 0;

  while (i < str.length) {
    // Get the character from the string we're trying to match
    const strCode = str.codePointAt(i) ?? 0;
    const strChar = String.fromCodePoint(strCode);
    const strCharLen = strChar.length;

    // Get the character from the input
    const [inputChar] = getCharAndLength(
      input,
      currentPos.offset,
    );

    if (inputChar === "") {
      return createFailure(
        `Expected "${str}" but got end of input`,
        currentPos,
        {
          expected: str,
          found: "end of input",
          parserName,
        },
      );
    }

    if (inputChar !== strChar) {
      return createFailure(
        `Unexpected character "${inputChar}" at position ${currentPos.offset}, expected "${strChar}"`,
        currentPos,
        {
          expected: strChar,
          found: inputChar,
          parserName,
        },
      );
    }

    // Update the position
    currentPos = nextPos(inputChar, currentPos);
    i += strCharLen;
  }

  return {
    success: true,
    val: str,
    current: pos,
    next: currentPos,
  };
};

/**
 * Parser for literal string matching.
 *
 * @template T Type of the string literal
 * @param str The string literal to match
 * @param parserName Optional name for error reporting
 * @returns Parser<T> A parser that succeeds if the input matches the given string, or fails otherwise.
 */
export const literal = <T extends string>(
  str: NonEmptyString<T>,
  parserName = "literal",
): Parser<T> => {
  // Check once during parser creation to avoid repeated checks
  const useOptimizedPath = canUseOptimizedPath(str);

  return (input: string, pos: Pos) => {
    if (useOptimizedPath) {
      return parseSimpleString(str, input, pos, parserName);
    }

    // Use complex path for Unicode strings
    return parseComplexString(str, input, pos, parserName);
  };
};

/**
 * Alias for {@link literal}.
 *
 * @template T Type of the string literal
 * @param str The string literal to match
 * @returns Parser<T> A parser that succeeds if the input matches the given string, or fails otherwise.
 * @see literal
 */
export const lit = literal;
