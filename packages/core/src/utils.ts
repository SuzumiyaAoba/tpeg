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
 * Gets a single character from the input string at the given offset,
 * without allocating the `[char, length]` tuple that {@link getCharAndLength}
 * returns. Use this when only the character itself is needed.
 *
 * @param input - The input string to read from
 * @param offset - The position in the string to start reading (0-based)
 * @returns The character at `offset` (may be a surrogate pair), or "" if out of range
 *
 * @example
 * ```typescript
 * const text = "Hello 🌍 World";
 *
 * getCharAt(text, 0);  // "H"
 * getCharAt(text, 6);  // "🌍" (emoji is 2 code units)
 * getCharAt(text, 20); // "" (out of range)
 * ```
 */
export const getCharAt = (input: string, offset: number): string => {
  if (offset < 0 || offset >= input.length) {
    return "";
  }

  const code = input.codePointAt(offset);
  if (code === undefined) return "";
  return String.fromCodePoint(code);
};

/**
 * Calculates the next offset after consuming a character.
 *
 * The threaded parser position is a plain offset now (see `Parser` in
 * `./types.ts`), so this is just `offset + char.length` -- no `Pos`
 * object, no line/column bookkeeping, on every single character
 * consumed during parsing. Line/column are recovered on demand, only
 * when something actually asks for them, via `offsetToPos` below.
 *
 * @param char - The character being consumed
 * @param pos - The current offset
 * @returns The offset after consuming the character
 *
 * @example
 * ```typescript
 * nextPos("H", 0);     // 1
 * nextPos("🌍", 0);    // 2 (emoji is 2 code units)
 * ```
 */
export const nextPos = (char: string, pos: number): number => pos + char.length;

/**
 * Creates a failure result with detailed error information.
 *
 * This function creates a standardized ParseFailure object with all
 * necessary error information. It's used throughout the parsing system
 * to provide consistent error reporting.
 *
 * `message` and `pos` always win over same-named keys in `options`. This
 * matters for callers that build a wrapper error by spreading a child
 * error's fields (`{ ...childError, parserName: "sequence" }`) while also
 * passing their own, more contextual `message`/`pos` explicitly -- the
 * explicit arguments are the ones that end up on the returned error.
 *
 * @param message - Human-readable error message describing the failure
 * @param pos - Offset where the error occurred
 * @param options - Additional error information (expected, found, parserName, context)
 * @returns A ParseFailure object with the specified error details
 *
 * @example
 * ```typescript
 * const failure = createFailure(
 *   "Expected digit",
 *   5,
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
  pos: number,
  options?: Omit<ParseError, "message" | "pos">,
): ParseFailure => {
  return {
    success: false,
    error: {
      ...options,
      message,
      pos,
    },
  };
};

/**
 * Creates a parser function that runs from the beginning of input.
 *
 * This utility function wraps a parser to automatically start parsing
 * from the beginning of the input string (offset 0). It's useful for
 * creating top-level parsers that don't need to track their own
 * position state.
 *
 * @template T - Type of the parse result value
 * @param parser - The parser function to wrap
 * @returns A function that takes an input string and returns the parse result
 *
 * @example
 * ```typescript
 * const digitParser: Parser<number> = (input, pos) => {
 *   const char = input[pos];
 *   if (char >= '0' && char <= '9') {
 *     return {
 *       success: true,
 *       val: parseInt(char),
 *       current: pos,
 *       next: pos + 1
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
    parser(input, 0);

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
 * Creates an initial offset. Kept as a named function (rather than
 * inlining `0` at every call site) mainly for test readability and for
 * the rare caller that wants to start somewhere other than the
 * beginning of input.
 *
 * @param offset - Character offset from the start of input (default: 0)
 * @returns The offset
 *
 * @example
 * ```typescript
 * createPos();    // 0
 * createPos(10);  // 10
 * ```
 */
export const createPos = (offset = 0): number => offset;

/**
 * Advances an offset by a string's length (in UTF-16 code units, so the
 * result stays aligned with plain string indexing).
 *
 * This used to also maintain line/column, incrementing the line and
 * resetting the column on every `\n` seen -- see `offsetToPos` below for
 * where that bookkeeping now happens: lazily, on demand, not on every
 * multi-character match during parsing.
 *
 * @param str - The string to advance by
 * @param pos - The current offset
 * @returns The offset after consuming the string
 *
 * @example
 * ```typescript
 * advancePos("Hello", 0);        // 5
 * advancePos("Hello\nWorld", 0); // 11
 * advancePos("🌍", 0);           // 2
 * ```
 */
export const advancePos = (str: string, pos: number): number =>
  pos + str.length;

/**
 * Single-entry cache of the last input's newline offsets, keyed by
 * reference/value equality on the input string itself (strings can't be
 * `WeakMap` keys, and a `Map` keyed by arbitrary input strings would
 * grow unboundedly across many different parses -- a single slot,
 * overwritten whenever a different input shows up, bounds memory while
 * still amortizing repeated `offsetToPos` calls against the SAME input,
 * which is the common case: `withPosition` inside a repetition, or
 * multiple diagnostics from formatting one parse's error).
 */
let cachedNewlineIndexInput: string | null = null;
let cachedNewlineIndexOffsets: Uint32Array | null = null;

const getNewlineOffsets = (input: string): Uint32Array => {
  if (cachedNewlineIndexInput === input && cachedNewlineIndexOffsets) {
    return cachedNewlineIndexOffsets;
  }
  const offsets: number[] = [];
  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) === 10 /* "\n" */) offsets.push(i);
  }
  const result = Uint32Array.from(offsets);
  cachedNewlineIndexInput = input;
  cachedNewlineIndexOffsets = result;
  return result;
};

/**
 * Recovers the line/column a given offset falls on, for callers that
 * explicitly need them (error formatting in `./error.ts`, `withPosition`
 * in `tpeg-combinator`) -- NOT maintained incrementally during parsing
 * anymore (see `Parser` in `./types.ts`'s doc comment).
 *
 * Line lookup is O(log n) (binary search over a per-input newline-offset
 * index, cached across repeated calls against the same input -- see
 * `getNewlineOffsets`). Column is then counted in *code points* (to
 * match what per-character `nextPos` used to produce -- a line
 * containing an astral character must not count it as 2 columns) by
 * scanning from the start of that line up to `offset`, an O(line
 * length) walk. Both costs are fine here specifically because this
 * function runs only on demand (once per formatted error, or once per
 * `withPosition` call), never once per character consumed.
 *
 * @example
 * ```typescript
 * offsetToPos("ab\ncd", 0); // { offset: 0, line: 1, column: 0 }
 * offsetToPos("ab\ncd", 4); // { offset: 4, line: 2, column: 1 }
 * ```
 */
export const offsetToPos = (input: string, offset: number): Pos => {
  const newlineOffsets = getNewlineOffsets(input);

  let lo = 0;
  let hi = newlineOffsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((newlineOffsets[mid] as number) < offset) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const newlinesBefore = lo;
  const line = newlinesBefore + 1;
  const lineStart =
    newlinesBefore === 0
      ? 0
      : (newlineOffsets[newlinesBefore - 1] as number) + 1;

  let column = 0;
  let i = lineStart;
  while (i < offset) {
    const codePoint = input.codePointAt(i);
    i += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    column++;
  }

  return { offset, line, column };
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
// Lazily constructed once and reused across calls: Intl.Segmenter construction
// has non-trivial setup cost, and the locale/options here never change.
let graphemeSegmenter: Intl.Segmenter | null | undefined;

export const unicodeGraphemeLength = (str: string): number => {
  if (!str) return 0;

  try {
    if (graphemeSegmenter === undefined) {
      graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    }
    if (graphemeSegmenter === null) {
      throw new Error("Intl.Segmenter unavailable");
    }
    const segments = graphemeSegmenter.segment(str);
    let count = 0;
    for (const _ of segments) {
      count++;
    }
    return count;
  } catch (error) {
    graphemeSegmenter = null;
    // Fallback to unicodeLength if Intl.Segmenter is not available
    const silenceWarn = (() => {
      const g = globalThis as unknown as {
        process?: { env?: Record<string, string | undefined> };
      };
      return g.process?.env?.["TPEG_SILENCE_SEGMENTER_WARN"];
    })();
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
const WHITESPACE_REGEX = /\s/;

export const isWhitespace = (char: string): boolean => {
  return WHITESPACE_REGEX.test(char);
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

/**
 * Prepends one or more labels to an error's `context`, normalizing the
 * existing context (which may be a single string, an array, or absent)
 * into a flat array.
 *
 * @param labels - Label(s) to prepend, outermost first
 * @param context - The existing `ParseError.context` value to normalize and extend
 * @returns A flat array starting with `labels`, followed by the normalized existing context
 *
 * @example
 * ```typescript
 * prependContext("in sequence", "inner"); // ["in sequence", "inner"]
 * prependContext("in sequence", ["a", "b"]); // ["in sequence", "a", "b"]
 * prependContext("in sequence", undefined); // ["in sequence"]
 * ```
 */
export const prependContext = (
  labels: string | string[],
  context: string | string[] | undefined,
): string[] => {
  return [
    ...(Array.isArray(labels) ? labels : [labels]),
    ...(Array.isArray(context) ? context : context ? [context] : []),
  ];
};
