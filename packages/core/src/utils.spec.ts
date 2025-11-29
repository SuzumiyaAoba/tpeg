import { describe, expect, it } from "bun:test";
import { anyChar, literal } from "./basic";
import {
  advancePos,
  createFailure,
  createPos,
  extractValue,
  getCharAndLength,
  isEmptyArray,
  isFailure,
  isNewline,
  isNonEmptyArray,
  isSuccess,
  isWhitespace,
  nextPos,
  parse,
  safeExtractValue,
  unicodeLength,

} from "./utils";

describe("Utils", () => {
  describe("Array utilities", () => {
    describe("isEmptyArray", () => {
      it("should return true for empty arrays", () => {
        expect(isEmptyArray([])).toBe(true);
        expect(isEmptyArray([1, 2, 3])).toBe(false);
      });

      it("should work with readonly arrays", () => {
        const readonlyArray: readonly number[] = [];
        expect(isEmptyArray(readonlyArray)).toBe(true);
      });

      it("should work with different types", () => {
        expect(isEmptyArray([""])).toBe(false);
        expect(isEmptyArray([true, false])).toBe(false);
      });
    });

    describe("isNonEmptyArray", () => {
      it("should return true for non-empty arrays", () => {
        expect(isNonEmptyArray([1, 2, 3])).toBe(true);
        expect(isNonEmptyArray([])).toBe(false);
      });

      it("should provide type narrowing", () => {
        const arr: readonly number[] = [1, 2, 3];
        if (isNonEmptyArray(arr)) {
          // TypeScript should know arr is NonEmptyArray<number> here
          expect(arr[0]).toBe(1);
        }
      });

      it("should work with readonly arrays", () => {
        const readonlyArray: readonly string[] = ["hello"];
        expect(isNonEmptyArray(readonlyArray)).toBe(true);
      });
    });
  });

  describe("Character utilities", () => {
    describe("getCharAndLength", () => {
      it("should handle ASCII characters", () => {
        expect(getCharAndLength("Hello", 0)).toEqual(["H", 1]);
        expect(getCharAndLength("Hello", 1)).toEqual(["e", 1]);
      });

      it("should handle Unicode characters", () => {
        expect(getCharAndLength("こんにちは", 0)).toEqual(["こ", 1]);
        expect(getCharAndLength("🌍", 0)).toEqual(["🌍", 2]);
      });

      it("should handle out of bounds", () => {
        expect(getCharAndLength("Hello", 10)).toEqual(["", 0]);
        expect(getCharAndLength("Hello", -1)).toEqual(["", 0]);
      });

      it("should handle empty string", () => {
        expect(getCharAndLength("", 0)).toEqual(["", 0]);
      });
    });

    describe("nextPos", () => {
      it("should advance position for ASCII characters", () => {
        const pos = { offset: 0, column: 0, line: 1 };
        const next = nextPos("a", pos);
        expect(next).toEqual({ offset: 1, column: 1, line: 1 });
      });

      it("should handle newlines", () => {
        const pos = { offset: 0, column: 5, line: 1 };
        const next = nextPos("\n", pos);
        expect(next).toEqual({ offset: 1, column: 0, line: 2 });
      });

      it("should handle Unicode characters", () => {
        const pos = { offset: 0, column: 0, line: 1 };
        const next = nextPos("🌍", pos);
        expect(next).toEqual({ offset: 2, column: 1, line: 1 });
      });

      it("should handle carriage returns", () => {
        const pos = { offset: 0, column: 5, line: 1 };
        const next = nextPos("\r", pos);
        expect(next).toEqual({ offset: 1, column: 6, line: 1 });
      });
    });

    describe("advancePos", () => {
      it("should advance position by string length", () => {
        const pos = { offset: 0, column: 0, line: 1 };
        const next = advancePos("Hello", pos);
        expect(next).toEqual({ offset: 5, column: 5, line: 1 });
      });

      it("should handle newlines in string", () => {
        const pos = { offset: 0, column: 0, line: 1 };
        const next = advancePos("Hello\nWorld", pos);
        expect(next).toEqual({ offset: 11, column: 5, line: 2 });
      });

      it("should handle Unicode characters", () => {
        const pos = { offset: 0, column: 0, line: 1 };
        const next = advancePos("こんにちは", pos);
        expect(next).toEqual({ offset: 5, column: 5, line: 1 });
      });

      it("should handle mixed ASCII and Unicode", () => {
        const pos = { offset: 0, column: 0, line: 1 };
        const next = advancePos("Hello🌍World", pos);
        expect(next).toEqual({ offset: 12, column: 11, line: 1 });
      });

      it("should handle empty string", () => {
        const pos = { offset: 10, column: 5, line: 2 };
        const next = advancePos("", pos);
        expect(next).toEqual({ offset: 10, column: 5, line: 2 });
      });
    });

    describe("unicodeLength", () => {
      it("should return correct length for ASCII", () => {
        expect(unicodeLength("Hello")).toBe(5);
        expect(unicodeLength("")).toBe(0);
      });

      it("should return correct length for Unicode", () => {
        expect(unicodeLength("こんにちは")).toBe(5);
        expect(unicodeLength("🌍")).toBe(1);
        expect(unicodeLength("𝄞")).toBe(1);
      });

      it("should handle mixed content", () => {
        expect(unicodeLength("Hello🌍World")).toBe(11);
      });
    });

    describe("isWhitespace", () => {
      it("should identify whitespace characters", () => {
        expect(isWhitespace(" ")).toBe(true);
        expect(isWhitespace("\t")).toBe(true);
        expect(isWhitespace("\n")).toBe(true);
        expect(isWhitespace("\r")).toBe(true);
        expect(isWhitespace("\f")).toBe(true);
        expect(isWhitespace("\v")).toBe(true);
      });

      it("should reject non-whitespace characters", () => {
        expect(isWhitespace("a")).toBe(false);
        expect(isWhitespace("1")).toBe(false);
        expect(isWhitespace("!")).toBe(false);
        expect(isWhitespace("こ")).toBe(false);
      });
    });

    describe("isNewline", () => {
      it("should identify newline characters", () => {
        expect(isNewline("\n")).toBe(true);
        expect(isNewline("\r")).toBe(true);
        // CRLF is two characters and should be evaluated per char
        expect(isNewline("\r\n")).toBe(false);
      });

      it("should reject non-newline characters", () => {
        expect(isNewline(" ")).toBe(false);
        expect(isNewline("\t")).toBe(false);
        expect(isNewline("a")).toBe(false);
      });
    });
  });

  describe("Position utilities", () => {
    describe("createPos", () => {
      it("should create position with defaults", () => {
        expect(createPos()).toEqual({ offset: 0, column: 0, line: 1 });
      });

      it("should create position with custom values", () => {
        expect(createPos(10, 5, 2)).toEqual({ offset: 10, column: 5, line: 2 });
      });

      it("should handle partial parameters", () => {
        expect(createPos(5)).toEqual({ offset: 5, column: 0, line: 1 });
        expect(createPos(5, 3)).toEqual({ offset: 5, column: 3, line: 1 });
      });
    });
  });

  describe("Parse result utilities", () => {
    describe("isSuccess", () => {
      it("should identify successful parse results", () => {
        const success = {
          success: true,
          val: "test",
          current: { offset: 0, column: 0, line: 1 },
          next: { offset: 4, column: 4, line: 1 },
        } as const;
        expect(isSuccess(success)).toBe(true);
      });

      it("should identify failed parse results", () => {
        const failure = {
          success: false,
          error: {
            message: "Parse failed",
            pos: { offset: 0, column: 0, line: 1 },
          },
        } as const;
        expect(isSuccess(failure)).toBe(false);
      });
    });

    describe("isFailure", () => {
      it("should identify failed parse results", () => {
        const failure = {
          success: false,
          error: {
            message: "Parse failed",
            pos: { offset: 0, column: 0, line: 1 },
          },
        } as const;
        expect(isFailure(failure)).toBe(true);
      });

      it("should identify successful parse results", () => {
        const success = {
          success: true,
          val: "test",
          current: { offset: 0, column: 0, line: 1 },
          next: { offset: 4, column: 4, line: 1 },
        } as const;
        expect(isFailure(success)).toBe(false);
      });
    });

    describe("extractValue", () => {
      it("should extract value from successful result", () => {
        const success = {
          success: true,
          val: "test",
          current: { offset: 0, column: 0, line: 1 },
          next: { offset: 4, column: 4, line: 1 },
        } as const;
        expect(extractValue(success)).toBe("test");
      });

      it("should throw error for failed result", () => {
        const failure = {
          success: false,
          error: {
            message: "Parse failed",
            pos: { offset: 0, column: 0, line: 1 },
          },
        } as const;
        expect(() => extractValue(failure)).toThrow(
          "Parse failed: Parse failed",
        );
      });
    });

    describe("safeExtractValue", () => {
      it("should extract value from successful result", () => {
        const success = {
          success: true,
          val: "test",
          current: { offset: 0, column: 0, line: 1 },
          next: { offset: 4, column: 4, line: 1 },
        } as const;
        expect(safeExtractValue(success)).toBe("test");
      });

      it("should return undefined for failed result", () => {
        const failure = {
          success: false,
          error: {
            message: "Parse failed",
            pos: { offset: 0, column: 0, line: 1 },
          },
        } as const;
        expect(safeExtractValue(failure)).toBeUndefined();
      });
    });
  });

  describe("Parse utilities", () => {
    describe("parse", () => {
      it("should create a parse function", () => {
        const parseFn = parse(anyChar());
        expect(typeof parseFn).toBe("function");
      });

      it("should parse input correctly", () => {
        const parseFn = parse(literal("hello"));
        const result = parseFn("hello world");
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe("hello");
        }
      });

      it("should handle parse failures", () => {
        const parseFn = parse(literal("hello"));
        const result = parseFn("world");
        expect(result.success).toBe(false);
      });
    });
  });

  describe("Error utilities", () => {
    describe("createFailure", () => {
      it("should create a failure result", () => {
        const pos = { offset: 0, column: 0, line: 1 };
        const failure = createFailure("Test error", pos);
        expect(failure.success).toBe(false);
        expect(failure.error.message).toBe("Test error");
        expect(failure.error.pos).toEqual(pos);
      });

      it("should include optional error details", () => {
        const pos = { offset: 0, column: 0, line: 1 };
        const failure = createFailure("Test error", pos, {
          expected: ["hello", "world"],
          found: "test",
          parserName: "testParser",
        });
        expect(failure.error.expected).toEqual(["hello", "world"]);
        expect(failure.error.found).toBe("test");
        expect(failure.error.parserName).toBe("testParser");
      });
    });
  });

  describe("Edge cases and error handling", () => {
    it("should handle empty input gracefully", () => {
      expect(getCharAndLength("", 0)).toEqual(["", 0]);
      expect(unicodeLength("")).toBe(0);
    });

    it("should handle null/undefined gracefully", () => {
      // These functions should handle edge cases without throwing
      expect(() => createPos()).not.toThrow();
      expect(() =>
        createFailure("test", { offset: 0, column: 0, line: 1 }),
      ).not.toThrow();
    });

    it("should handle Unicode surrogate pairs correctly", () => {
      const emoji = "🌍";
      expect(unicodeLength(emoji)).toBe(1);
      expect(getCharAndLength(emoji, 0)).toEqual([emoji, 2]);
    });

    it("should handle complex Unicode sequences", () => {
      const complex = "こんにちは🌍世界";
      expect(unicodeLength(complex)).toBe(8);
    });
  });
});


