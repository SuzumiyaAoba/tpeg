/**
 * Type representing a non-empty array.
 *
 * This type ensures that the array contains at least one element.
 * It uses TypeScript's tuple syntax to enforce the constraint that
 * the array must have at least one element of type T.
 *
 * @template T - The type of elements in the array
 * @example
 * ```typescript
 * const numbers: NonEmptyArray<number> = [1, 2, 3]; // OK
 * const empty: NonEmptyArray<number> = []; // Type error
 * ```
 */
export type NonEmptyArray<T> = [T, ...T[]];

/**
 * Type representing a non-empty string.
 *
 * This type ensures that the string is not empty by using conditional types.
 * If the input type T is an empty string, it resolves to `never`, otherwise
 * it resolves to the original type T.
 *
 * @template T - The string type to check (defaults to string)
 * @example
 * ```typescript
 * const s: NonEmptyString<"abc"> = "abc"; // OK
 * const s2: NonEmptyString<""> = ""; // Type error - resolves to never
 * const s3: NonEmptyString = "hello"; // OK
 * ```
 */
export type NonEmptyString<T extends string = string> = T extends ""
  ? never
  : T;

/**
 * A fully-resolved position in the source string: offset plus the
 * line/column it falls on. This is NOT what threads through parsing
 * anymore (see `Parser`/`ParseSuccess`/`ParseError`, which all use a
 * plain `offset: number`) -- it survives only as an OUTPUT shape, for
 * callers that explicitly ask for line/column (`withPosition` in
 * `tpeg-combinator`, and error formatting in `./error.ts`), computed
 * lazily on demand via `offsetToPos` (`./utils.ts`) rather than
 * maintained incrementally on every character consumed.
 *
 * @property offset - The absolute offset from the start of the input (0-based)
 * @property column - The column number within the current line (0-based, counted in code points, not UTF-16 code units)
 * @property line - The line number in the input (1-based)
 * @example
 * ```typescript
 * const pos: Pos = {
 *   offset: 15,
 *   column: 5,
 *   line: 2
 * };
 * ```
 */
export type Pos = {
  readonly offset: number;
  readonly column: number;
  readonly line: number;
};

/**
 * Result of successful parsing.
 *
 * When a parser successfully matches input, it returns a ParseSuccess
 * object containing the parsed value and the offsets it spans.
 *
 * @template T - The type of the parsed value
 * @property success - Always true for successful parse results
 * @property val - The parsed value of type T
 * @property current - The offset in the input before parsing began
 * @property next - The offset in the input after parsing completed
 * @example
 * ```typescript
 * const result: ParseSuccess<string> = {
 *   success: true,
 *   val: "parsed text",
 *   current: 0,
 *   next: 11
 * };
 * ```
 */
export type ParseSuccess<T> = {
  success: true;
  val: T;
  current: number;
  next: number;
};

/**
 * Result of failed parsing.
 *
 * When a parser fails to match input, it returns a ParseFailure
 * object containing detailed error information.
 *
 * @property success - Always false for failed parse results
 * @property error - Detailed error information including message, position, and context
 * @example
 * ```typescript
 * const result: ParseFailure = {
 *   success: false,
 *   error: {
 *     message: "Expected digit",
 *     pos: 5,
 *     expected: ["0-9"],
 *     found: "a",
 *     parserName: "digit"
 *   }
 * };
 * ```
 */
export type ParseFailure = {
  success: false;
  error: ParseError;
};

/**
 * Parse result (success or failure).
 *
 * This is a discriminated union type that represents either a successful
 * parse result (ParseSuccess) or a failed parse result (ParseFailure).
 * The `success` property acts as the discriminator.
 *
 * @template T - The type of the parse result value
 * @see ParseSuccess
 * @see ParseFailure
 * @example
 * ```typescript
 * function handleResult(result: ParseResult<string>) {
 *   if (result.success) {
 *     console.log("Parsed:", result.val);
 *   } else {
 *     console.log("Error:", result.error.message);
 *   }
 * }
 * ```
 */
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

/**
 * Parse error information.
 *
 * Contains detailed information about parsing failures, including
 * the location of the error, what was expected, what was found,
 * and context about the parser that failed.
 *
 * @property message - Human-readable error message describing the failure
 * @property pos - Offset in the input where the error occurred (see `offsetToPos` in `./utils.ts` to recover line/column for display)
 * @property expected - What was expected at this position (optional)
 * @property found - What was actually found at this position (optional)
 * @property parserName - Name of the parser that caused the error (optional)
 * @property context - Additional context information about the parser state (optional)
 * @example
 * ```typescript
 * const error: ParseError = {
 *   message: "Expected a number",
 *   pos: 10,
 *   expected: ["digit"],
 *   found: "x",
 *   parserName: "number",
 *   context: ["expression", "term"]
 * };
 * ```
 */
export interface ParseError {
  message: string;
  pos: number;
  expected?: string | string[];
  found?: string;
  parserName?: string;
  context?: string | string[];
  /**
   * Set by `commit()` (see combinators.ts) to mark a failure as a
   * cut/commit point: once a grammar's `~` operator has been reached and
   * the rest of that alternative fails, `choice()`/`captureChoice()` must
   * not try sibling alternatives, and `optional`/`zeroOrMore`/`oneOrMore`/
   * `quantified` (see repetition.ts) must not swallow the failure as "no
   * match" either -- both re-raise a `fatal` failure unchanged instead of
   * applying their normal backtracking/recovery behavior. Every combinator
   * that rebuilds a failure via `{ ...childError, ... }` (rather than
   * discarding it) preserves this flag for free, since it's just another
   * enumerable property on `ParseError`.
   */
  fatal?: boolean;
}

/**
 * Parser function type.
 *
 * A parser is a function that takes an input string and a starting
 * offset, and returns a parse result indicating success or failure.
 * Parsers are the fundamental building blocks of the parsing system.
 *
 * The threaded position is a plain `number` (a UTF-16 code unit offset
 * into `input`), not a `Pos` -- line/column bookkeeping used to be
 * maintained incrementally on every character consumed (`nextPos`
 * building a fresh `Pos` object per call), which is pure overhead for
 * the overwhelming majority of a parse that never fails or asks for a
 * line/column. `Pos` still exists as an output shape: call `offsetToPos`
 * (`./utils.ts`) to recover line/column on demand, e.g. when formatting
 * an error or in `withPosition` (`tpeg-combinator`).
 *
 * @template T - The type of the parse result value
 * @param input - The input string to parse
 * @param pos - The current offset in the input where parsing should begin
 * @returns ParseResult<T> - The result of parsing (success or failure)
 * @example
 * ```typescript
 * const digitParser: Parser<number> = (input: string, pos: number) => {
 *   const char = input[pos];
 *   if (char >= '0' && char <= '9') {
 *     return {
 *       success: true,
 *       val: parseInt(char),
 *       current: pos,
 *       next: pos + 1
 *     };
 *   } else {
 *     return {
 *       success: false,
 *       error: {
 *         message: "Expected digit",
 *         pos,
 *         expected: ["0-9"],
 *         found: char,
 *         parserName: "digit"
 *       }
 *     };
 *   }
 * };
 * ```
 */
export type Parser<T> = (input: string, pos: number) => ParseResult<T>;
