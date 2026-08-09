import type { ParseFailure, Parser } from "@suzumiyaaoba/tpeg-core";

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
    const result = parser(input, pos);

    if (!result.success) {
      const failure = result as ParseFailure;
      const enhancedError = { ...failure.error };
      enhancedError.parserName = parserName;

      const failurePos = failure.error.pos ?? pos;
      const found =
        failurePos < input.length ? (input[failurePos] ?? "EOF") : "EOF";

      enhancedError.found = found;

      if (failurePos < input.length) {
        const contextStart = Math.max(0, failurePos - 5);
        const contextEnd = Math.min(input.length, failurePos + 5);
        enhancedError.context = input.substring(contextStart, contextEnd);
      }

      if (!enhancedError.message) {
        enhancedError.message = `${parserName}: Expected ${
          enhancedError.expected || "valid input"
        } but found '${found}'`;
      }

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
export const labeled =
  <T>(
    parser: Parser<T>,
    errorMessage: string,
    parserName?: string,
  ): Parser<T> =>
  (input: string, pos: number) => {
    const result = parser(input, pos);
    if (!result.success) {
      const errorObj = {
        message: errorMessage,
        pos,
        ...(parserName && { parserName }),
        ...(result.error.fatal === true ? { fatal: true } : {}),
      };
      const labeledResult: ParseFailure = {
        success: false,
        error: errorObj,
      };
      return labeledResult;
    }
    return result;
  };

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
export const labeledWithContext =
  <T>(
    parser: Parser<T>,
    errorMessage: string,
    context: string | string[],
    parserName?: string,
  ): Parser<T> =>
  (input: string, pos: number) => {
    const result = parser(input, pos);
    if (!result.success) {
      const contextArray = Array.isArray(context) ? context : [context];
      const fullMessage = `${errorMessage} (in context: ${contextArray.join(" > ")})`;
      const errorObj = {
        message: fullMessage,
        pos,
        context: contextArray,
        ...(parserName && { parserName }),
        ...(result.error.fatal === true ? { fatal: true } : {}),
      };
      const labeledResult: ParseFailure = {
        success: false,
        error: errorObj,
      };
      return labeledResult;
    }
    return result;
  };
