import type { ParseResult, Parser, Pos } from "@suzumiyaaoba/tpeg-core";
import { isFailure } from "@suzumiyaaoba/tpeg-core";
import { named } from "./error";

/**
 * Shared, module-scoped watermark for the parse currently in progress:
 * `commitAtTopLevel` (below) advances `watermarkOffset` when a top-level
 * cut fires, and every `memoize` cache prunes its own entries below it
 * lazily, the next time that cache is touched (see `memoize`'s own
 * comment on why lazy/per-cache rather than an eager sweep of every live
 * cache). Scoped to one input at a time via the same `input !== ...`
 * identity check `memoize` itself already uses for the same reason (see
 * that function's doc comment) -- reusing the pattern rather than
 * inventing a second one.
 */
let watermarkInput: string | null = null;
let watermarkOffset = 0;

/**
 * `commit()`'s (`@suzumiyaaoba/tpeg-core`) top-level counterpart: marks a
 * failure fatal exactly like `commit`, and ALSO advances the shared
 * watermark `memoize` (below) uses to discard now-unreachable cache
 * entries. See the plan's Phase 3 (Mizushima et al., PASTE 2010) for the
 * theory, and read the soundness restriction below before using this
 * directly -- it is easy to reach for and unsound to use in the wrong
 * place.
 *
 * ## Soundness restriction -- read before using
 *
 * Advancing the watermark to offset `k` asserts "this parse will never
 * backtrack to before `k` again." That's true only when nothing *below*
 * the cut can still cause backtracking past it: no pending choice
 * alternative, no in-progress `*`/`+`/`?`, no enclosing sequence that
 * could still fail and unwind further out. Per `docs/peg-grammar.md`, a
 * cut is scoped to its own enclosing choice -- it does NOT protect
 * anything above that (see the fix in the immediately preceding commit,
 * `fix(core): scope commit()'s fatal flag to its own enclosing choice`,
 * for a concrete case of what goes wrong when that scoping isn't
 * respected). `commitAtTopLevel` needs the same care one level further:
 * it must only be used where there is provably no live backtrack point
 * *anywhere* above it, not just "no choice directly above."
 *
 * This codebase's own codegen (`packages/parser/src/codegen.ts` and
 * `codegen-optimized.ts`) only ever emits `commitAtTopLevel` for a `Cut`
 * that is a *direct* element of a grammar's start rule's own top-level
 * `Sequence` -- never nested inside a `Choice`, `Group`, repetition, or
 * reached through a referenced sub-rule. That is a deliberately narrow,
 * structurally-verifiable sufficient condition for "no live backtrack
 * point above this," not the general Mizushima result: it misses cases
 * the general result would also handle safely (e.g. a cut inside a
 * referenced rule that happens to always be invoked at backtrack depth
 * 0), but it never advances the watermark somewhere unsound. A caller
 * constructing a grammar by hand, rather than through this codebase's
 * codegen, takes on the same obligation directly.
 *
 * The watermark advances to `pos.offset` -- the offset `parser` is about
 * to be tried at, i.e. right after everything before the cut has already
 * matched -- not to wherever `parser` itself stops. The commitment is
 * already final at that point regardless of whether `parser` goes on to
 * succeed or fail.
 */
export const commitAtTopLevel =
  <T>(parser: Parser<T>): Parser<T> =>
  (input: string, pos: Pos) => {
    if (input !== watermarkInput) {
      watermarkInput = input;
      watermarkOffset = 0;
    }
    if (pos.offset > watermarkOffset) {
      watermarkOffset = pos.offset;
    }

    const result = parser(input, pos);
    if (isFailure(result)) {
      return {
        ...result,
        error: { ...result.error, fatal: true },
      };
    }
    return result;
  };

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
 *
 * ## Cut-driven truncation (Phase 3 / Mizushima et al., PASTE 2010)
 *
 * On every call, this also discards any cached entry at an offset the
 * shared watermark (`commitAtTopLevel`, above) has proven the parse can
 * never backtrack to again. This is a *reachability* fact, not a
 * capacity cap -- it never discards something still possibly needed, so
 * it composes freely with `maxCacheSize` below (a genuinely separate,
 * unrelated bound). Pruning is lazy and per-cache: rather than an eager
 * sweep of every live `memoize` cache the instant the watermark moves
 * (which would need a global registry of them), each cache compares the
 * watermark against `base` -- the offset *it* has already pruned below --
 * on its own next call, and only actually touches storage when there's
 * something new to discard. A cache nobody calls again before the parse
 * ends simply never gets swept, which is fine: nothing reads it either.
 *
 * ## Storage: a dense, offset-based window, not a hash map
 *
 * The key is always `pos.offset`, a small non-negative integer, so a
 * plain array indexed by `offset - base` (`base` being the oldest offset
 * still live, i.e. what pruning has not yet discarded) is a direct
 * packrat *matrix* row -- no hashing, no boxed key objects -- while still
 * bounding memory to the *live window* rather than the whole input:
 * pruning shifts `base` forward and `splice`s the discarded prefix out,
 * so the array's length tracks `(highest offset seen) - base`, not the
 * input's total length. `undefined` (a genuine array hole, not a stored
 * value) means "not cached"; `ParseResult<T>` never legitimately
 * contains `undefined` itself.
 */
export const memoize = <T>(
  parser: Parser<T>,
  options: { maxCacheSize?: number; parserName?: string } = {},
): Parser<T> => {
  const { maxCacheSize, parserName } = options;
  let cachedInput: string | null = null;
  let cache: (ParseResult<T> | undefined)[] | null = null;
  // Offset that cache[0] corresponds to; entries before this are pruned.
  let base = 0;
  // Offsets currently cached, oldest first -- only maintained when
  // maxCacheSize is set, purely to know which entry to evict.
  let insertionOrder: number[] | null = null;

  const memoizedParser: Parser<T> = (input: string, pos: Pos) => {
    if (input !== cachedInput || !cache) {
      // A different input than the last call (or the very first call):
      // this is a new parse. Start a fresh table rather than retaining
      // the previous input's entries.
      cachedInput = input;
      cache = [];
      base = 0;
      insertionOrder = maxCacheSize !== undefined ? [] : null;
    }

    if (watermarkInput === input && watermarkOffset > base) {
      const shiftBy = watermarkOffset - base;
      cache.splice(0, shiftBy);
      if (insertionOrder) {
        insertionOrder = insertionOrder.filter(
          (offset) => offset >= watermarkOffset,
        );
      }
      base = watermarkOffset;
    }

    const index = pos.offset - base;
    if (index >= 0) {
      const cached = cache[index];
      if (cached) {
        return cached;
      }
    }

    const result = parser(input, pos);

    if (index >= 0) {
      if (
        maxCacheSize !== undefined &&
        insertionOrder &&
        insertionOrder.length >= maxCacheSize
      ) {
        const oldest = insertionOrder.shift();
        if (oldest !== undefined) {
          cache[oldest - base] = undefined;
        }
      }
      cache[index] = result;
      insertionOrder?.push(pos.offset);
    }

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
