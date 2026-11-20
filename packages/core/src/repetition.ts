import { safeStringForDisplay } from "./escape";
import { isFatalFailure } from "./failure";
import type { NonEmptyArray, Parser } from "./types";
import {
  createFailure,
  invalidNextPosition,
  isValidOffset,
  offsetToPos,
} from "./utils";

/**
 * Creates a standardized infinite loop error for repetition parsers.
 * This helper reduces code duplication and ensures consistent error messaging.
 *
 * Marked `fatal: true` (the same flag `commit`, `combinators.ts`, sets on a
 * cut-driven failure) -- NOT an ordinary failure. A zero-width match inside
 * an unbounded repetition means "this grammar/input pair has no well-defined
 * PEG meaning" (see `docs/peg-grammar.md`'s note on unbounded repetition
 * over a nullable expression), which is a property of the SUBTREE, not of
 * whatever happens to enclose it. Before this was fatal, the very same
 * `zeroOrMore(optional(e))` diverged three ways depending purely on context:
 * a bare call surfaced the failure, wrapping it in `optional(...)` silently
 * swallowed it back down to a quiet `null` success (`optional`'s "no match ->
 * null" branch, just below), and putting it as a `choice` alternative let
 * backtracking silently fall through to try the next alternative instead.
 * Marking it fatal closes all three: `optional`/`zeroOrMore`/`oneOrMore`/
 * `quantified`/`withDefault` re-raise a fatal failure rather than treating
 * it as "no match" (their own doc comments, this file and combinators.ts),
 * and `choice`/`predictiveChoice` stop at their own boundary and fail
 * outright rather than trying a sibling -- so every enclosing shape now
 * either surfaces the failure or the whole construct fails, matching an
 * undefined construct actually being undefined rather than silently
 * meaning three different things depending on how it's embedded. `!e`/
 * `reject` still turn it into an ordinary success, same as any other fatal
 * failure reached inside a negative-lookahead probe (`notPredicate`'s doc
 * comment, `lookahead.ts`) -- that absorption is correct here too: "the
 * zero-width construct didn't match e" is exactly what `!e` asks.
 *
 * `.tpeg`-sourced grammars never observe this: `assertNoNullableRepetition`
 * (`packages/parser/src/first-sets.ts`) rejects a nullable-bodied unbounded
 * repetition at generation time, so this can only fire against a
 * hand-written combinator tree built directly against this package (e.g.
 * `packages/samples`), never against anything the `tpeg` CLI generates.
 */
const createInfiniteLoopError = (
  input: string,
  position: number,
  parserName: string,
  additionalContext?: string,
) => {
  const inputPreview = input.slice(position, position + 10);
  const truncated = input.length > position + 10 ? "..." : "";
  const { line, column } = offsetToPos(input, position);

  return createFailure(
    `Infinite loop detected in ${parserName}: Parser succeeded but consumed no input at position ${position}`,
    position,
    {
      parserName,
      fatal: true,
      context: [
        "Parser matched but did not consume any input",
        `Input: "${inputPreview}${truncated}"`,
        `Position: line ${line}, column ${column + 1}`,
        ...(additionalContext ? [additionalContext] : []),
      ],
    },
  );
};

/**
 * Parser for optional content (zero or one occurrence).
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<T | null> A parser that returns the parsed value on a match, or `null` on failure.
 */
export const optional =
  <T>(parser: Parser<T>): Parser<T | null> =>
  (input: string, pos) => {
    // Same out-of-contract-`pos` guard every leaf parser already applies
    // (`isValidOffset`, `./utils.ts`): an invalid offset must fail here
    // rather than fall into the "no match -> empty array" branch below
    // and echo itself back as a bogus zero-width success. `pos ===
    // input.length` stays legal -- a legitimate empty match at EOF.
    if (!isValidOffset(pos) || pos > input.length) {
      return createFailure("Expected a valid position", pos, {
        parserName: "optional",
      });
    }

    const result = parser(input, pos);

    if (result.success) {
      const next = result.next;
      const invalid = invalidNextPosition(input, pos, next, "optional");
      if (invalid) return invalid;
      return {
        success: true,
        val: result.val,
        current: pos,
        next,
      };
    }

    // A cut/commit (see `commit` in combinators.ts) inside `parser` marks
    // its failure `fatal`, meaning "do not treat this as backtrackable" --
    // re-raise it instead of the usual "swallow and report no match",
    // otherwise `("if" ~ cond)?` would silently discard the cut's intent.
    if (isFatalFailure(result)) {
      return result;
    }

    // Return null on failure (not an error)
    return {
      success: true,
      val: null,
      current: pos,
      next: pos,
    };
  };

/**
 * Alias for {@link optional}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T | null> A parser that returns the parsed value on a match, or `null` on failure.
 * @see optional
 */
export const opt = optional;

/** An unbounded repetition must advance on every successful iteration. */
function repeatUnbounded<T>(
  parser: Parser<T>,
  minimum: 0 | 1,
  parserName: string,
): Parser<T[]> {
  return (input, pos) => {
    if (!isValidOffset(pos) || pos > input.length) {
      return createFailure("Expected a valid position", pos, { parserName });
    }

    const values: T[] = [];
    let current = pos;
    for (;;) {
      const result = parser(input, current);
      if (!result.success) {
        if (values.length < minimum || isFatalFailure(result)) return result;
        return { success: true, val: values, current: pos, next: current };
      }

      const next = result.next;
      const invalid = invalidNextPosition(input, current, next, parserName);
      if (invalid) return invalid;
      if (next === current) {
        if (minimum === 0)
          return createInfiniteLoopError(input, current, parserName);
        return createInfiniteLoopError(
          input,
          current,
          parserName || "oneOrMore",
          `Results so far: ${values.length} item(s)`,
        );
      }
      values.push(result.val);
      current = next;
    }
  };
}

/**
 * Parser for zero or more occurrences of a pattern.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T[]> A parser that returns an array of parsed values (possibly empty).
 */
export const zeroOrMore = <T>(
  parser: Parser<T>,
  parserName = "zeroOrMore",
): Parser<T[]> => repeatUnbounded(parser, 0, parserName);

/**
 * Alias for {@link zeroOrMore}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T[]> A parser that returns an array of parsed values (possibly empty).
 * @see zeroOrMore
 */
export const star = zeroOrMore;

/**
 * Parser for one or more occurrences of a pattern.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of parsed values.
 */
export const oneOrMore = <T>(
  parser: Parser<T>,
  parserName = "oneOrMore",
): Parser<NonEmptyArray<T>> =>
  repeatUnbounded(parser, 1, parserName) as Parser<NonEmptyArray<T>>;

/**
 * Alias for {@link oneOrMore}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of parsed values.
 * @see oneOrMore
 */
export const plus = oneOrMore;

/** Return a diagnostic for invalid PEG repetition bounds. Omitted max and Infinity are unbounded. */
export function quantifiedRangeError(
  min: number,
  max?: number,
): string | undefined {
  if (!Number.isSafeInteger(min) || min < 0) {
    return `Invalid quantified range: minimum (${safeStringForDisplay(min)}) must be a non-negative safe integer`;
  }
  if (
    max !== undefined &&
    max !== Infinity &&
    (!Number.isSafeInteger(max) || max < min)
  ) {
    return `Invalid quantified range: maximum (${safeStringForDisplay(max)}) must be a safe integer not less than minimum (${min}), or Infinity`;
  }
  return undefined;
}

/**
 * Parser for quantified repetition (exactly n times, n to m times, or n or more times).
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param min Minimum number of repetitions (inclusive)
 * @param max Maximum number of repetitions (inclusive, undefined for unbounded)
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T[]> A parser that returns an array of parsed values with the specified count.
 * @throws {Error} If `min` is not a non-negative safe integer, or `max`
 *   is neither Infinity nor a safe integer at least `min`. An invalid range is a grammar authoring error rather than a
 *   parse failure, so it is reported eagerly when the parser is constructed
 *   instead of when it is applied to input.
 */
export const quantified = <T>(
  parser: Parser<T>,
  min: number,
  max?: number,
  parserName = "quantified",
): Parser<T[]> => {
  const error = quantifiedRangeError(min, max);
  if (error) throw new Error(error);

  const limit = max ?? Infinity;
  return (input, pos) => {
    if (!isValidOffset(pos) || pos > input.length) {
      return createFailure("Expected a valid position", pos, { parserName });
    }

    const results: T[] = [];
    let currentPos = pos;
    while (results.length < limit) {
      const result = parser(input, currentPos);
      if (!result.success) {
        if (results.length < min || isFatalFailure(result)) return result;
        break;
      }

      const next = result.next;
      const invalid = invalidNextPosition(input, currentPos, next, parserName);
      if (invalid) return invalid;
      // Required iterations are counted even for a zero-width match. Only
      // the unbounded optional tail needs a progress check.
      if (limit === Infinity && results.length >= min && next === currentPos) {
        return createInfiniteLoopError(
          input,
          currentPos,
          parserName,
          `Repetition: ${results.length + 1} (optional)`,
        );
      }
      results.push(result.val);
      currentPos = next;
    }

    return {
      success: true,
      val: results,
      current: pos,
      next: currentPos,
    };
  };
};
