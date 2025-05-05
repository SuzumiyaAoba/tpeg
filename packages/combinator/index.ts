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

/**
 * Utility function to calculate the next position after consuming a character.
 *
 * @param char The character being consumed
 * @param pos The current position
 * @returns The new position after consuming the character
 */
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
  const [char, _] = getCharAndLength(input, pos.offset);

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
    const [char, _] = getCharAndLength(input, pos.offset);
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
    // Try the first match
    const firstResult = parser(input, pos);
    if (!firstResult.success) {
      return {
        success: false,
        error: { message: "Expected at least one", pos },
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
 */
export const mapResult =
  <T, U>(parser: Parser<T>, f: (value: ParseSuccess<T>) => U): Parser<U> =>
  (input, index) => {
    const result = parser(input, index);

    return result.success
      ? { ...result, val: f(result) }
      : (result as ParseResult<U>);
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

/**
 * Parser that consumes characters until a condition is met.
 *
 * @template T Type of condition parser result
 * @param condition Parser that determines when to stop consuming characters
 * @returns Parser<string> A parser that returns all consumed characters as a string
 */
export const takeUntil =
  <T>(condition: Parser<T>): Parser<string> =>
  (input, pos) => {
    let currentPos = pos;
    let result = "";

    while (currentPos.offset < input.length) {
      // Try the condition parser at the current position
      const condResult = condition(input, currentPos);
      if (condResult.success) {
        break;
      }

      // Get the character at current position
      const [char, len] = getCharAndLength(input, currentPos.offset);
      if (!char) break;

      // Consume the character
      result += char;
      currentPos = nextPos(char, currentPos);
    }

    return {
      success: true,
      val: result,
      current: pos,
      next: currentPos,
    };
  };

/**
 * Parser for matching content between two parsers.
 *
 * @template O Type of opening parser result
 * @template C Type of closing parser result
 * @param open Opening parser
 * @param close Closing parser
 * @returns Parser<string> A parser that returns the content between open and close
 */
export const between = <O, C>(
  open: Parser<O>,
  close: Parser<C>,
): Parser<string> =>
  map(seq(open, takeUntil(close), close), ([_, content]) => content);

/**
 * Parser that applies a parser repeatedly, separated by another parser.
 *
 * @template T Type of the value parser result
 * @template S Type of the separator parser result
 * @param value Parser for the values
 * @param separator Parser for the separators
 * @returns Parser<T[]> A parser that returns an array of values
 */
export const sepBy = <T, S>(
  value: Parser<T>,
  separator: Parser<S>,
): Parser<T[]> => {
  const sepByOne = map(
    seq(value, many(map(seq(separator, value), ([_, v]) => v))),
    ([first, rest]) => [first, ...rest],
  );

  return choice(
    sepByOne,
    map(andPredicate(not(value)), () => []),
  );
};

/**
 * Parser that applies a parser repeatedly at least once, separated by another parser.
 *
 * @template T Type of the value parser result
 * @template S Type of the separator parser result
 * @param value Parser for the values
 * @param separator Parser for the separators
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of values
 */
export const sepBy1 = <T, S>(
  value: Parser<T>,
  separator: Parser<S>,
): Parser<NonEmptyArray<T>> =>
  map(
    seq(value, many(map(seq(separator, value), ([_, v]) => v))),
    ([first, rest]) => [first, ...rest] as NonEmptyArray<T>,
  );

/**
 * Parser that consumes whitespace characters.
 *
 * @returns Parser<string> A parser that returns consumed whitespace characters
 */
export const whitespace = (): Parser<string> =>
  map(many(charClass(" ", "\t", "\n", "\r")), (chars) => chars.join(""));

/**
 * Parser wrapper that consumes whitespace after the parser.
 *
 * @template T Type of the parser result
 * @param parser The parser to apply
 * @returns Parser<T> A parser that returns the result of the original parser
 */
export const token = <T>(parser: Parser<T>): Parser<T> =>
  map(seq(parser, whitespace()), ([value]) => value);

/**
 * Parser for matching a JavaScript/JSON-style string with escape sequences.
 *
 * @returns Parser<string> A parser that returns the content of the string without quotes
 */
export const quotedString = (): Parser<string> => {
  const escapeSeq = map(seq(literal("\\"), anyChar()), ([_, char]) => {
    switch (char) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "\\":
        return "\\";
      case '"':
        return '"';
      case "'":
        return "'";
      default:
        return char;
    }
  });

  const stringChar = choice(
    escapeSeq,
    map(
      seq(not(choice(literal('"'), literal("\\"))), anyChar()),
      ([_, char]) => char,
    ),
  );

  return map(seq(literal('"'), many(stringChar), literal('"')), ([_, chars]) =>
    chars.join(""),
  );
};

/**
 * Creates a memoized version of a parser.
 * This can significantly improve performance for recursive grammars.
 *
 * @template T Type of the parser result
 * @param parser The parser to memoize
 * @returns Parser<T> A memoized version of the parser
 */
export const memoize = <T>(parser: Parser<T>): Parser<T> => {
  const cache = new Map<string, ParseResult<T>>();

  return (input, pos) => {
    const key = `${pos.offset}`;

    if (cache.has(key)) {
      const result = cache.get(key);
      return result !== undefined
        ? result
        : {
            success: false,
            error: {
              message: "Memoization error: cached result is undefined",
              pos,
            },
          };
    }

    const result = parser(input, pos);
    cache.set(key, result);

    return result;
  };
};

/**
 * Create a recursive parser.
 * Allows for defining parsers that reference themselves.
 *
 * @template T Type of the parser result
 * @returns [Parser<T>, (parser: Parser<T>) => void] A tuple containing the parser and a setter function
 */
export const recursive = <T>(): [Parser<T>, (parser: Parser<T>) => void] => {
  let ref: Parser<T> | undefined;

  const parser: Parser<T> = (input, pos) => {
    if (!ref) {
      return {
        success: false,
        error: {
          message: "Recursive parser not initialized",
          pos,
        },
      };
    }

    return ref(input, pos);
  };

  const setParser = (p: Parser<T>): void => {
    ref = p;
  };

  return [parser, setParser];
};

/**
 * Creates a parser with error reporting.
 *
 * @template T Type of the parser result
 * @param parser The parser to apply
 * @param errorMessage Custom error message
 * @returns Parser<T> A parser with custom error message
 */
export const labeled =
  <T>(parser: Parser<T>, errorMessage: string): Parser<T> =>
  (input, pos) => {
    const result = parser(input, pos);

    if (!result.success) {
      const failure = result as ParseFailure;
      return {
        success: false,
        error: {
          message: errorMessage,
          pos: failure.error.pos,
        },
      };
    }

    return result;
  };

/**
 * Parser for matching a JavaScript/JSON-style number.
 *
 * @returns Parser<number> A parser that returns the parsed number
 */
export const number = (): Parser<number> => {
  const digits = map(oneOrMore(charClass(["0", "9"])), (chars) =>
    chars.join(""),
  );
  const integer = map(
    seq(optional(literal("-")), digits),
    ([sign, num]) => (sign.length ? "-" : "") + num,
  );

  const fraction = map(seq(literal("."), digits), ([_, frac]) => `.${frac}`);

  const exponent = map(
    seq(charClass("e", "E"), optional(charClass("+", "-")), digits),
    ([e, sign, exp]) => e + (sign.length ? sign[0] : "") + exp,
  );

  return map(
    seq(integer, optional(fraction), optional(exponent)),
    ([int, frac, exp]) => {
      const numStr =
        int + (frac.length ? frac[0] : "") + (exp.length ? exp[0] : "");
      return Number(numStr);
    },
  );
};

/**
 * Parse an integer number.
 *
 * @returns Parser<number> A parser that returns the parsed integer
 */
export const int = (): Parser<number> => {
  return map(
    seq(optional(literal("-")), oneOrMore(charClass(["0", "9"]))),
    ([sign, digits]) => {
      return Number.parseInt((sign.length ? "-" : "") + digits.join(""), 10);
    },
  );
};

/**
 * Create a parser that tracks line and column for better error reporting.
 *
 * @template T Type of the parser result
 * @param parser The parser to apply
 * @returns Parser<T> A parser that tracks position information
 */
export const withPosition =
  <T>(parser: Parser<T>): Parser<T & { position: Pos }> =>
  (input, pos) => {
    const result = parser(input, pos);

    if (!result.success) {
      return result as ParseResult<T & { position: Pos }>;
    }

    return {
      ...result,
      val: { ...result.val, position: pos } as T & { position: Pos },
    };
  };
