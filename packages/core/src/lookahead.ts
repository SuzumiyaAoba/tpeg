import type { Parser } from "./types";
import { createFailure, isFailure } from "./utils";

/**
 * Parser for positive lookahead (does not consume input).
 *
 * Succeeds if the given parser succeeds at the current position, but does not consume any input.
 * This is equivalent to the `&expr` syntax in PEG notation.
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
 * ```
 */
export const andPredicate =
  <T>(parser: Parser<T>): Parser<undefined> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (isFailure(result)) {
      const context = result.error.context
        ? Array.isArray(result.error.context)
          ? result.error.context
          : [result.error.context]
        : [];

      return createFailure(
        `Positive lookahead failed: ${result.error.message}`,
        result.error.pos,
        {
          ...result.error,
          parserName: "andPredicate",
          context: ["in positive lookahead", ...context],
        },
      );
    }

    return {
      success: true,
      val: undefined,
      current: pos,
      next: pos,
    };
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
 * ```
 */
export const notPredicate =
  <T>(parser: Parser<T>): Parser<undefined> =>
  (input: string, pos) => {
    const result = parser(input, pos);
    if (!result.success) {
      return {
        success: true,
        val: undefined,
        current: pos,
        next: pos,
      };
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
