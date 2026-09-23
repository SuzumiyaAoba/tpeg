import { isFatalFailure } from "./failure";
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
      return {
        success: true,
        val: result.val,
        current: pos,
        next: result.next,
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

      // Check for infinite loop (position doesn't advance). Written as
      // `!(result.next > currentPos)` rather than `result.next ===
      // currentPos`: a `next` that is NaN (`NaN > x` is always false) or
      // somehow behind `currentPos` is every bit as non-terminating as a
      // zero-width match -- `next = currentPos` was only the COMMON
      // shape of "no progress", not the only one. A child parser
      // violating the `next > current` success invariant has no
      // well-defined repetition semantics; flag it here, loudly,
      // instead of looping forever.
      if (!(result.next > currentPos)) {
        return createInfiniteLoopError(input, currentPos, parserName);
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

      // Check for infinite loop (position doesn't advance) -- see
      // `zeroOrMore` above for why this is `!(result.next >
      // currentPos)` rather than `result.next === currentPos` (a `NaN`
      // or backwards `next` is equally non-terminating).
      if (!(result.next > currentPos)) {
        return createInfiniteLoopError(
          input,
          currentPos,
          parserName || "oneOrMore",
          `Results so far: ${results.length} item(s)`,
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
 * @throws {Error} If the range is invalid (`min` is negative, or `max` is less
 *   than `min`). An invalid range is a grammar authoring error rather than a
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
      `Invalid quantified range: minimum (${min}) must be a non-negative safe integer`,
    );
  }

  if (
    max !== undefined &&
    (max < min ||
      (max !== Number.POSITIVE_INFINITY && !Number.isSafeInteger(max)))
  ) {
    throw new Error(
      `Invalid quantified range: maximum (${max}) must be a safe integer not less than minimum (${min}), or Infinity`,
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

      results.push(result.val);
      currentPos = result.next;
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

      // Check for infinite loop (position doesn't advance) -- only
      // meaningful when `limit` is unbounded: a genuinely FINITE `max`
      // already bounds this loop via `limit`, exactly like the required
      // loop above, so a zero-width match there is likewise a legitimate
      // result, not an infinite loop. Gated on `!Number.isFinite(limit)`
      // rather than `max === undefined`: `max` itself can be
      // `Number.POSITIVE_INFINITY` (an explicit spelling of "unbounded" --
      // this codebase already blesses that spelling elsewhere, see
      // `@suzumiyaaoba/tpeg-combinator`'s `memoize` cache-size option) and
      // the constructor-time validation above (`max < min`) accepts it
      // silently, since `Infinity < min` is always `false`. Checking
      // `max === undefined` alone left that spelling of unbounded WITHOUT
      // this guard: `quantified(optional(literal("a")), 0,
      // Number.POSITIVE_INFINITY)` on input with no leading "a" looped
      // forever (confirmed: `optional`'s zero-width match makes `limit`
      // itself already `Infinity`, so the tail loop never terminates on
      // its own either), pushing an unboundedly growing array the whole
      // time. `!(result.next > currentPos)` rather than `result.next ===
      // currentPos`, same as `zeroOrMore` above: a `NaN` or backwards
      // `next` is equally non-terminating.
      if (!Number.isFinite(limit) && !(result.next > currentPos)) {
        return createInfiniteLoopError(
          input,
          currentPos,
          parserName,
          `Repetition: ${i + 1} (optional)`,
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
};
