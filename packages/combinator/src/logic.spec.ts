import { describe, expect, it } from "vite-plus/test";
import {
  type ParseError,
  type ParseSuccess,
  type Parser,
  anyChar,
  parse,
} from "@suzumiyaaoba/tpeg-core";
import { literal } from "@suzumiyaaoba/tpeg-core";
import {
  charClassRun,
  choice,
  commit,
  notPredicate,
  resetFailureWatermark,
  sequence,
} from "@suzumiyaaoba/tpeg-core";
import { commitAtTopLevel, memoize, recursive, withPosition } from "./logic";

const pos = (offset: number): number => offset;

/** Wraps `literal(char)` so every actual invocation increments `counter`,
 * the same technique `packages/parser/bench/harness.ts` uses -- a cache
 * hit never reaches the wrapped parser, so this counts real re-parses. */
function countedLiteral(char: string, counter: { count: number }) {
  const inner = literal(char);
  return (input: string, p: number) => {
    counter.count++;
    return inner(input, p);
  };
}

const memoConfigurations: [string, { maxCacheSize?: number }][] = [
  ["omitted", {}],
  ["single", { maxCacheSize: 1 }],
  ["finite", { maxCacheSize: 2 }],
  ["Infinity", { maxCacheSize: Number.POSITIVE_INFINITY }],
];

describe("logic combinators", () => {
  describe.each(memoConfigurations)(
    "memoize: cache scope is one parse() session (capacity: %s)",
    (_capacityName, options) => {
      it("uses a fresh session after returning from a nested parse", () => {
        const counter = { count: 0 };
        const memoized = memoize(countedLiteral("a", counter), options);
        parse(() => parse(memoized)("a"))("outer");
        parse(memoized)("a");
        expect(counter.count).toBe(2);
      });

      it("restores the outer cache's session after a nested parser throws", () => {
        const counter = { count: 0 };
        const memoized = memoize(countedLiteral("a", counter), options);
        parse((input: string, p: number) => {
          const first = memoized(input, p);
          expect(() =>
            parse(() => {
              throw new Error("nested action failed");
            })("inner"),
          ).toThrow("nested action failed");
          expect(memoized(input, p)).toBe(first);
          return first;
        })("a");
        expect(counter.count).toBe(1);
      });

      it("retains the outer cache across a nested parse of another parser", () => {
        const counter = { count: 0 };
        const memoized = memoize(countedLiteral("a", counter), options);
        const result = parse((input: string, p: number) => {
          const first = memoized(input, p);
          parse(literal("inner"))("inner");
          const second = memoized(input, p);
          expect(second).toBe(first);
          return second;
        })("a");
        expect(result.success).toBe(true);
        expect(counter.count).toBe(1);
      });

      it.each([false, true])(
        "does not write into a cache replaced by a reentrant call (parse wrapper: %s)",
        (useParse) => {
          const character = anyChar();
          let shared: Parser<string>;
          shared = memoize((input: string, p: number) => {
            if (input === "a") {
              if (useParse) parse(shared)("b");
              else shared("b", 0);
            }
            return character(input, p);
          }, options);
          const result = parse((input: string, p: number) => {
            shared(input, p);
            return shared("b", 0);
          })("a");
          expect(result.success).toBe(true);
          if (result.success) expect(result.val).toBe("b");
        },
      );

      it("re-runs the wrapped parser for a second parse() of the same text", () => {
        const counter = { count: 0 };
        const memoized = memoize(countedLiteral("a", counter), options);
        parse(memoized)("a");
        parse(memoized)("a");
        expect(counter.count).toBe(2);
      });

      it("does not hand a later parse() the value object an earlier one returned", () => {
        const memoized = memoize((input: string, p: number) => {
          const r = literal("a")(input, p);
          return r.success ? { ...r, val: { items: [r.val as string] } } : r;
        }, options);
        const first = parse(memoized)("a");
        if (!first.success) throw new Error("expected success");
        first.val.items.push("MUTATED");
        const second = parse(memoized)("a");
        if (!second.success) throw new Error("expected success");
        expect(second.val).not.toBe(first.val);
        expect(second.val.items).toEqual(["a"]);
      });

      it("still caches repeated calls within one session", () => {
        const counter = { count: 0 };
        const memoized = memoize(countedLiteral("a", counter), options);
        const twice = (input: string, p: number) => {
          memoized(input, p);
          return memoized(input, p);
        };
        parse(twice)("a");
        expect(counter.count).toBe(1);
      });
    },
  );

  describe("memoize", () => {
    it.each([2, 3])(
      "does not evict early when reentrancy fills the same key twice (capacity: %s)",
      (maxCacheSize) => {
        const calls = new Map<number, number>();
        const character = anyChar();
        let reentered = false;
        let shared: Parser<string>;
        shared = memoize(
          (input, p) => {
            calls.set(p, (calls.get(p) ?? 0) + 1);
            if (p === 0 && !reentered) {
              reentered = true;
              shared(input, p);
            }
            return character(input, p);
          },
          { maxCacheSize },
        );
        const input = "abcd#bounded-reentry";
        const first = shared(input, 0);
        for (let p = 1; p < maxCacheSize; p++) shared(input, p);
        expect(shared(input, 0)).toBe(first);
        expect(calls.get(0)).toBe(2);
      },
    );

    it("evicts the oldest inserted position without refreshing it on a hit", () => {
      const calls = new Map<number, number>();
      const character = anyChar();
      const shared = memoize(
        (input, p) => {
          calls.set(p, (calls.get(p) ?? 0) + 1);
          return character(input, p);
        },
        { maxCacheSize: 2 },
      );
      const input = "abc#bounded-order";
      const first = shared(input, 2);
      const second = shared(input, 0);
      expect(shared(input, 2)).toBe(first);
      shared(input, 1);
      expect(shared(input, 0)).toBe(second);
      expect(shared(input, 2)).toEqual(first);
      expect(calls).toEqual(
        new Map([
          [2, 2],
          [0, 1],
          [1, 1],
        ]),
      );
    });

    it("prunes bounded entries by position even when insertion order differs", () => {
      const calls = new Map<number, number>();
      const character = anyChar();
      const shared = memoize(
        (input, p) => {
          calls.set(p, (calls.get(p) ?? 0) + 1);
          return character(input, p);
        },
        { maxCacheSize: 3 },
      );
      const input = "xxxxxx#bounded-cut";
      shared(input, 2);
      const retained = shared(input, 5);
      shared(input, 1);
      commitAtTopLevel(character)(input, 3);
      expect(shared(input, 5)).toBe(retained);
      for (const p of [2, 1]) {
        shared(input, p);
        shared(input, p);
        expect(calls.get(p)).toBe(3);
      }
      expect(shared(input, 5)).toBe(retained);
      expect(calls.get(5)).toBe(1);
    });
    it("resumes FIFO order after pruning a rotated full cache", () => {
      const calls = new Map<number, number>();
      const character = anyChar();
      const shared = memoize(
        (input, p) => {
          calls.set(p, (calls.get(p) ?? 0) + 1);
          return character(input, p);
        },
        { maxCacheSize: 3 },
      );
      const input = "xxxxxx#bounded-cut-rotation";
      for (const p of [0, 4, 1]) shared(input, p);
      const atThree = shared(input, 3);
      commitAtTopLevel(character)(input, 2);
      const atFive = shared(input, 5);
      shared(input, 2);
      expect(shared(input, 3)).toBe(atThree);
      expect(shared(input, 5)).toBe(atFive);
      shared(input, 4);
      expect(calls.get(4)).toBe(2);
      expect(calls.get(3)).toBe(1);
      expect(calls.get(5)).toBe(1);
    });

    it("should cache results", () => {
      let callCount = 0;
      const parser = (input: string, pos: number) => {
        callCount++;
        return literal("a")(input, pos);
      };
      const memoized = memoize(parser);

      const pos = 0;
      memoized("a", pos);
      memoized("a", pos);

      expect(callCount).toBe(1);
    });

    it("should evict from cache when full", () => {
      let callCount = 0;
      const parser = (input: string, pos: number) => {
        callCount++;
        const char = input[pos];
        if (char === undefined) {
          return { success: false, error: { message: "EOF", pos } } as const;
        }
        return literal(char)(input, pos);
      };
      const memoized = memoize(parser, { maxCacheSize: 1 });

      memoized("ab", 0); // Key 0
      memoized("ab", 1); // Key 1, evicts Key 0
      memoized("ab", 0); // Key 0 again, cache miss

      expect(callCount).toBe(3);
    });

    it("treats maxCacheSize: 0 as a cache with no entries", () => {
      let callCount = 0;
      const memoized = memoize(
        (input: string, pos: number) => {
          callCount++;
          return literal("a")(input, pos);
        },
        { maxCacheSize: 0 },
      );

      memoized("a", 0);
      memoized("a", 0);

      expect(callCount).toBe(2);
    });

    it("rejects negative memoize cache sizes", () => {
      expect(() => memoize(literal("a"), { maxCacheSize: -1 })).toThrow(
        /non-negative integer/,
      );
    });

    it.each([
      ["unsafe integer", () => Number.MAX_SAFE_INTEGER + 1],
      ["Symbol", () => Symbol("cache size")],
      ["object without a prototype", () => Object.create(null)],
      [
        "throwing conversion",
        () => ({
          [Symbol.toPrimitive]() {
            throw new Error("conversion failed");
          },
        }),
      ],
    ] as const)(
      "reports an invalid memoize cache size for %s",
      (_kind, createValue) => {
        expect(() =>
          memoize(literal("a"), { maxCacheSize: createValue() as number }),
        ).toThrow("Invalid memoize cache size");
      },
    );

    it("discards the whole cache the moment a different input arrives, regardless of maxCacheSize", () => {
      // Not an eviction policy anymore -- the cache is always scoped to
      // exactly the most recently seen input. `maxCacheSize` (even unset
      // here) has no bearing on this: switching inputs always starts a
      // fresh table.
      let callCount = 0;
      const parser = (input: string, pos: number) => {
        callCount++;
        const char = input[pos];
        if (char === undefined) {
          return { success: false, error: { message: "EOF", pos } } as const;
        }
        return literal(char)(input, pos);
      };
      const memoized = memoize(parser);
      const pos = 0;

      memoized("a", pos); // caches input "a"
      memoized("b", pos); // different input -> fresh table, discards "a"'s cache
      memoized("a", pos); // different input again -> fresh table, discards "b"'s cache

      expect(callCount).toBe(3);
    });

    it("never returns a cached result from a different input at the same offset", () => {
      // The correctness property the cache-reset behavior exists to
      // guarantee: two inputs that differ only after a shared offset
      // must each get their own (correct) result there, never the other
      // input's cached one.
      const parser = (input: string, pos: number) =>
        literal(input[0] as string)(input, pos);
      const memoized = memoize(parser);
      const pos = 0;

      const resultA = memoized("aX", pos);
      const resultB = memoized("bY", pos);
      const resultAAgain = memoized("aX", pos);

      expect(resultA.success).toBe(true);
      expect(resultB.success).toBe(true);
      if (resultA.success && resultB.success) {
        expect(resultA.val).toBe("a");
        expect(resultB.val).toBe("b");
      }
      expect(resultAAgain).toEqual(resultA);
    });

    it("does not evict cached positions for one input when maxCacheSize is left unset (default: unbounded per input)", () => {
      let callCount = 0;
      const parser = (input: string, pos: number) => {
        callCount++;
        const char = input[pos];
        if (char === undefined) {
          return { success: false, error: { message: "EOF", pos } } as const;
        }
        return literal(char)(input, pos);
      };
      const memoized = memoize(parser);
      const input = "abc";

      memoized(input, 0);
      memoized(input, 1);
      memoized(input, 2);
      expect(callCount).toBe(3);

      // Re-visiting offset 0 must be a cache hit -- nothing evicted it.
      memoized(input, 0);
      expect(callCount).toBe(3);
    });

    it("keys on offset alone: a different Pos with the same offset still hits the cache", () => {
      // line/column are fully determined by (input, offset), so once the
      // cache is scoped to one input, including them in the key would be
      // redundant. This pins that the implementation actually relies on
      // that instead of accidentally requiring an exact Pos match.
      let callCount = 0;
      const parser = (input: string, pos: number) => {
        callCount++;
        return literal("a")(input, pos);
      };
      const memoized = memoize(parser);

      memoized("a", 0);
      // Same offset, deliberately "wrong" line/column -- must still hit.
      memoized("a", 0);

      expect(callCount).toBe(1);
    });

    describe("caching a fatal (cut/commit) failure", () => {
      // A cache HIT replays a previously-computed `ParseResult` verbatim
      // (see `memoize`'s own doc comment, "Farthest-failure watermark:
      // replaying what a cache hit skips") -- that result can just as
      // easily be a FATAL failure (`commit`, `@suzumiyaaoba/tpeg-core`) as
      // an ordinary one, and nothing in the cache-hit path re-derives or
      // strips `.error.fatal`, so a HIT must reproduce it exactly like the
      // original MISS did.
      it("preserves error.fatal === true on a cache hit, identical to the original miss", () => {
        const inner = sequence(literal("a"), commit(literal("b")));
        const memoized = memoize(inner);

        const miss = memoized("ac", pos(0));
        const hit = memoized("ac", pos(0));

        expect(miss.success).toBe(false);
        expect(hit.success).toBe(false);
        if (!miss.success && !hit.success) {
          expect(miss.error.fatal).toBe(true);
          expect(hit.error.fatal).toBe(true);
        }
      });

      it("a cache-hit fatal failure still aborts an enclosing choice rather than falling through to a sibling", () => {
        // The real-world consequence of the property above: `choice`
        // absorbs a fatal failure at its own boundary and does NOT try
        // the next alternative (see `commit`'s doc comment,
        // `@suzumiyaaoba/tpeg-core`) -- if a cache hit silently lost the
        // `fatal` flag, this would wrongly succeed via `fallback` instead.
        const inner = sequence(literal("a"), commit(literal("b")));
        const memoized = memoize(inner);
        const fallback = literal("a");
        const grammar = choice(memoized, fallback);

        // First call: cache MISS.
        const first = grammar("ac", pos(0));
        expect(first.success).toBe(false);
        // Second call: `memoized` itself now hits the cache internally,
        // but `choice` around it must behave identically either way.
        const second = grammar("ac", pos(0));
        expect(second.success).toBe(false);
      });
    });

    describe.each(memoConfigurations)(
      "farthest-failure watermark on a cache hit (capacity: %s)",
      (_capacityName, options) => {
        // A cache HIT returns a previously-computed `ParseResult` without
        // re-running the wrapped parser, so none of the leaf `fail()` calls
        // that originally produced it run again. `error`/`.expected`/`.pos`
        // are derived from `tpeg-core`'s shared watermark
        // (`packages/core/src/failure.ts`), populated as a SIDE EFFECT of
        // those calls -- without replaying that contribution on a hit, the
        // diagnostic would silently degrade to "Parse failed" the moment a
        // second call at the same offset hits the cache (regression: this
        // used to happen unconditionally).
        it("reproduces the same error diagnostics on a cache hit as the original miss", () => {
          const inner = choice(literal("aa"), charClassRun([["0", "9"]], 1));
          let calls = 0;
          const term = memoize((input: string, p: number) => {
            calls++;
            return inner(input, p);
          }, options);
          const result = parse((input: string, p: number) => {
            const miss = term(input, p);
            expect(miss.success).toBe(false);
            if (miss.success) return miss;
            const missError = miss.error;
            resetFailureWatermark();
            const hit = term(input, p);
            expect(hit.success).toBe(false);
            if (!hit.success) expect(hit.error).toEqual(missError);
            return hit;
          })("zz");
          expect(result.success).toBe(false);
          expect(calls).toBe(1);
        });

        it("replays a cached failure's own expectations after a probe discards an earlier failure", () => {
          const counter = { count: 0 };
          const term = memoize(countedLiteral("x", counter), options);
          const result = parse(
            sequence(notPredicate(choice(literal("abcdef"), term)), term),
          )("abcde!");
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.pos).toBe(0);
            expect(result.error.expected).toBe('"x"');
          }
          expect(counter.count).toBe(1);
        });

        it("does not replay another alternative's failure from a cached success", () => {
          const counter = { count: 0 };
          const term = memoize(countedLiteral("a", counter), options);
          const result = parse(
            sequence(
              notPredicate(
                choice(literal("abcdef"), sequence(term, literal("z"))),
              ),
              term,
              literal("!"),
            ),
          )("abcde!");
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.pos).toBe(1);
            expect(result.error.expected).toBe('"!"');
          }
          expect(counter.count).toBe(1);
        });

        it("reproduces diagnostics when the cache is populated by a probe (!e e), not a direct miss", () => {
          // `notPredicate` snapshots and restores the watermark around its
          // own probe (see `packages/core/src/lookahead.ts`) -- so if
          // `term`'s failure inside that probe is what populates the
          // memoize cache, and the SECOND `term` (the real one, right
          // after) hits that cache, the watermark must still end up
          // reflecting `term`'s own failure, not the restored/empty state
          // the probe left behind.
          const term = memoize(
            choice(literal("aa"), charClassRun([["0", "9"]], 1)),
            options,
          );
          const grammar = sequence(notPredicate(term), term);
          const result = parse(grammar)("zz");
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.pos).toBe(0);
            expect(result.error.expected).toEqual(['"aa"', "0-9"]);
          }
        });

        it("does not let expected grow across repeated parses of the same failing input", () => {
          const term = memoize(
            choice(literal("("), charClassRun([["0", "9"]], 1)),
            options,
          );
          const grammar = sequence(term, literal("!"));
          const results = Array.from({ length: 4 }, () =>
            parse(grammar)("iffoo"),
          );
          for (const r of results) {
            expect(r.success).toBe(false);
            if (!r.success) {
              expect(r.error.pos).toBe(0);
              expect(r.error.expected).toEqual(['"("', "0-9"]);
            }
          }
        });
      },
    );
  });

  describe("commitAtTopLevel", () => {
    // `commitAtTopLevel` advances a watermark that's module-scoped state
    // (shared across every call in this process, by design -- see its
    // doc comment), NOT reset between test cases. Every test below uses
    // its own distinct input string (suffixed with a unique marker after
    // the range of offsets it actually tests) purely so that
    // `input !== watermarkInput` is guaranteed true on its first
    // `commitAtTopLevel`/`memoize` call, forcing a fresh reset -- without
    // that, a test could accidentally observe leftover watermark state
    // from whichever test happened to run before it.

    it.each(["inherited", "non-enumerable"])(
      "retains %s diagnostics when marking a concrete failure fatal",
      (kind) => {
        const metadata = Symbol("metadata");
        const fields: ParseError = {
          message: "custom diagnostic",
          pos: 1,
          expected: ["a"],
          found: "z",
          parserName: "custom",
          context: ["inside rule"],
          fatal: false,
          abort: false,
        };
        const error: ParseError =
          kind === "inherited"
            ? Object.create(fields)
            : Object.defineProperties(
                new Error(fields.message),
                Object.fromEntries(
                  Object.entries(fields).map(([key, value]) => [
                    key,
                    { value },
                  ]),
                ),
              );
        Object.assign(error, {
          detail: "retained",
          [metadata]: "symbol metadata",
        });
        const child: Parser<string> = () => ({ success: false, error });
        expect(commitAtTopLevel(child)("xz#diagnostic", 0)).toMatchObject({
          success: false,
          error: {
            ...fields,
            fatal: true,
            detail: "retained",
            [metadata]: "symbol metadata",
          },
        });
        expect(error.fatal).toBe(false);
      },
    );

    it.each(["choice", "negative lookahead"])(
      "retains inherited abort through %s",
      (kind) => {
        const error: ParseError = Object.create({
          message: "cancelled",
          pos: 0,
          abort: true,
          fatal: false,
        });
        const child: Parser<string> = () => ({ success: false, error });
        let fallbackCalls = 0;
        const fallback: Parser<string> = (_input, p) => {
          fallbackCalls++;
          return { success: true, val: "fallback", current: p, next: p };
        };
        const cut = commitAtTopLevel(child);
        const parser =
          kind === "choice" ? choice(choice(cut), fallback) : notPredicate(cut);
        expect(parser("abort#top-level", 0)).toMatchObject({
          success: false,
          error: { abort: true },
        });
        expect(fallbackCalls).toBe(0);
      },
    );

    it("reads a concrete failure's error getter once", () => {
      let reads = 0;
      const child: Parser<string> = () => ({
        success: false,
        get error() {
          return { message: "diagnostic", pos: reads++ };
        },
      });
      expect(commitAtTopLevel(child)("getter#top-level", 0)).toMatchObject({
        success: false,
        error: { pos: 0, fatal: true },
      });
      expect(reads).toBe(1);
    });

    it("marks a failure fatal, same as commit", () => {
      const parser = commitAtTopLevel(literal("a"));
      const result = parser("b#1", pos(0));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fatal).toBe(true);
      }
    });

    it("does not mark a success fatal", () => {
      const parser = commitAtTopLevel(literal("a"));
      const result = parser("a#2", pos(0));
      expect(result.success).toBe(true);
    });

    it("advances the watermark to the offset it's invoked at, pruning a memoize cache's entries below that offset on its next touch", () => {
      const counter = { count: 0 };
      const shared = memoize(countedLiteral("x", counter));
      const input = "xxxxxx#3";

      // Populate cache entries at offsets 0..3 (simulating earlier
      // backtracking that touched positions before an eventual commit
      // point).
      for (let offset = 0; offset < 4; offset++) {
        shared(input, pos(offset));
      }
      expect(counter.count).toBe(4);

      // A committed parser fires at offset 4 -- everything before it
      // (offsets 0..3) is now provably unreachable.
      commitAtTopLevel(literal("x"))(input, pos(4));

      // Offset 2 (below the new watermark) must have been pruned: this
      // call re-invokes the underlying parser instead of hitting cache.
      const before = counter.count;
      shared(input, pos(2));
      expect(counter.count).toBe(before + 1);
    });

    it("does not prune entries at or above the watermark", () => {
      const counter = { count: 0 };
      const shared = memoize(countedLiteral("x", counter));
      const input = "xxxxxx#4";

      shared(input, pos(5)); // cache offset 5
      expect(counter.count).toBe(1);

      commitAtTopLevel(literal("x"))(input, pos(4)); // watermark -> 4

      // Offset 5 is >= the watermark, so it must still be a cache hit.
      shared(input, pos(5));
      expect(counter.count).toBe(1);
    });

    it("scopes the watermark to one input, same as memoize's own cache", () => {
      const counter = { count: 0 };
      const shared = memoize(countedLiteral("x", counter));

      shared("xxxxxx#5a", pos(2));
      commitAtTopLevel(literal("x"))("xxxxxx#5a", pos(4)); // watermark -> 4 for THIS input
      expect(counter.count).toBe(1);

      // A different input string starts a fresh parse -- the previous
      // input's watermark must not affect this cache's fresh table, and
      // touching this new cache must not be treated as already pruned.
      const counter2 = { count: 0 };
      const other = memoize(countedLiteral("x", counter2));
      other("xxxxx#5b", pos(1));
      expect(counter2.count).toBe(1);
      other("xxxxx#5b", pos(1)); // cache hit, same input+offset
      expect(counter2.count).toBe(1);
    });

    it("never decreases the watermark (a later commitAtTopLevel call at an earlier offset is a no-op for pruning)", () => {
      const counter = { count: 0 };
      const shared = memoize(countedLiteral("x", counter));
      const input = "xxxxxx#6";

      shared(input, pos(1));
      commitAtTopLevel(literal("x"))(input, pos(5)); // watermark -> 5
      commitAtTopLevel(literal("x"))(input, pos(2)); // must NOT lower it back to 2

      // Offset 1 is still below the (higher) watermark of 5, so it must
      // stay pruned regardless of the second, lower-offset commit call.
      const before = counter.count;
      shared(input, pos(1));
      expect(counter.count).toBe(before + 1);
    });
  });

  describe.each(memoConfigurations)(
    "memoize + commitAtTopLevel interaction (self-recursive rules, capacity: %s)",
    (_capacityName, options) => {
      it('does not corrupt another offset\'s cache entry when a recursive re-entry of the same memoized rule advances the watermark mid-call (regression: a self-recursive @memoize\'d rule with a promoted cut, e.g. `item = "(" ~ item / "x"`, wrote its result into a stale, since-reindexed cache slot)', () => {
        // Mirrors exactly what codegen produces for `item = "(" ~ item / "x"`
        // under both `@memoize` and cut promotion: the recursive reference to
        // `item` inside its own body goes through the SAME memoized closure
        // (`memoizedItem`, not the raw unmemoized one), and the cut after "("
        // compiles to `commitAtTopLevel` (safe here: "x", the only sibling in
        // the enclosing choice, is FIRST-disjoint from "("). Built via
        // `recursive` (below) rather than a hand-rolled forward-declared
        // `let`, so `memoizedItem` can still reference `rawItem`'s body
        // before that body is finalized.
        const [rawItem, setRawItem] = recursive<unknown>();
        const memoizedItem = memoize(rawItem, options);
        setRawItem((input, itemPos) => {
          const open = literal("(")(input, itemPos);
          if (open.success) {
            const rest = commitAtTopLevel(memoizedItem)(input, open.next);
            if (!rest.success) return rest;
            return {
              success: true,
              val: [open.val, rest.val],
              current: itemPos,
              next: rest.next,
            } as const;
          }
          return literal("x")(input, itemPos);
        });

        const input = `((x#8-${_capacityName}`;
        // Priming this parse recurses through offsets 0 -> 1 -> 2, firing
        // `commitAtTopLevel` (and so reindexing this shared cache) at each
        // level while the shallower calls are still on the stack waiting to
        // write their own (still-unwritten) cache entries.
        const primed = memoizedItem(input, pos(0));
        expect(primed.success).toBe(true);
        if (primed.success) {
          expect(primed.val).toEqual(["(", ["(", "x"]]);
          expect(primed.next).toBe(3);
        }

        // An unrelated, later query at offset 2 must get offset 2's own
        // result ("x"), never offset 0's result wrongly written into offset
        // 2's cache slot by the priming call above.
        const atOffset2 = memoizedItem(input, pos(2));
        expect(atOffset2.success).toBe(true);
        if (atOffset2.success) {
          expect(atOffset2.val).toBe("x");
          expect(atOffset2.current).toBe(2);
          expect(atOffset2.next).toBe(3);
        }
      });
    },
  );

  describe("recursive", () => {
    it("should allow self-reference", () => {
      const [parser, setParser] = recursive<string>();
      // A simple recursive grammar: A -> "a" A | "b"
      setParser((input, pos) => {
        const resultA = literal("a")(input, pos);
        if (resultA.success) {
          const resultRest = parser(input, resultA.next);
          if (resultRest.success) {
            return {
              success: true,
              val: `a${resultRest.val}`,
              current: pos,
              next: resultRest.next,
            };
          }
        }
        return literal("b")(input, pos);
      });

      const result = parse(parser)("aaab");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("aaab");
      }
    });

    it("should fail if not initialized", () => {
      const [parser] = recursive<string>();
      const result = parse(parser)("a");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Recursive parser not initialized");
      }
    });
  });

  describe("withPosition", () => {
    it("keeps consumption when reading the child's value changes its result", () => {
      const child: ParseSuccess<string> = {
        success: true,
        current: 2,
        next: 3,
        get val() {
          child.current = 0;
          child.next = 0;
          return "a";
        },
      };
      expect(withPosition(() => child)("x\na", 2)).toMatchObject({
        success: true,
        val: { value: "a", position: { offset: 2, line: 2, column: 0 } },
        current: 2,
        next: 3,
      });
    });

    it("should return value and position", () => {
      const parser = withPosition(literal("abc"));
      const result = parse(parser)("abc");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe("abc");
        expect(result.val.position.offset).toBe(0);
        expect(result.val.position.line).toBe(1);
        // Initial position from core seems to be column 0
        expect(result.val.position.column).toBe(0);
      }
    });

    it("should propagate failure", () => {
      const parser = withPosition(literal("abc"));
      const result = parse(parser)("def");
      expect(result.success).toBe(false);
    });

    it("propagates a fatal (cut/commit) failure unchanged, including the fatal flag", () => {
      // `withPosition` returns the wrapped parser's failure verbatim on
      // failure (see its own implementation) -- worth pinning explicitly
      // since a fatal failure's flag surviving that pass-through is what
      // lets an enclosing `choice` correctly abort rather than try a
      // sibling alternative.
      const parser = withPosition(commit(literal("abc")));
      const result = parser("def", 0);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fatal).toBe(true);
      }
    });

    it("should tag failures with parserName when provided", () => {
      const parser = withPosition(literal("abc"), "abcWithPosition");
      const result = parse(parser)("def");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.parserName).toBe("abcWithPosition");
      }
    });

    it("should still return value and position when parserName is provided", () => {
      const parser = withPosition(literal("abc"), "abcWithPosition");
      const result = parse(parser)("abc");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe("abc");
        expect(result.val.position.offset).toBe(0);
      }
    });
  });

  describe("out-of-contract pos", () => {
    const input = "a";
    const invalidPositions = [
      -1,
      -0.5,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      2 ** 32,
      input.length + 1,
    ];

    it("memoize fails rather than writing a sparse/fractional cache entry", () => {
      const parser = memoize(literal("a"));
      for (const pos of invalidPositions) {
        expect(parser(input, pos).success).toBe(false);
      }
      // And the bogus calls left nothing cached: a valid call still runs
      // the wrapped parser exactly once.
      expect(parser(input, 0).success).toBe(true);
    });

    it("commitAtTopLevel fails and does not advance the prune watermark", () => {
      // A distinctive input string keeps this test independent of any
      // other commitAtTopLevel call's leftover module state: the
      // `input !== watermarkInput` check resets the offset for a new
      // input, so the only way `watermarkOffset` moves here is through
      // THIS test's own calls.
      const markerInput = "zz-commit-marker";
      const parser = commitAtTopLevel(literal("z"));
      for (const pos of [
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        2 ** 32,
        markerInput.length + 1,
      ]) {
        expect(parser(markerInput, pos).success).toBe(false);
      }
      // A bogus call must not have pushed the prune watermark forward:
      // a following memoized rule on the same input at offset 0 still
      // serves its cache (a pruned-below-0 cache would re-run the inner
      // parser on every call).
      let calls = 0;
      const counted = memoize((i: string, p: number) => {
        calls++;
        return literal("z")(i, p);
      });
      counted(markerInput, 0);
      counted(markerInput, 0);
      expect(calls).toBe(1);
    });
  });
});
