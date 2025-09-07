// Re-export all types and functions from grammar-types.ts
export * from "./grammar-types";

// Re-export all types and functions from other modules
export * from "./basic";
export * from "./capture";
export * from "./char-class";
export * from "./combinators";
export * from "./error";
export * from "./error-handling";
export * from "./lookahead";
export * from "./repetition";
export * from "./test-utils";
export * from "./transform";
export * from "./types";
export * from "./utils";

// ============================================================================
// Namespaced API for Better Organization
// ============================================================================

/**
 * Namespaced parsers for better API organization.
 *
 * Provides a clean, organized way to access all parser functions
 * with consistent naming and grouping.
 *
 * @example
 * ```typescript
 * import { parsers } from "@suzumiyaaoba/tpeg-core";
 *
 * const helloParser = parsers.literal("hello");
 * const anyCharParser = parsers.any();
 * const digitParser = parsers.charClass("0-9");
 * ```
 */
export const parsers = {
  // Basic parsers
  any: () => import("./basic").then((m) => m.any),
  anyChar: (name?: string) => import("./basic").then((m) => m.anyChar(name)),
  literal: <T extends string>(
    str: import("./types").NonEmptyString<T>,
    name?: string,
  ) => import("./basic").then((m) => m.literal(str, name)),
  lit: <T extends string>(
    str: import("./types").NonEmptyString<T>,
    name?: string,
  ) => import("./basic").then((m) => m.lit(str, name)),

  // Character class parsers
  charClass: (...ranges: [string, string][] | string[]) =>
    import("./char-class").then((m) => {
      // Normalize to CharClassSpec[] as expected by charClass
      const specs = ranges as (string | [string, string])[] as unknown as [
        string | [string, string],
        ...Array<string | [string, string]>,
      ];
      return m.charClass(...specs);
    }),

  // Combinators
  sequence: <P extends import("./types").Parser<unknown>[]>(...parsers: P) =>
    import("./combinators").then((m) => m.sequence(...parsers)),
  seq: <P extends import("./types").Parser<unknown>[]>(...parsers: P) =>
    import("./combinators").then((m) => m.seq(...parsers)),
  choice: <T extends unknown[]>(
    ...parsers: { [K in keyof T]: import("./types").Parser<T[K]> }
  ) => import("./combinators").then((m) => m.choice(...parsers)),
  maybe: <T>(parser: import("./types").Parser<T>) =>
    import("./combinators").then((m) => m.maybe(parser)),
  withDefault: <T>(parser: import("./types").Parser<T>, defaultValue: T) =>
    import("./combinators").then((m) => m.withDefault(parser, defaultValue)),
  reject: <T>(parser: import("./types").Parser<T>, name?: string) =>
    import("./combinators").then((m) => m.reject(parser, name)),

  // Repetition parsers
  zeroOrMore: <T>(parser: import("./types").Parser<T>) =>
    import("./repetition").then((m) => m.zeroOrMore(parser)),
  oneOrMore: <T>(parser: import("./types").Parser<T>) =>
    import("./repetition").then((m) => m.oneOrMore(parser)),
  optional: <T>(parser: import("./types").Parser<T>) =>
    import("./repetition").then((m) => m.optional(parser)),
  quantified: <T>(
    parser: import("./types").Parser<T>,
    min: number,
    max?: number,
  ) => import("./repetition").then((m) => m.quantified(parser, min, max)),

  // Lookahead parsers
  andPredicate: <T>(parser: import("./types").Parser<T>) =>
    import("./lookahead").then((m) => m.andPredicate(parser)),
  notPredicate: <T>(parser: import("./types").Parser<T>) =>
    import("./lookahead").then((m) => m.notPredicate(parser)),
  and: <T>(parser: import("./types").Parser<T>) =>
    import("./lookahead").then((m) => m.and(parser)),
  not: <T>(parser: import("./types").Parser<T>) =>
    import("./lookahead").then((m) => m.not(parser)),

  // Capture parsers
  capture: <T>(label: string, parser: import("./types").Parser<T>) =>
    import("./capture").then((m) => m.capture(label, parser)),
  captureSequence: <P extends import("./types").Parser<unknown>[]>(
    ...parsers: P
  ) => import("./capture").then((m) => m.captureSequence(...parsers)),
  captureChoice: <T extends unknown[]>(
    ...parsers: { [K in keyof T]: import("./types").Parser<T[K]> }
  ) => import("./capture").then((m) => m.captureChoice(...parsers)),

  // Transform parsers
  map: <T, U>(parser: import("./types").Parser<T>, fn: (val: T) => U) =>
    import("./transform").then((m) => m.map(parser, fn)),
  mapResult: <T, U>(
    parser: import("./types").Parser<T>,
    fn: (
      result: import("./types").ParseResult<T>,
    ) => import("./types").ParseResult<U>,
  ) => import("./transform").then((m) => m.mapResult(parser, fn)),
  mapError: <T>(
    parser: import("./types").Parser<T>,
    fn: (error: import("./types").ParseError) => import("./types").ParseError,
  ) =>
    import("./transform").then((m) =>
      m.mapError(
        parser,
        (e: import("./types").ParseFailure): import("./types").ParseFailure =>
          fn(e as unknown as import("./types").ParseError) as unknown as import(
            "./types",
          ).ParseFailure,
      ),
    ),
  filter: <T>(
    parser: import("./types").Parser<T>,
    predicate: (val: T) => boolean,
  ) =>
    import("./transform").then((m) =>
      m.filter(parser, predicate, "Filter predicate failed"),
    ),
  tap: <T>(parser: import("./types").Parser<T>, fn: (val: T) => void) =>
    import("./transform").then((m) => m.tap(parser, fn)),
} as const;

/**
 * Namespaced utilities for better API organization.
 *
 * Provides organized access to utility functions for parsing,
 * error handling, and position management.
 *
 * @example
 * ```typescript
 * import { utils } from "@suzumiyaaoba/tpeg-core";
 *
 * const parseFn = utils.parse(myParser);
 * const pos = utils.createPos(10, 5, 2);
 * const isSuccess = utils.isSuccess(result);
 * ```
 */
export const utils = {
  // Parse utilities
  parse: <T>(parser: import("./types").Parser<T>) =>
    import("./utils").then((m) => m.parse(parser)),

  // Position utilities
  createPos: (offset?: number, column?: number, line?: number) =>
    import("./utils").then((m) => m.createPos(offset, column, line)),
  releasePos: (pos: import("./types").Pos) =>
    import("./utils").then((m) => m.releasePos(pos)),
  nextPos: (char: string, pos: import("./types").Pos) =>
    import("./utils").then((m) => m.nextPos(char, pos)),
  advancePos: (str: string, pos: import("./types").Pos) =>
    import("./utils").then((m) => m.advancePos(str, pos)),

  // Result utilities
  isSuccess: <T>(result: import("./types").ParseResult<T>) =>
    import("./utils").then((m) => m.isSuccess(result)),
  isFailure: <T>(result: import("./types").ParseResult<T>) =>
    import("./utils").then((m) => m.isFailure(result)),
  extractValue: <T>(result: import("./types").ParseResult<T>) =>
    import("./utils").then((m) => m.extractValue(result)),
  safeExtractValue: <T>(result: import("./types").ParseResult<T>) =>
    import("./utils").then((m) => m.safeExtractValue(result)),

  // Error utilities
  createFailure: (
    message: string,
    pos: import("./types").Pos,
    options?: Omit<import("./types").ParseError, "message" | "pos">,
  ) => import("./utils").then((m) => m.createFailure(message, pos, options)),
  formatParseError: (
    error: import("./types").ParseError,
    input: string,
    options?: import("./error").FormatErrorOptions,
  ) => import("./error").then((m) => m.formatParseError(error, input, options)),
  formatParseResult: <T>(
    result: import("./types").ParseResult<T>,
    input: string,
    options?: import("./error").FormatErrorOptions,
  ) =>
    import("./error").then((m) => m.formatParseResult(result, input, options)),
  reportParseError: <T>(
    result: import("./types").ParseResult<T>,
    input: string,
    options?: import("./error").FormatErrorOptions,
  ) =>
    import("./error").then((m) => m.reportParseError(result, input, options)),

  // Character utilities
  getCharAndLength: (input: string, offset: number) =>
    import("./utils").then((m) => m.getCharAndLength(input, offset)),
  unicodeLength: (str: string) =>
    import("./utils").then((m) => m.unicodeLength(str)),
  isWhitespace: (char: string) =>
    import("./utils").then((m) => m.isWhitespace(char)),
  isNewline: (char: string) => import("./utils").then((m) => m.isNewline(char)),

  // Array utilities
  isEmptyArray: <T>(arr: readonly T[]) =>
    import("./utils").then((m) => m.isEmptyArray(arr)),
  isNonEmptyArray: <T>(arr: readonly T[]) =>
    import("./utils").then((m) => m.isNonEmptyArray(arr)),
} as const;

/**
 * Namespaced combinators for better API organization.
 *
 * Provides organized access to parser combinators for building
 * complex parsing logic.
 *
 * @example
 * ```typescript
 * import { combinators } from "@suzumiyaaoba/tpeg-core";
 *
 * const sequence = combinators.sequence(parser1, parser2, parser3);
 * const choice = combinators.choice(alt1, alt2, alt3);
 * ```
 */
export const combinators = {
  sequence: <P extends import("./types").Parser<unknown>[]>(...parsers: P) =>
    import("./combinators").then((m) => m.sequence(...parsers)),
  seq: <P extends import("./types").Parser<unknown>[]>(...parsers: P) =>
    import("./combinators").then((m) => m.seq(...parsers)),
  choice: <T extends unknown[]>(
    ...parsers: { [K in keyof T]: import("./types").Parser<T[K]> }
  ) => import("./combinators").then((m) => m.choice(...parsers)),
  maybe: <T>(parser: import("./types").Parser<T>) =>
    import("./combinators").then((m) => m.maybe(parser)),
  withDefault: <T>(parser: import("./types").Parser<T>, defaultValue: T) =>
    import("./combinators").then((m) => m.withDefault(parser, defaultValue)),
  reject: <T>(parser: import("./types").Parser<T>, name?: string) =>
    import("./combinators").then((m) => m.reject(parser, name)),
} as const;
