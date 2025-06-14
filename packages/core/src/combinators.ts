import type { ParseError, ParseResult, Parser } from "./types";
import { createFailure, isFailure } from "./utils";

/**
 * Parser that parses a sequence of parsers.
 *
 * @template P Array of parsers
 * @param parsers Array of parsers to run in sequence
 * @returns Parser that succeeds if all parsers succeed in sequence.
 */
export const sequence =
  <P extends Parser<unknown>[]>(
    ...parsers: P
  ): Parser<{ [K in keyof P]: P[K] extends Parser<infer T> ? T : never }> =>
  (input: string, pos) => {
    if (parsers.length === 0) {
      return {
        success: true,
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
        return createFailure(
          `Parser at index ${i} is undefined`,
          pos,
          { parserName: "sequence" }
        );
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
              ...(parserResult.error.context
                ? Array.isArray(parserResult.error.context)
                  ? parserResult.error.context
                  : [parserResult.error.context]
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
      success: true,
      val: result as {
        [K in keyof P]: P[K] extends Parser<infer T> ? T : never;
      },
      current: pos,
      next: currentPos,
    };
  };

/**
 * Alias for {@link sequence}.
 *
 * @template P Array of parsers
 * @param parsers Array of parsers to run in sequence
 * @returns Parser that succeeds if all parsers succeed in sequence.
 * @see sequence
 */
export const seq = sequence;

/**
 * Parser that attempts multiple parsers and returns the result of the first successful one.
 *
 * @template T Array of possible result types
 * @param parsers Array of parsers to try
 * @returns Parser that succeeds if any of the parsers succeed.
 */
export const choice =
  <T extends unknown[]>(
    ...parsers: { [K in keyof T]: Parser<T[K]> }
  ): Parser<T[number]> =>
  (input: string, pos) => {
    if (parsers.length === 0) {
      return createFailure("Empty choice", pos, {
        parserName: "choice",
      });
    }

    const errors: ParseError[] = [];

    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      if (!parser) {
        return createFailure(
          `Parser at index ${i} is undefined`,
          pos,
          { parserName: "choice" }
        );
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

/**
 * Parser that makes a parser optional, returning the value or null.
 * Different from repetition.ts optional which returns [T] | [].
 *
 * @template T Type of the parser result
 * @param parser The parser to make optional
 * @returns Parser that always succeeds, returning T | null
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
 * @template T Type of the parser result
 * @param parser The parser to try
 * @param defaultValue The default value to return if parser fails
 * @returns Parser that always succeeds, returning T or the default value
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
 * Different from lookahead.ts not which is for lookahead only.
 * This parser returns null as a meaningful value.
 *
 * @template T Type of the parser result (not used in the result)
 * @param parser The parser that should fail
 * @returns Parser that returns null if the given parser fails
 */
export const reject =
  <T>(parser: Parser<T>): Parser<null> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return createFailure("Expected parser to fail", pos, {
        parserName: "reject",
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
