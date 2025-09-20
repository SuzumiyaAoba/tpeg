import type {
  NonEmptyArray,
  ParseError,
  ParseFailure,
  ParseResult,
  ParseSuccess,
  Parser,
  Pos,
} from "./types";

/**
 * Checks if the given array is empty.
 *
 * This utility function provides a type-safe way to check if an array is empty.
 * It uses TypeScript's type narrowing to ensure the return type is correctly
 * typed as an empty array when the condition is true.
 *
 * @template T - Type of array elements
 * @param arr - The array to check
 * @returns `true` if the array is empty, `false` otherwise
 *
 * @example
 * ```typescript
 * const empty: number[] = [];
 * const nonEmpty: number[] = [1, 2, 3];
 *
 * isEmptyArray(empty);   // true
 * isEmptyArray(nonEmpty); // false
 * ```
 */
export const isEmptyArray = <T>(arr: readonly T[]): arr is [] => {
  return arr.length === 0;
};

/**
 * Checks if the given array is non-empty.
 *
 * This utility function provides a type-safe way to check if an array contains
 * at least one element. It uses TypeScript's type narrowing to ensure the
 * return type is correctly typed as a NonEmptyArray when the condition is true.
 *
 * @template T - Type of array elements
 * @param arr - The array to check
 * @returns `true` if the array is non-empty, `false` otherwise
 *
 * @example
 * ```typescript
 * const empty: number[] = [];
 * const nonEmpty: number[] = [1, 2, 3];
 *
 * isNonEmptyArray(empty);   // false
 * isNonEmptyArray(nonEmpty); // true
 *
 * // Type narrowing example
 * function processArray<T>(arr: readonly T[]) {
 *   if (isNonEmptyArray(arr)) {
 *     // TypeScript knows arr is NonEmptyArray<T> here
 *     console.log("First element:", arr[0]);
 *   }
 * }
 * ```
 */
export const isNonEmptyArray = <T>(
  arr: readonly T[],
): arr is NonEmptyArray<T> => {
  return arr.length > 0;
};

/**
 * Gets a single character from the input string at the given offset.
 *
 * This function handles Unicode surrogate pairs correctly, ensuring that
 * multi-byte characters (like emojis) are treated as single characters.
 * It returns both the character and its length in code units.
 *
 * @param input - The input string to read from
 * @param offset - The position in the string to start reading (0-based)
 * @returns A tuple containing [character, length in code units]. Returns ["", 0] if out of range
 *
 * @example
 * ```typescript
 * const text = "Hello 🌍 World";
 *
 * getCharAndLength(text, 0);  // ["H", 1]
 * getCharAndLength(text, 6);  // ["🌍", 2] (emoji is 2 code units)
 * getCharAndLength(text, 20); // ["", 0] (out of range)
 * ```
 */
export const getCharAndLength = (
  input: string,
  offset: number,
): [string, number] => {
  if (offset < 0 || offset >= input.length) {
    return ["", 0];
  }

  const code = input.codePointAt(offset);
  if (code === undefined) return ["", 0];
  const char = String.fromCodePoint(code);
  return [char, char.length];
};

/**
 * Calculates the next position after consuming a character.
 *
 * This function updates the position information (offset, column, line)
 * based on the character that was consumed. It properly handles newline
 * characters by resetting the column and incrementing the line number.
 *
 * @param char - The character being consumed
 * @param pos - The current position information
 * @returns The new position after consuming the character
 *
 * @example
 * ```typescript
 * const pos = { offset: 0, column: 0, line: 1 };
 *
 * nextPos("H", pos);     // { offset: 1, column: 1, line: 1 }
 * nextPos("\n", pos);    // { offset: 1, column: 0, line: 2 }
 * nextPos("🌍", pos);    // { offset: 2, column: 1, line: 1 } (emoji is 2 code units)
 * ```
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
 * Creates a failure result with detailed error information.
 *
 * This function creates a standardized ParseFailure object with all
 * necessary error information. It's used throughout the parsing system
 * to provide consistent error reporting.
 *
 * @param message - Human-readable error message describing the failure
 * @param pos - Position where the error occurred
 * @param options - Additional error information (expected, found, parserName, context)
 * @returns A ParseFailure object with the specified error details
 *
 * @example
 * ```typescript
 * const pos = { offset: 5, column: 5, line: 1 };
 * const failure = createFailure(
 *   "Expected digit",
 *   pos,
 *   {
 *     expected: ["0-9"],
 *     found: "a",
 *     parserName: "digit"
 *   }
 * );
 * ```
 */
export const createFailure = (
  message: string,
  pos: Pos,
  options?: Omit<ParseError, "message" | "pos">,
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
 * Creates a parser function that runs from the beginning of input.
 *
 * This utility function wraps a parser to automatically start parsing
 * from the beginning of the input string (position 0, column 0, line 1).
 * It's useful for creating top-level parsers that don't need to track
 * their own position state.
 *
 * @template T - Type of the parse result value
 * @param parser - The parser function to wrap
 * @returns A function that takes an input string and returns the parse result
 *
 * @example
 * ```typescript
 * const digitParser: Parser<number> = (input, pos) => {
 *   const char = input[pos.offset];
 *   if (char >= '0' && char <= '9') {
 *     return {
 *       success: true,
 *       val: parseInt(char),
 *       current: pos,
 *       next: { ...pos, offset: pos.offset + 1, column: pos.column + 1 }
 *     };
 *   }
 *   return createFailure("Expected digit", pos);
 * };
 *
 * const parseDigit = parse(digitParser);
 * const result = parseDigit("5"); // Success: { val: 5, ... }
 * ```
 */
export const parse =
  <T>(parser: Parser<T>) =>
  (input: string) =>
    parser(input, { offset: 0, column: 0, line: 1 });

/**
 * Type guard to check if a parse result is a failure.
 *
 * This function provides a type-safe way to check if a parse result
 * represents a failure. When used in conditional statements, it enables
 * TypeScript's type narrowing to provide better type inference.
 *
 * @template T - Type of the parse result value
 * @param result - The parse result to check
 * @returns `true` if the result is a failure, `false` otherwise
 *
 * @example
 * ```typescript
 * function handleResult<T>(result: ParseResult<T>) {
 *   if (isFailure(result)) {
 *     // TypeScript knows result is ParseFailure here
 *     console.log("Parse failed:", result.error.message);
 *   } else {
 *     // TypeScript knows result is ParseSuccess<T> here
 *     console.log("Parse succeeded:", result.val);
 *   }
 * }
 * ```
 */
export const isFailure = <T>(
  result: ParseResult<T>,
): result is ParseFailure => {
  return !result.success;
};

/**
 * Type guard to check if a parse result is a success.
 *
 * This function provides a type-safe way to check if a parse result
 * represents a success. When used in conditional statements, it enables
 * TypeScript's type narrowing to provide better type inference.
 *
 * @template T - Type of the parse result value
 * @param result - The parse result to check
 * @returns `true` if the result is a success, `false` otherwise
 *
 * @example
 * ```typescript
 * function handleResult<T>(result: ParseResult<T>) {
 *   if (isSuccess(result)) {
 *     // TypeScript knows result is ParseSuccess<T> here
 *     console.log("Parse succeeded:", result.val);
 *   } else {
 *     // TypeScript knows result is ParseFailure here
 *     console.log("Parse failed:", result.error.message);
 *   }
 * }
 * ```
 */
export const isSuccess = <T>(
  result: ParseResult<T>,
): result is ParseSuccess<T> => {
  return result.success;
};

/**
 * Extracts the value from a successful parse result.
 *
 * This function safely extracts the parsed value from a successful result.
 * If the result is a failure, it throws an error with the failure message.
 * Use this when you're confident the parse will succeed or want to handle
 * failures with exceptions.
 *
 * @template T - Type of the parse result value
 * @param result - The parse result
 * @returns The parsed value
 * @throws {Error} If the result is a failure
 *
 * @example
 * ```typescript
 * try {
 *   const value = extractValue(parseResult);
 *   console.log("Parsed value:", value);
 * } catch (error) {
 *   console.error("Parse failed:", error.message);
 * }
 * ```
 */
export const extractValue = <T>(result: ParseResult<T>): T => {
  if (isSuccess(result)) {
    return result.val;
  }
  throw new Error(`Parse failed: ${result.error.message}`);
};

/**
 * Safely extracts the value from a successful parse result.
 *
 * This function safely extracts the parsed value from a successful result.
 * If the result is a failure, it returns `undefined` instead of throwing
 * an error. Use this when you want to handle failures gracefully without
 * exceptions.
 *
 * @template T - Type of the parse result value
 * @param result - The parse result
 * @returns The parsed value or `undefined` if the parse failed
 *
 * @example
 * ```typescript
 * const value = safeExtractValue(parseResult);
 * if (value !== undefined) {
 *   console.log("Parsed value:", value);
 * } else {
 *   console.log("Parse failed");
 * }
 * ```
 */
export const safeExtractValue = <T>(result: ParseResult<T>): T | undefined => {
  return isSuccess(result) ? result.val : undefined;
};

/**
 * Position object pool for memory efficiency.
 *
 * Reuses position objects to reduce garbage collection pressure
 * during intensive parsing operations.
 */
// Position pooling removed for simplicity and minimal overhead of small objects

/**
 * Creates a position object with default values.
 *
 * This utility function creates a standardized position object with
 * sensible defaults. It's useful for initializing position tracking
 * or creating position objects for testing.
 *
 * @param offset - Character offset from the start of input (default: 0)
 * @param column - Column number within the current line (default: 0)
 * @param line - Line number in the input (default: 1)
 * @returns A position object with the specified coordinates
 *
 * @example
 * ```typescript
 * createPos();           // { offset: 0, column: 0, line: 1 }
 * createPos(10, 5, 2);  // { offset: 10, column: 5, line: 2 }
 * createPos(5);          // { offset: 5, column: 0, line: 1 }
 * ```
 */
export const createPos = (offset = 0, column = 0, line = 1): Pos => ({
  offset,
  column,
  line,
});

/**
 * Releases a position object back to the pool for reuse.
 *
 * This function should be called when a position object is no longer needed
 * to improve memory efficiency during intensive parsing operations.
 *
 * @param pos - The position object to release
 *
 * @example
 * ```typescript
 * const pos = createPos(10, 5, 2);
 * // Use the position...
 * releasePos(pos);
 * ```
 */
export const releasePos = (_pos: Pos): void => {
  // no-op
};

/**
 * Advances position by a string, handling newlines correctly.
 *
 * This function calculates the new position after consuming a string,
 * properly handling newline characters by resetting the column and
 * incrementing the line number. It's useful for parsers that consume
 * multiple characters at once.
 *
 * @param str - The string to advance by
 * @param pos - The current position
 * @returns The new position after consuming the string
 *
 * @example
 * ```typescript
 * const pos = { offset: 0, column: 0, line: 1 };
 *
 * advancePos("Hello", pos);           // { offset: 5, column: 5, line: 1 }
 * advancePos("Hello\nWorld", pos);    // { offset: 11, column: 5, line: 2 }
 * advancePos("🌍", pos);              // { offset: 2, column: 1, line: 1 }
 * ```
 */
export const advancePos = (str: string, pos: Pos): Pos => {
  let { offset, column, line } = pos;

  for (const char of str) {
    if (char === "\n") {
      line++;
      column = 0;
    } else {
      column++;
    }
    // Advance by code units to keep offset aligned with string indexing
    offset += char.length;
  }

  return { offset, column, line };
};

/**
 * Calculates the length of a string in terms of Unicode code points.
 *
 * This function counts the number of Unicode code points in a string,
 * which is different from the string's length property when the string
 * contains surrogate pairs (like emojis). It uses a for...of loop
 * to properly iterate over Unicode code points.
 *
 * @param str - The string to measure
 * @returns The number of Unicode code points in the string
 *
 * @example
 * ```typescript
 * unicodeLength("Hello");     // 5
 * unicodeLength("🌍");        // 1 (not 2 like str.length)
 * unicodeLength("Hello 🌍");  // 7 (not 8 like str.length)
 * unicodeLength("");          // 0
 * ```
 */
export const unicodeLength = (str: string): number => {
  let count = 0;
  for (const _ of str) {
    count++;
  }
  return count;
};

/**
 * Calculates the number of grapheme clusters (user-perceived characters) in a string.
 *
 * This function uses the Intl.Segmenter API to properly count grapheme clusters,
 * which are the units that users perceive as single characters. This is different
 * from unicodeLength which counts code points, and from str.length which counts
 * code units.
 *
 * Grapheme clusters handle complex cases like:
 * - Emoji with skin tone modifiers (👨‍👩‍👧‍👦 = 1 grapheme, 7 code points)
 * - Combining characters (é = 1 grapheme, 2 code points)
 * - Zero-width joiners (ZWJ) sequences
 *
 * @param str - The string to count graphemes in
 * @returns The number of grapheme clusters in the string
 *
 * @example
 * ```typescript
 * unicodeGraphemeLength("Hello");           // 5
 * unicodeGraphemeLength("🌍");              // 1
 * unicodeGraphemeLength("👨‍👩‍👧‍👦");        // 1 (family emoji)
 * unicodeGraphemeLength("café");            // 4 (é is 1 grapheme)
 * unicodeGraphemeLength("Hello 🌍 World");  // 13
 * unicodeGraphemeLength("");                // 0
 * ```
 */
export const unicodeGraphemeLength = (str: string): number => {
  if (!str) return 0;

  try {
    // biome-ignore lint/suspicious/noExplicitAny: Intl.Segmenter is not in TypeScript types yet
    const segmenter = new (Intl as any).Segmenter("en", {
      granularity: "grapheme",
    });
    const segments = segmenter.segment(str);
    let count = 0;
    for (const _ of segments) {
      count++;
    }
    return count;
  } catch (error) {
    // Fallback to unicodeLength if Intl.Segmenter is not available
    const silenceWarn =
      (globalThis as any).process?.env?.["TPEG_SILENCE_SEGMENTER_WARN"];
    if (!silenceWarn) {
      console.warn(
        "Intl.Segmenter not available, falling back to unicodeLength:",
        error,
      );
    }
    return unicodeLength(str);
  }
};

/**
 * Checks if a character is a whitespace character.
 *
 * This function uses a regular expression to check if a character
 * is considered whitespace according to Unicode standards. It includes
 * spaces, tabs, newlines, and other whitespace characters.
 *
 * @param char - The character to check
 * @returns `true` if the character is whitespace, `false` otherwise
 *
 * @example
 * ```typescript
 * isWhitespace(" ");   // true
 * isWhitespace("\t");  // true
 * isWhitespace("\n");  // true
 * isWhitespace("a");   // false
 * isWhitespace("1");   // false
 * ```
 */
export const isWhitespace = (char: string): boolean => {
  return /\s/.test(char);
};

/**
 * Checks if a character is a newline character.
 *
 * This function checks if a character represents a line break.
 * It recognizes common newline sequences: `\n` (LF), `\r` (CR),
 * and `\r\n` (CRLF). Note that this function checks individual
 * characters, so `\r\n` should be checked as two separate calls.
 *
 * @param char - The character to check
 * @returns `true` if the character is a newline, `false` otherwise
 *
 * @example
 * ```typescript
 * isNewline("\n");     // true
 * isNewline("\r");     // true
 * isNewline("a");      // false
 * isNewline(" ");      // false
 * ```
 */
export const isNewline = (char: string): boolean => {
  return char === "\n" || char === "\r";
};
