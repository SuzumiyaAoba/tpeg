import type { NonEmptyArray, Parser } from "./types";
import { createFailure, isFailure } from "./utils";

/**
 * Parser for optional content (zero or one occurrence).
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<[T] | []> A parser that returns a singleton array if the parser succeeds, or an empty array if it fails.
 */
export const optional =
  <T>(parser: Parser<T>): Parser<[T] | []> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return {
        success: true,
        val: [result.val],
        current: pos,
        next: result.next,
      };
    }

    // Return empty array on failure (not an error)
    return {
      success: true,
      val: [],
      current: pos,
      next: pos,
    };
  };

/**
 * Alias for {@link optional}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<[T] | []> A parser that returns a singleton array if the parser succeeds, or an empty array if it fails.
 * @see optional
 */
export const opt = optional;

/**
 * Parser for zero or more occurrences of a pattern.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<T[]> A parser that returns an array of parsed values (possibly empty).
 */
export const zeroOrMore =
  <T>(parser: Parser<T>): Parser<T[]> =>
  (input: string, pos) => {
    const results: T[] = [];
    let currentPos = pos;

    while (true) {
      const result = parser(input, currentPos);

      if (!result.success) {
        break;
      }

      // Check for infinite loop (position doesn't advance)
      if (result.next.offset === currentPos.offset) {
        return createFailure(
          "Infinite loop detected in zeroOrMore",
          currentPos,
          {
            parserName: "zeroOrMore",
            context: ["Parser matched but did not consume any input"],
          },
        );
      }

      results.push(result.val);
      currentPos = result.next;
    }

    return {
      success: true,
      val: results,
      current: pos,
      next: currentPos,
    };
  };

/**
 * Alias for {@link zeroOrMore}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<T[]> A parser that returns an array of parsed values (possibly empty).
 * @see zeroOrMore
 */
export const star = zeroOrMore;

/**
 * Parser for one or more occurrences of a pattern.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of parsed values.
 */
export const oneOrMore =
  <T>(parser: Parser<T>): Parser<NonEmptyArray<T>> =>
  (input: string, pos) => {
    const firstResult = parser(input, pos);

    if (isFailure(firstResult)) {
      return createFailure(
        `Expected at least one occurrence: ${firstResult.error.message}`,
        firstResult.error.pos,
        {
          ...firstResult.error,
          parserName: "oneOrMore",
          context: [
            "in oneOrMore",
            ...(firstResult.error.context
              ? Array.isArray(firstResult.error.context)
                ? firstResult.error.context
                : [firstResult.error.context]
              : []),
          ],
        },
      );
    }

    // Get the rest using zeroOrMore
    const restResult = zeroOrMore(parser)(input, firstResult.next);

    // Check for infinite loop
    if (isFailure(restResult)) {
      return restResult;
    }

    // Combine first and rest
    return {
      success: true,
      val: [firstResult.val, ...restResult.val] as NonEmptyArray<T>,
      current: pos,
      next: restResult.next,
    };
  };

/**
 * Alias for {@link oneOrMore}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of parsed values.
 * @see oneOrMore
 */
export const plus = oneOrMore;
