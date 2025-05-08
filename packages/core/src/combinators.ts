import { type ParseError, ParseResult, type Parser } from "./types";
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
      // For empty array of parsers, return empty array with correct type
      // Using type assertion since we know this is compatible
      return {
        success: true,
        val: [] as unknown as {
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
      const parserResult = parser(input, currentPos);

      if (isFailure(parserResult)) {
        // Add context to the error
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
      const result = parser(input, pos);

      if (result.success) {
        return result;
      }

      if (isFailure(result)) {
        errors.push(result.error);
      }
    }

    // Combine error messages from all failed parsers
    const expected = errors
      .flatMap((e) =>
        e.expected
          ? Array.isArray(e.expected)
            ? e.expected
            : [e.expected]
          : [],
      )
      .filter((v, i, a) => a.indexOf(v) === i); // Remove duplicates

    const found = errors[0]?.found;

    const customMessage = `None of the parsers matched. ${
      expected.length > 0
        ? `Expected one of: ${expected.join(", ")}`
        : "No expectations provided"
    }`;

    return createFailure(customMessage, pos, {
      expected: expected.length > 0 ? expected : undefined,
      found,
      parserName: "choice",
    });
  };
