import { describe, expect, it } from "bun:test";
import { anyChar, literal } from "./basic";
import { choice, sequence } from "./combinators";
import { zeroOrMore } from "./repetition";
import {
  createPos,
  getCharAndLength,
  releasePos,
  unicodeLength,
} from "./utils";

describe("Edge Cases and Stress Tests", () => {
  describe("Very Large Input Handling", () => {
    it("should handle extremely large strings efficiently", () => {
      const largeString = "A".repeat(1000000); // 1MB string
      const parser = literal("A");

      const startTime = performance.now();
      let pos = createPos();
      let count = 0;

      // Parse the entire large string
      while (pos.offset < largeString.length) {
        const result = parser(largeString, pos);
        if (result.success) {
          count++;
          pos = result.next;
        } else {
          break;
        }
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(count).toBe(1000000);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it("should handle very long Unicode strings", () => {
      const unicodeString = "こんにちは🌍世界".repeat(10000);
      const parser = literal("こんにちは🌍世界");

      const startTime = performance.now();
      let pos = createPos();
      let count = 0;

      while (pos.offset < unicodeString.length) {
        const result = parser(unicodeString, pos);
        if (result.success) {
          count++;
          pos = result.next;
        } else {
          break;
        }
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(count).toBe(10000);
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
    });
  });

  describe("Memory Leak Prevention", () => {
    it("should not leak memory during repeated parsing operations", () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Perform many parsing operations
      for (let i = 0; i < 10000; i++) {
        const parser = literal(`test${i}`);
        const input = `test${i}extra`;
        const pos = createPos();

        const result = parser(input, pos);
        expect(result.success).toBe(true);

        // Release position objects
        releasePos(pos);
        if (result.success) {
          releasePos(result.next);
        }
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });

    it("should handle position pool correctly", () => {
      const positions: ReturnType<typeof createPos>[] = [];

      // Create many positions
      for (let i = 0; i < 1000; i++) {
        positions.push(createPos(i, i % 100, Math.floor(i / 100) + 1));
      }

      // Release all positions
      for (const pos of positions) {
        releasePos(pos);
      }

      // Create new positions - should reuse from pool
      const newPositions: ReturnType<typeof createPos>[] = [];
      for (let i = 0; i < 100; i++) {
        newPositions.push(createPos(i, i, i + 1));
      }

      // All positions should be valid
      for (const pos of newPositions) {
        expect(pos.offset).toBeGreaterThanOrEqual(0);
        expect(pos.column).toBeGreaterThanOrEqual(0);
        expect(pos.line).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("Unicode Edge Cases", () => {
    it("should handle maximum Unicode code points", () => {
      const maxCodePoint = String.fromCodePoint(0x10ffff);
      const parser = literal(maxCodePoint);

      const result = parser(maxCodePoint, createPos());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(maxCodePoint);
      }
    });

    it("should handle Unicode normalization edge cases", () => {
      // Composed vs decomposed forms
      const composed = "é"; // U+00E9
      const decomposed = "e\u0301"; // U+0065 + U+0301

      const composedParser = literal(composed);
      const decomposedParser = literal(decomposed);

      // They should be treated as different
      expect(composedParser(composed, createPos()).success).toBe(true);
      expect(decomposedParser(decomposed, createPos()).success).toBe(true);
      expect(composedParser(decomposed, createPos()).success).toBe(false);
      expect(decomposedParser(composed, createPos()).success).toBe(false);
    });

    it("should handle complex Unicode sequences", () => {
      const complexUnicode = "👨‍👩‍👧‍👦"; // Family emoji (multiple code points)
      const parser = literal(complexUnicode);

      const result = parser(complexUnicode, createPos());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(complexUnicode);
      }
    });

    it("should handle Unicode length calculation correctly", () => {
      const testCases = [
        { input: "Hello", expected: 5 },
        { input: "こんにちは", expected: 5 },
        { input: "🌍", expected: 1 },
        { input: "Hello🌍World", expected: 11 },
        { input: "👨‍👩‍👧‍👦", expected: 1 },
        { input: "", expected: 0 },
      ];

      for (const testCase of testCases) {
        const length = unicodeLength(testCase.input);
        expect(length).toBe(testCase.expected);
      }
    });
  });

  describe("Character Extraction Edge Cases", () => {
    it("should handle out-of-bounds character extraction", () => {
      const input = "hello";

      // Test negative offset
      const [char1, len1] = getCharAndLength(input, -1);
      expect(char1).toBe("");
      expect(len1).toBe(0);

      // Test offset beyond string length
      const [char2, len2] = getCharAndLength(input, 100);
      expect(char2).toBe("");
      expect(len2).toBe(0);

      // Test valid offsets
      const [char3, len3] = getCharAndLength(input, 0);
      expect(char3).toBe("h");
      expect(len3).toBe(1);

      const [char4, len4] = getCharAndLength(input, 4);
      expect(char4).toBe("o");
      expect(len4).toBe(1);
    });

    it("should handle Unicode character extraction at boundaries", () => {
      const input = "🌍Hello🌍";

      // Test at Unicode character boundaries
      const [char1, len1] = getCharAndLength(input, 0);
      expect(char1).toBe("🌍");
      expect(len1).toBe(2);

      const [char2, len2] = getCharAndLength(input, 2);
      expect(char2).toBe("H");
      expect(len2).toBe(1);

      const [char3, len3] = getCharAndLength(input, 7);
      expect(char3).toBe("🌍");
      expect(len3).toBe(2);
    });
  });

  describe("Parser Composition Edge Cases", () => {
    it("should handle deeply nested parser compositions", () => {
      // Create a deeply nested parser without accumulating tuple types
      const parts: Array<ReturnType<typeof literal>> = [literal("a")];
      for (let i = 0; i < 100; i++) {
        parts.push(literal("b"));
      }
      const parser = sequence(
        ...(parts as unknown as import("./types").Parser<unknown>[]),
      );

      const input = `a${"b".repeat(100)}`;
      const result = parser(input, createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toHaveLength(101); // a + 100 b's
      }
    });

    it("should handle choice with many alternatives", () => {
      // Create a choice with many alternatives
      const alternatives = [];
      for (let i = 0; i < 1000; i++) {
        alternatives.push(literal(`option${i}`));
      }

      const parser = choice(
        ...(alternatives as unknown as import("./types").Parser<string>[]),
      );

      // Test with the last alternative
      const input = "option999";
      const result = parser(input, createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("option999");
      }
    });

    it("should handle repetition with very large counts", () => {
      const parser = zeroOrMore(literal("a"));
      const input = "a".repeat(10000);

      const startTime = performance.now();
      const result = parser(input, createPos());
      const endTime = performance.now();

      expect(result.success).toBe(true);
      expect(endTime - startTime).toBeLessThan(100); // Should be fast

      if (result.success) {
        expect(result.val).toHaveLength(10000);
      }
    });
  });

  describe("Error Handling Edge Cases", () => {
    it("should handle malformed input gracefully", () => {
      const parser = literal("hello");

      // Test with null-like inputs
      const result1 = parser("", createPos());
      expect(result1.success).toBe(false);

      // Test with very long input that doesn't match
      const longInput = "x".repeat(1000000);
      const result2 = parser(longInput, createPos());
      expect(result2.success).toBe(false);
    });

    it("should handle position edge cases", () => {
      const parser = anyChar();

      // Test with position at end of string
      const input = "hello";
      const endPos = createPos(input.length, input.length, 1);
      const result = parser(input, endPos);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("end of input");
      }
    });
  });

  describe("Performance Under Stress", () => {
    it("should maintain performance with many small operations", () => {
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        const parser = literal(`test${i % 100}`);
        const input = `test${i % 100}extra`;
        const pos = createPos();

        const result = parser(input, pos);
        expect(result.success).toBe(true);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(1000);
    });

    it("should handle concurrent-like operations efficiently", () => {
      const parsers = [];
      for (let i = 0; i < 100; i++) {
        parsers.push(literal(`pattern${i}`));
      }

      const startTime = performance.now();

      // Simulate concurrent parsing
      for (let i = 0; i < 1000; i++) {
        const parser = parsers[i % parsers.length];
        const input = `pattern${i % parsers.length}extra`;
        const pos = createPos();

        if (!parser) throw new Error("parser is undefined");
        const result = parser(input, pos);
        expect(result.success).toBe(true);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(500);
    });
  });
});
