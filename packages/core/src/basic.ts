import { ASCII_CHARS } from "./char-tables";
import { escapeControlCharsForDisplay } from "./escape";
import type { Expectation } from "./failure";
import { fail } from "./failure";
import type { NonEmptyString, ParseResult, Parser } from "./types";
import { advancePos, getCharAt, isValidOffset, nextPos } from "./utils";

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
 * const result = parser("hello", 0);
 * // result: { success: true, val: "h", current: {...}, next: {...} }
 *
 * // End of input handling
 * const endResult = parser("", 0);
 * // endResult: { success: false, error: "Unexpected EOI", ... }
 *
 * // Unicode support
 * const unicodeResult = parser("🌍", 0);
 * // unicodeResult: { success: true, val: "🌍", current: {...}, next: {...} }
 *
 * // Custom parser name for debugging
 * const customParser = anyChar("character");
 * const debugResult = customParser("", 0);
 * // debugResult.error.parserName === "character"
 * ```
 *
 * @example
 * ```typescript
 * // Real-world usage: parsing user input
 * const userInput = "Hello 🌍 World!";
 * let pos = 0;
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
 * const result = greetingParser("Hello! How are you?", 0);
 * // result.val will be ["Hello", "!", " "]
 * ```
 */
export const anyChar = (parserName = "anyChar"): Parser<string> => {
  // Allocated once per `anyChar(...)` call (construction time), not once
  // per attempted match -- see `./failure.ts`'s `Expectation` doc comment.
  const expectation: Expectation = { label: "any character", parserName };
  return (input: string, pos: number) => {
    // Same hot-path shape as `charClass`/`negatedCharClass`
    // (`./char-class.ts`'s `makeCharClassParser`), with both membership
    // tests removed -- `anyChar` matches everything but end-of-input.
    // `isValidOffset` first: `(pos >>> 0)` alone folds a negative `pos`
    // into a huge unsigned value, but a fractional/`NaN`/`>= 2**32` `pos`
    // used to pass it and reach `charCodeAt`/`codePointAt`, which coerce
    // the index (truncate/`NaN`) and returned bogus successes like
    // `{ current: 0.5, next: 1.5 }` or an empty-string match at
    // `pos = 2**32` (`./utils.ts`).
    if (!isValidOffset(pos) || pos >= input.length) {
      return fail(input, pos, expectation);
    }

    const code = input.charCodeAt(pos);
    if (code < 128) {
      return {
        success: true,
        val: ASCII_CHARS[code] as string,
        current: pos,
        next: pos + 1,
      };
    }

    const cp = input.codePointAt(pos) as number;
    const len = cp > 0xffff ? 2 : 1;
    return {
      success: true,
      val: input.slice(pos, pos + len),
      current: pos,
      next: pos + len,
    };
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
  // Pre-compiled regex for better performance
  const asciiRegex = /^[ -~\t\r]*$/;

  return (str: string): boolean => {
    return asciiRegex.test(str);
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
 * const result = parseSimpleString("hello", "hello world", 0);
 * // result: { success: true, val: "hello", current: {...}, next: {...} }
 * ```
 */
const parseSimpleString = <T extends string>(
  str: NonEmptyString<T>,
  input: string,
  pos: number,
  expectation: Expectation,
): ParseResult<T> => {
  // Fast path for ASCII-only strings with no newlines
  const offset = pos;

  // An out-of-contract `pos` must fail BEFORE the length check below:
  // `offset + str.length > input.length` is `false` for `offset = -1`
  // (`-1 + 1 = 0 > len` never holds), after which `input.startsWith(str,
  // -1)` CLAMPS the start index to 0 and "matches" a character that was
  // never at `pos` -- likewise `startsWith(str, 0.5)`/`(str, NaN)`
  // truncate/coerce to 0. Every other leaf parser already rejects such
  // positions (`./utils.ts`'s `isValidOffset`); `pos = input.length`
  // remains a legal offset that simply has no characters left to match,
  // handled by the length check as before.
  if (!isValidOffset(offset)) {
    return fail(input, pos, expectation);
  }

  // A `pos` at or past end-of-input has no characters left to match at
  // all, so it reports there unconditionally. `offset < input.length`
  // with insufficient input remaining falls through to the shared
  // mismatch scan below instead: that scan compares the truncated
  // `inputSlice` element-by-element and reports the FIRST divergence --
  // the offset where the remainder actually stops matching `str`, which
  // is exactly `input.length` when the input is a genuine prefix of `str`
  // ("comp" vs "complete" -> "end of input") but the real mismatch offset
  // when it is not ("k=12" vs "while" -> the 'k' at `offset`, not a bogus
  // "expected at EOF" the literal never even partially matched).
  if (offset >= input.length) {
    return fail(input, input.length, expectation);
  }

  // Avoid allocating a substring on the (common) success path
  if (!input.startsWith(str, offset)) {
    // Find the first mismatched character, for a more precise farthest-
    // failure position than `pos` (the literal's start) -- the watermark
    // (`./failure.ts`) only ever gets MORE useful from a more precise
    // position, and this loop only runs on the (discarded) failure path.
    // `input.slice` clamps its end index to `input.length`, so when fewer
    // than `str.length` characters remain `inputSlice` is simply shorter
    // and the first out-of-range index (where `inputSlice[i]` is
    // `undefined`, which cannot equal `str[i]`) reports at exactly
    // `input.length` -- the "input ran out mid-match" case above.
    const inputSlice = input.slice(offset, offset + str.length);
    for (let i = 0; i < str.length; i++) {
      if (inputSlice[i] !== str[i]) {
        return fail(input, offset + i, expectation);
      }
    }
    // Unreachable: the loop above always finds a mismatch when
    // `startsWith` returned false, but keep a well-typed fallback.
    return fail(input, pos, expectation);
  }

  // Success - all characters matched
  return {
    success: true,
    val: str,
    current: pos,
    next: offset + str.length,
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
 * const result = parseComplexString("café", "café au lait", 0);
 * // result: { success: true, val: "café", current: {...}, next: {...} }
 * ```
 */
const parseComplexString = <T extends string>(
  str: NonEmptyString<T>,
  input: string,
  pos: number,
  expectation: Expectation,
): ParseResult<T> => {
  const offset = pos;

  // Same out-of-contract-`pos` guard as `parseSimpleString` above (see
  // its comment): `startsWith`/`slice` would otherwise clamp or truncate
  // a negative/fractional/`NaN` offset into a real index and "match" a
  // character that was never at `pos`.
  if (!isValidOffset(offset)) {
    return fail(input, pos, expectation);
  }

  // A `pos` at or past end-of-input reports there unconditionally; with
  // insufficient input remaining, the character-by-character loop below
  // already reports the first real divergence (or `input.length` when the
  // input is a genuine prefix of `str`, where `getCharAt` returns "" --
  // see `parseSimpleString`'s equivalent branch for why that position is
  // the right "input ran out" report rather than a bogus EOF claim for an
  // input that mismatched earlier).
  if (offset >= input.length) {
    return fail(input, input.length, expectation);
  }

  // Fast path: avoid allocating a substring on the (common) success path
  if (input.startsWith(str, offset)) {
    return {
      success: true,
      val: str,
      current: pos,
      next: advancePos(str, pos),
    };
  }

  // Fallback: character-by-character search to find the precise mismatch
  // point (see `parseSimpleString`'s equivalent comment).
  let currentPos = pos;
  let i = 0;

  while (i < str.length) {
    const strCode = str.codePointAt(i);
    if (strCode === undefined) {
      break;
    }

    const strChar = String.fromCodePoint(strCode);
    const strCharLen = strChar.length;

    const inputChar = getCharAt(input, currentPos);

    if (inputChar === "" || inputChar !== strChar) {
      return fail(input, currentPos, expectation);
    }

    currentPos = nextPos(inputChar, currentPos);
    i += strCharLen;
  }

  return fail(input, pos, expectation);
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
  const pos = 0;

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
 * const result = helloParser("hello world", 0);
 * // result: { success: true, val: "hello", current: {...}, next: {...} }
 *
 * // With custom parser name for debugging
 * const keywordParser = literal("function", "keyword");
 *
 * // Unicode support
 * const unicodeParser = literal("café");
 * const unicodeResult = unicodeParser("café", 0);
 * // result: { success: true, val: "café", current: {...}, next: {...} }
 *
 * // Failure case
 * const failResult = helloParser("hi there", 0);
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
 * const result = functionParser("function myFunc() {}", 0);
 * // result: { success: true, val: "function", ... }
 * ```
 *
 * @example
 * ```typescript
 * // Multi-line string parsing
 * const multilineParser = literal("line1\nline2");
 * const result = multilineParser("line1\nline2\nline3", 0);
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
 * const asciiResult = asciiParser("hello world extra", 0);
 * const unicodeResult = unicodeParser("こんにちは世界", 0);
 * ```
 */
export const literal = <T extends string>(
  str: NonEmptyString<T>,
  parserName = "literal",
): Parser<T> => {
  // Check once during parser creation to avoid repeated checks
  const useOptimizedPath = canUseOptimizedPath(str);
  // One `Expectation` per `literal(...)` call, not per attempted match --
  // replaces the old per-character `expected: str[i]` (a different
  // expectation object built on every mismatched character) with a single
  // top-level "expected this whole literal" description. See
  // `./failure.ts`'s `Expectation` doc comment.
  // Control characters escaped for display (`"\\n"`, not a raw line
  // break inside the error message) -- see `escapeControlCharsForDisplay`.
  const expectation: Expectation = {
    label: `"${escapeControlCharsForDisplay(str)}"`,
    parserName,
  };

  return (input: string, pos: number) => {
    if (useOptimizedPath) {
      return parseSimpleString(str, input, pos, expectation);
    }

    // Use complex path for Unicode strings
    return parseComplexString(str, input, pos, expectation);
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
