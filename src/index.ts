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

export type Pos = {
  readonly offset: number;
  readonly column: number;
  readonly line: number;
};

export type ParseResult<T> =
  | {
      success: true;
      value: T;
      next: Pos;
    }
  | {
      success: false;
      error: ParseError;
    };

export interface ParseError {
  message: string;
  pos: Pos;
}

export type Parser<T> = (input: string, pos: Pos) => ParseResult<T>;

export const any = (): Parser<string> => (input, pos) => {
  const char = input?.[pos.offset];

  if (char === undefined) {
    return {
      success: false,
      error: {
        message: "Unexpected end of input",
        pos,
      },
    };
  }

  const isNewline = char === "\n";

  return {
    success: true,
    value: char,
    next: {
      offset: pos.offset + 1,
      column: isNewline ? 0 : pos.column + 1,
      line: pos.line + (isNewline ? 1 : 0),
    },
  };
};

export const lit =
  (str: string): Parser<string> =>
  (input, pos) => {
    let column = pos.column;
    let line = pos.line;
    for (let i = 0; i < str.length; i++) {
      const char = input[pos.offset + i];

      if (char !== str[i]) {
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
      value: str,
      next: {
        offset: pos.offset + str.length,
        column,
        line,
      },
    };
  };

export const charClass =
  (charOrRanges: (string | [string, string])[]): Parser<string> =>
  (input, pos) => {
    const char = input[pos.offset];
    if (!char) {
      return {
        success: false,
        error: { message: "Unexpected EOF", pos },
      };
    }

    for (const charOrRange of charOrRanges) {
      if (typeof charOrRange === "string") {
        if (char === charOrRange) {
          const isNewline = char === "\n";
          return {
            success: true,
            value: char,
            next: {
              offset: pos.offset + 1,
              column: isNewline ? 0 : pos.column + 1,
              line: isNewline ? pos.line + 1 : pos.line,
            },
          };
        }
      } else {
        const [start, stop] = charOrRange;
        if (start <= char && char <= stop) {
          const isNewline = char === "\n";
          return {
            success: true,
            value: char,
            next: {
              offset: pos.offset + 1,
              column: isNewline ? 0 : pos.column + 1,
              line: isNewline ? pos.line + 1 : pos.line,
            },
          };
        }
      }
    }

    return {
      success: false,
      error: { message: `Expected "${charOrRanges}"`, pos },
    };
  };

export const seq =
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

      values.push(result.value);
      currentPos = result.next;
    }

    return {
      success: true,
      // biome-ignore lint/suspicious/noExplicitAny:
      value: values as any,
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

export const opt =
  <T>(parser: Parser<T>): Parser<[T] | []> =>
  (input, pos) => {
    const result = parser(input, pos);
    if (result.success) {
      return { success: true, value: [result.value], next: result.next };
    }

    return {
      success: true,
      value: [],
      next: pos,
    };
  };

export const star =
  <T>(parser: Parser<T>): Parser<T[]> =>
  (input, pos) => {
    const results: T[] = [];
    let currentPos = pos;
    let result = parser(input, currentPos);
    while (result.success && currentPos.offset < input.length) {
      currentPos = result.next;

      results.push(result.value);
      result = parser(input, currentPos);
    }

    return {
      success: true,
      value: results,
      next: currentPos,
    };
  };

export const plus =
  <T>(parser: Parser<T>): Parser<NonEmptyArray<T>> =>
  (input, pos) => {
    const results = star(parser)(input, pos);

    if (results.success) {
      const value = results.value;
      if (isNonEmptyArray(value)) {
        return { ...results, value };
      }
    }

    return {
      success: false,
      error: { message: "Expected at least one", pos },
    };
  };

export const and =
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
      value: undefined as never,
      next: pos,
    };
  };

export const not =
  <T>(parser: Parser<T>): Parser<never> =>
  (input, pos) => {
    const result = parser(input, pos);
    if (!result.success) {
      return {
        success: true,
        value: undefined as never,
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

export const map =
  <T>(parser: Parser<T>) =>
  <U>(f: (value: T) => U): Parser<U> =>
  (input, index) => {
    const result = parser(input, index);

    return result.success
      ? { ...result, value: f(result.value) }
      : (result as ParseResult<U>);
  };
