//
// Types
//

/**
 * @see https://zenn.dev/chot/articles/321f58dfa01339
 */
export type NonEmptyArray<T> = [T, ...T[]] | [...T[], T];

export const isEmptyArray = <T>(arr: readonly T[]): arr is [] => {
  return arr.length === 0;
};

export const isNonEmptyArray = <T>(
  arr: readonly T[],
): arr is NonEmptyArray<T> => {
  return arr.length > 0;
};

type NonEmptyString<T extends string = string> = T extends "" ? never : T;

export type Pos = {
  readonly offset: number;
  readonly column: number;
  readonly line: number;
};

export type ParseSuccess<T> = {
  success: true;
  val: T;
  current: Pos;
  next: Pos;
};

export type ParseFailure = {
  success: false;
  error: ParseError;
};

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export interface ParseError {
  message: string;
  pos: Pos;
}

export type Parser<T> = (input: string, pos: Pos) => ParseResult<T>;

const nextPos = (char: string, { offset, column, line }: Pos): Pos => {
  const isNewline = char === "\n";

  return {
    offset: offset + 1,
    column: isNewline ? 0 : column + 1,
    line: isNewline ? line + 1 : line,
  };
};

//
// Primitive combinators
//

export const anyChar = (): Parser<string> => (input, pos) => {
  const char = input?.[pos.offset];

  if (char === undefined) {
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

export const any = anyChar;

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

export const lit = literal;

export const charClass =
  (
    ...charOrRanges: NonEmptyArray<
      NonEmptyString | [NonEmptyString, NonEmptyString]
    >
  ): Parser<string> =>
  (input, pos) => {
    if (pos.offset >= input.length) {
      return {
        success: false,
        error: { message: "Unexpected EOF", pos },
      };
    }

    const char = input.charAt(pos.offset);
    if (char === undefined) {
      return {
        success: false,
        error: { message: "Unexpected EOF", pos },
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
        if (start <= char && char <= stop) {
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

export const seq = sequence;

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

export const opt = optional;

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

export const star = zeroOrMore;

export const many = zeroOrMore;

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

export const plus = oneOrMore;

export const many1 = oneOrMore;

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

export const and = andPredicate;

export const positive = andPredicate;

export const assert = andPredicate;

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

export const not = notPredicate;

export const negative = notPredicate;

export const map =
  <T, U>(parser: Parser<T>, f: (value: T) => U): Parser<U> =>
  (input, index) => {
    const result = parser(input, index);

    return result.success
      ? { ...result, val: f(result.val) }
      : (result as ParseResult<U>);
  };

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

export const EOF = not(any());
