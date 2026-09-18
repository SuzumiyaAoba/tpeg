import type { ParseFailure, Parser } from "@suzumiyaaoba/tpeg-core";
import {
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
      const enhancedError = { ...failure.error };
      enhancedError.parserName = parserName;

      const failurePos = failure.error.pos ?? pos;

      // Keep the shared farthest-failure watermark in sync with this
      // rename -- see `renameWatermarkExpectationsSince`'s doc comment
      // (`tpeg-core`'s `failure.ts`) for why: without this, a `choice`
      // this parser is one alternative of re-forwards the RENAMED
      // failure as a SECOND, differently-named expectation for the same
      // label once this rename turns `result` from the `FAIL` singleton
      // into a plain object, doubling the resulting error message and
      // dropping `parserName` from it entirely.
      renameWatermarkExpectationsSince(input, watermarkBefore, parserName);
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
      // Read `.error` once: on the `FAIL`/`FAIL_FATAL` singletons it is a
      // getter that materializes a fresh object per read.
      const error = result.error;
      // An `abort` failure (resource-limit hit -- see `ParseError.abort`,
      // `@suzumiyaaoba/tpeg-core`) carries its own diagnostic; relabeling
      // it would replace the limit message with this label. Re-raise
      // unchanged.
      if (error.abort === true) return result;
      const errorObj = {
        message: errorMessage,
        pos,
        ...(parserName && { parserName }),
        // A `fatal` (cut/commit) failure must stay `fatal` after
        // relabeling -- otherwise wrapping a committed parser in
        // `labeled(...)` would silently let an enclosing `choice` fall
        // back to a sibling alternative it should have been barred from
        // trying (see `commit`'s doc comment, `@suzumiyaaoba/tpeg-core`).
        ...(error.fatal && { fatal: true }),
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
      // Read `.error` once (see `labeled` above: singletons materialize
      // it per read). An `abort` failure must keep its own resource-limit
      // diagnostic -- re-raise unchanged.
      const error = result.error;
      if (error.abort === true) return result;
      const contextArray = Array.isArray(context) ? context : [context];
      const fullMessage = `${errorMessage} (in context: ${contextArray.join(" > ")})`;
      const errorObj = {
        message: fullMessage,
        pos,
        context: contextArray,
        ...(parserName && { parserName }),
        // See `labeled`'s identical guard above: a `fatal` (cut/commit)
        // failure must survive relabeling.
        ...(error.fatal && { fatal: true }),
      };
      const labeledResult: ParseFailure = {
        success: false,
        error: errorObj,
      };
      return labeledResult;
    }
    return result;
  };
