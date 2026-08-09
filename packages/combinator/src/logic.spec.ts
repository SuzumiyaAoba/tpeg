import { describe, expect, it } from "bun:test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { literal } from "@suzumiyaaoba/tpeg-core";
import {
  charClassRun,
  choice,
  notPredicate,
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

describe("logic combinators", () => {
  describe("memoize", () => {
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

    describe("farthest-failure watermark on a cache hit", () => {
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
        const term = memoize(
          choice(literal("aa"), charClassRun([["0", "9"]], 1)),
        );
        const miss = parse(term)("zz");
        const hit = parse(term)("zz");
        expect(miss.success).toBe(false);
        expect(hit.success).toBe(false);
        if (!miss.success && !hit.success) {
          expect(hit.error.pos).toBe(miss.error.pos);
          // `expected`'s declared type (`string | string[] | undefined`)
          // makes `toEqual`'s generic parameter reject the `undefined`
          // branch when passed directly -- both sides are already known
          // non-`undefined` failures here, so `JSON.stringify` sidesteps
          // that without weakening what's actually being compared.
          expect(JSON.stringify(hit.error.expected)).toBe(
            JSON.stringify(miss.error.expected),
          );
          expect(hit.error.message).toBe(miss.error.message);
        }
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
    });
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

  describe("memoize + commitAtTopLevel interaction (self-recursive rules)", () => {
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
      const memoizedItem = memoize(rawItem);
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

      const input = "((x#8";
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
  });

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
});
