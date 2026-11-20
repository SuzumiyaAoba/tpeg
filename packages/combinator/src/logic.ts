import type {
  Expectation,
  FailureWatermarkSnapshot,
  ParseResult,
  Parser,
  Pos,
} from "@suzumiyaaoba/tpeg-core";
import {
  commit,
  createFailure,
  currentParseSession,
  guardedParserCall,
  isValidOffset,
  mergeFailureWatermark,
  offsetToPos,
  resetFailureWatermark,
  restoreFailureWatermark,
  safeStringForDisplay,
  snapshotFailureWatermark,
} from "@suzumiyaaoba/tpeg-core";
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
/** The parse session (`@suzumiyaaoba/tpeg-core`'s parse-session.ts) the
 * watermark above belongs to: a new session over the SAME input text is
 * a new parse and must not inherit a previous parse's commit offset. */
let watermarkSession = -1;

/**
 * `commit()`'s (`@suzumiyaaoba/tpeg-core`) top-level counterpart: marks a
 * failure fatal exactly like `commit`, and ALSO advances the shared
 * watermark `memoize` (below) uses to discard now-unreachable cache
 * entries. See Mizushima et al., PASTE 2010, for the
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
 * The watermark advances to `pos` -- the offset `parser` is about
 * to be tried at, i.e. right after everything before the cut has already
 * matched -- not to wherever `parser` itself stops. The commitment is
 * already final at that point regardless of whether `parser` goes on to
 * succeed or fail.
 */
export const commitAtTopLevel = <T>(parser: Parser<T>): Parser<T> => {
  const committed = commit(parser);
  return (input: string, pos: number) => {
    const session = currentParseSession();
    if (input !== watermarkInput || session !== watermarkSession) {
      watermarkInput = input;
      watermarkOffset = 0;
      watermarkSession = session;
    }
    // An out-of-contract `pos` must not advance the prune watermark: the
    // child call below fails on its own (every leaf parser enforces
    // `isValidOffset`), and folding e.g. `pos = 2**31` into
    // `watermarkOffset` would let subsequent `memoize` caches discard
    // entries that are still reachable (a correctness-safe but real
    // perf regression -- see `memoize`'s doc comment).
    if (isValidOffset(pos) && pos <= input.length && pos > watermarkOffset) {
      watermarkOffset = pos;
    }

    // Delegate cut handling to core so inherited diagnostics, abort and
    // error getters follow exactly the same contract as an ordinary cut.
    return committed(input, pos);
  };
};

/**
 * Packrat memoization: caches a rule's parse result per (input, position),
 * so re-trying the same rule at the same offset -- exactly what backtracking
 * in an ordered `choice` or a shared-prefix reparse does -- is an O(1)
 * cache lookup instead of a full re-parse. See
 * `packages/parser/bench/`'s "memoization on" results for the
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
 * Keyed on `pos` alone (a plain number, not a template-string
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
 * ## Storage: an offset window or a bounded table
 *
 * With no finite capacity, the key is always `pos`, a small non-negative integer, so a
 * plain array indexed by `offset - base` (`base` being the oldest offset
 * still live, i.e. what pruning has not yet discarded) is a direct
 * packrat *matrix* row -- no hashing, no boxed key objects -- while still
 * bounding memory to the *live window* rather than the whole input:
 * pruning shifts `base` forward and `splice`s the discarded prefix out,
 * so the array's length tracks `(highest offset seen) - base`, not the
 * input's total length. `undefined` (a genuine array hole, not a stored
 * value) means "not cached"; a stored {@link MemoEntry} never legitimately
 * contains `undefined` itself.
 *
 * A finite capacity uses a map and a circular insertion-order queue,
 * or one direct slot when the capacity is 1.
 * Evicted offsets leave no array slots spanning the input, so storage and
 * bookkeeping grow with retained entries rather than the highest offset.
 * Hits and replacements keep the original insertion age; only new keys
 * enter the queue. Both an omitted capacity and Infinity use the offset
 * window without maintaining an eviction queue.
 *
 * ## Farthest-failure watermark: replaying what a cache hit skips
 *
 * `tpeg-core`'s shared farthest-failure watermark (`packages/core/src/
 * failure.ts`) is populated as a SIDE EFFECT of a leaf parser's `fail()`
 * call. A cache HIT returns a previously-computed `ParseResult` without
 * re-running `parser`, so none of the `fail()` calls that originally
 * produced it run again -- without the fields below, a rule's diagnostic
 * contribution (its farthest internal failure, or its own outright
 * failure) would silently disappear from `error.pos`/`.expected` the
 * moment a second call at the same offset hits the cache. Each entry
 * therefore also stores the wrapped parser's own watermark contribution,
 * collected in isolation from earlier failures. Every later HIT replays it via
 * `mergeFailureWatermark` before returning the cached result -- for a
 * cached success as much as a cached failure, since a memoized rule can
 * still contain the parse's overall farthest failure internally even
 * where the rule itself went on to succeed via a later alternative. Isolating
 * the contribution matters when a surrounding negative lookahead discards
 * earlier failures: the cache must retain this rule's own nearer failure and
 * must not resurrect a different alternative's discarded farther failure.
 */
// Successful rules often record no failures. Share this immutable empty
// contribution instead of allocating an array for every cached position.
const EMPTY_MEMO_EXPECTATIONS: readonly Expectation[] = Object.freeze([]);

interface MemoEntry<T> {
  readonly result: ParseResult<T>;
  /** Farthest failure contributed by the MISS that produced `result`
   * -- `-1` if `parser` never called
   * `fail()` at all (nothing to replay on a later hit). */
  readonly watermarkPos: number;
  readonly watermarkExpected: readonly Expectation[];
}

/** Capacity 1 needs neither a lookup table nor eviction bookkeeping. */
class SingleMemoCache<T> {
  private pos = -1;
  private entry: MemoEntry<T> | undefined;

  get(pos: number): MemoEntry<T> | undefined {
    return pos === this.pos ? this.entry : undefined;
  }

  set(pos: number, entry: MemoEntry<T>): void {
    this.pos = pos;
    this.entry = entry;
  }

  prune(before: number): void {
    if (this.pos < before) {
      this.pos = -1;
      this.entry = undefined;
    }
  }
}

/** A finite cache keeps one queue slot per retained key. The circular
 * queue avoids shifting the entire capacity on each FIFO eviction. */
class BoundedMemoCache<T> {
  private readonly entries = new Map<number, MemoEntry<T>>();
  private order: number[] = [];
  private head = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(pos: number): MemoEntry<T> | undefined {
    return this.entries.get(pos);
  }

  set(pos: number, entry: MemoEntry<T>): void {
    if (!this.entries.has(pos)) {
      if (this.entries.size >= this.capacity) {
        const oldest = this.order[this.head] as number;
        this.entries.delete(oldest);
        this.order[this.head] = pos;
        this.head = (this.head + 1) % this.order.length;
      } else {
        this.order.push(pos);
      }
    }
    this.entries.set(pos, entry);
  }

  prune(before: number): void {
    const retained: number[] = [];
    for (let i = 0; i < this.order.length; i++) {
      const pos = this.order[(this.head + i) % this.order.length] as number;
      if (pos < before) this.entries.delete(pos);
      else retained.push(pos);
    }
    this.order = retained;
    this.head = 0;
  }
}

export const memoize = <T>(
  parser: Parser<T>,
  options: { maxCacheSize?: number; parserName?: string } = {},
): Parser<T> => {
  const { maxCacheSize, parserName } = options;

  // A cache size is a count of retained positions. Reject malformed counts
  // eagerly instead of allowing fractional/negative/NaN values to fall
  // through to array-index and eviction logic with surprising behavior.
  // `Infinity` remains an explicit spelling of an unbounded cache, matching
  // the behavior of the omitted option.
  if (
    maxCacheSize !== undefined &&
    maxCacheSize !== Number.POSITIVE_INFINITY &&
    (!Number.isSafeInteger(maxCacheSize) || maxCacheSize < 0)
  ) {
    throw new Error(
      `Invalid memoize cache size: maxCacheSize (${safeStringForDisplay(maxCacheSize)}) must be a non-negative integer within the safe integer range, or Infinity`,
    );
  }

  // A zero-sized cache is useful when callers want the same API shape while
  // disabling memoization (for example, to compare a grammar with and
  // without caching). Returning the wrapped parser directly avoids the
  // eviction path's unavoidable one-entry overshoot at size zero.
  if (maxCacheSize === 0) return named(parser, parserName);

  const capacity = maxCacheSize ?? Number.POSITIVE_INFINITY;

  let cachedInput: string | null = null;
  // The parse session the cache was built in (see
  // `@suzumiyaaoba/tpeg-core`'s parse-session.ts): keying on the input
  // text alone reused one parse's results in the next parse of identical
  // text, skipping its semantic actions and handing out the same value
  // objects -- a caller mutating one parse's result corrupted the next.
  let cachedSession = -1;
  let cache:
    | (MemoEntry<T> | undefined)[]
    | BoundedMemoCache<T>
    | SingleMemoCache<T>
    | null = null;
  // Lower bound for retained offsets, and origin of the unbounded array.
  let base = 0;

  const memoizedParser: Parser<T> = (input: string, pos: number) => {
    // Same out-of-contract-`pos` guard every leaf parser already applies
    // (`isValidOffset`, `@suzumiyaaoba/tpeg-core`): the child would fail
    // anyway, but letting the call reach the cache code first would write
    // a sparse `cache[pos - base]` entry for an out-of-range offset, or a
    // fractional-property entry for `pos = 0.5`.
    if (!isValidOffset(pos) || pos > input.length) {
      return createFailure("Expected a valid position", pos, {
        parserName: parserName ?? "memoize",
      });
    }

    const session = currentParseSession();
    if (input !== cachedInput || session !== cachedSession || !cache) {
      cachedSession = session;
      // A different input than the last call (or the very first call):
      // this is a new parse. Start a fresh table rather than retaining
      // the previous input's entries.
      cachedInput = input;
      cache =
        capacity === 1
          ? new SingleMemoCache<T>()
          : Number.isFinite(capacity)
            ? new BoundedMemoCache<T>(capacity)
            : [];
      base = 0;
    }

    if (
      watermarkInput === input &&
      watermarkSession === session &&
      watermarkOffset > base
    ) {
      if (Array.isArray(cache)) cache.splice(0, watermarkOffset - base);
      else cache.prune(watermarkOffset);
      base = watermarkOffset;
    }

    const index = pos - base;
    if (index >= 0) {
      const cached = Array.isArray(cache) ? cache[index] : cache.get(pos);
      if (cached) {
        // See "Farthest-failure watermark" above: replay what this hit
        // skips re-running.
        mergeFailureWatermark(
          input,
          cached.watermarkPos,
          cached.watermarkExpected,
        );
        return cached.result;
      }
    }

    const activeCache = cache;
    const watermarkBefore = snapshotFailureWatermark();
    let result: ParseResult<T>;
    let watermark: FailureWatermarkSnapshot;
    if (watermarkBefore.expected.length === 0) {
      result = parser(input, pos);
      watermark = snapshotFailureWatermark();
    } else {
      resetFailureWatermark();
      try {
        result = parser(input, pos);
        watermark = snapshotFailureWatermark();
      } finally {
        restoreFailureWatermark(watermarkBefore);
      }
      if (watermark.input === input) {
        mergeFailureWatermark(input, watermark.pos, watermark.expected);
      }
    }

    // A semantic action can invoke this same memoized parser on another
    // input or in a nested parse(), replacing the cache while this call
    // is still running. Its result belongs only to the original cache.
    if (
      cache !== activeCache ||
      cachedInput !== input ||
      cachedSession !== session
    ) {
      return result;
    }

    // Recomputed relative to the CURRENT `base`, not the pre-call `index`
    // above: if `parser` recursively re-enters this same memoized rule (a
    // self-/mutually-recursive rule calling itself at a later offset) and a
    // `commitAtTopLevel` cut fires in between, the nested call's own
    // watermark-pruning step (above) can have already spliced `cache` and
    // advanced `base` out from under this still-in-flight outer call.
    // `pos` itself never changes, so re-deriving the index from it is
    // always correct; reusing the stale `index` would write into a
    // since-shifted slot -- silently corrupting whatever entry now lives
    // there, and later being read back as this result for a position it
    // doesn't belong to.
    const writeIndex = pos - base;
    if (writeIndex >= 0) {
      const entry: MemoEntry<T> = {
        result,
        watermarkPos: watermark.input === input ? watermark.pos : -1,
        watermarkExpected:
          watermark.input === input
            ? watermark.expected
            : EMPTY_MEMO_EXPECTATIONS,
      };
      if (Array.isArray(cache)) cache[writeIndex] = entry;
      else cache.set(pos, entry);
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

  const parser: Parser<T> = (input: string, pos: number) => {
    const inner = innerParser;
    if (!inner) {
      return {
        success: false,
        error: {
          message: "Recursive parser not initialized",
          pos,
        },
      };
    }
    // Depth-guarded, same as core's `lazy()`: the hand-written grammar
    // parser's `expression` recursion (`(...)` nesting in .tpeg sources)
    // funnels through this delegation (#114).
    return guardedParserCall(() => inner(input, pos), pos);
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
    pos: number,
  ) => {
    const result = parser(input, pos);

    if (result.success) {
      const { current, next } = result;
      return {
        success: true,
        val: { value: result.val, position: offsetToPos(input, pos) },
        current,
        next,
      } as const;
    }

    return result;
  };

  return named(withPositionParser, parserName);
};
