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
 * Parser that consumes characters until a condition is met.
 *
 * @template T Type of condition parser result
 * @param condition Parser that determines when to stop consuming characters
 * @returns Parser<string> A parser that returns all consumed characters as a string
 */
export const takeUntil =
  <T>(condition: Parser<T>): Parser<string> =>
  (input: string, pos: Pos) => {
    // Ensure pos is properly defined
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    let currentPos = startPos;
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
      current: startPos,
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
export const between =
  <O, C>(open: Parser<O>, close: Parser<C>): Parser<string> =>
  (input: string, pos: Pos) => {
    // Ensure pos is properly defined
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    return map(seq(open, takeUntil(close), close), ([_, content]) => content)(
      input,
      startPos,
    );
  };

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
  // Parser for processing a single value
  const single = map(value, (v) => [v] as NonEmptyArray<T>);

  // Parser for processing multiple values
  const multiple = map(
    seq(value, oneOrMore(map(seq(separator, value), ([_, v]) => v))),
    ([first, rest]) => [first, ...rest] as NonEmptyArray<T>,
  );

  return choice(multiple, single);
};

/**
 * Parser for comma-separated values with customizable value parser.
 * Returns an empty array if no values are present.
 *
 * @template T Type of the value parser result
 * @param valueParser Parser for individual values
 * @param allowTrailing Whether to allow a trailing comma
 * @returns Parser<T[]> A parser that returns an array of values
 */
export const commaSeparated = <T>(
  valueParser: Parser<T>,
  allowTrailing = false,
): Parser<T[]> => {
  const comma = token(literal(","));

  // No values case
  const empty = map(notPredicate(valueParser), () => [] as T[]);

  // One or more values with optional trailing comma
  const nonEmpty = map(
    seq(
      token(valueParser),
      zeroOrMore(map(seq(comma, token(valueParser)), ([_, val]) => val)),
      allowTrailing ? optional(comma) : map(notPredicate(comma), () => null),
    ),
    ([first, rest]) => [first, ...rest],
  );

  return choice(nonEmpty, empty);
};

/**
 * Parser for comma-separated values with customizable value parser.
 * Requires at least one value to be present.
 *
 * @template T Type of the value parser result
 * @param valueParser Parser for individual values
 * @param allowTrailing Whether to allow a trailing comma
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of values
 */
export const commaSeparated1 = <T>(
  valueParser: Parser<T>,
  allowTrailing = false,
): Parser<NonEmptyArray<T>> => {
  const comma = token(literal(","));

  // Single value
  const single = map(
    seq(
      token(valueParser),
      allowTrailing ? optional(comma) : map(notPredicate(comma), () => null),
    ),
    ([val]) => [val] as NonEmptyArray<T>,
  );

  // Multiple values with optional trailing comma
  const multiple = map(
    seq(
      token(valueParser),
      oneOrMore(map(seq(comma, token(valueParser)), ([_, val]) => val)),
      allowTrailing ? optional(comma) : map(notPredicate(comma), () => null),
    ),
    ([first, rest]) => [first, ...rest] as NonEmptyArray<T>,
  );

  return choice(multiple, single);
};

/**
 * Creates a memoized version of a parser.
 * This can significantly improve performance for recursive grammars.
 *
 * @template T Type of the parser result
 * @param parser The parser to memoize
 * @param options Memoization options
 * @returns Parser<T> A memoized version of the parser
 */
export const memoize = <T>(
  parser: Parser<T>,
  options: { maxCacheSize?: number } = {},
): Parser<T> => {
  const cache = new Map<string, ParseResult<T>>();
  const maxSize = options.maxCacheSize || Number.POSITIVE_INFINITY;

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

    // Add result to cache, managing cache size
    if (cache.size >= maxSize && maxSize !== Number.POSITIVE_INFINITY) {
      // Remove oldest entry when cache is full
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        cache.delete(firstKey);
      }
    }

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

    // Ensure pos is properly defined
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    return ref(input, startPos);
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
 * Creates a parser with enhanced error reporting including context information.
 *
 * @template T Type of the parser result
 * @param parser The parser to apply
 * @param errorMessage Custom error message
 * @param context Additional context information (e.g., rule name, grammar part)
 * @returns Parser<T> A parser with custom error message and context
 */
export const labeledWithContext =
  <T>(
    parser: Parser<T>,
    errorMessage: string,
    context: string | string[],
  ): Parser<T> =>
  (input: string, pos: Pos) => {
    const result = parser(input, pos);

    if (!result.success) {
      const failure = result as ParseFailure;
      return {
        success: false,
        error: {
          message: errorMessage,
          pos: failure.error.pos,
          context: context,
        },
      };
    }

    return result;
  };

/**
 * Create a parser that tracks line and column for better error reporting.
 *
 * @template T Type of the parser result
 * @param parser The parser to apply
 * @returns Parser<{ value: T, position: Pos }> A parser that returns an object with value and position
 */
export const withPosition =
  <T>(parser: Parser<T>): Parser<{ value: T; position: Pos }> =>
  (input: string, pos: Pos) => {
    const result = parser(input, pos);

    if (!result.success) {
      return result as ParseResult<{ value: T; position: Pos }>;
    }

    return {
      ...result,
      val: { value: result.val, position: pos },
    };
  };

/**
 * Creates a parser that provides more detailed error reporting with input excerpt.
 *
 * @template T Type of parser result
 * @param parser The parser to apply
 * @param parserName Name of the parser for error reporting
 * @param contextSize Number of characters to include before and after error position
 * @returns Parser<T> A parser with enhanced error reporting
 */
export const withDetailedError = <T>(
  parser: Parser<T>,
  parserName: string,
  contextSize = 10,
): Parser<T> => {
  return (input: string, pos: Pos) => {
    const result = parser(input, pos);

    if (!result.success) {
      // Type assertion to access the error property
      const failure = result as ParseFailure;

      // Only enhance the error if the error doesn't already have detailed information
      const enhancedError = { ...failure.error };
      enhancedError.parserName = parserName;

      // Add input excerpt to show context around error
      const start = Math.max(0, pos.offset - contextSize);
      const end = Math.min(input.length, pos.offset + contextSize);

      const before = input.substring(start, pos.offset);
      const after = input.substring(pos.offset, end);

      // First character at error position
      const found = pos.offset < input.length ? input[pos.offset] : "EOF";

      enhancedError.found = found;
      enhancedError.message =
        enhancedError.message ||
        `${parserName}: Expected ${
          enhancedError.expected || "valid input"
        } but found '${found}'`;

      return {
        success: false,
        error: enhancedError,
      };
    }

    return result;
  };
};

/**
 * Parser that checks for end of input (EOF).
 *
 * Succeeds only if the input is at the end.
 *
 * @returns Parser<never> A parser that succeeds at end of input, or fails otherwise.
 */
export const EOF = not(any());

/**
 * Parser that matches any newline sequence.
 *
 * @returns Parser<string> A parser that matches "\r\n", "\n", or "\r"
 */
export const newline = choice(literal("\r\n"), literal("\n"), literal("\r"));

/**
 * Parser that consumes whitespace characters.
 *
 * @returns Parser<string> A parser that returns consumed whitespace characters
 */
export const whitespace = charClass(" ", "\t", "\n", "\r");

/**
 * Parser that consumes one or more whitespace characters.
 *
 * @returns Parser<string> A parser that returns consumed whitespace characters
 */
export const spaces = zeroOrMore(whitespace);

/**
 * Parser wrapper that consumes whitespace before and after the parser.
 *
 * @template T Type of the parser result
 * @param parser The parser to apply
 * @returns Parser<T> A parser that returns the result of the original parser
 */
export const token = <T>(parser: Parser<T>): Parser<T> =>
  map(seq(spaces, parser, spaces), ([_, value]) => value);

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
 * Parser for matching a string with single quotes.
 *
 * @returns Parser<string> A parser that returns the content of the string without quotes
 */
export const singleQuotedString = (): Parser<string> => {
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
      case "'":
        return "'";
      case '"':
        return '"';
      default:
        return char;
    }
  });

  const stringChar = choice(
    escapeSeq,
    map(
      seq(notPredicate(choice(literal("'"), literal("\\"))), anyChar()),
      ([_, char]) => char,
    ),
  );

  return map(
    seq(literal("'"), zeroOrMore(stringChar), literal("'")),
    ([_, chars]) => chars.join(""),
  );
};

/**
 * Parser for matching a string with either single or double quotes.
 *
 * @returns Parser<string> A parser that returns the content of the string without quotes
 */
export const anyQuotedString = (): Parser<string> => {
  return choice(quotedString(), singleQuotedString());
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
 * Creates a debugging parser that logs information about the parsing process.
 * Useful for troubleshooting and understanding parser behavior.
 *
 * @template T Type of the parser result
 * @param parser The parser to debug
 * @param name Name for identifying the parser in logs
 * @param options Debug options
 * @returns Parser<T> The original parser with added logging
 */
export const debug = <T>(
  parser: Parser<T>,
  name: string,
  options: {
    logSuccess?: boolean;
    logFailure?: boolean;
    logInput?: boolean;
    logResult?: boolean;
    customLogger?: (message: string) => void;
  } = {},
): Parser<T> => {
  // Default options
  const {
    logSuccess = true,
    logFailure = true,
    logInput = true,
    logResult = true,
    customLogger = console.log,
  } = options;

  return (input: string, pos: Pos) => {
    // Log attempt
    const inputPreview = logInput
      ? input
          .substring(pos.offset, Math.min(pos.offset + 30, input.length))
          .replace(/\n/g, "\\n")
      : "";

    customLogger(
      `DEBUG[${name}] Attempting at line ${pos.line}, col ${pos.column}${
        logInput
          ? `: "${inputPreview}${inputPreview.length === 30 ? "..." : ""}"`
          : ""
      }`,
    );

    // Run the parser
    const result = parser(input, pos);

    // Log the result
    if (result.success) {
      if (logSuccess) {
        customLogger(
          `DEBUG[${name}] Success at line ${pos.line}, col ${pos.column}${
            logResult ? `: ${JSON.stringify(result.val)}` : ""
          }`,
        );
      }
    } else {
      if (logFailure) {
        const failure = result as ParseFailure;
        customLogger(
          `DEBUG[${name}] Failure at line ${pos.line}, col ${pos.column}: ${failure.error.message}`,
        );
      }
    }

    return result;
  };
};

/**
 * Creates a parser that matches input against a regular expression.
 *
 * @param regex The regular expression to match against
 * @param errorMessage Optional error message when matching fails
 * @returns Parser<string> A parser that returns the matched string
 */
export const regex = (
  regex: RegExp,
  errorMessage = "Expected pattern match",
): Parser<string> => {
  return (input: string, pos: Pos) => {
    // Ensure regex has the global flag to ensure we start matching from the current position
    const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
    const regexWithGlobalFlag = new RegExp(regex.source, flags);

    // Set lastIndex to start matching from current position
    regexWithGlobalFlag.lastIndex = pos.offset;

    const match = regexWithGlobalFlag.exec(input);

    // Check if we matched and if the match starts at the current position
    if (match && match.index === pos.offset) {
      const matchedText = match[0];

      // Calculate new position after match
      let newPos = { ...pos };
      for (let i = 0; i < matchedText.length; i++) {
        const char = matchedText[i];
        newPos = nextPos(char, newPos);
      }

      return {
        success: true,
        val: matchedText,
        current: pos,
        next: newPos,
      };
    }

    return {
      success: false,
      error: {
        message: errorMessage,
        pos,
        expected: regex.toString(),
      },
    };
  };
};

/**
 * Creates a parser that returns all capture groups from a regex match.
 *
 * @param regex The regular expression to match against (must have capture groups)
 * @param errorMessage Optional error message when matching fails
 * @returns Parser<string[]> A parser that returns an array with the full match followed by all capture groups
 */
export const regexGroups = (
  regex: RegExp,
  errorMessage = "Expected pattern match",
): Parser<string[]> => {
  return (input: string, pos: Pos) => {
    // Ensure regex has the global flag
    const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
    const regexWithGlobalFlag = new RegExp(regex.source, flags);

    // Set lastIndex to start matching from current position
    regexWithGlobalFlag.lastIndex = pos.offset;

    const match = regexWithGlobalFlag.exec(input);

    // Check if we matched and if the match starts at the current position
    if (match && match.index === pos.offset) {
      const matchedText = match[0];

      // Calculate new position after match
      let newPos = { ...pos };
      for (let i = 0; i < matchedText.length; i++) {
        const char = matchedText[i];
        newPos = nextPos(char, newPos);
      }

      // Return all groups (match[0] is the full match, match[1...n] are capture groups)
      return {
        success: true,
        val: Array.from(match),
        current: pos,
        next: newPos,
      };
    }

    return {
      success: false,
      error: {
        message: errorMessage,
        pos,
        expected: regex.toString(),
      },
    };
  };
};
