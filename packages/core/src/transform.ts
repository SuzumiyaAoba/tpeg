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
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return {
        success: true,
        val: f(result.val),
        current: result.current,
        next: result.next,
      };
    }
    
    return result as ParseFailure;
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
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return {
        success: true,
        val: f(result),
        current: result.current,
        next: result.next,
      };
    }
    
    return result as ParseFailure;
  };

/**
 * Parser that transforms the error message on failure.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param f Function to transform the error
 * @returns Parser<T> A parser that returns the original value on success, or the transformed error on failure.
 * @example
 *   const number = mapError(
 *     charClass(["0", "9"]),
 *     error => ({ ...error, message: "Expected a digit" })
 *   );
 *   // Provides a custom error message for digit parsing
 */
export const mapError =
  <T>(parser: Parser<T>, f: (error: ParseFailure) => ParseFailure): Parser<T> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return result;
    }
    
    return f(result as ParseFailure);
  };

/**
 * Parser that applies a predicate to filter parse results.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param predicate Function to test the parsed value
 * @param errorMessage Error message to use when predicate fails
 * @returns Parser<T> A parser that succeeds only if both parsing and predicate succeed.
 * @example
 *   const evenDigit = filter(
 *     map(charClass(["0", "9"]), char => parseInt(char, 10)),
 *     n => n % 2 === 0,
 *     "Expected an even digit"
 *   );
 *   // Parses a digit and ensures it's even
 */
export const filter =
  <T>(parser: Parser<T>, predicate: (value: T) => boolean, errorMessage: string): Parser<T> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      if (predicate(result.val)) {
        return result;
      }
      
      return {
        success: false,
        error: {
          message: errorMessage,
          pos: result.current,
          parserName: "filter",
        },
      };
    }
    
    return result as ParseFailure;
  };

/**
 * Parser that executes a side effect on successful parse without changing the result.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param effect Function to execute as a side effect
 * @returns Parser<T> A parser that returns the original result after executing the side effect.
 * @example
 *   const loggedParser = tap(
 *     literal("hello"),
 *     value => console.log(`Parsed: ${value}`)
 *   );
 *   // Logs the parsed value without changing the result
 */
export const tap =
  <T>(parser: Parser<T>, effect: (value: T) => void): Parser<T> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      effect(result.val);
      return result;
    }
    
    return result as ParseFailure;
  };
