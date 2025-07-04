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
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<string> A parser that returns all consumed characters as a string
 */
export const takeUntil =
  <T>(condition: Parser<T>, parserName?: string): Parser<string> =>
  (input: string, pos: Pos) => {
    // Ensure pos is properly defined
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    let currentPos = startPos;
    const chars: string[] = [];

    while (currentPos.offset < input.length) {
      // Try the condition parser at the current position
      const condResult = condition(input, currentPos);
      if (condResult.success) {
        break;
      }

      // Get the character at current position
      const [char, _len] = getCharAndLength(input, currentPos.offset);
      if (!char) break;

      // Consume the character
      chars.push(char);
      currentPos = nextPos(char, currentPos);
    }

    const result = {
      success: true,
      val: chars.join(""),
      current: startPos,
      next: currentPos,
    } as const;

    return parserName
      ? withDetailedError(() => result, parserName)(input, pos)
      : result;
  };

/**
 * Parser for matching content between two parsers.
 *
 * @template O Type of opening parser result
 * @template C Type of closing parser result
 * @param open Opening parser
 * @param close Closing parser
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<string> A parser that returns the content between open and close
 */
export const between =
  <O, C>(
    open: Parser<O>,
    close: Parser<C>,
    parserName?: string,
  ): Parser<string> =>
  (input: string, pos: Pos) => {
    // Ensure pos is properly defined
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    const parser = map(
      seq(open, takeUntil(close), close),
      ([_, content]) => content,
    );
    const result = parser(input, startPos);

    return parserName
      ? withDetailedError(() => result, parserName)(input, pos)
      : result;
  };

/**
 * Parser that applies a parser repeatedly, separated by another parser.
 *
 * @template T Type of the value parser result
 * @template S Type of the separator parser result
 * @param value Parser for the values
 * @param separator Parser for the separators
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T[]> A parser that returns an array of values
 */
export const sepBy = <T, S>(
  value: Parser<T>,
  separator: Parser<S>,
  parserName?: string,
): Parser<T[]> => {
  const sepByOne = map(
    seq(value, zeroOrMore(map(seq(separator, value), ([_, v]) => v))),
    ([first, rest]) => [first, ...rest],
  );

  const parser = choice(
    sepByOne,
    map(notPredicate(value), () => []),
  );

  return parserName ? withDetailedError(parser, parserName) : parser;
};

/**
 * Parser that applies a parser repeatedly at least once, separated by another parser.
 *
 * @template T Type of the value parser result
 * @template S Type of the separator parser result
 * @param value Parser for the values
 * @param separator Parser for the separators
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of values
 */
export const sepBy1 = <T, S>(
  value: Parser<T>,
  separator: Parser<S>,
  parserName?: string,
): Parser<NonEmptyArray<T>> => {
  // Parser for processing a single value
  const single = map(value, (v) => [v] as NonEmptyArray<T>);

  // Parser for processing multiple values
  const multiple = map(
    seq(value, oneOrMore(map(seq(separator, value), ([_, v]) => v))),
    ([first, rest]) => [first, ...rest] as NonEmptyArray<T>,
  );

  const parser = choice(multiple, single);

  return parserName ? withDetailedError(parser, parserName) : parser;
};

/**
 * Parser for comma-separated values with customizable value parser.
 * Returns an empty array if no values are present.
 *
 * @template T Type of the value parser result
 * @param valueParser Parser for individual values
 * @param allowTrailing Whether to allow a trailing comma
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T[]> A parser that returns an array of values
 */
export const commaSeparated = <T>(
  valueParser: Parser<T>,
  allowTrailing = false,
  parserName?: string,
): Parser<T[]> => {
  const comma = token(literal(","));

  // No values case
  const empty = map(notPredicate(valueParser), () => [] as T[]);

  // One or more values with optional trailing comma
  const nonEmpty = map(
    seq(
      token(valueParser),
      zeroOrMore(map(seq(comma, token(valueParser)), ([_, val]) => val)),
      allowTrailing ? optional(comma) : map(notPredicate(comma), () => []),
    ),
    ([first, rest]) => [first, ...rest],
  );

  const parser = choice(nonEmpty, empty);

  return parserName ? withDetailedError(parser, parserName) : parser;
};

/**
 * Parser for comma-separated values with customizable value parser.
 * Requires at least one value to be present.
 *
 * @template T Type of the value parser result
 * @param valueParser Parser for individual values
 * @param allowTrailing Whether to allow a trailing comma
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<NonEmptyArray<T>> A parser that returns a non-empty array of values
 */
export const commaSeparated1 = <T>(
  valueParser: Parser<T>,
  allowTrailing = false,
  parserName?: string,
): Parser<NonEmptyArray<T>> => {
  const comma = token(literal(","));

  // Single value
  const single = map(
    seq(
      token(valueParser),
      allowTrailing ? optional(comma) : map(notPredicate(comma), () => []),
    ),
    ([val]) => [val] as NonEmptyArray<T>,
  );

  // Multiple values with optional trailing comma
  const multiple = map(
    seq(
      token(valueParser),
      oneOrMore(map(seq(comma, token(valueParser)), ([_, val]) => val)),
      allowTrailing ? optional(comma) : map(notPredicate(comma), () => []),
    ),
    ([first, rest]) => [first, ...rest] as NonEmptyArray<T>,
  );

  const parser = choice(multiple, single);

  return parserName ? withDetailedError(parser, parserName) : parser;
};

/**
 * Memoization parser that caches results for optimization.
 *
 * @template T Type of parser result
 * @param parser Parser to memoize
 * @param options Options including maxCacheSize and optional parserName
 * @returns Parser<T> Memoized parser
 */
export const memoize = <T>(
  parser: Parser<T>,
  options: { maxCacheSize?: number; parserName?: string } = {},
): Parser<T> => {
  const { maxCacheSize = 1000, parserName } = options;
  const cache = new Map<string, ParseResult<T>>();

  const memoizedParser: Parser<T> = (input: string, pos: Pos) => {
    const key = `${pos.offset}:${pos.line}:${pos.column}`;

    if (cache.has(key)) {
      const result = cache.get(key);
      if (result) {
        return result;
      }
    }

    const result = parser(input, pos);

    // Implement cache size limit
    if (cache.size >= maxCacheSize) {
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        cache.delete(firstKey);
      }
    }

    cache.set(key, result);
    return result;
  };

  return parserName
    ? withDetailedError(memoizedParser, parserName)
    : memoizedParser;
};

/**
 * Creates a recursive parser placeholder and setter.
 *
 * @template T Type of parser result
 * @param parserName Optional name for error reporting and debugging
 * @returns [Parser<T>, (parser: Parser<T>) => void] Tuple of parser and setter
 */
export const recursive = <T>(
  parserName?: string,
): [Parser<T>, (parser: Parser<T>) => void] => {
  let innerParser: Parser<T> | null = null;

  const parser: Parser<T> = (input: string, pos: Pos) => {
    if (!innerParser) {
      return {
        success: false,
        error: {
          message: "Recursive parser not initialized",
          pos,
        },
      };
    }
    return innerParser(input, pos);
  };

  const setParser = (p: Parser<T>): void => {
    innerParser = p;
  };

  const namedParser = parserName
    ? withDetailedError(parser, parserName)
    : parser;

  return [namedParser, setParser];
};

/**
 * Creates a labeled parser with custom error message.
 *
 * @template T Type of parser result
 * @param parser Parser to label
 * @param errorMessage Error message to use when parser fails
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T> Labeled parser
 */
export const labeled =
  <T>(
    parser: Parser<T>,
    errorMessage: string,
    parserName?: string,
  ): Parser<T> =>
  (input: string, pos: Pos) => {
    const result = parser(input, pos);
    if (!result.success) {
      const errorObj = {
        message: errorMessage,
        pos,
        ...(parserName && { parserName }),
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
 * Creates a labeled parser with custom error message and context.
 *
 * @template T Type of parser result
 * @param parser Parser to label
 * @param errorMessage Error message to use when parser fails
 * @param context Context information for error reporting
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T> Labeled parser with context
 */
export const labeledWithContext =
  <T>(
    parser: Parser<T>,
    errorMessage: string,
    context: string | string[],
    parserName?: string,
  ): Parser<T> =>
  (input: string, pos: Pos) => {
    const result = parser(input, pos);
    if (!result.success) {
      const contextArray = Array.isArray(context) ? context : [context];
      const fullMessage = `${errorMessage} (in context: ${contextArray.join(" > ")})`;
      const errorObj = {
        message: fullMessage,
        pos,
        context: contextArray,
        ...(parserName && { parserName }),
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
 * Creates a parser that returns both the parsed value and its position.
 *
 * @template T Type of the parser result
 * @param parser The parser to apply
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<{value: T, position: Pos}> A parser that returns value with position
 */
export const withPosition =
  <T>(
    parser: Parser<T>,
    parserName?: string,
  ): Parser<{ value: T; position: Pos }> =>
  (input: string, pos: Pos) => {
    const startPos = pos || { offset: 0, line: 1, column: 1 };
    const result = parser(input, startPos);

    if (result.success) {
      const positionResult = {
        success: true,
        val: { value: result.val, position: startPos },
        current: result.current,
        next: result.next,
      } as const;
      return parserName
        ? withDetailedError(() => positionResult, parserName)(input, pos)
        : positionResult;
    }

    return result;
  };

/**
 * Creates a parser that automatically handles whitespace.
 *
 * @template T Type of the parser result
 * @param parser The parser to apply
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T> A parser that handles surrounding whitespace
 */
export const token = <T>(parser: Parser<T>, parserName?: string): Parser<T> => {
  const tokenParser = map(seq(spaces, parser, spaces), ([_, value]) => value);
  return parserName ? withDetailedError(tokenParser, parserName) : tokenParser;
};

/**
 * Creates a debug wrapper for a parser with logging capabilities.
 *
 * @template T Type of the parser result
 * @param parser The parser to debug
 * @param name Debug name for logging
 * @param options Debug options
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T> A debug-enabled parser
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
  parserName?: string,
): Parser<T> => {
  const {
    logSuccess = true,
    logFailure = true,
    logInput = false,
    logResult = false,
    customLogger = console.log,
  } = options;

  const debugParser: Parser<T> = (input: string, pos: Pos) => {
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    if (logInput) {
      const context = input.slice(startPos.offset, startPos.offset + 20);
      customLogger(
        `[DEBUG ${name}] Input at ${startPos.offset}: "${context}..."`,
      );
    }

    const result = parser(input, startPos);

    if (result.success && logSuccess) {
      customLogger(`[DEBUG ${name}] SUCCESS`);
      if (logResult) {
        customLogger(`[DEBUG ${name}] Result:`, result.val);
      }
    } else if (!result.success && logFailure) {
      customLogger(`[DEBUG ${name}] FAILURE`);
      if (logResult) {
        customLogger(`[DEBUG ${name}] Error:`, result.error);
      }
    }

    return result;
  };

  return parserName ? withDetailedError(debugParser, parserName) : debugParser;
};

/**
 * Parser that matches a regular expression.
 *
 * @param regex Regular expression to match
 * @param errorMessage Custom error message (optional)
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<string> Parser that returns the matched string
 */
export const regex = (
  regex: RegExp,
  errorMessage = "Expected pattern match",
  parserName?: string,
): Parser<string> => {
  const regexParser: Parser<string> = (input: string, pos: Pos) => {
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    // Create a new regex with global flag reset
    const regexCopy = new RegExp(regex.source, regex.flags.replace("g", ""));
    regexCopy.lastIndex = 0;

    const inputFromPos = input.slice(startPos.offset);
    const match = regexCopy.exec(inputFromPos);

    if (match && match.index === 0) {
      const matchedText = match[0];
      let currentPos = startPos;

      // Calculate position after the match
      for (const char of matchedText) {
        currentPos = nextPos(char, currentPos);
      }

      return {
        success: true,
        val: matchedText,
        current: startPos,
        next: currentPos,
      };
    }

    const errorObj = {
      message: errorMessage,
      pos: startPos,
      expected: regex.toString(),
      ...(parserName && { parserName }),
    };

    return {
      success: false,
      error: errorObj,
    };
  };

  return parserName ? withDetailedError(regexParser, parserName) : regexParser;
};

/**
 * Parser that matches a regular expression and returns capture groups.
 *
 * @param regex Regular expression with capture groups
 * @param errorMessage Custom error message (optional)
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<string[]> Parser that returns an array of captured groups
 */
export const regexGroups = (
  regex: RegExp,
  errorMessage = "Expected pattern match",
  parserName?: string,
): Parser<string[]> => {
  const regexParser: Parser<string[]> = (input: string, pos: Pos) => {
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    // Create a new regex with global flag reset
    const regexCopy = new RegExp(regex.source, regex.flags.replace("g", ""));
    regexCopy.lastIndex = 0;

    const inputFromPos = input.slice(startPos.offset);
    const match = regexCopy.exec(inputFromPos);

    if (match && match.index === 0) {
      const matchedText = match[0];
      let currentPos = startPos;

      // Calculate position after the match
      for (const char of matchedText) {
        currentPos = nextPos(char, currentPos);
      }

      // Return all captured groups (excluding the full match at index 0)
      const groups = match.slice(1);

      return {
        success: true,
        val: groups,
        current: startPos,
        next: currentPos,
      };
    }

    const errorObj = {
      message: errorMessage,
      pos: startPos,
      expected: regex.toString(),
      ...(parserName && { parserName }),
    };

    return {
      success: false,
      error: errorObj,
    };
  };

  return parserName ? withDetailedError(regexParser, parserName) : regexParser;
};

/**
 * Parser for matching letters (alphabetic characters).
 *
 * @returns Parser<string> A parser that matches [a-zA-Z]
 */
export const letter: Parser<string> = charClass(["a", "z"], ["A", "Z"]);

/**
 * Parser for matching digits.
 *
 * @returns Parser<string> A parser that matches [0-9]
 */
export const digit: Parser<string> = charClass(["0", "9"]);

/**
 * Parser for matching alphanumeric characters.
 *
 * @returns Parser<string> A parser that matches [a-zA-Z0-9]
 */
export const alphaNum: Parser<string> = charClass(
  ["a", "z"],
  ["A", "Z"],
  ["0", "9"],
);

/**
 * Parser for matching identifiers (starts with letter/underscore, followed by alphanumeric/underscore).
 *
 * @returns Parser<string> A parser that matches valid identifiers
 */
export const identifier: Parser<string> = (() => {
  const firstChar = choice(letter, literal("_"));
  const restChars = zeroOrMore(choice(alphaNum, literal("_")));

  return map(
    seq(firstChar, restChars),
    ([first, rest]) => first + rest.join(""),
  );
})();

/**
 * Parser that succeeds only at the start of a line.
 *
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<never> A parser that matches start of line
 */
export const startOfLine = (parserName?: string): Parser<never> => {
  const startParser: Parser<never> = (_input: string, pos: Pos) => {
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    if (startPos.column === 1) {
      return {
        success: true,
        val: undefined as never,
        current: startPos,
        next: startPos,
      };
    }

    const errorObj = {
      message: "Expected start of line",
      pos: startPos,
      ...(parserName && { parserName }),
    };

    return {
      success: false,
      error: errorObj,
    };
  };

  return parserName ? withDetailedError(startParser, parserName) : startParser;
};

/**
 * Parser that succeeds only at the end of a line.
 *
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<never> A parser that matches end of line
 */
export const endOfLine = (parserName?: string): Parser<never> => {
  const endParser: Parser<never> = (input: string, pos: Pos) => {
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    if (
      startPos.offset >= input.length ||
      input[startPos.offset] === "\n" ||
      input[startPos.offset] === "\r"
    ) {
      return {
        success: true,
        val: undefined as never,
        current: startPos,
        next: startPos,
      };
    }

    const errorObj = {
      message: "Expected end of line",
      pos: startPos,
      ...(parserName && { parserName }),
    };

    return {
      success: false,
      error: errorObj,
    };
  };

  return parserName ? withDetailedError(endParser, parserName) : endParser;
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
      // Mark as used for future context features
      void before;
      void after;

      // First character at error position
      const found =
        pos.offset < input.length ? (input[pos.offset] ?? "EOF") : "EOF";

      enhancedError.found = found;
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
 * Parser that checks for end of input (EOF).
 *
 * Succeeds only if the input is at the end.
 *
 * @returns Parser<never> A parser that succeeds at end of input, or fails otherwise.
 */
export const EOF = not(any);

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
 * Parser for matching a JavaScript/JSON-style string with escape sequences.
 *
 * @returns Parser<string> A parser that returns the content of the string without quotes
 */
export const quotedString: Parser<string> = (() => {
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

  return labeled(
    map(seq(literal('"'), zeroOrMore(stringChar), literal('"')), ([_, chars]) =>
      chars.join(""),
    ),
    "Expected valid quoted string",
  );
})();

/**
 * Parser for matching a string with single quotes.
 *
 * @returns Parser<string> A parser that returns the content of the string without quotes
 */
export const singleQuotedString: Parser<string> = (() => {
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
})();

/**
 * Parser for matching a string with either single or double quotes.
 *
 * @returns Parser<string> A parser that returns the content of the string without quotes
 */
export const anyQuotedString: Parser<string> = choice(
  quotedString,
  singleQuotedString,
);

/**
 * Parser for matching a JavaScript/JSON-style number.
 *
 * @returns Parser<number> A parser that returns the parsed number
 */
export const number: Parser<number> = (() => {
  const digits = map(oneOrMore(charClass(["0", "9"])), (chars) =>
    chars.join(""),
  );
  const integer = map(
    seq(optional(literal("-")), digits),
    ([sign, num]) => (sign.length > 0 ? "-" : "") + num,
  );

  const fraction = map(seq(literal("."), digits), ([_, frac]) => `.${frac}`);

  const exponent = map(
    seq(charClass("e", "E"), optional(charClass("+", "-")), digits),
    ([e, sign, exp]) => e + (sign.length > 0 ? sign[0] : "") + exp,
  );

  return map(
    seq(integer, optional(fraction), optional(exponent)),
    ([int, frac, exp]) => {
      const numStr =
        int + (frac.length > 0 ? frac[0] : "") + (exp.length > 0 ? exp[0] : "");
      return Number(numStr);
    },
  );
})();

/**
 * Parse an integer number.
 *
 * @returns Parser<number> A parser that returns the parsed integer
 */
export const int: Parser<number> = map(
  seq(optional(literal("-")), oneOrMore(charClass(["0", "9"]))),
  ([sign, digits]) => {
    return Number.parseInt((sign.length > 0 ? "-" : "") + digits.join(""), 10);
  },
);
