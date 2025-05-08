import type { ParseFailure, ParseSuccess, Parser } from "./types";

/**
 * Parser that applies a transformation function to the parse result value.
 *
 * @template T Type of the input parse result value
 * @template U Type of the output value
 * @param parser Target parser
 * @param f Transformation function applied to the parse result value
 * @returns Parser<U> A parser that returns the transformed value if parsing succeeds, or fails otherwise.
 * @example
 *   const digit = map(
 *     charClass(["0", "9"]),
 *     char => parseInt(char, 10)
 *   );
 *   // Parses a digit char and converts it to a number
 */
export const map =
  <T, U>(parser: Parser<T>, f: (value: T) => U): Parser<U> =>
  (input: string, index) => {
    const result = parser(input, index);

    return result.success
      ? { ...result, val: f(result.val) }
      : (result as ParseFailure);
  };

/**
 * Parser that transforms the entire ParseSuccess object on success.
 *
 * @template T Type of the input parse result value
 * @template U Type of the output value
 * @param parser Target parser
 * @param f Function to transform the ParseSuccess object
 * @returns Parser<U> A parser that returns the transformed value if parsing succeeds, or fails otherwise.
 * @example
 *   const withPosition = mapResult(
 *     charClass(["0", "9"]),
 *     result => ({ value: result.val, position: result.current })
 *   );
 *   // Returns both the parsed digit and its position in the input
 */
export const mapResult =
  <T, U>(parser: Parser<T>, f: (value: ParseSuccess<T>) => U): Parser<U> =>
  (input: string, index) => {
    const result = parser(input, index);

    return result.success
      ? { ...result, val: f(result) }
      : (result as ParseFailure);
  };
