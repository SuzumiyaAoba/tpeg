import type { NonEmptyString, ParseResult, Parser, Pos } from "./types";
import { createFailure, getCharAndLength, nextPos } from "./utils";

/**
 * Parser that parses any single character from the input.
 *
 * This parser succeeds when there is at least one character available at the current
 * position in the input string. It fails only when it encounters the end of input.
 * The parser is Unicode-aware and will correctly handle multi-byte characters.
 *
 * **Performance Characteristics:**
 * - O(1) time complexity for ASCII characters
 * - O(n) time complexity for Unicode characters where n is the number of code units
 * - Memory efficient with minimal allocations
 *
 * **Unicode Handling:**
 * - Correctly handles surrogate pairs (e.g., emojis)
 * - Properly updates position for multi-code-unit characters
 * - Maintains accurate line/column tracking for newlines
 *
 * @param parserName - Optional name for the parser, used in error messages for debugging. Defaults to "anyChar"
 * @returns A parser function that accepts input string and position, returning a ParseResult containing the matched character
 *
 * @example
 * ```typescript
 * // Basic usage
 * const parser = anyChar();
 * const result = parser("hello", { offset: 0, line: 1, column: 1 });
 * // result: { success: true, val: "h", current: {...}, next: {...} }
 *
 * // End of input handling
 * const endResult = parser("", { offset: 0, line: 1, column: 1 });
 * // endResult: { success: false, error: "Unexpected end of input", ... }
 *
 * // Unicode support
 * const unicodeResult = parser("🌍", { offset: 0, line: 1, column: 1 });
 * // unicodeResult: { success: true, val: "🌍", current: {...}, next: {...} }
 *
 * // Custom parser name for debugging
 * const customParser = anyChar("character");
 * const debugResult = customParser("", { offset: 0, line: 1, column: 1 });
 * // debugResult.error.parserName === "character"
 * ```
 *
 * @example
 * ```typescript
 * // Real-world usage: parsing user input
 * const userInput = "Hello 🌍 World!";
 * let pos = { offset: 0, line: 1, column: 1 };
 *
 * const charParser = anyChar("user input character");
 * const result = charParser(userInput, pos);
 *
 * if (result.success) {
 *   console.log(`Found character: ${result.val}`);
 *   pos = result.next; // Update position for next parsing
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Integration with other parsers
 * import { sequence, literal } from "./combinators";
 *
 * const greetingParser = sequence(
 *   literal("Hello"),
 *   anyChar("space or punctuation"),
 *   anyChar("next character")
 * );
 *
 * const result = greetingParser("Hello! How are you?", { offset: 0, line: 1, column: 1 });
 * // result.val will be ["Hello", "!", " "]
 * ```
 */
export const anyChar =
  (parserName = "anyChar"): Parser<string> =>
  (input: string, pos: Pos) => {
    const [char] = getCharAndLength(input, pos.offset);

    if (!char) {
      return createFailure("Unexpected end of input", pos, {
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
 * Alias for {@link anyChar} with a shorter name.
 *
 * This is a convenience function that creates an anyChar parser with the name "any".
 * Functionally identical to calling `anyChar("any")`.
 *
 * @returns A parser function that matches any single character
 * @see {@link anyChar} for full documentation and examples
 */
export const any = anyChar("any");

/**
 * Checks if a string can be processed by the optimized string parsing path.
 *
 * The optimized path is used for ASCII-only strings that don't contain newlines,
 * allowing for faster parsing by avoiding complex Unicode handling. This function
 * uses a regex to check for ASCII printable characters (32-126) plus common
 * whitespace characters (tab and carriage return), but excludes newlines.
 *
 * @param str - The string to check for optimization eligibility
 * @returns `true` if the string can use the optimized parsing path, `false` otherwise
 *
 * @internal This is an internal optimization function
 *
 * @example
 * ```typescript
 * canUseOptimizedPath("hello world"); // true
 * canUseOptimizedPath("hello\nworld"); // false (contains newline)
 * canUseOptimizedPath("café"); // false (contains non-ASCII character)
 * ```
 */
const canUseOptimizedPath = (() => {
  // Simplified cache with fixed size for better performance
  const cache = new Map<string, boolean>();
  const MAX_CACHE_SIZE = 1000; // Fixed size for simplicity and predictability

  // Pre-compiled regex for better performance
  const asciiRegex = /^[ -~\t\r]*$/;

  return (str: string): boolean => {
    // Check cache first
    const cached = cache.get(str);
    if (cached !== undefined) {
      return cached;
    }

    // Use a more efficient check for ASCII-only strings without newlines
    // Check for ASCII printable characters (32-126) plus common whitespace (except newline)
    const result = asciiRegex.test(str) && !str.includes("\n");

    // Simple cache management: clear when full
    if (cache.size >= MAX_CACHE_SIZE) {
      cache.clear();
    }

    cache.set(str, result);
    return result;
  };
})();

/**
 * Simple implementation for string literals that don't need complex Unicode handling.
 *
 * This function provides an optimized parsing path for ASCII-only strings without
 * newlines. It uses simple string slicing and comparison operations, which are
 * significantly faster than character-by-character Unicode-aware parsing.
 *
 * @template T - The exact string literal type being parsed
 * @param str - The string literal to match against the input
 * @param input - The input string being parsed
 * @param pos - The current parsing position
 * @param parserName - Optional name for error reporting, defaults to "literal"
 * @returns A ParseResult indicating success with the matched string or failure with error details
 *
 * @internal This is an internal optimization function used by the literal parser
 *
 * @example
 * ```typescript
 * const result = parseSimpleString("hello", "hello world", { offset: 0, line: 1, column: 1 });
 * // result: { success: true, val: "hello", current: {...}, next: {...} }
 * ```
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
    // Use the already sliced input for comparison to avoid double indexing
    for (let i = 0; i < str.length; i++) {
      if (inputSlice[i] !== str[i]) {
        const errorPos = {
          offset: offset + i,
          column: column + i,
          line,
        };
        const foundChar = inputSlice[i] ?? "EOF";
        const expectedChar = str[i] ?? "EOF";
        return createFailure(
          `Unexpected character "${foundChar}" at position ${
            offset + i
          }, expected "${expectedChar}"`,
          errorPos,
          {
            ...(str[i] !== undefined && { expected: str[i] }),
            ...(inputSlice[i] !== undefined && {
              found: inputSlice[i],
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
 *
 * This function provides Unicode-aware parsing for strings that contain non-ASCII
 * characters or newlines. It processes the string character by character, properly
 * handling multi-byte Unicode sequences and updating line/column positions for
 * newline characters.
 *
 * @template T - The exact string literal type being parsed
 * @param str - The string literal to match against the input
 * @param input - The input string being parsed
 * @param pos - The current parsing position
 * @param parserName - Optional name for error reporting, defaults to "literal"
 * @returns A ParseResult indicating success with the matched string or failure with error details
 *
 * @internal This is an internal function used by the literal parser for Unicode strings
 *
 * @example
 * ```typescript
 * const result = parseComplexString("café", "café au lait", { offset: 0, line: 1, column: 1 });
 * // result: { success: true, val: "café", current: {...}, next: {...} }
 * ```
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
    const strCode = str.codePointAt(i);
    if (strCode === undefined) {
      // This should never happen with a valid string, but handle it gracefully
      return createFailure(
        `Invalid string literal: unexpected end at position ${i}`,
        currentPos,
        {
          expected: str,
          found: "invalid string",
          parserName,
        },
      );
    }

    const strChar = String.fromCodePoint(strCode);
    const strCharLen = strChar.length;

    // Get the character from the input
    const [inputChar] = getCharAndLength(input, currentPos.offset);

    if (inputChar === "") {
      return createFailure(
        `Expected "${str}" but reached end of input`,
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
        `Expected "${strChar}" but found "${inputChar}" at position ${currentPos.offset}`,
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
 * Performance measurement utility for parser operations
 *
 * @internal This is an internal utility for performance testing
 */
export const benchmarkParser = <T>(
  name: string,
  parser: Parser<T>,
  input: string,
  iterations = 1000,
): { name: string; avgTime: number; totalTime: number; iterations: number } => {
  const pos = { offset: 0, line: 1, column: 1 };

  // Warm up
  for (let i = 0; i < 10; i++) {
    parser(input, pos);
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    parser(input, pos);
  }
  const end = performance.now();

  const totalTime = end - start;
  const avgTime = totalTime / iterations;

  return {
    name,
    avgTime,
    totalTime,
    iterations,
  };
};

/**
 * Parser for literal string matching.
 *
 * Creates a parser that matches an exact string literal in the input. The parser
 * automatically chooses between an optimized implementation for simple ASCII strings
 * and a Unicode-aware implementation for complex strings. The optimization is
 * determined at parser creation time for maximum efficiency.
 *
 * The parser succeeds if the input at the current position exactly matches the
 * provided string literal. It fails if there's a mismatch or insufficient input.
 * Error messages include detailed information about the expected vs. found characters.
 *
 * @template T - The exact string literal type, preserving the literal type for type safety
 * @param str - The string literal to match. Must be a non-empty string
 * @param parserName - Optional name for the parser, used in error messages. Defaults to "literal"
 * @returns A parser function that matches the specified string literal
 *
 * @example
 * ```typescript
 * // Basic usage
 * const helloParser = literal("hello");
 * const result = helloParser("hello world", { offset: 0, line: 1, column: 1 });
 * // result: { success: true, val: "hello", current: {...}, next: {...} }
 *
 * // With custom parser name for debugging
 * const keywordParser = literal("function", "keyword");
 *
 * // Unicode support
 * const unicodeParser = literal("café");
 * const unicodeResult = unicodeParser("café", { offset: 0, line: 1, column: 1 });
 * // result: { success: true, val: "café", current: {...}, next: {...} }
 *
 * // Failure case
 * const failResult = helloParser("hi there", { offset: 0, line: 1, column: 1 });
 * // failResult: { success: false, error: "Unexpected character...", ... }
 * ```
 *
 * @example
 * ```typescript
 * // Programming language keyword parsing
 * const keywords = ["function", "const", "let", "var", "if", "else"];
 * const keywordParsers = keywords.map(kw => literal(kw, `keyword:${kw}`));
 *
 * const functionParser = keywordParsers[0];
 * const result = functionParser("function myFunc() {}", { offset: 0, line: 1, column: 1 });
 * // result: { success: true, val: "function", ... }
 * ```
 *
 * @example
 * ```typescript
 * // Multi-line string parsing
 * const multilineParser = literal("line1\nline2");
 * const result = multilineParser("line1\nline2\nline3", { offset: 0, line: 1, column: 1 });
 * // result: { success: true, val: "line1\nline2", next: { line: 3, column: 0, ... } }
 * ```
 *
 * @example
 * ```typescript
 * // Performance optimization example
 * const asciiParser = literal("hello world"); // Uses optimized path
 * const unicodeParser = literal("こんにちは"); // Uses Unicode path
 *
 * // Both work correctly, but ASCII strings are faster
 * const asciiResult = asciiParser("hello world extra", { offset: 0, line: 1, column: 1 });
 * const unicodeResult = unicodeParser("こんにちは世界", { offset: 0, line: 1, column: 1 });
 * ```
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
 * Alias for {@link literal} with a shorter name.
 *
 * This is a convenience function that provides the same functionality as `literal`
 * but with a more concise name for frequent use in parser compositions.
 *
 * @template T - The exact string literal type
 * @param str - The string literal to match
 * @returns A parser function that matches the specified string literal
 * @see {@link literal} for full documentation and examples
 */
export const lit = literal;
