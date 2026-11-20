import { isFatalFailure } from "./failure";
import { safeStringForDisplay } from "./escape";
import type { NonEmptyArray, Parser } from "./types";
import { createFailure, isValidOffset, offsetToPos } from "./utils";

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

/** A successful child must return an integer offset within the input
 * that does not go backwards. Keep the failure positioned at the valid
 * call site rather than adopting the child's malformed offset. */
const createInvalidNextPositionError = (
  position: number,
  parserName: string,
  next: number,
) =>
  createFailure(
    `Invalid next position in ${parserName}: ${safeStringForDisplay(next)}`,
    position,
    { parserName, fatal: true },
  );

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
      if (!isValidOffset(next) || next < pos || next > input.length) {
        return createInvalidNextPositionError(pos, "optional", next);
      }
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

/**
 * Parser for zero or more occurrences of a pattern.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T[]> A parser that returns an array of parsed values (possibly empty).
 */
export const zeroOrMore =
  <T>(parser: Parser<T>, parserName = "zeroOrMore"): Parser<T[]> =>
  (input: string, pos) => {
    // Same out-of-contract-`pos` guard as `optional` above: without it a
    // `NaN`/negative/fractional `pos` made the loop below see an immediate
    // child failure and return `{ val: [], current: pos, next: pos }` --
    // a bogus success echoing the invalid offset back out. `pos ===
    // input.length` stays legal -- an empty run at EOF.
    if (!isValidOffset(pos) || pos > input.length) {
      return createFailure("Expected a valid position", pos, {
        parserName,
      });
    }

    const results: T[] = [];
    let currentPos = pos;

    while (true) {
      const result = parser(input, currentPos);

      if (!result.success) {
        // See `optional` above: a fatal (cut/commit) failure must propagate
        // rather than be treated as "the repetition simply ends here".
        if (isFatalFailure(result)) {
          return result;
        }
        break;
      }

      // Validate before comparing: malformed values must not be coerced
      // into positions or throw during the progress check.
      const next = result.next;
      if (!isValidOffset(next) || next < currentPos || next > input.length) {
        return createInvalidNextPositionError(currentPos, parserName, next);
      }
      if (next === currentPos) {
        return createInfiniteLoopError(input, currentPos, parserName);
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
 * This implementation is optimized to avoid calling zeroOrMore internally,
 * reducing function call overhead and providing better error messages.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of parsed values.
 */
export const oneOrMore =
  <T>(parser: Parser<T>, parserName = "oneOrMore"): Parser<NonEmptyArray<T>> =>
  (input: string, pos) => {
    // Same out-of-contract-`pos` guard as `zeroOrMore` above. A first
    // iteration on an honest child would fail anyway, but the contract
    // is enforced here regardless of caller -- see `optional`.
    if (!isValidOffset(pos) || pos > input.length) {
      return createFailure("Expected a valid position", pos, {
        parserName,
      });
    }

    const results: T[] = [];
    let currentPos = pos;
    let isFirstIteration = true;

    while (true) {
      const result = parser(input, currentPos);

      if (!result.success) {
        if (isFirstIteration) {
          // First iteration failed - relay the child failure UNCHANGED
          // rather than re-wrapping it with an enriched message (see
          // `sequence`'s identical reasoning in combinators.ts): the
          // failed element's own `fail()` call (`./failure.ts`) already
          // recorded its position/expectation in the shared watermark,
          // and reading `.error` here to build a wrapper would trigger a
          // singleton's lazy getter on every `+`-repeated rule's first
          // failed attempt.
          return result;
        }
        // See `optional` above: a fatal (cut/commit) failure must propagate
        // rather than be treated as "the repetition simply ends here".
        if (isFatalFailure(result)) {
          return result;
        }
        // Later iterations failed - break and return what we have
        break;
      }

      const next = result.next;
      if (!isValidOffset(next) || next < currentPos || next > input.length) {
        return createInvalidNextPositionError(currentPos, parserName, next);
      }
      if (next === currentPos) {
        return createInfiniteLoopError(
          input,
          currentPos,
          parserName || "oneOrMore",
          `Results so far: ${results.length} item(s)`,
        );
      }
      results.push(result.val);
      currentPos = next;
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
 * @param parserName Optional name for error reporting and debugging
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
  // Validate input parameters early. `min` must be a safe, non-negative
  // integer: `Infinity` (e.g. a quantifier bound that overflowed
  // `parseInt`) would make the required `i < min` loop below genuinely
  // unbounded -- on a nullable `parser` that is an infinite loop, not a
  // long one. `max` may be `Infinity` (the documented explicit spelling
  // of unbounded, handled by `limit` below) but no other non-integer.
  if (!Number.isSafeInteger(min) || min < 0) {
    throw new Error(
      `Invalid quantified range: minimum (${safeStringForDisplay(min)}) must be a non-negative safe integer`,
    );
  }

  if (
    max !== undefined &&
    max !== Number.POSITIVE_INFINITY &&
    (!Number.isSafeInteger(max) || max < min)
  ) {
    throw new Error(
      `Invalid quantified range: maximum (${safeStringForDisplay(max)}) must be a safe integer not less than minimum (${min}), or Infinity`,
    );
  }

  return (input: string, pos) => {
    // Same out-of-contract-`pos` guard as `zeroOrMore` above: with `min
    // === 0` (or after `min` satisfied matches) this parser's own return
    // is a zero-width success, so it must not be reachable at an invalid
    // offset. `pos === input.length` stays legal.
    if (!isValidOffset(pos) || pos > input.length) {
      return createFailure("Expected a valid position", pos, {
        parserName,
      });
    }

    const results: T[] = [];
    let currentPos = pos;
    let count = 0;

    // Parse exactly min times first (required). This loop is bounded by
    // `min` itself (a plain `for` counter), so it can never actually loop
    // forever -- unlike `zeroOrMore`/`oneOrMore`'s genuinely-unbounded
    // loops, there is nothing here for an infinite-loop guard to protect
    // against. A zero-width match (a nullable `parser`) is a legitimate
    // `e{n,m}` result, not an error: e.g. `("a"?){2,2}` on input with no
    // leading "a" must succeed with two empty matches, per standard PEG
    // semantics for a bounded repetition.
    for (let i = 0; i < min; i++) {
      const result = parser(input, currentPos);
      if (!result.success) {
        // Relay the child failure UNCHANGED -- see `sequence`'s identical
        // reasoning in combinators.ts. The failed element's own `fail()`
        // call already recorded its position/expectation in the shared
        // watermark.
        return result;
      }

      const next = result.next;
      if (!isValidOffset(next) || next < currentPos || next > input.length) {
        return createInvalidNextPositionError(currentPos, parserName, next);
      }
      results.push(result.val);
      currentPos = next;
      count++;
    }

    // Parse additional times up to max (optional), or unbounded if max is undefined
    const limit = max ?? Number.POSITIVE_INFINITY;
    for (let i = count; i < limit; i++) {
      const result = parser(input, currentPos);
      if (!result.success) {
        // See `optional` above: a fatal (cut/commit) failure must propagate
        // rather than be treated as "the repetition simply ends here".
        if (isFatalFailure(result)) {
          return result;
        }
        // Optional repetitions can fail - just break
        break;
      }

      const next = result.next;
      if (!isValidOffset(next) || next < currentPos || next > input.length) {
        return createInvalidNextPositionError(currentPos, parserName, next);
      }
      // Finite repetitions permit zero-width matches. Both an omitted
      // max and explicit Infinity require progress to avoid divergence.
      if (!Number.isFinite(limit) && next === currentPos) {
        return createInfiniteLoopError(
          input,
          currentPos,
          parserName,
          `Repetition: ${i + 1} (optional)`,
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
