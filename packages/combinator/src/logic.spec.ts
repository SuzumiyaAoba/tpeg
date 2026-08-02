import { describe, expect, it } from "bun:test";
import type { Pos } from "@suzumiyaaoba/tpeg-core";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { literal } from "@suzumiyaaoba/tpeg-core";
import { commitAtTopLevel, memoize, recursive, withPosition } from "./logic";

const pos = (offset: number): Pos => ({ offset, line: 1, column: offset });

/** Wraps `literal(char)` so every actual invocation increments `counter`,
 * the same technique `packages/parser/bench/harness.ts` uses -- a cache
 * hit never reaches the wrapped parser, so this counts real re-parses. */
function countedLiteral(char: string, counter: { count: number }) {
  const inner = literal(char);
  return (input: string, p: Pos) => {
    counter.count++;
    return inner(input, p);
  };
}

describe("logic combinators", () => {
  describe("memoize", () => {
    it("should cache results", () => {
      let callCount = 0;
      const parser = (input: string, pos: Pos) => {
        callCount++;
        return literal("a")(input, pos);
      };
      const memoized = memoize(parser);

      const pos = { offset: 0, line: 1, column: 1 };
      memoized("a", pos);
      memoized("a", pos);

      expect(callCount).toBe(1);
    });

    it("should evict from cache when full", () => {
      let callCount = 0;
      const parser = (input: string, pos: Pos) => {
        callCount++;
        const char = input[pos.offset];
        if (char === undefined) {
          return { success: false, error: { message: "EOF", pos } } as const;
        }
        return literal(char)(input, pos);
      };
      const memoized = memoize(parser, { maxCacheSize: 1 });

      memoized("ab", { offset: 0, line: 1, column: 1 }); // Key 0
      memoized("ab", { offset: 1, line: 1, column: 2 }); // Key 1, evicts Key 0
      memoized("ab", { offset: 0, line: 1, column: 1 }); // Key 0 again, cache miss

      expect(callCount).toBe(3);
    });

    it("discards the whole cache the moment a different input arrives, regardless of maxCacheSize", () => {
      // Not an eviction policy anymore -- the cache is always scoped to
      // exactly the most recently seen input. `maxCacheSize` (even unset
      // here) has no bearing on this: switching inputs always starts a
      // fresh table.
      let callCount = 0;
      const parser = (input: string, pos: Pos) => {
        callCount++;
        const char = input[pos.offset];
        if (char === undefined) {
          return { success: false, error: { message: "EOF", pos } } as const;
        }
        return literal(char)(input, pos);
      };
      const memoized = memoize(parser);
      const pos = { offset: 0, line: 1, column: 1 };

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
      const parser = (input: string, pos: Pos) =>
        literal(input[0] as string)(input, pos);
      const memoized = memoize(parser);
      const pos = { offset: 0, line: 1, column: 1 };

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
      const parser = (input: string, pos: Pos) => {
        callCount++;
        const char = input[pos.offset];
        if (char === undefined) {
          return { success: false, error: { message: "EOF", pos } } as const;
        }
        return literal(char)(input, pos);
      };
      const memoized = memoize(parser);
      const input = "abc";

      memoized(input, { offset: 0, line: 1, column: 1 });
      memoized(input, { offset: 1, line: 1, column: 2 });
      memoized(input, { offset: 2, line: 1, column: 3 });
      expect(callCount).toBe(3);

      // Re-visiting offset 0 must be a cache hit -- nothing evicted it.
      memoized(input, { offset: 0, line: 1, column: 1 });
      expect(callCount).toBe(3);
    });

    it("keys on offset alone: a different Pos with the same offset still hits the cache", () => {
      // line/column are fully determined by (input, offset), so once the
      // cache is scoped to one input, including them in the key would be
      // redundant. This pins that the implementation actually relies on
      // that instead of accidentally requiring an exact Pos match.
      let callCount = 0;
      const parser = (input: string, pos: Pos) => {
        callCount++;
        return literal("a")(input, pos);
      };
      const memoized = memoize(parser);

      memoized("a", { offset: 0, line: 1, column: 1 });
      // Same offset, deliberately "wrong" line/column -- must still hit.
      memoized("a", { offset: 0, line: 99, column: 99 });

      expect(callCount).toBe(1);
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
