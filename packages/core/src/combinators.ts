import type { ParseError, Parser, Pos } from "./types";
import { createFailure, isFailure, prependContext } from "./utils";

/** How many distinct expectations `error` carries -- used by `choice` to
 * break ties between two failures at the same (farthest) offset. */
const expectedRichness = (error: ParseError): number =>
  Array.isArray(error.expected)
    ? error.expected.length
    : error.expected
      ? 1
      : 0;

/** Adds `error`'s expectation(s) to `target`. Module-level (not a closure
 * over `choice`'s per-call state) so it isn't reallocated on every parse. */
const mergeExpectedInto = (target: Set<string>, error: ParseError): void => {
  if (!error.expected) return;
  if (Array.isArray(error.expected)) {
    for (const exp of error.expected) {
      target.add(exp);
    }
  } else {
    target.add(error.expected);
  }
};

/**
 * Parser that parses a sequence of parsers in order.
 *
 * Executes each parser in the given sequence and returns an array of all results.
 * If any parser fails, the entire sequence fails at that position.
 *
 * @template P Array of parsers
 * @param parsers Array of parsers to run in sequence
 * @returns Parser that succeeds if all parsers succeed in sequence, returning a tuple of all results
 *
 * @example
 * ```typescript
 * const parser = sequence(literal("hello"), literal(" "), literal("world"));
 * const result = parser("hello world", 0);
 * // result.val will be ["hello", " ", "world"]
 * ```
 *
 * @example
 * ```typescript
 * // Parse a number followed by a plus sign followed by another number
 * const addExpr = sequence(number, literal("+"), number);
 * const result = addExpr("42+37", 0);
 * // result.val will be [42, "+", 37]
 * ```
 */
export const sequence = <P extends Parser<unknown>[]>(
  ...parsers: P
): Parser<{ [K in keyof P]: P[K] extends Parser<infer T> ? T : never }> => {
  const sequenceParser = (input: string, pos: Pos) => {
    if (parsers.length === 0) {
      return {
        success: true,
        val: [] as {
          [K in keyof P]: P[K] extends Parser<infer T> ? T : never;
        },
        current: pos,
        next: pos,
      } as const;
    }

    const result: unknown[] = [];
    let currentPos = pos;

    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      if (!parser) {
        return createFailure(`Parser at index ${i} is undefined`, pos, {
          parserName: "sequence",
        });
      }
      const parserResult = parser(input, currentPos);

      if (isFailure(parserResult)) {
        return createFailure(
          `Failed to parse sequence at element ${i}: ${parserResult.error.message}`,
          parserResult.error.pos,
          {
            ...parserResult.error,
            context: prependContext("in sequence", parserResult.error.context),
            parserName: "sequence",
          },
        );
      }

      result.push(parserResult.val);
      currentPos = parserResult.next;
    }

    return {
      success: true as const,
      val: result as {
        [K in keyof P]: P[K] extends Parser<infer T> ? T : never;
      },
      current: pos,
      next: currentPos,
    };
  };

  return sequenceParser;
};

/**
 * Alias for {@link sequence}.
 *
 * Provides a shorter name for the sequence combinator. Behaves identically to `sequence`.
 *
 * @template P Array of parsers
 * @param parsers Array of parsers to run in sequence
 * @returns Parser that succeeds if all parsers succeed in sequence, returning a tuple of all results
 * @see sequence
 *
 * @example
 * ```typescript
 * const parser = seq(literal("("), expr, literal(")"));
 * // Equivalent to: sequence(literal("("), expr, literal(")"))
 * ```
 */
export const seq = sequence;

/**
 * Parser that attempts multiple parsers and returns the result of the first successful one.
 *
 * Tries each parser in order until one succeeds. If all parsers fail, returns a failure
 * with aggregated error information from all attempts.
 *
 * @template T Array of possible result types
 * @param parsers Array of parsers to try in order
 * @returns Parser that succeeds if any of the parsers succeed, returning the result of the first successful parser
 *
 * @example
 * ```typescript
 * const numberOrString = choice(
 *   number,           // Try to parse a number first
 *   quotedString,     // If that fails, try a quoted string
 *   identifier        // If that fails, try an identifier
 * );
 * ```
 *
 * @example
 * ```typescript
 * // Parse different types of literals
 * const booleanLiteral = choice(
 *   literal("true"),
 *   literal("false"),
 *   literal("null")
 * );
 * ```
 */
export const choice = <T extends unknown[]>(
  ...parsers: { [K in keyof T]: Parser<T[K]> }
): Parser<T[number]> => {
  const choiceParser = (input: string, pos: Pos) => {
    if (parsers.length === 0) {
      return createFailure("Empty choice", pos, {
        parserName: "choice",
      });
    }

    // Nothing beyond these two bindings is allocated on the success path
    // (by far the common case in a PEG choice): no error array, no Set,
    // until an alternative actually fails.
    let expectedSet: Set<string> | null = null;
    let farthestError: ParseError | null = null;

    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      if (!parser) {
        return createFailure(`Parser at index ${i} is undefined`, pos, {
          parserName: "choice",
        });
      }
      const result = parser(input, pos);

      if (result.success) {
        return result;
      }

      if (isFailure(result)) {
        const error = result.error;
        if (!farthestError || error.pos.offset > farthestError.pos.offset) {
          // Strictly farther than anything seen so far: expectations
          // collected for the previous (now-stale) farthest offset no
          // longer belong in the aggregate.
          farthestError = error;
          expectedSet = null;
          if (error.expected) {
            expectedSet = new Set();
            mergeExpectedInto(expectedSet, error);
          }
        } else if (error.pos.offset === farthestError.pos.offset) {
          if (error.expected) {
            if (!expectedSet) expectedSet = new Set();
            mergeExpectedInto(expectedSet, error);
          }
          if (expectedRichness(error) > expectedRichness(farthestError)) {
            farthestError = error;
          }
        }
      }
    }

    // Rebind through a fresh `const` after the loop: some TS versions'
    // control-flow analysis over a `let` reassigned across branches
    // inside a loop narrows it to `never` by this point otherwise.
    const finalFarthestError: ParseError | null = farthestError;
    const expected = expectedSet ? Array.from(expectedSet) : [];
    const found = finalFarthestError?.found;

    const customMessage = `None of the parsers matched. ${
      expected.length > 0
        ? `Expected one of: ${expected.join(", ")}`
        : "No expectations provided"
    }`;

    return createFailure(customMessage, finalFarthestError?.pos ?? pos, {
      parserName: "choice",
      ...(expected.length > 0 && { expected }),
      ...(found !== undefined && { found }),
    });
  };

  return choiceParser;
};

/**
 * Parser that tries to parse with the given parser and returns a default value if it fails.
 *
 * This combinator makes a parser optional by providing a fallback value when parsing fails.
 * The parser position is not advanced if the main parser fails.
 *
 * @template T Type of the parser result and default value
 * @param parser The parser to try
 * @param defaultValue The default value to return if parser fails
 * @returns Parser that always succeeds, returning either the parsed result or the default value
 *
 * @example
 * ```typescript
 * // Parse an optional sign, defaulting to "+"
 * const optionalSign = withDefault(choice(literal("+"), literal("-")), "+");
 *
 * const result1 = optionalSign("-123", 0); // Returns "-"
 * const result2 = optionalSign("123", 0);  // Returns "+" (default)
 * ```
 *
 * @example
 * ```typescript
 * // Parse an optional configuration with defaults
 * const config = withDefault(
 *   parseConfigObject,
 *   { debug: false, timeout: 5000 }
 * );
 * ```
 */
export const withDefault =
  <T>(parser: Parser<T>, defaultValue: T): Parser<T> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return result;
    }

    return {
      success: true,
      val: defaultValue,
      current: pos,
      next: pos,
    };
  };

/**
 * Parser that makes a parser optional, returning the value or null.
 * Different from repetition.ts optional which returns [T] | [].
 *
 * @template T Type of the parser result
 * @param parser The parser to make optional
 * @returns Parser that always succeeds, returning T | null
 *
 * @example
 * ```typescript
 * const parser = maybe(char('a'));
 * const result1 = parser('a', 0); // Success: 'a'
 * const result2 = parser('b', 0); // Success: null
 * ```
 */
export const maybe = <T>(parser: Parser<T>): Parser<T | null> =>
  withDefault<T | null>(parser, null);

/**
 * Parser that succeeds if the given parser fails (without consuming input).
 *
 * This is a negative assertion parser that succeeds only when the given parser fails.
 * It does not consume any input and returns null as a meaningful indicator.
 * This is different from lookahead combinators as it's designed for rejection logic.
 *
 * @template T Type of the parser result (not used in the result, parser should fail)
 * @param parser The parser that should fail for this combinator to succeed
 * @returns Parser that returns null if the given parser fails, or fails if the parser succeeds
 *
 * @example
 * ```typescript
 * const notKeyword = reject(literal("if"));
 * const identifier = sequence(notKeyword, parseIdentifier);
 * ```
 */
export const reject =
  <T>(parser: Parser<T>, parserName = "reject"): Parser<null> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return createFailure("Expected parser to fail", pos, {
        parserName,
        expected: "parser to fail",
      });
    }

    return {
      success: true,
      val: null,
      current: pos,
      next: pos,
    };
  };

/**
 * Parser that defers resolving its underlying parser until first invoked.
 *
 * A rule defined as `const a = sequence(literal("("), b, literal(")"))`
 * throws a `ReferenceError` (temporal dead zone) as soon as `b` is a `const`
 * declared later in the same module - the common shape for generated,
 * mutually- or self-recursive grammar rules. Wrapping the reference in
 * `lazy(() => b)` defers reading `b` until the wrapped parser actually runs,
 * by which point every top-level `const` in the module has finished
 * initializing.
 *
 * @template T Type of the parser result
 * @param fn Thunk returning the parser to delegate to, evaluated on every call
 * @returns Parser that calls `fn()` and delegates to its result
 *
 * @example
 * ```typescript
 * // "a" and "b" reference each other; whichever is declared second would
 * // otherwise throw a ReferenceError when the other's initializer runs.
 * const a: Parser<unknown> = sequence(literal("("), lazy(() => b), literal(")"));
 * const b: Parser<unknown> = choice(a, literal("x"));
 * ```
 */
export const lazy =
  <T>(fn: () => Parser<T>): Parser<T> =>
  (input: string, pos) =>
    fn()(input, pos);
