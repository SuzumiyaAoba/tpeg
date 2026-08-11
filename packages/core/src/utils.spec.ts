import { describe, expect, it } from "bun:test";
import { anyChar, literal } from "./basic";
import {
  advancePos,
  createFailure,
  createPos,
  extractValue,
  getCharAndLength,
  getCharAt,
  isEmptyArray,
  isFailure,
  isNewline,
  isNonEmptyArray,
  isSuccess,
  isWhitespace,
  nextPos,
  offsetToPos,
  parse,
  prependContext,
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

    describe("getCharAt", () => {
      it("returns the character at offset, unlike getCharAndLength no tuple allocated", () => {
        expect(getCharAt("Hello", 0)).toBe("H");
        expect(getCharAt("Hello", 1)).toBe("e");
      });

      it("returns a full astral character (surrogate pair) as one string", () => {
        expect(getCharAt("🌍", 0)).toBe("🌍");
        expect(getCharAt("a🌍b", 1)).toBe("🌍");
      });

      it("returns empty string when out of bounds", () => {
        expect(getCharAt("Hello", 10)).toBe("");
        expect(getCharAt("Hello", -1)).toBe("");
        expect(getCharAt("", 0)).toBe("");
      });

      it("agrees with getCharAndLength's first tuple element for every offset", () => {
        const input = "a🌍b世界";
        for (let i = 0; i <= input.length; i++) {
          expect(getCharAt(input, i)).toBe(getCharAndLength(input, i)[0]);
        }
      });
    });

    describe("nextPos", () => {
      it("should advance position for ASCII characters", () => {
        const pos = 0;
        const next = nextPos("a", pos);
        expect(next).toBe(1);
      });

      it("should handle newlines", () => {
        const pos = 0;
        const next = nextPos("\n", pos);
        expect(next).toBe(1);
      });

      it("should handle Unicode characters", () => {
        const pos = 0;
        const next = nextPos("🌍", pos);
        expect(next).toBe(2);
      });

      it("should handle carriage returns", () => {
        const pos = 0;
        const next = nextPos("\r", pos);
        expect(next).toBe(1);
      });
    });

    describe("advancePos", () => {
      it("should advance position by string length", () => {
        const pos = 0;
        const next = advancePos("Hello", pos);
        expect(next).toBe(5);
      });

      it("should handle newlines in string", () => {
        const pos = 0;
        const next = advancePos("Hello\nWorld", pos);
        expect(next).toBe(11);
      });

      it("should handle Unicode characters", () => {
        const pos = 0;
        const next = advancePos("こんにちは", pos);
        expect(next).toBe(5);
      });

      it("should handle mixed ASCII and Unicode", () => {
        const pos = 0;
        const next = advancePos("Hello🌍World", pos);
        expect(next).toBe(12);
      });

      it("should handle empty string", () => {
        const pos = 10;
        const next = advancePos("", pos);
        expect(next).toBe(10);
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
        expect(createPos()).toBe(0);
      });

      it("should create position with custom values", () => {
        expect(createPos(10)).toBe(10);
      });

      it("should handle partial parameters", () => {
        expect(createPos(5)).toBe(5);
        expect(createPos(5)).toBe(5);
      });
    });
  });

  describe("Parse result utilities", () => {
    describe("isSuccess", () => {
      it("should identify successful parse results", () => {
        const success = {
          success: true,
          val: "test",
          current: 0,
          next: 4,
        } as const;
        expect(isSuccess(success)).toBe(true);
      });

      it("should identify failed parse results", () => {
        const failure = {
          success: false,
          error: {
            message: "Parse failed",
            pos: 0,
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
            pos: 0,
          },
        } as const;
        expect(isFailure(failure)).toBe(true);
      });

      it("should identify successful parse results", () => {
        const success = {
          success: true,
          val: "test",
          current: 0,
          next: 4,
        } as const;
        expect(isFailure(success)).toBe(false);
      });
    });

    describe("extractValue", () => {
      it("should extract value from successful result", () => {
        const success = {
          success: true,
          val: "test",
          current: 0,
          next: 4,
        } as const;
        expect(extractValue(success)).toBe("test");
      });

      it("should throw error for failed result", () => {
        const failure = {
          success: false,
          error: {
            message: "Parse failed",
            pos: 0,
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
          current: 0,
          next: 4,
        } as const;
        expect(safeExtractValue(success)).toBe("test");
      });

      it("should return undefined for failed result", () => {
        const failure = {
          success: false,
          error: {
            message: "Parse failed",
            pos: 0,
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
        const pos = 0;
        const failure = createFailure("Test error", pos);
        expect(failure.success).toBe(false);
        expect(failure.error.message).toBe("Test error");
        expect(failure.error.pos).toEqual(pos);
      });

      it("should include optional error details", () => {
        const pos = 0;
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

  describe("offsetToPos", () => {
    it("returns line 1, column 0 at the very start of a single-line input", () => {
      expect(offsetToPos("abc", 0)).toEqual({ offset: 0, line: 1, column: 0 });
    });

    it("counts columns within the first line before any newline", () => {
      expect(offsetToPos("abc", 2)).toEqual({ offset: 2, line: 1, column: 2 });
    });

    it("advances the line number past each newline and resets the column", () => {
      expect(offsetToPos("ab\ncd", 0)).toEqual({
        offset: 0,
        line: 1,
        column: 0,
      });
      // Offset 3 is right after the newline, at the start of line 2.
      expect(offsetToPos("ab\ncd", 3)).toEqual({
        offset: 3,
        line: 2,
        column: 0,
      });
      expect(offsetToPos("ab\ncd", 4)).toEqual({
        offset: 4,
        line: 2,
        column: 1,
      });
    });

    it("counts multiple lines correctly", () => {
      const input = "line1\nline2\nline3";
      expect(offsetToPos(input, 0).line).toBe(1);
      expect(offsetToPos(input, 6).line).toBe(2); // right after first \n
      expect(offsetToPos(input, 12).line).toBe(3); // right after second \n
    });

    it("counts a column in CODE POINTS, not UTF-16 code units, on a line containing an astral character", () => {
      // "a🌍b" -- the emoji is 2 UTF-16 code units but must count as ONE
      // column, matching what per-character `nextPos` used to produce
      // (see the function's own doc comment).
      const input = "a🌍b";
      expect(offsetToPos(input, 0).column).toBe(0); // "a"
      expect(offsetToPos(input, 1).column).toBe(1); // "🌍" starts here
      expect(offsetToPos(input, 3).column).toBe(2); // "b" -- 1 column past the emoji, not 2
    });

    it("is consistent with a manual walk via getCharAndLength across a mixed-content multi-line input", () => {
      const input = "ab\ncd🌍\nef";
      let offset = 0;
      let line = 1;
      let column = 0;
      for (const ch of ["a", "b", "\n", "c", "d", "🌍", "\n", "e", "f"]) {
        expect(offsetToPos(input, offset)).toEqual({ offset, line, column });
        offset += ch.length;
        if (ch === "\n") {
          line++;
          column = 0;
        } else {
          column++;
        }
      }
    });
  });

  describe("prependContext", () => {
    it("wraps a single label into a one-element array when context is undefined", () => {
      expect(prependContext("in sequence", undefined)).toEqual(["in sequence"]);
    });

    it("prepends a single label to a single-string context", () => {
      expect(prependContext("in sequence", "inner")).toEqual([
        "in sequence",
        "inner",
      ]);
    });

    it("prepends a single label to an array context, preserving order", () => {
      expect(prependContext("in sequence", ["a", "b"])).toEqual([
        "in sequence",
        "a",
        "b",
      ]);
    });

    it("prepends an array of labels, outermost first, ahead of the existing context", () => {
      expect(prependContext(["outer", "inner"], ["a", "b"])).toEqual([
        "outer",
        "inner",
        "a",
        "b",
      ]);
    });

    it("returns just the labels, flattened, when both labels and context are arrays and context is empty", () => {
      expect(prependContext(["a", "b"], [])).toEqual(["a", "b"]);
    });

    it("never mutates its inputs", () => {
      const labels = ["a", "b"];
      const context = ["c", "d"];
      const result = prependContext(labels, context);
      expect(result).toEqual(["a", "b", "c", "d"]);
      expect(labels).toEqual(["a", "b"]);
      expect(context).toEqual(["c", "d"]);
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
      expect(() => createFailure("test", 0)).not.toThrow();
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
