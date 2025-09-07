import type {
  NonEmptyArray,
  ParseFailure,
  ParseResult,
  Parser,
  Pos,
} from "@suzumiyaaoba/tpeg-core";
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
} from "@suzumiyaaoba/tpeg-core";

/**
 * Parser that consumes characters until a condition is met.
 *
 * Checks the condition parser at each position and consumes characters until the condition succeeds.
 * Efficient input processing allows fast operation even with large text.
 * This is particularly useful for extracting content up to a delimiter or boundary.
 *
 * @example
 * ```typescript
 * // Get characters until double quote
 * const content = takeUntil(literal('"'));
 * const result = content('Hello "World"', { offset: 0, line: 1, column: 1 });
 * // result.val === "Hello "
 *
 * // Extract content until newline
 * const lineContent = takeUntil(newline);
 * const lineResult = lineContent('First line\nSecond line', { offset: 0, line: 1, column: 1 });
 * // lineResult.val === "First line"
 *
 * // Extract until end of input
 * const untilEnd = takeUntil(EOF);
 * const endResult = untilEnd('Complete content', { offset: 0, line: 1, column: 1 });
 * // endResult.val === "Complete content"
 * ```
 *
 * @remarks
 * - The condition parser is checked at each character position
 * - Characters are consumed one by one until the condition succeeds
 * - If the condition never succeeds, all remaining input is consumed
 * - Performance is O(n) where n is the number of characters consumed
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
 * Efficiently extracts content between opening and closing parsers.
 * Uses takeUntil internally for optimized processing.
 * This is commonly used for parsing delimited content like parentheses, brackets, or quotes.
 *
 * @example
 * ```typescript
 * // Get content between parentheses
 * const content = between(literal('('), literal(')'));
 * const result = content('(Hello World)', { offset: 0, line: 1, column: 1 });
 * // result.val === "Hello World"
 *
 * // Extract content between quotes
 * const quoted = between(literal('"'), literal('"'));
 * const quoteResult = quoted('"Important message"', { offset: 0, line: 1, column: 1 });
 * // quoteResult.val === "Important message"
 *
 * // Parse JSON-like object content
 * const objectContent = between(literal('{'), literal('}'));
 * const jsonResult = objectContent('{"key": "value"}', { offset: 0, line: 1, column: 1 });
 * // jsonResult.val === '"key": "value"'
 * ```
 *
 * @remarks
 * - The opening parser must succeed first
 * - Content is extracted until the closing parser succeeds
 * - Both opening and closing parsers are consumed
 * - If the closing parser never succeeds, parsing fails
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
 * Handles both empty and non-empty cases efficiently. Returns an empty array
 * when no values are found, making it suitable for optional list parsing.
 * This is ideal for parsing lists where the first value might be optional.
 *
 * @example
 * ```typescript
 * // Parse comma-separated number list
 * const numberList = sepBy(int, literal(','));
 * const result = numberList('1,2,3', { offset: 0, line: 1, column: 1 });
 * // result.val === [1, 2, 3]
 *
 * // Handle empty input
 * const emptyResult = numberList('', { offset: 0, line: 1, column: 1 });
 * // emptyResult.val === []
 *
 * // Parse space-separated words
 * const wordList = sepBy(identifier, spaces);
 * const wordResult = wordList('hello world test', { offset: 0, line: 1, column: 1 });
 * // wordResult.val === ["hello", "world", "test"]
 *
 * // Parse with complex separator
 * const complexList = sepBy(int, seq(spaces, literal(','), spaces));
 * const complexResult = complexList('1 , 2 , 3', { offset: 0, line: 1, column: 1 });
 * // complexResult.val === [1, 2, 3]
 * ```
 *
 * @remarks
 * - Always succeeds, even with empty input
 * - Returns empty array if no values are found
 * - Separator is consumed between each value
 * - No trailing separator is allowed
 * - Performance is O(n) where n is the number of values
 *
 * @template T Type of the value parser result
 * @template S Type of the separator parser result
 * @param value Parser for the values
 * @param separator Parser for the separators
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T[]> A parser that returns an array of values (empty if none found)
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
 * Ensures at least one value is present, making it suitable for required list parsing.
 * Returns a non-empty array type for better type safety.
 * This is ideal for parsing lists where at least one value is mandatory.
 *
 * @example
 * ```typescript
 * // List requiring at least one number
 * const numberList = sepBy1(int, literal(','));
 * const result = numberList('1,2,3', { offset: 0, line: 1, column: 1 });
 * // result.val === [1, 2, 3] (NonEmptyArray<number> type)
 *
 * // Empty input fails
 * const emptyResult = numberList('', { offset: 0, line: 1, column: 1 });
 * // emptyResult.success === false
 *
 * // Parse function arguments (at least one required)
 * const args = sepBy1(identifier, seq(spaces, literal(','), spaces));
 * const argsResult = args('x, y, z', { offset: 0, line: 1, column: 1 });
 * // argsResult.val === ["x", "y", "z"]
 *
 * // Single value also works
 * const singleResult = numberList('42', { offset: 0, line: 1, column: 1 });
 * // singleResult.val === [42]
 * ```
 *
 * @remarks
 * - Fails if no values are found
 * - Returns NonEmptyArray<T> for better type safety
 * - At least one value must be present
 * - Separator is consumed between each value
 * - No trailing separator is allowed
 * - Performance is O(n) where n is the number of values
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
 *
 * Handles trailing commas optionally and returns an empty array if no values are present.
 * Optimized for common CSV-like parsing scenarios with flexible trailing comma support.
 * This is specifically designed for parsing comma-separated lists with optional trailing commas.
 *
 * @example
 * ```typescript
 * // Basic comma separation
 * const csv = commaSeparated(int);
 * const result = csv('1,2,3', { offset: 0, line: 1, column: 1 });
 * // result.val === [1, 2, 3]
 *
 * // Allow trailing comma
 * const csvWithTrailing = commaSeparated(int, true);
 * const result2 = csvWithTrailing('1,2,3,', { offset: 0, line: 1, column: 1 });
 * // result2.val === [1, 2, 3]
 *
 * // Empty input
 * const emptyResult = csv('', { offset: 0, line: 1, column: 1 });
 * // emptyResult.val === []
 *
 * // Parse string values
 * const stringList = commaSeparated(quotedString);
 * const stringResult = stringList('"a","b","c"', { offset: 0, line: 1, column: 1 });
 * // stringResult.val === ["a", "b", "c"]
 *
 * // Parse with whitespace handling
 * const spacedList = commaSeparated(token(int));
 * const spacedResult = spacedList(' 1 , 2 , 3 ', { offset: 0, line: 1, column: 1 });
 * // spacedResult.val === [1, 2, 3]
 * ```
 *
 * @remarks
 * - Always succeeds, even with empty input
 * - Returns empty array if no values are found
 * - Handles optional trailing commas when allowTrailing is true
 * - Automatically handles whitespace around commas
 * - Optimized for CSV-like formats
 * - Performance is O(n) where n is the number of values
 *
 * @template T Type of the value parser result
 * @param valueParser Parser for individual values
 * @param allowTrailing Whether to allow a trailing comma (default: false)
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T[]> A parser that returns an array of values (empty if none found)
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
 * Parser for comma-separated values requiring at least one value.
 *
 * Requires at least one value to be present and handles trailing commas optionally.
 * Returns a non-empty array type for better type safety in required list scenarios.
 * This is designed for parsing comma-separated lists where at least one value is mandatory.
 *
 * @example
 * ```typescript
 * // Requires at least one value
 * const csv = commaSeparated1(int);
 * const result = csv('1,2,3', { offset: 0, line: 1, column: 1 });
 * // result.val === [1, 2, 3] (NonEmptyArray<number> type)
 *
 * // Allow trailing comma
 * const csvWithTrailing = commaSeparated1(int, true);
 * const result2 = csvWithTrailing('1,2,3,', { offset: 0, line: 1, column: 1 });
 * // result2.val === [1, 2, 3]
 *
 * // Empty input fails
 * const emptyResult = csv('', { offset: 0, line: 1, column: 1 });
 * // emptyResult.success === false
 *
 * // Single value works
 * const singleResult = csv('42', { offset: 0, line: 1, column: 1 });
 * // singleResult.val === [42]
 *
 * // Parse function parameters
 * const params = commaSeparated1(identifier);
 * const paramsResult = params('x,y,z', { offset: 0, line: 1, column: 1 });
 * // paramsResult.val === ["x", "y", "z"]
 * ```
 *
 * @remarks
 * - Fails if no values are found
 * - Returns NonEmptyArray<T> for better type safety
 * - At least one value must be present
 * - Handles optional trailing commas when allowTrailing is true
 * - Automatically handles whitespace around commas
 * - Performance is O(n) where n is the number of values
 *
 * @template T Type of the value parser result
 * @param valueParser Parser for individual values
 * @param allowTrailing Whether to allow a trailing comma (default: false)
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
 * Features LRU-like cache eviction and enhanced cache key generation for better performance.
 * This is particularly useful for recursive parsers or parsers that are called repeatedly
 * with the same input positions.
 *
 * @example
 * ```typescript
 * // Basic memoization
 * const memoizedParser = memoize(complexParser);
 *
 * // Limit cache size
 * const limitedCache = memoize(complexParser, { maxCacheSize: 100 });
 *
 * // Named memoized parser
 * const namedMemoized = memoize(complexParser, {
 *   maxCacheSize: 500,
 *   parserName: "ComplexParser"
 * });
 *
 * // Memoize recursive parser
 * const [expression, setExpression] = recursive<number>();
 * const memoizedExpression = memoize(expression);
 * setExpression(choice(add, int));
 * ```
 *
 * @remarks
 * - Caches results based on input position and length
 * - Uses LRU-like eviction when cache size limit is reached
 * - Cache key includes offset, line, column, and input length
 * - Memory usage is proportional to maxCacheSize
 * - Performance improvement is most noticeable with recursive parsers
 * - Default cache size is 1000 entries
 *
 * @template T Type of parser result
 * @param parser Parser to memoize
 * @param options Options including maxCacheSize and optional parserName
 * @returns Parser<T> Memoized parser with optimized caching
 */
export const memoize = <T>(
  parser: Parser<T>,
  options: { maxCacheSize?: number; parserName?: string } = {},
): Parser<T> => {
  const { maxCacheSize = 1000, parserName } = options;
  const cache = new Map<string, ParseResult<T>>();

  const memoizedParser: Parser<T> = (input: string, pos: Pos) => {
    // More efficient cache key generation
    const key = `${pos.offset}:${pos.line}:${pos.column}:${input.length}`;

    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const result = parser(input, pos);

    // Implement cache size limit with LRU-like behavior
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
 * Creates a recursive parser placeholder and setter for self-referential grammars.
 *
 * Enables parsing of recursive structures like nested expressions, lists, and trees.
 * The parser must be set before use, otherwise returns an initialization error.
 * This is essential for parsing languages with recursive grammar rules.
 *
 * @example
 * ```typescript
 * // Recursive expression parser
 * const [expression, setExpression] = recursive<number>("Expression");
 *
 * const number = int;
 * const add = map(seq(number, literal('+'), expression), ([a, _, b]) => a + b);
 *
 * // Set up recursion
 * setExpression(choice(add, number));
 *
 * const result = expression('1+2+3', { offset: 0, line: 1, column: 1 });
 * // result.val === 6
 *
 * // Recursive list parser
 * const [list, setList] = recursive<string[]>("List");
 * const item = identifier;
 * const nestedList = map(seq(literal('['), list, literal(']')), ([_, items, __]) => items);
 * setList(choice(nestedList, sepBy(item, literal(','))));
 *
 * const listResult = list('[a,b,[c,d]]', { offset: 0, line: 1, column: 1 });
 * // listResult.val === ["a", "b", ["c", "d"]]
 * ```
 *
 * @remarks
 * - Returns a placeholder parser and a setter function
 * - The placeholder must be set before use
 * - Returns initialization error if used before setting
 * - Essential for parsing recursive grammars
 * - Often used with memoize for performance
 * - Common in expression parsing and nested structures
 *
 * @template T Type of parser result
 * @param parserName Optional name for error reporting and debugging
 * @returns [Parser<T>, (parser: Parser<T>) => void] Tuple of parser and setter function
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
 * Provides simple error labeling for parser debugging and error reporting.
 * This is useful for providing more meaningful error messages when parsers fail.
 *
 * @example
 * ```typescript
 * // Parser with custom error message
 * const numberParser = labeled(int, "Number expected");
 * const result = numberParser('abc', { offset: 0, line: 1, column: 1 });
 * // result.error.message === "Number expected"
 *
 * // Named labeled parser
 * const namedParser = labeled(int, "Number expected", "NumberParser");
 *
 * // Label complex parser
 * const expressionParser = labeled(
 *   choice(int, identifier),
 *   "Expression expected (number or identifier)"
 * );
 *
 * // Label with context
 * const functionCall = labeled(
 *   seq(identifier, literal('('), sepBy(identifier, literal(',')), literal(')')),
 *   "Function call expected"
 * );
 * ```
 *
 * @remarks
 * - Replaces the original error message when parser fails
 * - Useful for providing user-friendly error messages
 * - Can be combined with withDetailedError for enhanced reporting
 * - Often used in complex parser compositions
 * - Error message should be descriptive and actionable
 *
 * @template T Type of parser result
 * @param parser Parser to label
 * @param errorMessage Error message to use when parser fails
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T> Labeled parser with custom error message
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
 * Creates a labeled parser with custom error message and hierarchical context.
 *
 * Provides detailed error reporting with context hierarchy for better debugging
 * and error understanding in complex parser compositions.
 * This is particularly useful for complex grammars where error context is important.
 *
 * @example
 * ```typescript
 * // Single context
 * const numberParser = labeledWithContext(int, "Number expected", "Expression");
 *
 * // Multiple contexts (hierarchical)
 * const complexParser = labeledWithContext(
 *   int,
 *   "Number expected",
 *   ["Function", "Parameter", "Type"]
 * );
 *
 * const result = complexParser('abc', { offset: 0, line: 1, column: 1 });
 * // result.error.message === "Number expected (in context: Function > Parameter > Type)"
 *
 * // Nested structure context
 * const objectParser = labeledWithContext(
 *   seq(literal('{'), sepBy(identifier, literal(',')), literal('}')),
 *   "Object definition expected",
 *   ["JSON", "Object", "Properties"]
 * );
 *
 * // Function call context
 * const functionCallParser = labeledWithContext(
 *   seq(identifier, literal('('), sepBy(identifier, literal(',')), literal(')')),
 *   "Function call expected",
 *   ["Statement", "FunctionCall", "Arguments"]
 * );
 * ```
 *
 * @remarks
 * - Provides hierarchical context information in error messages
 * - Context can be a single string or array of strings
 * - Array contexts are joined with " > " separator
 * - Useful for complex nested grammars
 * - Helps users understand where parsing failed
 * - Can be combined with withDetailedError for comprehensive reporting
 *
 * @template T Type of parser result
 * @param parser Parser to label
 * @param errorMessage Error message to use when parser fails
 * @param context Context information for error reporting (string or array of strings)
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T> Labeled parser with hierarchical context information
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
 * Creates a parser that returns both the parsed value and its position information.
 *
 * Useful for AST construction and error reporting where position information is needed.
 * Returns an object containing both the parsed value and the starting position.
 * This is essential for building ASTs with source location information.
 *
 * @example
 * ```typescript
 * // Parser with position information
 * const numberWithPos = withPosition(int);
 * const result = numberWithPos('123', { offset: 0, line: 1, column: 1 });
 * // result.val === { value: 123, position: { offset: 0, line: 1, column: 1 } }
 *
 * // Named position parser
 * const namedWithPos = withPosition(int, "NumberWithPosition");
 *
 * // Position information for AST nodes
 * const identifierWithPos = withPosition(identifier);
 * const idResult = identifierWithPos('myVariable', { offset: 0, line: 1, column: 1 });
 * // idResult.val === { value: "myVariable", position: { offset: 0, line: 1, column: 1 } }
 *
 * // Complex expression with position
 * const expressionWithPos = withPosition(
 *   seq(int, literal('+'), int)
 * );
 * const exprResult = expressionWithPos('1+2', { offset: 0, line: 1, column: 1 });
 * // exprResult.val === { value: [1, "+", 2], position: { offset: 0, line: 1, column: 1 } }
 * ```
 *
 * @remarks
 * - Returns an object with value and position properties
 * - Position contains offset, line, and column information
 * - Essential for AST construction with source locations
 * - Useful for error reporting with precise location
 * - Can be used with any parser type
 * - Position is captured at the start of parsing
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

    return result as ParseFailure;
  };

/**
 * Creates a parser that automatically handles surrounding whitespace.
 *
 * Wraps a parser with automatic whitespace consumption before and after the main parser.
 * Useful for creating token-based parsers that ignore whitespace automatically.
 *
 * @example
 * ```typescript
 * // Number parser that ignores whitespace
 * const numberToken = token(int);
 * const result = numberToken('  123  ', { offset: 0, line: 1, column: 1 });
 * // result.val === 123
 *
 * // Named token parser
 * const namedToken = token(int, "NumberToken");
 * ```
 *
 * @template T Type of the parser result
 * @param parser The parser to apply
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T> A parser that handles surrounding whitespace automatically
 */
export const token = <T>(parser: Parser<T>, parserName?: string): Parser<T> => {
  const tokenParser = map(seq(spaces, parser, spaces), ([_, value]) => value);
  return parserName ? withDetailedError(tokenParser, parserName) : tokenParser;
};

/**
 * Creates a debug wrapper for a parser with comprehensive logging capabilities.
 *
 * Provides detailed logging for success/failure states, input context, and result values
 * to aid in parser development and troubleshooting.
 *
 * @example
 * ```typescript
 * // Basic debug parser
 * const debugParser = debug(int, "NumberParser");
 *
 * // Debug with custom options
 * const customDebug = debug(int, "NumberParser", {
 *   logSuccess: true,
 *   logFailure: true,
 *   logInput: true,
 *   logResult: true,
 *   customLogger: (msg) => console.log(`[CUSTOM] ${msg}`)
 * });
 *
 * // Log only results
 * const resultOnly = debug(int, "NumberParser", {
 *   logSuccess: false,
 *   logFailure: false,
 *   logInput: false,
 *   logResult: true
 * });
 * ```
 *
 * @template T Type of the parser result
 * @param parser The parser to debug
 * @param name Debug name for logging
 * @param options Debug options including logging preferences and custom logger
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<T> A debug-enabled parser with comprehensive logging
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
        customLogger(`[DEBUG ${name}] Error:`, (result as ParseFailure).error);
      }
    }

    return result;
  };

  return parserName ? withDetailedError(debugParser, parserName) : debugParser;
};

/**
 * Parser that matches a regular expression with optimized performance.
 *
 * Uses sticky flag for better performance and ensures thread-safe regex execution.
 *
 * @example
 * ```typescript
 * // Basic regex match
 * const wordParser = regex(/\w+/, "Word expected");
 * const result = wordParser('hello123', { offset: 0, line: 1, column: 1 });
 * // result.val === "hello123"
 *
 * // With custom error message
 * const emailParser = regex(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, "Valid email address expected");
 *
 * // Named regex parser
 * const namedRegex = regex(/\d+/, "Number expected", "NumberRegex");
 * ```
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

    // Create a new regex with global flag reset and sticky flag for better performance
    const regexCopy = new RegExp(
      regex.source,
      `${regex.flags.replace("g", "").replace("y", "")}y`,
    );
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
 * Parser that matches a regular expression and returns capture groups with optimized performance.
 *
 * Uses sticky flag for better performance and ensures thread-safe regex execution.
 *
 * @example
 * ```typescript
 * // Regex with capture groups
 * const dateParser = regexGroups(/(\d{4})-(\d{2})-(\d{2})/, "Date expected");
 * const result = dateParser('2023-12-25', { offset: 0, line: 1, column: 1 });
 * // result.val === ["2023", "12", "25"]
 *
 * // Extract name and email
 * const contactParser = regexGroups(/(\w+)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/, "Contact information expected");
 * const contactResult = contactParser('John john@example.com', { offset: 0, line: 1, column: 1 });
 * // contactResult.val === ["John", "john@example.com"]
 * ```
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

    // Create a new regex with global flag reset and sticky flag for better performance
    const regexCopy = new RegExp(
      regex.source,
      `${regex.flags.replace("g", "").replace("y", "")}y`,
    );
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
 * Matches both uppercase and lowercase letters [a-zA-Z].
 * Useful for identifier parsing and text processing.
 *
 * @example
 * ```typescript
 * const result = letter('a', { offset: 0, line: 1, column: 1 });
 * // result.val === "a"
 *
 * const result2 = letter('Z', { offset: 0, line: 1, column: 1 });
 * // result2.val === "Z"
 *
 * const result3 = letter('1', { offset: 0, line: 1, column: 1 });
 * // result3.success === false
 * ```
 *
 * @returns Parser<string> A parser that matches [a-zA-Z]
 */
export const letter: Parser<string> = charClass(["a", "z"], ["A", "Z"]);

/**
 * Parser for matching digits.
 *
 * Matches numeric characters [0-9].
 * Useful for number parsing and validation.
 *
 * @example
 * ```typescript
 * const result = digit('5', { offset: 0, line: 1, column: 1 });
 * // result.val === "5"
 *
 * const result2 = digit('a', { offset: 0, line: 1, column: 1 });
 * // result2.success === false
 * ```
 *
 * @returns Parser<string> A parser that matches [0-9]
 */
export const digit: Parser<string> = charClass(["0", "9"]);

/**
 * Parser for matching alphanumeric characters.
 *
 * Matches letters and digits [a-zA-Z0-9].
 * Useful for identifier parsing and text validation.
 *
 * @example
 * ```typescript
 * const result = alphaNum('a', { offset: 0, line: 1, column: 1 });
 * // result.val === "a"
 *
 * const result2 = alphaNum('5', { offset: 0, line: 1, column: 1 });
 * // result2.val === "5"
 *
 * const result3 = alphaNum('_', { offset: 0, line: 1, column: 1 });
 * // result3.success === false
 * ```
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
 * Follows common programming language identifier rules: starts with letter or underscore,
 * followed by any number of letters, digits, or underscores.
 *
 * @example
 * ```typescript
 * const result = identifier('myVariable', { offset: 0, line: 1, column: 1 });
 * // result.val === "myVariable"
 *
 * const result2 = identifier('_private', { offset: 0, line: 1, column: 1 });
 * // result2.val === "_private"
 *
 * const result3 = identifier('123invalid', { offset: 0, line: 1, column: 1 });
 * // result3.success === false
 * ```
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
 * Useful for line-oriented parsing where certain patterns must appear at the beginning
 * of a line. Checks if the current column position is 1.
 *
 * @example
 * ```typescript
 * // Match only at line start
 * const lineStart = startOfLine("LineStart");
 * const result = lineStart('Hello World', { offset: 0, line: 1, column: 1 });
 * // result.success === true
 *
 * const result2 = lineStart('  Hello World', { offset: 2, line: 1, column: 3 });
 * // result2.success === false
 * ```
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
 * Useful for line-oriented parsing where certain patterns must appear at the end
 * of a line. Checks for newline characters or end of input.
 *
 * @example
 * ```typescript
 * // Match only at line end
 * const lineEnd = endOfLine("LineEnd");
 * const result = lineEnd('\n', { offset: 0, line: 1, column: 1 });
 * // result.success === true
 *
 * const result2 = lineEnd('Hello World', { offset: 0, line: 1, column: 1 });
 * // result2.success === false
 *
 * // Also matches at end of input
 * const result3 = lineEnd('', { offset: 0, line: 1, column: 1 });
 * // result3.success === true
 * ```
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
 * Generates detailed error messages including context information around the error position.
 *
 * @example
 * ```typescript
 * // Parser with detailed error reporting
 * const detailedParser = withDetailedError(int, "NumberParser");
 * const result = detailedParser('abc', { offset: 0, line: 1, column: 1 });
 * // result.error.message === "NumberParser: Expected valid input but found 'a'"
 * // result.error.context === "abc"
 * // result.error.found === "a"
 * ```
 *
 * @template T Type of parser result
 * @param parser The parser to apply
 * @param parserName Name of the parser for error reporting
 * @returns Parser<T> A parser with enhanced error reporting including context information
 */
export const withDetailedError = <T>(
  parser: Parser<T>,
  parserName: string,
): Parser<T> => {
  return (input: string, pos: Pos) => {
    const result = parser(input, pos);

    if (!result.success) {
      // Type assertion to access the error property
      const failure = result as ParseFailure;

      // Only enhance the error if the error doesn't already have detailed information
      const enhancedError = { ...failure.error };
      enhancedError.parserName = parserName;

      // First character at error position
      const found =
        pos.offset < input.length ? (input[pos.offset] ?? "EOF") : "EOF";

      enhancedError.found = found;

      // Add context information for better error reporting
      if (pos.offset < input.length) {
        const contextStart = Math.max(0, pos.offset - 5);
        const contextEnd = Math.min(input.length, pos.offset + 5);
        enhancedError.context = input.substring(contextStart, contextEnd);
      }

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
 * Succeeds only if the input is completely consumed. Useful for ensuring
 * that no additional content follows the parsed structure.
 *
 * @example
 * ```typescript
 * // Ensure complete input consumption
 * const completeParser = seq(int, EOF);
 * const result = completeParser('123', { offset: 0, line: 1, column: 1 });
 * // result.success === true
 *
 * const result2 = completeParser('123abc', { offset: 0, line: 1, column: 1 });
 * // result2.success === false (additional content present)
 * ```
 *
 * @returns Parser<never> A parser that succeeds at end of input, or fails otherwise
 */
export const EOF = not(any);

/**
 * Parser that matches any newline sequence.
 *
 * Handles different newline conventions: "\r\n" (Windows), "\n" (Unix), "\r" (Mac).
 * Useful for cross-platform text parsing.
 *
 * @example
 * ```typescript
 * // Unix newline
 * const result = newline('\n', { offset: 0, line: 1, column: 1 });
 * // result.val === "\n"
 *
 * // Windows newline
 * const result2 = newline('\r\n', { offset: 0, line: 1, column: 1 });
 * // result2.val === "\r\n"
 *
 * // Mac newline
 * const result3 = newline('\r', { offset: 0, line: 1, column: 1 });
 * // result3.val === "\r"
 * ```
 *
 * @returns Parser<string> A parser that matches "\r\n", "\n", or "\r"
 */
export const newline = choice(literal("\r\n"), literal("\n"), literal("\r"));

/**
 * Parser that consumes whitespace characters.
 *
 * Matches space, tab, newline, and carriage return characters.
 * Returns the consumed whitespace string for potential use in formatting.
 *
 * @example
 * ```typescript
 * const result = whitespace(' ', { offset: 0, line: 1, column: 1 });
 * // result.val === " "
 *
 * const result2 = whitespace('\t', { offset: 0, line: 1, column: 1 });
 * // result2.val === "\t"
 *
 * const result3 = whitespace('a', { offset: 0, line: 1, column: 1 });
 * // result3.success === false
 * ```
 *
 * @returns Parser<string> A parser that returns consumed whitespace characters
 */
export const whitespace = charClass(" ", "\t", "\n", "\r");

/**
 * Parser that consumes zero or more whitespace characters.
 *
 * Matches any number of whitespace characters (space, tab, newline, carriage return).
 * Useful for ignoring optional whitespace in token-based parsing.
 *
 * @example
 * ```typescript
 * const result = spaces('   \t\n', { offset: 0, line: 1, column: 1 });
 * // result.val === "   \t\n"
 *
 * const result2 = spaces('abc', { offset: 0, line: 1, column: 1 });
 * // result2.val === "" (empty string)
 * ```
 *
 * @returns Parser<string> A parser that returns consumed whitespace characters
 */
export const spaces = zeroOrMore(whitespace);

/**
 * Parser for matching a JavaScript/JSON-style string with escape sequences.
 *
 * Uses optimized escape sequence handling with support for common escape characters.
 *
 * @example
 * ```typescript
 * const result = quotedString('"Hello\\nWorld"', { offset: 0, line: 1, column: 1 });
 * // result.val === "Hello\nWorld"
 *
 * const result2 = quotedString('"Escaped\\"quote"', { offset: 0, line: 1, column: 1 });
 * // result2.val === "Escaped\"quote"
 *
 * const result3 = quotedString('"Invalid', { offset: 0, line: 1, column: 1 });
 * // result3.success === false
 * ```
 *
 * @returns Parser<string> A parser that returns the content of the string without quotes
 */
export const quotedString: Parser<string> = (() => {
  // Common escape sequence handler
  const createEscapeHandler = (quoteChar: string) =>
    map(seq(literal("\\"), anyChar()), ([_, char]) => {
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
        case quoteChar:
          return quoteChar;
        default:
          return char;
      }
    });

  const escapeSeq = createEscapeHandler('"');

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
 * Parser for matching a string with single quotes and escape sequences.
 *
 * Uses optimized escape sequence handling with support for common escape characters.
 *
 * @example
 * ```typescript
 * const result = singleQuotedString("'Hello\\nWorld'", { offset: 0, line: 1, column: 1 });
 * // result.val === "Hello\nWorld"
 *
 * const result2 = singleQuotedString("'Escaped\\'quote'", { offset: 0, line: 1, column: 1 });
 * // result2.val === "Escaped'quote"
 * ```
 *
 * @returns Parser<string> A parser that returns the content of the string without quotes
 */
export const singleQuotedString: Parser<string> = (() => {
  // Common escape sequence handler
  const createEscapeHandler = (quoteChar: string) =>
    map(seq(literal("\\"), anyChar()), ([_, char]) => {
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
        case quoteChar:
          return quoteChar;
        default:
          return char;
      }
    });

  const escapeSeq = createEscapeHandler("'");

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
 * Combines both quotedString and singleQuotedString parsers for flexible
 * string parsing that accepts either quote style.
 *
 * @example
 * ```typescript
 * const result = anyQuotedString('"Hello World"', { offset: 0, line: 1, column: 1 });
 * // result.val === "Hello World"
 *
 * const result2 = anyQuotedString("'Hello World'", { offset: 0, line: 1, column: 1 });
 * // result2.val === "Hello World"
 * ```
 *
 * @returns Parser<string> A parser that returns the content of the string without quotes
 */
export const anyQuotedString: Parser<string> = choice(
  quotedString,
  singleQuotedString,
);

/**
 * Parser for matching a JavaScript/JSON-style number with validation.
 *
 * Supports integers, decimals, and scientific notation with proper error handling.
 *
 * @example
 * ```typescript
 * const result = number('123', { offset: 0, line: 1, column: 1 });
 * // result.val === 123
 *
 * const result2 = number('-3.14', { offset: 0, line: 1, column: 1 });
 * // result2.val === -3.14
 *
 * const result3 = number('1.23e-4', { offset: 0, line: 1, column: 1 });
 * // result3.val === 0.000123
 *
 * const result4 = number('invalid', { offset: 0, line: 1, column: 1 });
 * // result4.success === false
 * ```
 *
 * @returns Parser<number> A parser that returns the parsed number with validation
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

      const parsed = Number(numStr);

      // Validate the parsed number
      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid number format: ${numStr}`);
      }

      return parsed;
    },
  );
})();

/**
 * Parse an integer number with validation.
 *
 * Supports negative integers and provides proper error handling for invalid formats.
 *
 * @example
 * ```typescript
 * const result = int('123', { offset: 0, line: 1, column: 1 });
 * // result.val === 123
 *
 * const result2 = int('-456', { offset: 0, line: 1, column: 1 });
 * // result2.val === -456
 *
 * const result3 = int('3.14', { offset: 0, line: 1, column: 1 });
 * // result3.success === false (decimals not supported)
 *
 * const result4 = int('invalid', { offset: 0, line: 1, column: 1 });
 * // result4.success === false
 * ```
 *
 * @returns Parser<number> A parser that returns the parsed integer with validation
 */
export const int: Parser<number> = map(
  seq(optional(literal("-")), oneOrMore(charClass(["0", "9"]))),
  ([sign, digits]) => {
    const numStr = (sign.length > 0 ? "-" : "") + digits.join("");
    const parsed = Number.parseInt(numStr, 10);

    // Validate the parsed integer
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid integer format: ${numStr}`);
    }

    return parsed;
  },
);
