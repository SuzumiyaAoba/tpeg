//
// Types
//

/**
 * Type representing a non-empty array.
 *
 * This type ensures that tthe array contains at least one element.
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
 */
export interface ParseError {
  message: string;
  pos: Pos;
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
const getCharAndLength = (input: string, offset: number): [string, number] => {
  const code = input.codePointAt(offset);
  if (code === undefined) return ["", 0];
  const char = String.fromCodePoint(code);
  return [char, char.length];
};

const nextPos = (char: string, { offset, column, line }: Pos): Pos => {
  const isNewline = char === "\n";
  return {
    offset: offset + char.length,
    column: isNewline ? 0 : column + 1,
    line: isNewline ? line + 1 : line,
  };
};

//
// Primitive combinators
//

/**
 * Parser that parses any single character from the input.
 *
 * @returns Parser<string> A parser that succeeds if any character is present at the current position, or fails at end of input.
 */
export const anyChar = (): Parser<string> => (input, pos) => {
  const [char, charLen] = getCharAndLength(input, pos.offset);

  if (!char) {
    return {
      success: false,
      error: {
        message: "Unexpected EOI",
        pos,
      },
    };
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
export const any = anyChar;

/**
 * Parser that parses the specified literal string from the input.
 *
 * @template T Type of the literal string
 * @param str The literal string to parse (must be non-empty)
 * @returns Parser<T> A parser that succeeds if the input at the current position matches the given string exactly.
 */
export const literal =
  <T extends string>(str: NonEmptyString<T>): Parser<T> =>
  (input, pos) => {
    if (pos.offset >= input.length) {
      return {
        success: false,
        error: {
          message: "Unexpected EOI",
          pos,
        },
      };
    }

    let column = pos.column;
    let line = pos.line;
    for (let i = 0; i < str.length; i++) {
      const char = input.charAt(pos.offset + i);

      if (char !== str.charAt(i)) {
        return {
          success: false,
          error: {
            message: "Unexpected character",
            pos: {
              offset: pos.offset + i,
              column: column,
              line,
            },
          },
        };
      }

      if (char === "\n") {
        line++;
        column = 0;
      } else {
        column++;
      }
    }

    return {
      success: true,
      val: str,
      current: pos,
      next: {
        offset: pos.offset + str.length,
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
  (input, pos) => {
    const [char, charLen] = getCharAndLength(input, pos.offset);
    if (!char) {
      return {
        success: false,
        error: { message: "Unexpected EOI", pos },
      };
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

    return {
      success: false,
      error: {
        message: `Expected [${charOrRanges.map(classToString).join("")}]`,
        pos,
      },
    };
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
  (input, pos) => {
    const values: unknown[] = [];
    let currentPos = pos;
    for (const parser of parsers) {
      const result = parser(input, currentPos);

      if (!result.success) {
        return result;
      }

      values.push(result.val);
      currentPos = result.next;
    }

    return {
      success: true,
      // biome-ignore lint/suspicious/noExplicitAny:
      val: values as any,
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
  (input, pos) => {
    for (const parser of parsers) {
      const result = parser(input, pos);
      if (result.success) {
        return result;
      }
    }

    return {
      success: false,
      error: {
        message: `Expected one of: ${parsers
          .map((_, i) => `choice ${i + 1}`)
          .join(", ")}`,
        pos,
      },
    };
  };

/**
 * Alias for {@link sequence}.
 *
 * @see sequence
 */
export const seq = sequence;

/**
 * Parser that makes the given parser optional.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<[T] | []> A parser that returns a single-element array if successful, or an empty array if not.
 */
export const optional =
  <T>(parser: Parser<T>): Parser<[T] | []> =>
  (input, pos) => {
    const result = parser(input, pos);
    if (result.success) {
      return {
        success: true,
        val: [result.val],
        current: pos,
        next: result.next,
      };
    }

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
 * @see optional
 */
export const opt = optional;

/**
 * Parser that parses zero or more repetitions of the given parser.
 *
 * @template T Type of the parse result value
 * @param parser Target parser
 * @returns Parser<T[]> A parser that returns an array of results (possibly empty).
 */
export const zeroOrMore =
  <T>(parser: Parser<T>): Parser<T[]> =>
  (input, pos) => {
    const results: T[] = [];
    let currentPos = pos;
    let result = parser(input, currentPos);
    while (result.success && currentPos.offset < input.length) {
      currentPos = result.next;

      results.push(result.val);
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
 * @see zeroOrMore
 */
export const star = zeroOrMore;

/**
 * Alias for {@link zeroOrMore}.
 *
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
  (input, pos) => {
    const results = star(parser)(input, pos);

    if (results.success) {
      const val = results.val;
      if (isNonEmptyArray(val)) {
        return { ...results, val };
      }
    }

    return {
      success: false,
      error: { message: "Expected at least one", pos },
    };
  };

/**
 * Alias for {@link oneOrMore}.
 *
 * @see oneOrMore
 */
export const plus = oneOrMore;

/**
 * Alias for {@link oneOrMore}.
 *
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
  (input, pos) => {
    const result = parser(input, pos);
    if (!result.success) {
      return {
        success: false,
        error: {
          message: "And-predicate did not match",
          pos,
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
 * @see andPredicate
 */
export const and = andPredicate;

/**
 * Alias for {@link andPredicate}.
 *
 * @see andPredicate
 */
export const positive = andPredicate;

/**
 * Alias for {@link andPredicate}.
 *
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
  (input, pos) => {
    const result = parser(input, pos);
    if (!result.success) {
      return {
        success: true,
        val: undefined as never,
        current: pos,
        next: pos,
      };
    }

    return {
      success: false,
      error: {
        message: "Not-predicate matched",
        pos,
      },
    };
  };

/**
 * Alias for {@link notPredicate}.
 *
 * @see notPredicate
 */
export const not = notPredicate;

/**
 * Alias for {@link notPredicate}.
 *
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
 */
export const map =
  <T, U>(parser: Parser<T>, f: (value: T) => U): Parser<U> =>
  (input, index) => {
    const result = parser(input, index);

    return result.success
      ? { ...result, val: f(result.val) }
      : (result satisfies ParseResult<U>);
  };

/**
 * Parser that transforms the entire ParseSuccess object on success.
 *
 * @template T Type of the input parse result value
 * @template U Type of the output value
 * @param parser Target parser
 * @param f Function to transform the ParseSuccess object
 * @returns Parser<U> A parser that returns the transformed value if parsing succeeds, or fails otherwise.
 */
export const mapResult =
  <T, U>(parser: Parser<T>, f: (value: ParseSuccess<T>) => U): Parser<U> =>
  (input, index) => {
    const result = parser(input, index);

    return result.success
      ? { ...result, val: f(result) }
      : (result satisfies ParseResult<U>);
  };

//
// Utilities
//

/**
 * Parser that checks for end of input (EOF).
 *
 * Succeeds only if the input is at the end.
 *
 * @returns Parser<never> A parser that succeeds at end of input, or fails otherwise.
 */
export const EOF = not(any());

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
