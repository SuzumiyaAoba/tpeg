import type { ParseResult, Parser, Pos } from "@suzumiyaaoba/tpeg-core";
import { named } from "./error";

/**
 * Packrat memoization: caches a rule's parse result per (input, position),
 * so re-trying the same rule at the same offset -- exactly what backtracking
 * in an ordered `choice` or a shared-prefix reparse does -- is an O(1)
 * cache lookup instead of a full re-parse. See the plan's Phase 2-d
 * rationale and `packages/parser/bench/`'s "memoization on" results for the
 * measured effect (dramatic for genuine backtracking, a net negative for
 * grammars with nothing to reuse -- both expected, matching Ford (2002)'s
 * theory).
 *
 * ## Scoped to one input at a time
 *
 * All `Parser<T>` calls within a single top-level parse are threaded the
 * *same* `input` string by construction (every combinator in this
 * codebase just forwards `input` unchanged to the sub-parsers it calls).
 * That means "the `input` argument changed since the last call" is a
 * reliable, zero-API-surface signal that a *different* parse has begun --
 * so this cache tracks only the most recently seen `input` and discards
 * the whole table the moment a different one arrives, without needing any
 * explicit "start of parse" hook (`Parser<T>`'s signature has none, and
 * every call site -- both generated code and
 * `packages/samples/src/json/json.ts:148` -- expects the plain `(parser,
 * options?) => Parser<T>` shape, so this intentionally doesn't add one).
 *
 * This fixes the previous implementation's actual failure mode, found via
 * `packages/parser/bench/`: memoizing a grammar with several rules and
 * feeding it many distinct documents (e.g. the bench's 200-document JSON
 * corpus) used to retain up to `maxCacheSize` *documents'* worth of
 * cached positions per rule at once (bounded, but only after
 * accumulating real cross-document garbage) -- now at most one document's
 * cache is ever live, discarded the instant the next one starts.
 *
 * ## What `maxCacheSize` bounds now
 *
 * Previously `maxCacheSize` (default 1000) capped *both* the number of
 * distinct input strings tracked *and* the number of cached positions per
 * input -- the latter meaning the O(n) linear-time guarantee packrat
 * memoization is supposed to provide broke down for any input longer than
 * 1000 positions. With caching now inherently scoped to one input,
 * `maxCacheSize` only bounds cached positions *for that one input*, and
 * defaults to unbounded (`undefined`) to preserve the actual guarantee:
 * memory use for one parse is O(n) in that input's length, the same
 * asymptotic space cost every other unbounded-per-input structure in this
 * codebase already accepts (e.g. `zeroOrMore`'s results array). Pass
 * `maxCacheSize` explicitly to cap it for a single pathologically large
 * input.
 *
 * ## Cache key
 *
 * Keyed on `pos.offset` alone (a plain number, not a template-string
 * composite of offset/line/column): for a fixed `input`, a given offset
 * has exactly one corresponding (line, column), so line/column carry no
 * extra information once the cache is scoped to one input -- and a
 * numeric key avoids building a fresh string on every lookup.
 */
export const memoize = <T>(
  parser: Parser<T>,
  options: { maxCacheSize?: number; parserName?: string } = {},
): Parser<T> => {
  const { maxCacheSize, parserName } = options;
  let cachedInput: string | null = null;
  let cache: Map<number, ParseResult<T>> | null = null;

  const memoizedParser: Parser<T> = (input: string, pos: Pos) => {
    if (input !== cachedInput || !cache) {
      // A different input than the last call (or the very first call):
      // this is a new parse. Start a fresh table rather than retaining
      // the previous input's entries.
      cachedInput = input;
      cache = new Map<number, ParseResult<T>>();
    }

    const cached = cache.get(pos.offset);
    if (cached) {
      return cached;
    }

    const result = parser(input, pos);

    if (maxCacheSize !== undefined && cache.size >= maxCacheSize) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) {
        cache.delete(firstKey);
      }
    }

    cache.set(pos.offset, result);
    return result;
  };

  return named(memoizedParser, parserName);
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

  return [named(parser, parserName), setParser];
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
    const result = parser(input, pos);

    if (result.success) {
      return {
        success: true,
        val: { value: result.val, position: pos },
        current: result.current,
        next: result.next,
      } as const;
    }

    return result;
  };

  return named(withPositionParser, parserName);
};
