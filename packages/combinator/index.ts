import type {
  NonEmptyArray,
  ParseFailure,
  ParseResult,
  Parser,
  Pos,
} from "tpeg-core";
import {
  any,
  anyChar,
  charClass,
  choice,
  getCharAndLength,
  literal,
  map,
  nextPos,
  not,
  notPredicate,
  oneOrMore,
  optional,
  seq,
  zeroOrMore,
} from "tpeg-core";

/**
 * Parser that checks for end of input (EOF).
 *
 * Succeeds only if the input is at the end.
 *
 * @returns Parser<never> A parser that succeeds at end of input, or fails otherwise.
 */
export const EOF = not(any());

/**
 * Parser that consumes characters until a condition is met.
 *
 * @template T Type of condition parser result
 * @param condition Parser that determines when to stop consuming characters
 * @returns Parser<string> A parser that returns all consumed characters as a string
 */
export const takeUntil =
  <T>(condition: Parser<T>): Parser<string> =>
  (input: string, pos: Pos) => {
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
    seq(value, zeroOrMore(map(seq(separator, value), ([_, v]) => v))),
    ([first, rest]) => [first, ...rest],
  );

  return choice(
    sepByOne,
    map(notPredicate(value), () => []),
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
): Parser<NonEmptyArray<T>> => {
  // 単一の値を処理するパーサー
  const single = map(value, (v) => [v] as NonEmptyArray<T>);

  // 複数の値を処理するパーサー
  const multiple = map(
    seq(value, oneOrMore(map(seq(separator, value), ([_, v]) => v))),
    ([first, rest]) => [first, ...rest] as NonEmptyArray<T>,
  );

  return choice(multiple, single);
};

/**
 * Parser that consumes whitespace characters.
 *
 * @returns Parser<string> A parser that returns consumed whitespace characters
 */
export const whitespace = (): Parser<string> =>
  map(zeroOrMore(charClass(" ", "\t", "\n", "\r")), (chars) => chars.join(""));

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
      seq(notPredicate(choice(literal('"'), literal("\\"))), anyChar()),
      ([_, char]) => char,
    ),
  );

  return map(
    seq(literal('"'), zeroOrMore(stringChar), literal('"')),
    ([_, chars]) => chars.join(""),
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

  return (input: string, pos: Pos) => {
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

  const parser: Parser<T> = (input: string, pos: Pos) => {
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
  (input: string, pos: Pos) => {
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
  (input: string, pos: Pos) => {
    const result = parser(input, pos);

    if (!result.success) {
      return result as ParseResult<T & { position: Pos }>;
    }

    return {
      ...result,
      val: { ...result.val, position: pos } as T & { position: Pos },
    };
  };
