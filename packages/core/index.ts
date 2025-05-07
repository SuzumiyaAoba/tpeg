//
// Core Types
//

/**
 * Type representing a non-empty array.
 *
 * This type ensures that the array contains at least one element.
 *
 * @template T Type of array elements
 */
export type NonEmptyArray<T> = [T, ...T[]];

/**
 * Checks if the given array is empty.
 *
 * @template T Type of array elements
 * @param arr The array to check
 * @returns Returns true if the array is empty, otherwise false.
 */
export const isEmptyArray = <T>(arr: readonly T[]): arr is [] => {
  return arr.length === 0;
};

/**
 * Checks if the given array is non-empty.
 *
 * @template T Type of array elements
 * @param arr The array to check
 * @returns Returns true if the array is non-empty, otherwise false.
 */
export const isNonEmptyArray = <T>(
  arr: readonly T[],
): arr is NonEmptyArray<T> => {
  return arr.length > 0;
};

/**
 * Type representing a non-empty string.
 *
 * @template T String type (defaults to string)
 * @example
 *   const s: NonEmptyString<"abc"> = "abc"; // OK
 *   const s2: NonEmptyString<""> = never; // Error
 */
export type NonEmptyString<T extends string = string> = T extends ""
  ? never
  : T;

/**
 * Input position information in the source string.
 *
 * @property offset The absolute offset from the start of the input (0-based)
 * @property column The column number (0-based)
 * @property line The line number (1-based)
 */
export type Pos = {
  readonly offset: number;
  readonly column: number;
  readonly line: number;
};

/**
 * Result of successful parsing.
 *
 * @template T Type of the parse result value
 * @property success Always true
 * @property val The parsed value
 * @property current The position before parsing
 * @property next The position after parsing
 */
export type ParseSuccess<T> = {
  success: true;
  val: T;
  current: Pos;
  next: Pos;
};

/**
 * Result of failed parsing.
 *
 * @property success Always false
 * @property error The error information
 */
export type ParseFailure = {
  success: false;
  error: ParseError;
};

/**
 * Parse result (success or failure).
 *
 * @template T Type of the parse result value
 * @see ParseSuccess
 * @see ParseFailure
 */
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

/**
 * Parse error information.
 *
 * @property message Error message
 * @property pos Position where the error occurred
 * @property expected What was expected at this position
 * @property found What was actually found at this position
 * @property parserName Name of the parser that caused the error
 * @property context Information about parser context (e.g. the rule name or path)
 */
export interface ParseError {
  message: string;
  pos: Pos;
  expected?: string | string[];
  found?: string;
  parserName?: string;
  context?: string | string[];
}

/**
 * Parser function type.
 *
 * @template T Type of the parse result value
 * @param input The input string to parse
 * @param pos The current position in the input
 * @returns ParseResult<T> The result of parsing (success or failure)
 */
export type Parser<T> = (input: string, pos: Pos) => ParseResult<T>;

/**
 * Utility function to get a single character from the input string at the given offset,
 * taking surrogate pairs (Unicode code points) into account. Returns the character and its length in code units.
 *
 * @param input The input string
 * @param offset The position in the original string to start reading
 * @returns [The character at the given offset, its length in code units (1 or 2)]. Returns ["", 0] if out of range.
 */
export const getCharAndLength = (
  input: string,
  offset: number,
): [string, number] => {
  const code = input.codePointAt(offset);
  if (code === undefined) return ["", 0];
  const char = String.fromCodePoint(code);
  return [char, char.length];
};

/**
 * Utility function to calculate the next position after consuming a character.
 *
 * @param char The character being consumed
 * @param pos The current position
 * @returns The new position after consuming the character
 */
export const nextPos = (char: string, { offset, column, line }: Pos): Pos => {
  const isNewline = char === "\n";
  return {
    offset: offset + char.length,
    column: isNewline ? 0 : column + 1,
    line: isNewline ? line + 1 : line,
  };
};

/**
 * Utility function to run parsing from the beginning of the input.
 *
 * @template T Type of the parse result value
 * @param parser The parser to run
 * @returns Function that takes an input string and returns the parse result from the beginning of the input.
 */
export const parse =
  <T>(parser: Parser<T>) =>
  (input: string) =>
    parser(input, { offset: 0, column: 0, line: 1 });

//
// Primitive combinators
//

/**
 * Parser that parses any single character from the input.
 *
 * @returns Parser<string> A parser that succeeds if any character is present at the current position, or fails at end of input.
 */
export const anyChar =
  (parserName = "anyChar"): Parser<string> =>
  (input: string, pos: Pos) => {
    const [char, charLength] = getCharAndLength(input, pos.offset);

    if (!char) {
      return createFailure("Unexpected EOI", pos, {
        expected: "any character",
        found: "end of input",
        parserName,
      });
    }

    return {
      success: true,
      val: char,
      current: pos,
      next: nextPos(char, pos),
    };
  };

/**
 * Alias for {@link anyChar}.
 *
 * @returns Parser<string>
 */
export const any = () => anyChar("any");

/**
 * Parser that parses the specified literal string from the input.
 *
 * @template T Type of the literal string
 * @param str The literal string to parse (must be non-empty)
 * @returns Parser<T> A parser that succeeds if the input at the current position matches the given string exactly.
 */
export const literal =
  <T extends string>(
    str: NonEmptyString<T>,
    parserName = "literal",
  ): Parser<T> =>
  (input: string, pos: Pos) => {
    // Check for end of input
    if (pos.offset >= input.length) {
      return createFailure("Unexpected EOI", pos, {
        expected: `"${str}"`,
        found: "end of input",
        parserName,
      });
    }

    // Optimize for short, simple strings
    if (canUseOptimizedPath(str)) {
      const result = parseSimpleString(str, input, pos, parserName);
      if (result) return result;
    }

    // Full Unicode-aware parsing for complex strings
    return parseComplexString(str, input, pos, parserName);
  };

/**
 * Helper function to determine if a string can use the optimized parsing path.
 *
 * @param str The string to check
 * @returns True if the string is short and contains only simple characters
 */
const canUseOptimizedPath = (str: string): boolean => {
  return (
    str.length <= 10 && !str.includes("\n") && !/[\uD800-\uDFFF]/.test(str)
  );
};

/**
 * Helper function to create a failure result with the given message and position.
 *
 * @param message Error message
 * @param pos Position where the error occurred
 * @param options Additional error information
 * @returns A ParseFailure object
 */
const createFailure = (
  message: string,
  pos: Pos,
  options?: Omit<ParseError, "message" | "pos">,
): ParseFailure => {
  return {
    success: false,
    error: {
      message,
      pos,
      ...options,
    },
  };
};

/**
 * Parse a simple string using optimized substring comparison.
 *
 * @param str The target string to parse
 * @param input The input string
 * @param pos The current position
 * @param parserName Name of the parser
 * @returns A ParseResult if successful, null if optimization can't be applied
 */
const parseSimpleString = <T extends string>(
  str: NonEmptyString<T>,
  input: string,
  pos: Pos,
  parserName = "literal",
): ParseResult<T> | null => {
  // Fail early if input is too short
  if (pos.offset + str.length > input.length) {
    return createFailure("Unexpected EOI", pos, {
      expected: `"${str}"`,
      found: "end of input",
      parserName,
    });
  }

  // Fast substring comparison
  const inputSubstring = input.substring(pos.offset, pos.offset + str.length);
  if (inputSubstring === str) {
    // Success case
    return {
      success: true,
      val: str,
      current: pos,
      next: {
        offset: pos.offset + str.length,
        column: pos.column + str.length,
        line: pos.line,
      },
    };
  }
  // Find position of mismatch
  let i = 0;
  while (
    i < str.length &&
    i < inputSubstring.length &&
    str.charAt(i) === inputSubstring.charAt(i)
  ) {
    i++;
  }

  const mismatchPos = {
    offset: pos.offset + i,
    column: pos.column + i,
    line: pos.line,
  };

  // Extract the found character that didn't match
  const foundChar = i < inputSubstring.length ? inputSubstring.charAt(i) : "";
  const expectedChar = i < str.length ? str.charAt(i) : "";

  return createFailure(
    `Unexpected character: expected "${expectedChar}" but found "${foundChar}"`,
    mismatchPos,
    {
      expected: `"${str}"`,
      found: inputSubstring,
      parserName,
    },
  );
};

/**
 * Parse a complex string using character-by-character comparison with Unicode support.
 *
 * @param str The target string to parse
 * @param input The input string
 * @param pos The current position
 * @param parserName Name of the parser
 * @returns A ParseResult
 */
const parseComplexString = <T extends string>(
  str: NonEmptyString<T>,
  input: string,
  pos: Pos,
  parserName = "literal",
): ParseResult<T> => {
  let column = pos.column;
  let line = pos.line;
  let currentOffset = pos.offset;
  let strOffset = 0;

  while (strOffset < str.length) {
    const [char, charLength] = getCharAndLength(input, currentOffset);
    const [targetChar, targetCharLength] = getCharAndLength(str, strOffset);

    if (!char || char !== targetChar) {
      const errorPos = {
        offset: currentOffset,
        column,
        line,
      };

      return createFailure(
        `Unexpected ${char ? `character "${char}"` : "EOI"}`,
        errorPos,
        {
          expected: `"${targetChar}"`,
          found: char || "end of input",
          parserName,
        },
      );
    }

    if (char === "\n") {
      line++;
      column = 0;
    } else {
      column++;
    }

    currentOffset += charLength;
    strOffset += targetCharLength;
  }

  return {
    success: true,
    val: str,
    current: pos,
    next: {
      offset: currentOffset,
      column,
      line,
    },
  };
};

/**
 * Alias for {@link literal}.
 *
 * @see literal
 */
export const lit = literal;

/**
 * Parser that parses a single character from the specified set of characters or character ranges.
 *
 * @param charOrRanges List of characters or [start, end] tuples representing character ranges. Each element must be a non-empty string or a tuple of two non-empty strings.
 * @returns Parser<string> A parser that succeeds if the input character matches any of the specified characters or ranges.
 * @example
 *   charClass("a", ["0", "9"]) // matches 'a' or any digit
 */
export const charClass =
  (
    ...charOrRanges: NonEmptyArray<
      NonEmptyString | [NonEmptyString, NonEmptyString]
    >
  ): Parser<string> =>
  (input: string, pos: Pos) => {
    const [char, charLength] = getCharAndLength(input, pos.offset);
    if (!char) {
      const classToString = (charOrRange: string | [string, string]) => {
        if (typeof charOrRange === "string") {
          return charOrRange;
        }
        return `${charOrRange[0]}-${charOrRange[1]}`;
      };

      const expectedChars = charOrRanges.map(classToString).join("");

      return createFailure("Unexpected EOI", pos, {
        expected: `[${expectedChars}]`,
        found: "end of input",
        parserName: "charClass",
      });
    }

    for (const charOrRange of charOrRanges) {
      if (typeof charOrRange === "string") {
        if (char === charOrRange) {
          return {
            success: true,
            val: char,
            current: pos,
            next: nextPos(char, pos),
          };
        }
      } else {
        const [start, stop] = charOrRange;
        const charCode = char.codePointAt(0);
        const startCode = start.codePointAt(0);
        const stopCode = stop.codePointAt(0);
        if (
          charCode !== undefined &&
          startCode !== undefined &&
          stopCode !== undefined &&
          startCode <= charCode &&
          charCode <= stopCode
        ) {
          return {
            success: true,
            val: char,
            current: pos,
            next: nextPos(char, pos),
          };
        }
      }
    }

    const classToString = (charOrRange: string | [string, string]) => {
      if (typeof charOrRange === "string") {
        return charOrRange;
      }
      return `${charOrRange[0]}-${charOrRange[1]}`;
    };

    const expectedChars = charOrRanges.map(classToString).join("");

    return createFailure(`Expected [${expectedChars}]`, pos, {
      expected: `[${expectedChars}]`,
      found: char,
      parserName: "charClass",
    });
  };

/**
 * Parser that applies multiple parsers in sequence.
 *
 * @template P Array of parser types
 * @param parsers List of parsers to apply in order
 * @returns Parser returning a tuple of results from each parser if all succeed, or fails on the first failure.
 */
export const sequence =
  <P extends Parser<unknown>[]>(
    ...parsers: P
  ): Parser<{ [K in keyof P]: P[K] extends Parser<infer T> ? T : never }> =>
  (input: string, pos: Pos) => {
    const values: unknown[] = [];
    let currentPos = pos;

    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      const result = parser(input, currentPos);

      if (!result.success) {
        // Add sequence context to error
        return {
          success: false,
          error: {
            ...result.error,
            message: `Sequence failed at item ${i + 1}: ${
              result.error.message
            }`,
            context: [`sequence item ${i + 1} of ${parsers.length}`],
            parserName: result.error.parserName || "sequence",
          },
        };
      }

      values.push(result.val);
      currentPos = result.next;
    }

    return {
      success: true,
      val: values as {
        [K in keyof P]: P[K] extends Parser<infer T> ? T : never;
      },
      current: pos,
      next: currentPos,
    };
  };

/**
 * Parser that applies one of multiple parsers (ordered choice).
 *
 * @template T Array of result types
 * @param parsers List of parsers to try in order
 * @returns Parser that returns the result of the first successful parser, or fails if all fail.
 */
export const choice =
  <T extends unknown[]>(
    ...parsers: { [K in keyof T]: Parser<T[K]> }
  ): Parser<T[number]> =>
  (input: string, pos: Pos) => {
    const errors: ParseError[] = [];

    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      const result = parser(input, pos);

      if (result.success) {
        return result;
      }

      // Collect error information from each failed alternative
      errors.push({
        ...result.error,
        context: [
          ...(result.error.context || []),
          `choice alternative ${i + 1} of ${parsers.length}`,
        ],
      });
    }

    // Combine error information from all alternatives
    const combinedExpected = errors
      .map((err) => err.expected)
      .filter((exp): exp is string | string[] => exp !== undefined)
      .flat();

    // Use the error from the last parser as the base
    const lastError = errors[errors.length - 1];

    return createFailure(
      `None of the ${parsers.length} alternatives matched`,
      pos,
      {
        expected: combinedExpected.length > 0 ? combinedExpected : undefined,
        found: lastError.found,
        parserName: "choice",
        context: [`choice with ${parsers.length} alternatives`],
      },
    );
  };

/**
 * Alias for {@link sequence}.
 *
 * @template P Array of parser types
 * @param parsers List of parsers to apply in order
 * @returns Parser returning a tuple of results from each parser if all succeed, or fails on the first failure.
 * @see sequence
 */
export const seq = sequence;

/**
 * Parser that makes the given parser optional.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<[T] | []> A parser that returns a single-element array if successful, or an empty array if not.
 * @example
 *   const optionalDigit = optional(charClass(["0", "9"]));
 *   // Matches a digit or nothing
 */
export const optional =
  <T>(parser: Parser<T>): Parser<[T] | []> =>
  (input: string, pos: Pos) => {
    const result = parser(input, pos);
    if (result.success) {
      return {
        success: true,
        val: [result.val],
        current: pos,
        next: result.next,
      };
    }

    // For optional, failure is not an error, just return empty array
    return {
      success: true,
      val: [],
      current: pos,
      next: pos,
    };
  };

/**
 * Alias for {@link optional}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<[T] | []> A parser that returns a single-element array if successful, or an empty array if not.
 * @see optional
 */
export const opt = optional;

/**
 * Parser that parses zero or more repetitions of the given parser.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<T[]> A parser that returns an array of results (possibly empty).
 * @example
 *   const digits = zeroOrMore(charClass(["0", "9"]));
 *   // Matches zero or more digits
 */
export const zeroOrMore =
  <T>(parser: Parser<T>): Parser<T[]> =>
  (input: string, pos: Pos) => {
    const results: T[] = [];
    let currentPos = pos;
    let result = parser(input, currentPos);

    while (result.success) {
      // Check to prevent infinite loop: ensure position is advancing
      if (result.next.offset <= currentPos.offset) {
        break;
      }

      results.push(result.val);
      currentPos = result.next;
      // Exit if we've reached the end of input
      if (currentPos.offset >= input.length) {
        break;
      }
      result = parser(input, currentPos);
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
 * @returns Parser<T[]> A parser that returns an array of results (possibly empty).
 * @see zeroOrMore
 */
export const star = zeroOrMore;

/**
 * Alias for {@link zeroOrMore}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<T[]> A parser that returns an array of results (possibly empty).
 * @see zeroOrMore
 */
export const many = zeroOrMore;

/**
 * Parser that parses one or more repetitions of the given parser.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of results, or fails if no match is found.
 */
export const oneOrMore =
  <T>(parser: Parser<T>): Parser<NonEmptyArray<T>> =>
  (input: string, pos: Pos) => {
    // Try the first match
    const firstResult = parser(input, pos);
    if (!firstResult.success) {
      return {
        success: false,
        error: {
          ...firstResult.error,
          message: `Expected at least one match: ${firstResult.error.message}`,
          parserName: "oneOrMore",
          context: [
            ...(firstResult.error.context || []),
            "first item in oneOrMore",
          ],
        },
      };
    }

    // Remaining matches (zero or more)
    const restResults = zeroOrMore(parser)(input, firstResult.next);
    if (!restResults.success) {
      // This shouldn't happen, but for type safety
      return restResults as ParseResult<NonEmptyArray<T>>;
    }

    // Combine first match and rest
    return {
      success: true,
      val: [firstResult.val, ...restResults.val] as NonEmptyArray<T>,
      current: pos,
      next: restResults.next,
    };
  };

/**
 * Alias for {@link oneOrMore}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of results, or fails if no match is found.
 * @see oneOrMore
 */
export const plus = oneOrMore;

/**
 * Alias for {@link oneOrMore}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of results, or fails if no match is found.
 * @see oneOrMore
 */
export const many1 = oneOrMore;

/**
 * Parser for positive lookahead (does not consume input).
 *
 * Succeeds if the given parser succeeds at the current position, but does not consume any input.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for success/failure without consuming input.
 */
export const andPredicate =
  <T>(parser: Parser<T>): Parser<never> =>
  (input: string, pos: Pos) => {
    const result = parser(input, pos);
    if (!result.success) {
      return {
        success: false,
        error: {
          ...result.error,
          message: `And-predicate did not match: ${result.error.message}`,
          parserName: "andPredicate",
          context: [...(result.error.context || []), "in positive lookahead"],
        },
      };
    }

    return {
      success: true,
      val: undefined as never,
      current: pos,
      next: pos,
    };
  };

/**
 * Alias for {@link andPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for success/failure without consuming input.
 * @see andPredicate
 */
export const and = andPredicate;

/**
 * Alias for {@link andPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for success/failure without consuming input.
 * @see andPredicate
 */
export const positive = andPredicate;

/**
 * Alias for {@link andPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for success/failure without consuming input.
 * @see andPredicate
 */
export const assert = andPredicate;

/**
 * Parser for negative lookahead (does not consume input).
 *
 * Succeeds if the given parser fails at the current position, but does not consume any input.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for failure without consuming input.
 */
export const notPredicate =
  <T>(parser: Parser<T>): Parser<never> =>
  (input: string, pos: Pos) => {
    const result = parser(input, pos);
    if (!result.success) {
      return {
        success: true,
        val: undefined as never,
        current: pos,
        next: pos,
      };
    }

    return createFailure("Not-predicate matched when it should not have", pos, {
      parserName: "notPredicate",
      context: ["in negative lookahead"],
      expected: "pattern not to match",
      found: result.success ? "matching pattern" : undefined,
    });
  };

/**
 * Alias for {@link notPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for failure without consuming input.
 * @see notPredicate
 */
export const not = notPredicate;

/**
 * Alias for {@link notPredicate}.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<never> A parser that only checks for failure without consuming input.
 * @see notPredicate
 */
export const negative = notPredicate;

/**
 * Parser that applies a transformation function to the parse result value.
 *
 * @template T Type of the input parse result value
 * @template U Type of the output value
 * @param parser Target parser
 * @param f Transformation function applied to the parse result value
 * @returns Parser<U> A parser that returns the transformed value if parsing succeeds, or fails otherwise.
 * @example
 *   const digit = map(
 *     charClass(["0", "9"]),
 *     char => parseInt(char, 10)
 *   );
 *   // Parses a digit char and converts it to a number
 */
export const map =
  <T, U>(parser: Parser<T>, f: (value: T) => U): Parser<U> =>
  (input: string, index: Pos) => {
    const result = parser(input, index);

    return result.success
      ? { ...result, val: f(result.val) }
      : (result as ParseResult<U>);
  };

/**
 * Parser that transforms the entire ParseSuccess object on success.
 *
 * @template T Type of the input parse result value
 * @template U Type of the output value
 * @param parser Target parser
 * @param f Function to transform the ParseSuccess object
 * @returns Parser<U> A parser that returns the transformed value if parsing succeeds, or fails otherwise.
 * @example
 *   const withPosition = mapResult(
 *     charClass(["0", "9"]),
 *     result => ({ value: result.val, position: result.current })
 *   );
 *   // Returns both the parsed digit and its position in the input
 */
export const mapResult =
  <T, U>(parser: Parser<T>, f: (value: ParseSuccess<T>) => U): Parser<U> =>
  (input: string, index: Pos) => {
    const result = parser(input, index);

    return result.success
      ? { ...result, val: f(result) }
      : (result as ParseResult<U>);
  };

/**
 * Formats a parse error into a human-readable string with source context.
 *
 * @param error The parse error to format
 * @param input The original input string that was being parsed
 * @param options Formatting options
 * @returns A formatted error message with context
 */
export const formatParseError = (
  error: ParseError,
  input: string,
  options: {
    contextLines?: number;
    highlightErrors?: boolean;
    showPosition?: boolean;
    colorize?: boolean;
  } = {},
): string => {
  const {
    contextLines = 2,
    highlightErrors = true,
    showPosition = true,
    colorize = true,
  } = options;

  const { pos, message, expected, found, parserName, context } = error;
  const { line, column, offset } = pos;

  // Helper for color formatting if enabled
  const color = {
    red: (text: string) => (colorize ? `\x1b[31m${text}\x1b[0m` : text),
    green: (text: string) => (colorize ? `\x1b[32m${text}\x1b[0m` : text),
    yellow: (text: string) => (colorize ? `\x1b[33m${text}\x1b[0m` : text),
    blue: (text: string) => (colorize ? `\x1b[34m${text}\x1b[0m` : text),
    bold: (text: string) => (colorize ? `\x1b[1m${text}\x1b[0m` : text),
  };

  // Build the basic error message
  let result = color.bold(
    color.red(`Parse error at line ${line}, column ${column}:\n`),
  );

  // Add parser context if available
  if (context?.length) {
    result += color.blue(
      `Context: ${Array.isArray(context) ? context.join(" > ") : context}\n`,
    );
  }

  // Add parser name if available
  if (parserName) {
    result += color.blue(`Parser: ${parserName}\n`);
  }

  // Add expected/found info
  if (expected) {
    const expectedStr = Array.isArray(expected)
      ? expected.join(", ")
      : expected;
    result += color.green(`Expected: ${expectedStr}\n`);
  }
  if (found !== undefined) {
    result += color.red(`Found: ${found === "" ? "empty string" : found}\n`);
  }

  // Add the error message itself
  result += color.bold(`${message}\n`);

  // Add source context if input is provided
  if (input) {
    const lines = input.split("\n");

    // Determine which lines to show
    const startLine = Math.max(1, line - contextLines);
    const endLine = Math.min(lines.length, line + contextLines);

    // Add source context
    result += `\n${color.bold("Source context:")}\n`;

    // Calculate width needed for line numbers
    const lineNumWidth = String(endLine).length;

    // Show context lines
    for (let i = startLine; i <= endLine; i++) {
      const lineContent = lines[i - 1];
      const isErrorLine = i === line;
      const lineNum = String(i).padStart(lineNumWidth, " ");

      // Mark the error line
      const prefix = isErrorLine ? color.bold(color.red("> ")) : "  ";
      result += `${prefix}${lineNum} | ${lineContent}\n`;

      // Add pointer to error position
      if (isErrorLine && highlightErrors) {
        const pointer =
          " ".repeat(lineNumWidth + 3 + column) + color.bold(color.red("^"));
        result += `${pointer}\n`;
      }
    }
  }

  // Add position information
  if (showPosition) {
    result += `\n${color.bold(
      "Position:",
    )} Line ${line}, Column ${column}, Offset ${offset}\n`;
  }

  return result;
};

/**
 * Formats a parse result into a human-readable error message if it's a failure.
 * For successful parse results, returns null.
 *
 * @param result The parse result to format
 * @param input The original input string
 * @param options Formatting options (see formatParseError)
 * @returns A formatted error message or null if parsing was successful
 */
export const formatParseResult = <T>(
  result: ParseResult<T>,
  input: string,
  options?: Parameters<typeof formatParseError>[2],
): string | null => {
  if (result.success) {
    return null;
  }

  return formatParseError(result.error, input, options);
};

// Helper function for simple error reporting
export const reportParseError = <T>(
  result: ParseResult<T>,
  input: string,
  options?: Parameters<typeof formatParseError>[2],
): void => {
  if (!result.success) {
    console.error(formatParseError(result.error, input, options));
  }
};
