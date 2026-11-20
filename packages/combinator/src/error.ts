import type { ParseFailure, Parser } from "@suzumiyaaoba/tpeg-core";
import {
  cloneParseError,
  getCharAt,
  renameWatermarkExpectationsSince,
  snapshotFailureWatermark,
} from "@suzumiyaaoba/tpeg-core";

/**
 * Creates a parser with detailed error reporting that includes context and position information.
 *
 * Enhances the default error message by providing the specific character where parsing failed,
 * its position, and the surrounding input context to aid in debugging complex grammars.
 *
 * @template T Type of parser result
 * @param parser The parser to wrap with detailed error reporting
 * @param parserName Name of the parser for error reporting
 * @returns Parser<T> A parser with enhanced error reporting including context information
 */
export const withDetailedError = <T>(
  parser: Parser<T>,
  parserName: string,
): Parser<T> => {
  return (input: string, pos: number) => {
    // Snapshot the farthest-failure watermark BEFORE running the wrapped
    // parser: the rename below must retitle exactly the entries THIS
    // call contributed -- never expectations other parsers recorded
    // earlier (see `renameWatermarkExpectationsSince`, `tpeg-core`'s
    // `failure.ts`).
    const watermarkBefore = snapshotFailureWatermark();
    const result = parser(input, pos);

    if (!result.success) {
      const failure = result as ParseFailure;
      // FAIL's getter materializes a new error on each access. Use one
      // snapshot so position, expected text and found refer to one error.
      const error = failure.error;
      const enhancedError = cloneParseError(error);
      enhancedError.parserName = parserName;

      const failurePos = enhancedError.pos ?? pos;

      // `getCharAt`, not `input[failurePos]`: the latter indexes by raw
      // UTF-16 code unit, so a failure positioned on an astral character
      // (e.g. an emoji) would return a lone, unpaired surrogate instead of
      // the actual character.
      const found =
        failurePos < input.length
          ? getCharAt(input, failurePos) || "EOF"
          : "EOF";

      enhancedError.found = found;

      if (failurePos < input.length) {
        const contextStart = Math.max(0, failurePos - 5);
        const contextEnd = Math.min(input.length, failurePos + 5);
        enhancedError.context = input.substring(contextStart, contextEnd);
      }

      if (!enhancedError.message) {
        const expected = Array.isArray(enhancedError.expected)
          ? enhancedError.expected.join(" or ")
          : enhancedError.expected;
        enhancedError.message = `${parserName}: Expected ${expected || "valid input"} but found '${found}'`;
      }

      // Update only this call's records after adding details. An outer
      // choice de-duplicates the returned failure against these records,
      // so they must carry the decorated found/context as well as its name.
      renameWatermarkExpectationsSince(input, watermarkBefore, parserName, {
        found,
        ...(enhancedError.context !== undefined && {
          context: enhancedError.context,
        }),
      });

      return {
        success: false,
        error: enhancedError,
      };
    }

    return result;
  };
};

/**
 * Wraps `parser` with {@link withDetailedError} when `parserName` is given,
 * otherwise returns it unchanged. Centralizes the
 * `parserName ? withDetailedError(parser, parserName) : parser` pattern
 * repeated across the combinator modules.
 *
 * @template T Type of parser result
 * @param parser The parser to conditionally wrap
 * @param parserName Optional name for error reporting
 * @returns `parser`, wrapped with detailed error reporting if `parserName` is provided
 */
export const named = <T>(parser: Parser<T>, parserName?: string): Parser<T> =>
  parserName ? withDetailedError(parser, parserName) : parser;

/** Apply the same label to a failure and the expectations recorded for this call. */
const withLabel =
  <T>(
    parser: Parser<T>,
    message: string,
    parserName?: string,
    context?: string | string[],
  ): Parser<T> =>
  (input, pos) => {
    const watermarkBefore = parserName ? snapshotFailureWatermark() : undefined;
    const result = parser(input, pos);
    if (result.success) return result;

    const error = result.error;
    if (error.abort === true) return result;
    if (parserName && watermarkBefore) {
      renameWatermarkExpectationsSince(input, watermarkBefore, parserName);
    }
    const contextArray =
      context === undefined
        ? undefined
        : Array.isArray(context)
          ? [...context]
          : [context];
    return {
      success: false,
      error: {
        message:
          contextArray === undefined
            ? message
            : `${message} (in context: ${contextArray.join(" > ")})`,
        pos,
        ...(contextArray !== undefined && { context: contextArray }),
        ...(parserName && { parserName }),
        ...(error.fatal && { fatal: true }),
      },
    };
  };

/**
 * Creates a labeled parser with custom error message.
 *
 * Provides simple error labeling for parser debugging and error reporting.
 *
 * @template T Type of parser result
 * @param parser Parser to label
 * @param errorMessage Error message to use when parser fails
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T> Labeled parser with custom error message
 */
export const labeled = <T>(
  parser: Parser<T>,
  errorMessage: string,
  parserName?: string,
): Parser<T> => withLabel(parser, errorMessage, parserName);

/**
 * Creates a labeled parser with custom error message and hierarchical context.
 *
 * Provides detailed error reporting with context hierarchy for better debugging
 * and error understanding in complex parser compositions.
 *
 * @template T Type of parser result
 * @param parser Parser to label
 * @param errorMessage Error message to use when parser fails
 * @param context Context information for error reporting (string or array of strings)
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T> Labeled parser with hierarchical context information
 */
export const labeledWithContext = <T>(
  parser: Parser<T>,
  errorMessage: string,
  context: string | string[],
  parserName?: string,
): Parser<T> => withLabel(parser, errorMessage, parserName, context);
