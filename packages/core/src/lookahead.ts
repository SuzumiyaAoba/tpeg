import type { Parser } from "./types";
import { createFailure, isFailure } from "./utils";
import type { ParseSuccess } from "./types";

/**
 * 共通の成功結果オブジェクト（メモリ最適化のため）
 */
const createSuccessResult = (pos: import("./types").Pos): ParseSuccess<undefined> => ({
  success: true as const,
  val: undefined,
  current: pos,
  next: pos,
});

/**
 * Parser for positive lookahead (does not consume input).
 *
 * Succeeds if the given parser succeeds at the current position, but does not consume any input.
 * This is equivalent to the `&expr` syntax in PEG notation.
 * 
 * **Important**: This parser returns `undefined` as its value since it only checks
 * for pattern existence without consuming input. The input position remains unchanged
 * regardless of success or failure.
 *
 * @template T Type of the parse result value
 * @param parser Target parser to check
 * @returns Parser<undefined> A parser that only checks for success without consuming input
 *
 * @example
 * ```typescript
 * // Check if next characters are "hello" without consuming them
 * const checkHello = andPredicate(literal("hello"));
 * const result = checkHello("hello world", { offset: 0, line: 1, column: 1 });
 * // result.success === true, but position remains unchanged
 * 
 * // Common usage: ensure pattern exists before parsing
 * const identifier = sequence(
 *   andPredicate(letter), // ensure it starts with a letter
 *   many(alphaNumeric)    // then parse the rest
 * );
 * ```
 */
export const andPredicate =
  <T>(parser: Parser<T>): Parser<undefined> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (isFailure(result)) {
      const existingContext = result.error.context || [];
      const contextArray = Array.isArray(existingContext) 
        ? existingContext 
        : [existingContext];

      return createFailure(
        `Positive lookahead failed: ${result.error.message}`,
        result.error.pos,
        {
          ...result.error,
          parserName: "andPredicate",
          context: ["in positive lookahead", ...contextArray],
        },
      );
    }

    return createSuccessResult(pos);
  };

/**
 * Alias for {@link andPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser to check
 * @returns Parser<undefined> A parser that only checks for success without consuming input
 * @see andPredicate
 */
export const and = andPredicate;

/**
 * Alias for {@link andPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser to check
 * @returns Parser<undefined> A parser that only checks for success without consuming input
 * @see andPredicate
 */
export const positive = andPredicate;

/**
 * Alias for {@link andPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser to check
 * @returns Parser<undefined> A parser that only checks for success without consuming input
 * @see andPredicate
 */
export const assert = andPredicate;

/**
 * Parser for negative lookahead (does not consume input).
 *
 * Succeeds if the given parser fails at the current position, but does not consume any input.
 * This is equivalent to the `!expr` syntax in PEG notation.
 * 
 * **Important**: This parser returns `undefined` as its value since it only checks
 * for pattern absence without consuming input. The input position remains unchanged
 * regardless of success or failure.
 *
 * @template T Type of the parse result value
 * @param parser Target parser to check for failure
 * @returns Parser<undefined> A parser that only checks for failure without consuming input
 *
 * @example
 * ```typescript
 * // Ensure next characters are NOT "end" before parsing
 * const notEnd = notPredicate(literal("end"));
 * const result = notEnd("start", { offset: 0, line: 1, column: 1 });
 * // result.success === true because "start" doesn't match "end"
 * 
 * // Common usage: parse until a terminator without consuming it
 * const content = many(sequence(
 *   notPredicate(literal("</tag>")), // don't consume the closing tag
 *   anyChar()                        // but consume any other character
 * ));
 * ```
 */
export const notPredicate =
  <T>(parser: Parser<T>): Parser<undefined> =>
  (input: string, pos) => {
    const result = parser(input, pos);
    if (!result.success) {
      return createSuccessResult(pos);
    }

    return createFailure(
      "Negative lookahead failed: expected pattern not to match",
      pos,
      {
        parserName: "notPredicate",
        context: ["in negative lookahead"],
        expected: "pattern not to match",
        found: "matching pattern",
      },
    );
  };

/**
 * Alias for {@link notPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser to check for failure
 * @returns Parser<undefined> A parser that only checks for failure without consuming input
 * @see notPredicate
 */
export const not = notPredicate;

/**
 * Alias for {@link notPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser to check for failure
 * @returns Parser<undefined> A parser that only checks for failure without consuming input
 * @see notPredicate
 */
export const negative = notPredicate;
