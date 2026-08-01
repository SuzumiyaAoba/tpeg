import { describe, expect, it } from "bun:test";
import type { Pos } from "@suzumiyaaoba/tpeg-core";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { literal } from "@suzumiyaaoba/tpeg-core";
import { memoize, recursive, withPosition } from "./logic";

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
