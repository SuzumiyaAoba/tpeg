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

    it("should bound the number of distinct inputs tracked, not just positions within one input", () => {
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
      const pos = { offset: 0, line: 1, column: 1 };

      memoized("a", pos); // tracks input "a"
      memoized("b", pos); // tracks input "b", evicts input "a"
      memoized("a", pos); // input "a" was evicted from the outer cache -> cache miss

      expect(callCount).toBe(3);
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
