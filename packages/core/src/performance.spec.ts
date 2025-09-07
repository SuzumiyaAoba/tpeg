import { describe, expect, it } from "bun:test";
import {
  advancePos,
  createPos,
  getCharAndLength,
  isNewline,
  isWhitespace,
  nextPos,
  unicodeLength,
} from "./utils";

describe("Performance Tests", () => {
  describe("Unicode handling performance", () => {
    it("should handle large Unicode strings efficiently", () => {
      const largeUnicodeString = "こんにちは🌍世界".repeat(1000);
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        unicodeLength(largeUnicodeString);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 200ms (adjusted for slower systems)
      expect(duration).toBeLessThan(200);
    });

    it("should handle mixed ASCII and Unicode efficiently", () => {
      const mixedString = "Hello🌍Worldこんにちは".repeat(500);
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        unicodeLength(mixedString);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 200ms (adjusted for slower systems)
      expect(duration).toBeLessThan(200);
    });
  });

  describe("Position advancement performance", () => {
    it("should advance position efficiently for ASCII strings", () => {
      const asciiString = "Hello World".repeat(100);
      const pos = createPos();
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        advancePos(asciiString, pos);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 100ms (adjusted for slower systems)
      expect(duration).toBeLessThan(100);
    });

    it("should advance position efficiently for Unicode strings", () => {
      const unicodeString = "こんにちは🌍世界".repeat(50);
      const pos = createPos();
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        advancePos(unicodeString, pos);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 100ms
      expect(duration).toBeLessThan(100);
    });

    it("should handle newlines efficiently", () => {
      const multilineString = "Line 1\nLine 2\nLine 3\n".repeat(100);
      const pos = createPos();
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        advancePos(multilineString, pos);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 100ms (adjusted for slower systems)
      expect(duration).toBeLessThan(100);
    });
  });

  describe("Character extraction performance", () => {
    it("should extract characters efficiently from ASCII strings", () => {
      const asciiString = "Hello World".repeat(100);
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        for (let j = 0; j < Math.min(asciiString.length, 100); j++) {
          getCharAndLength(asciiString, j);
        }
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 100ms
      expect(duration).toBeLessThan(100);
    });

    it("should extract characters efficiently from Unicode strings", () => {
      const unicodeString = "こんにちは🌍世界".repeat(50);
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        for (let j = 0; j < Math.min(unicodeString.length, 50); j++) {
          getCharAndLength(unicodeString, j);
        }
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 100ms
      expect(duration).toBeLessThan(100);
    });
  });

  describe("Character classification performance", () => {
    it("should classify whitespace characters efficiently", () => {
      const whitespaceChars = " \t\n\r\f\v";
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        for (const char of whitespaceChars) {
          isWhitespace(char);
        }
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 50ms
      expect(duration).toBeLessThan(50);
    });

    it("should classify newline characters efficiently", () => {
      const newlineChars = "\n\r\r\n";
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        for (const char of newlineChars) {
          isNewline(char);
        }
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 50ms
      expect(duration).toBeLessThan(50);
    });
  });

  describe("Position creation performance", () => {
    it("should create positions efficiently", () => {
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        createPos(i, i % 100, Math.floor(i / 100) + 1);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 50ms
      expect(duration).toBeLessThan(50);
    });
  });

  describe("Memory usage tests", () => {
    it("should not leak memory during repeated operations", () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Perform many operations
      for (let i = 0; i < 1000; i++) {
        const pos = createPos();
        const unicodeString = "こんにちは🌍世界".repeat(10);
        advancePos(unicodeString, pos);
        unicodeLength(unicodeString);

        for (let j = 0; j < unicodeString.length; j++) {
          getCharAndLength(unicodeString, j);
        }
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 10MB)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });
  });

  describe("Stress tests", () => {
    it("should handle very large strings", () => {
      const largeString = "A".repeat(100000);
      const startTime = performance.now();

      const length = unicodeLength(largeString);
      const pos = advancePos(largeString, createPos());

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(length).toBe(100000);
      expect(pos.offset).toBe(100000);
      expect(duration).toBeLessThan(100); // Should complete within 100ms
    });

    it("should handle many small operations", () => {
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        const pos = createPos(i, i % 100, Math.floor(i / 100) + 1);
        const char = String.fromCharCode(i % 65536);
        nextPos(char, pos);
        unicodeLength(char);
        isWhitespace(char);
        isNewline(char);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 100ms
      expect(duration).toBeLessThan(100);
    });
  });

  describe("Edge case performance", () => {
    it("should handle empty strings efficiently", () => {
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        unicodeLength("");
        advancePos("", createPos());
        getCharAndLength("", 0);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 50ms
      expect(duration).toBeLessThan(50);
    });

    it("should handle single character strings efficiently", () => {
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        const char = String.fromCharCode(i % 65536);
        unicodeLength(char);
        advancePos(char, createPos());
        getCharAndLength(char, 0);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 50ms
      expect(duration).toBeLessThan(50);
    });
  });
});
