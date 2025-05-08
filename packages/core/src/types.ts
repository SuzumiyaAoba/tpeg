/**
 * Type representing a non-empty array.
 *
 * This type ensures that the array contains at least one element.
 *
 * @template T Type of array elements
 */
export type NonEmptyArray<T> = [T, ...T[]];

/**
 * Type representing a non-empty string.
 *
 * @template T String type (defaults to string)
 * @example
 *   const s: NonEmptyString<"abc"> = "abc"; // OK
 *   const s2: NonEmptyString<""> = never; // Error
 */
export type NonEmptyString<T extends string = string> = T extends ""
  ? never
  : T;

/**
 * Input position information in the source string.
 *
 * @property offset The absolute offset from the start of the input (0-based)
 * @property column The column number (0-based)
 * @property line The line number (1-based)
 */
export type Pos = {
  readonly offset: number;
  readonly column: number;
  readonly line: number;
};

/**
 * Result of successful parsing.
 *
 * @template T Type of the parse result value
 * @property success Always true
 * @property val The parsed value
 * @property current The position before parsing
 * @property next The position after parsing
 */
export type ParseSuccess<T> = {
  success: true;
  val: T;
  current: Pos;
  next: Pos;
};

/**
 * Result of failed parsing.
 *
 * @property success Always false
 * @property error The error information
 */
export type ParseFailure = {
  success: false;
  error: ParseError;
};

/**
 * Parse result (success or failure).
 *
 * @template T Type of the parse result value
 * @see ParseSuccess
 * @see ParseFailure
 */
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

/**
 * Parse error information.
 *
 * @property message Error message
 * @property pos Position where the error occurred
 * @property expected What was expected at this position
 * @property found What was actually found at this position
 * @property parserName Name of the parser that caused the error
 * @property context Information about parser context (e.g. the rule name or path)
 */
export interface ParseError {
  message: string;
  pos: Pos;
  expected?: string | string[];
  found?: string;
  parserName?: string;
  context?: string | string[];
}

/**
 * Parser function type.
 *
 * @template T Type of the parse result value
 * @param input The input string to parse
 * @param pos The current position in the input
 * @returns ParseResult<T> The result of parsing (success or failure)
 */
export type Parser<T> = (input: string, pos: Pos) => ParseResult<T>;
