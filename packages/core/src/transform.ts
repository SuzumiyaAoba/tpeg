import {
  fail,
  restoreFailureWatermark,
  snapshotFailureWatermark,
} from "./failure";
import type { ParseError, ParseFailure, ParseSuccess, Parser } from "./types";

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
  <T>(parser: Parser<T>, f: (error: ParseError) => ParseError): Parser<T> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return result;
    }

    return {
      success: false,
      error: f(result.error),
    };
  };

/**
 * Parser that replaces a successful match's value with the raw source
 * text the match consumed: `input.slice(result.current, result.next)`.
 * Consumption and failure behavior are exactly the wrapped parser's --
 * a failure (ordinary, `fatal`, or `abort`) passes through untouched;
 * only a success's `val` changes, whatever its original shape (tuple,
 * merged label object, capture tag, or leaf string) -- the span text
 * replaces it wholesale. This is the runtime behind the `@expr`
 * source-text extraction operator (`Span` in `grammar-types.ts`).
 *
 * @template T Type of the wrapped parser's (discarded) value
 * @param parser Target parser
 * @returns Parser<string> A parser returning the consumed source text on success.
 * @example
 *   const token = span(
 *     sequence(charClass(["a", "z"]), zeroOrMore(charClass(["a", "z"], ["0", "9"])))
 *   );
 *   // Parses the same input as the wrapped sequence, but yields the
 *   // matched text "abc123" instead of the element tuple.
 */
export const span =
  <T>(parser: Parser<T>): Parser<string> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return {
        success: true,
        val: input.slice(result.current, result.next),
        current: result.current,
        next: result.next,
      };
    }

    return result as ParseFailure;
  };

/**
 * Parser that applies a predicate to filter parse results.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param predicate Function to test the parsed value
 * @param errorMessage Error message to use when predicate fails
 * @param parserName Optional name for error reporting and debugging
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
  <T>(
    parser: Parser<T>,
    predicate: (value: T) => boolean,
    errorMessage: string,
    parserName = "filter",
  ): Parser<T> =>
  (input: string, pos) => {
    // Snapshot before running the child, for the same reason
    // `notPredicate` (`./lookahead.ts`) and `reject` (`./combinators.ts`)
    // snapshot before their probes: if the child SUCCEEDS but the
    // predicate rejects the value, every sub-failure the child left in
    // the watermark is speculative noise from its successful match -- and
    // when any of it sits deeper than `result.current`, it would make
    // this parser's own `fail()` below a no-op (pos < watermarkPos),
    // losing the predicate's expectation entirely.
    const snapshot = snapshotFailureWatermark();
    const result = parser(input, pos);

    if (result.success) {
      if (predicate(result.val)) {
        return result;
      }

      // Restore BEFORE recording (see the snapshot comment above), then
      // record `filter`'s own expectation into the shared farthest-
      // failure watermark, exactly like `notPredicate` and `reject` do on
      // their failing paths: the child SUCCEEDED here, so no leaf `fail()`
      // ran and nothing else will have registered this position -- a
      // swallowed failure (e.g. inside `optional`) would otherwise leave
      // no trace of the predicate that was actually tried.
      restoreFailureWatermark(snapshot);
      fail(input, result.current, {
        label: "value satisfying predicate",
        parserName,
      });

      const error: ParseError = {
        message: errorMessage,
        pos: result.current,
        parserName,
        expected: "value satisfying predicate",
        found: String(result.val),
      };

      return {
        success: false,
        error,
      };
    }

    return result;
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

    return result;
  };
