import type { ParseResult, Parser, Pos } from "@suzumiyaaoba/tpeg-core";
import { withDetailedError } from "./error";

/**
 * Memoization parser that caches results for optimization.
 *
 * Features FIFO cache eviction (oldest inserted, not least recently used) and
 * enhanced cache key generation for better performance.
 *
 * `maxCacheSize` bounds both the per-input result cache (positions tried against
 * a given input string) and the number of distinct input strings tracked at
 * once. Without the latter bound, a single `memoize`-wrapped parser reused
 * across many distinct large inputs (e.g. a long-lived parser in a server
 * process parsing many different documents) would retain every input string
 * and its cached results forever, since only the per-input cache evicted.
 */
export const memoize = <T>(
  parser: Parser<T>,
  options: { maxCacheSize?: number; parserName?: string } = {},
): Parser<T> => {
  const { maxCacheSize = 1000, parserName } = options;
  const cacheByInput = new Map<string, Map<string, ParseResult<T>>>();

  const memoizedParser: Parser<T> = (input: string, pos: Pos) => {
    const posKey = `${pos.offset}:${pos.line}:${pos.column}`;

    let inner = cacheByInput.get(input);
    if (!inner) {
      inner = new Map<string, ParseResult<T>>();
      cacheByInput.set(input, inner);

      if (cacheByInput.size > maxCacheSize) {
        const firstInputKey = cacheByInput.keys().next().value;
        if (firstInputKey !== undefined) {
          cacheByInput.delete(firstInputKey);
        }
      }
    }

    const cached = inner.get(posKey);
    if (cached) {
      return cached;
    }

    const result = parser(input, pos);

    if (inner.size >= maxCacheSize) {
      const firstKey = inner.keys().next().value;
      if (firstKey) {
        inner.delete(firstKey);
      }
    }

    inner.set(posKey, result);
    return result;
  };

  return parserName
    ? withDetailedError(memoizedParser, parserName)
    : memoizedParser;
};

/**
 * Creates a recursive parser placeholder and setter for self-referential grammars.
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
 * Creates a parser that returns both the parsed value and its position information.
 */
export const withPosition = <T>(
  parser: Parser<T>,
  parserName?: string,
): Parser<{ value: T; position: Pos }> => {
  const withPositionParser: Parser<{ value: T; position: Pos }> = (
    input: string,
    pos: Pos,
  ) => {
    const startPos = pos || { offset: 0, line: 1, column: 1 };
    const result = parser(input, startPos);

    if (result.success) {
      return {
        success: true,
        val: { value: result.val, position: startPos },
        current: result.current,
        next: result.next,
      } as const;
    }

    return result;
  };

  return parserName
    ? withDetailedError(withPositionParser, parserName)
    : withPositionParser;
};
