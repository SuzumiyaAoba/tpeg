import type {
  NonEmptyArray,
  ParseFailure,
  ParseResult,
  ParseSuccess,
  Parser,
  Pos,
} from "./types";

/**
 * Checks if the given array is empty.
 *
 * @template T Type of array elements
 * @param arr The array to check
 * @returns Returns true if the array is empty, otherwise false.
 */
export const isEmptyArray = <T>(arr: readonly T[]): arr is [] => {
  return arr.length === 0;
};

/**
 * Checks if the given array is non-empty.
 *
 * @template T Type of array elements
 * @param arr The array to check
 * @returns Returns true if the array is non-empty, otherwise false.
 */
export const isNonEmptyArray = <T>(
  arr: readonly T[],
): arr is NonEmptyArray<T> => {
  return arr.length > 0;
};

/**
 * Utility function to get a single character from the input string at the given offset,
 * taking surrogate pairs (Unicode code points) into account. Returns the character and its length in code units.
 *
 * @param input The input string
 * @param offset The position in the original string to start reading
 * @returns [The character at the given offset, its length in code units (1 or 2)]. Returns ["", 0] if out of range.
 */
export const getCharAndLength = (
  input: string,
  offset: number,
): [string, number] => {
  const code = input.codePointAt(offset);
  if (code === undefined) return ["", 0];
  const char = String.fromCodePoint(code);
  return [char, char.length];
};

/**
 * Utility function to calculate the next position after consuming a character.
 *
 * @param char The character being consumed
 * @param pos The current position
 * @returns The new position after consuming the character
 */
export const nextPos = (char: string, { offset, column, line }: Pos): Pos => {
  const isNewline = char === "\n";
  return {
    offset: offset + char.length,
    column: isNewline ? 0 : column + 1,
    line: isNewline ? line + 1 : line,
  };
};

/**
 * Creates a failure result.
 *
 * @param message Error message
 * @param pos Position where the error occurred
 * @param options Additional error information
 * @returns ParseFailure object
 */
export const createFailure = (
  message: string,
  pos: Pos,
  options?: Omit<import("./types").ParseError, "message" | "pos">,
): ParseFailure => {
  return {
    success: false,
    error: {
      message,
      pos,
      ...options,
    },
  };
};

/**
 * Utility function to run parsing from the beginning of the input.
 *
 * @template T Type of the parse result value
 * @param parser The parser to run
 * @returns Function that takes an input string and returns the parse result from the beginning of the input.
 */
export const parse =
  <T>(parser: Parser<T>) =>
  (input: string) =>
    parser(input, { offset: 0, column: 0, line: 1 });

/**
 * Type guard to check if a parse result is a failure.
 *
 * @template T Type of the parse result value
 * @param result The parse result to check
 * @returns Returns true if the result is a failure, otherwise false.
 */
export const isFailure = <T>(
  result: ParseResult<T>,
): result is ParseFailure => {
  return !result.success;
};

/**
 * Type guard to check if a parse result is a success.
 *
 * @template T Type of the parse result value
 * @param result The parse result to check
 * @returns Returns true if the result is a success, otherwise false.
 */
export const isSuccess = <T>(
  result: ParseResult<T>,
): result is ParseSuccess<T> => {
  return result.success;
};
