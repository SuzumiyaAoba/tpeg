import type { ParseError, Parser, Pos } from "./types";
import { createFailure, isFailure } from "./utils";

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
        success: true as const,
        val: [] as {
          [K in keyof P]: P[K] extends Parser<infer T> ? T : never;
        },
        current: pos,
        next: pos,
      };
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
            context: [
              "in sequence",
              ...(Array.isArray(parserResult.error.context)
                ? parserResult.error.context
                : parserResult.error.context
                  ? [parserResult.error.context]
                  : []),
            ],
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

    const errors: ParseError[] = [];

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
        errors.push(result.error);
      }
    }

    // Performance optimization: Use Set for deduplication
    const expectedSet = new Set<string>();
    for (const error of errors) {
      if (error.expected) {
        if (Array.isArray(error.expected)) {
          for (const exp of error.expected) {
            expectedSet.add(exp);
          }
        } else {
          expectedSet.add(error.expected);
        }
      }
    }

    const expected = Array.from(expectedSet);
    const found = errors[0]?.found;

    const customMessage = `None of the parsers matched. ${
      expected.length > 0
        ? `Expected one of: ${expected.join(", ")}`
        : "No expectations provided"
    }`;

    return createFailure(customMessage, pos, {
      parserName: "choice",
      ...(expected.length > 0 && { expected }),
      ...(found !== undefined && { found }),
    });
  };

  return choiceParser;
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
export const maybe =
  <T>(parser: Parser<T>): Parser<T | null> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return result;
    }

    // Return null if parser fails, but don't advance position
    return {
      success: true,
      val: null,
      current: pos,
      next: pos,
    };
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
  <T>(parser: Parser<T>, parserName?: string): Parser<null> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return createFailure("Expected parser to fail", pos, {
        parserName: parserName || "reject",
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
