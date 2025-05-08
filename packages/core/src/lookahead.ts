import type { Parser } from "./types";
import { createFailure, isFailure } from "./utils";

/**
 * Parser for positive lookahead (does not consume input).
 *
 * Succeeds if the given parser succeeds at the current position, but does not consume any input.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for success without consuming input.
 */
export const andPredicate =
  <T>(parser: Parser<T>): Parser<never> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (isFailure(result)) {
      return createFailure(
        `And-predicate failed: ${result.error.message}`,
        result.error.pos,
        {
          ...result.error,
          parserName: "andPredicate",
          context: [
            "in positive lookahead",
            ...(result.error.context
              ? Array.isArray(result.error.context)
                ? result.error.context
                : [result.error.context]
              : []),
          ],
        },
      );
    }

    return {
      success: true,
      val: undefined as never,
      current: pos,
      next: pos,
    };
  };

/**
 * Alias for {@link andPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for success without consuming input.
 * @see andPredicate
 */
export const and = andPredicate;

/**
 * Alias for {@link andPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for success without consuming input.
 * @see andPredicate
 */
export const positive = andPredicate;

/**
 * Alias for {@link andPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for success without consuming input.
 * @see andPredicate
 */
export const assert = andPredicate;

/**
 * Parser for negative lookahead (does not consume input).
 *
 * Succeeds if the given parser fails at the current position, but does not consume any input.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for failure without consuming input.
 */
export const notPredicate =
  <T>(parser: Parser<T>): Parser<never> =>
  (input: string, pos) => {
    const result = parser(input, pos);
    if (!result.success) {
      return {
        success: true,
        val: undefined as never,
        current: pos,
        next: pos,
      };
    }

    return createFailure("Not-predicate matched when it should not have", pos, {
      parserName: "notPredicate",
      context: ["in negative lookahead"],
      expected: "pattern not to match",
      found: result.success ? "matching pattern" : undefined,
    });
  };

/**
 * Alias for {@link notPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for failure without consuming input.
 * @see notPredicate
 */
export const not = notPredicate;

/**
 * Alias for {@link notPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for failure without consuming input.
 * @see notPredicate
 */
export const negative = notPredicate;
