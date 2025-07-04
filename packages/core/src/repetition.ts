import type { NonEmptyArray, ParseFailure, Parser } from "./types";
import { createFailure } from "./utils";

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
          `Infinite loop detected in zeroOrMore: Parser succeeded but consumed no input at position ${currentPos.offset}`,
          currentPos,
          {
            parserName: "zeroOrMore",
            context: [
              "Parser matched but did not consume any input",
              `Input: "${input.slice(currentPos.offset, currentPos.offset + 10)}${input.length > currentPos.offset + 10 ? "..." : ""}"`,
              `Position: line ${currentPos.line}, column ${currentPos.column}`,
            ],
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
 * This implementation is optimized to avoid calling zeroOrMore internally,
 * reducing function call overhead and providing better error messages.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of parsed values.
 */
export const oneOrMore =
  <T>(parser: Parser<T>): Parser<NonEmptyArray<T>> =>
  (input: string, pos) => {
    const results: T[] = [];
    let currentPos = pos;
    let isFirstIteration = true;

    while (true) {
      const result = parser(input, currentPos);

      if (!result.success) {
        if (isFirstIteration) {
          // First iteration failed - return error
          const failure = result as ParseFailure;
          return createFailure(
            `Expected at least one occurrence: ${failure.error.message}`,
            failure.error.pos,
            {
              ...failure.error,
              parserName: "oneOrMore",
              context: [
                "in oneOrMore",
                ...(failure.error.context
                  ? Array.isArray(failure.error.context)
                    ? failure.error.context
                    : [failure.error.context]
                  : []),
              ],
            },
          );
        }
        // Later iterations failed - break and return what we have
        break;
      }

      // Check for infinite loop (position doesn't advance)
      if (result.next.offset === currentPos.offset) {
        return createFailure(
          `Infinite loop detected in oneOrMore: Parser succeeded but consumed no input at position ${currentPos.offset}`,
          currentPos,
          {
            parserName: "oneOrMore",
            context: [
              "Parser matched but did not consume any input",
              `Input: "${input.slice(currentPos.offset, currentPos.offset + 10)}${input.length > currentPos.offset + 10 ? "..." : ""}"`,
              `Position: line ${currentPos.line}, column ${currentPos.column}`,
              `Results so far: ${results.length} item(s)`,
            ],
          },
        );
      }

      results.push(result.val);
      currentPos = result.next;
      isFirstIteration = false;
    }

    return {
      success: true,
      val: results as NonEmptyArray<T>,
      current: pos,
      next: currentPos,
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

/**
 * Parser for quantified repetition (exactly n times, n to m times, or n or more times).
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param min Minimum number of repetitions (inclusive)
 * @param max Maximum number of repetitions (inclusive, undefined for unbounded)
 * @returns Parser<T[]> A parser that returns an array of parsed values with the specified count.
 */
export const quantified =
  <T>(parser: Parser<T>, min: number, max?: number): Parser<T[]> =>
  (input: string, pos) => {
    if (min < 0) {
      return createFailure(
        `Invalid quantified range: minimum (${min}) cannot be negative`,
        pos,
        { parserName: "quantified" },
      );
    }

    if (max !== undefined && max < min) {
      return createFailure(
        `Invalid quantified range: maximum (${max}) cannot be less than minimum (${min})`,
        pos,
        { parserName: "quantified" },
      );
    }

    const results: T[] = [];
    let currentPos = pos;
    let count = 0;

    // Helper function to create infinite loop error
    const createInfiniteLoopError = (
      position: typeof pos,
      repetitionInfo: string,
    ) => {
      return createFailure(
        `Infinite loop detected in quantified: Parser succeeded but consumed no input at position ${position.offset}`,
        position,
        {
          parserName: "quantified",
          context: [
            "Parser matched but did not consume any input",
            `Input: "${input.slice(position.offset, position.offset + 10)}${input.length > position.offset + 10 ? "..." : ""}"`,
            `Position: line ${position.line}, column ${position.column}`,
            repetitionInfo,
          ],
        },
      );
    };

    // Parse exactly min times first (required)
    for (let i = 0; i < min; i++) {
      const result = parser(input, currentPos);
      if (!result.success) {
        const failure = result as ParseFailure;
        return createFailure(
          `quantified parser failed at required repetition ${i + 1}/${min}`,
          currentPos,
          {
            ...failure.error,
            parserName: "quantified",
            context: [
              `in quantified{${min},${max || ""}}`,
              `failed at required repetition ${i + 1}/${min}`,
              ...(failure.error.context
                ? Array.isArray(failure.error.context)
                  ? failure.error.context
                  : [failure.error.context]
                : []),
            ],
          },
        );
      }

      // Check for infinite loop (position doesn't advance)
      if (result.next.offset === currentPos.offset) {
        return createInfiniteLoopError(
          currentPos,
          `Repetition: ${i + 1}/${min} (required)`,
        );
      }

      results.push(result.val);
      currentPos = result.next;
      count++;
    }

    // Parse additional times up to max (optional)
    const effectiveMax = max ?? Number.MAX_SAFE_INTEGER;
    for (let i = count; i < effectiveMax; i++) {
      const result = parser(input, currentPos);
      if (!result.success) {
        // Optional repetitions can fail - just break
        break;
      }

      // Check for infinite loop (position doesn't advance)
      if (result.next.offset === currentPos.offset) {
        return createInfiniteLoopError(
          currentPos,
          `Repetition: ${i + 1} (optional)`,
        );
      }

      results.push(result.val);
      currentPos = result.next;
      count++;
    }

    return {
      success: true,
      val: results,
      current: pos,
      next: currentPos,
    };
  };
