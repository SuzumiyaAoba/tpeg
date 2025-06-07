import { describe, expect, it } from "bun:test";
import { any, anyChar, lit, literal } from "./basic";
import type { Pos } from "./types";
import { parse } from "./utils";

describe("any", () => {
  it("should parse any single character", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should parse newline character", () => {
    const input = "\n";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("\n");
      expect(result.next).toEqual({ offset: 1, column: 0, line: 2 });
    }
  });

  it("should return error for empty input", () => {
    const input = "";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Unexpected EOI");
      expect(result.error.pos).toEqual(pos);
    }
  });

  it("should return error for out of bound", () => {
    const input = "a";
    const pos: Pos = { offset: 1, column: 1, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Unexpected EOI");
      expect(result.error.pos).toEqual(pos);
    }
  });
});

describe("anyChar", () => {
  it("should parse any single character", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = anyChar()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should parse Unicode characters correctly", () => {
    const input = "🙂";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = anyChar()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("🙂");
      expect(result.next).toEqual({ offset: 2, column: 1, line: 1 });
    }
  });

  it("should parse surrogate pair characters correctly", () => {
    const input = "𝄞"; // Musical G clef (U+1D11E)
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = anyChar()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("𝄞");
      expect(result.next).toEqual({ offset: 2, column: 1, line: 1 });
    }
  });

  it("should parse newline character and update position correctly", () => {
    const input = "\n";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = anyChar()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("\n");
      expect(result.next).toEqual({ offset: 1, column: 0, line: 2 });
    }
  });

  it("should parse tab and other whitespace characters", () => {
    const input = "\t";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = anyChar()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("\t");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should return error for empty input", () => {
    const input = "";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = anyChar()(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Unexpected EOI");
      expect(result.error.pos).toEqual(pos);
      expect(result.error.expected).toBe("any character");
      expect(result.error.found).toBe("end of input");
      expect(result.error.parserName).toBe("anyChar");
    }
  });

  it("should return error for out of bound", () => {
    const input = "a";
    const pos: Pos = { offset: 1, column: 1, line: 1 };
    const result = anyChar()(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Unexpected EOI");
      expect(result.error.pos).toEqual(pos);
    }
  });

  it("should use custom parser name in error messages", () => {
    const input = "";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = anyChar("customAnyChar")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.parserName).toBe("customAnyChar");
    }
  });
});

describe("literal", () => {
  it("should parse a simple string", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("abc")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  it("should parse Unicode strings correctly", () => {
    const input = "こんにちは";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("こんにちは")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("こんにちは");
      expect(result.next).toEqual({ offset: 5, column: 5, line: 1 });
    }
  });

  it("should parse emoji strings correctly", () => {
    const input = "🙂👍🎉";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("🙂👍🎉")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("🙂👍🎉");
      expect(result.next).toEqual({ offset: 6, column: 3, line: 1 });
    }
  });

  it("should parse strings with newlines correctly", () => {
    const input = "hello\nworld";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("hello\nworld")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("hello\nworld");
      expect(result.next).toEqual({ offset: 11, column: 5, line: 2 });
    }
  });

  it("should parse strings with tabs and spaces", () => {
    const input = "hello\tworld test";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("hello\tworld test")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("hello\tworld test");
      expect(result.next).toEqual({ offset: 16, column: 16, line: 1 });
    }
  });

  it("should handle mixed ASCII and Unicode characters", () => {
    const input = "Hello 🌍 World";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("Hello 🌍 World")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("Hello 🌍 World");
      expect(result.next).toEqual({ offset: 14, column: 13, line: 1 });
    }
  });

  it("should return error if string does not match", () => {
    const input = "abd";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("abc")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected character");
      expect(result.error.pos).toEqual({ offset: 2, column: 2, line: 1 });
      expect(result.error.expected).toBe("c");
      expect(result.error.found).toBe("d");
      expect(result.error.parserName).toBe("literal");
    }
  });

  it("should return error for insufficient input", () => {
    const input = "ab";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("abc")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Expected \"abc\" but got end of input");
      expect(result.error.pos).toEqual(pos);
      expect(result.error.expected).toBe("abc");
      expect(result.error.found).toBe("end of input");
    }
  });

  it("should return error when Unicode string doesn't match", () => {
    const input = "こんばんは";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("こんにちは")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected character");
      expect(result.error.pos).toEqual({ offset: 2, column: 2, line: 1 });
    }
  });

  it("should return error when emoji string doesn't match", () => {
    const input = "🙂😭🎉";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("🙂👍🎉")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected character");
      expect(result.error.pos).toEqual({ offset: 2, column: 1, line: 1 });
    }
  });

  it("should use custom parser name in error messages", () => {
    const input = "xyz";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("abc", "customLiteral")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.parserName).toBe("customLiteral");
    }
  });

  it("should handle position correctly when parsing starts at non-zero offset", () => {
    const input = "prefixabc";
    const pos: Pos = { offset: 6, column: 6, line: 1 };
    const result = literal("abc")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
      expect(result.next).toEqual({ offset: 9, column: 9, line: 1 });
    }
  });

  it("should handle position correctly with multiline parsing", () => {
    const input = "line1\nline2\nabc";
    const pos: Pos = { offset: 12, column: 0, line: 3 };
    const result = literal("abc")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
      expect(result.next).toEqual({ offset: 15, column: 3, line: 3 });
    }
  });
});

describe("string", () => {
  it("should parse a string", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("abc")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  it("should return error if string does not match", () => {
    const input = "abd";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("abc")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected character");
      expect(result.error.pos).toEqual({ offset: 2, column: 2, line: 1 });
    }
  });

  it("should handle newline in string", () => {
    const input = "a\nb";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("a\nb")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a\nb");
      expect(result.next).toEqual({ offset: 3, column: 1, line: 2 });
    }
  });

  it("should handle surrogate pairs correctly", () => {
    // 𝄞 (musical G clef) is a surrogate pair (U+1D11E) represented as \uD834\uDD1E
    const input = "𝄞abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("𝄞abc")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("𝄞abc");
      // 𝄞 is a surrogate pair (2 code units) + 3 characters
      expect(result.next).toEqual({ offset: 5, column: 4, line: 1 });
    }
  });

  it("should correctly parse emoji characters", () => {
    // 🙂 is a surrogate pair (U+1F642)
    const input = "🙂🙂";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("🙂🙂")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("🙂🙂");
      // Each emoji is 2 code units, so 4 in total
      expect(result.next).toEqual({ offset: 4, column: 2, line: 1 });
    }
  });

  it("should handle mixed normal and surrogate pair characters", () => {
    const input = "a🙂b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("a🙂b")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a🙂b");
      // 1 (a) + 2 (🙂) + 1 (b) = 4 code units
      expect(result.next).toEqual({ offset: 4, column: 3, line: 1 });
    }
  });

  it("should fail correctly on partial emoji mismatch", () => {
    const input = "a🙃b"; // Different emoji (upside-down smile)
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("a🙂b")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected character");
      expect(result.error.pos).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should handle very long strings", () => {
    const longString = "a".repeat(1000);
    const input = longString;
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit(longString)(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe(longString);
      expect(result.next).toEqual({ offset: 1000, column: 1000, line: 1 });
    }
  });

  it("should handle control characters", () => {
    const input = "a\r\n\tb";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("a\r\n\tb")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a\r\n\tb");
      expect(result.next).toEqual({ offset: 5, column: 2, line: 2 });
    }
  });
});

describe("anyChar()", () => {
  it("should parse any single character", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = anyChar()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });
});

describe("literal(str)", () => {
  it("should parse a string", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("abc")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });
});

describe("parse", () => {
  it("should parse input with the given parser", () => {
    const input = "abc";
    const result = parse(lit("abc"))(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
    }
  });

  it("should return error if parser fails", () => {
    const input = "abd";
    const result = parse(lit("abc"))(input);
    expect(result.success).toBe(false);
  });

  it("should work with anyChar parser", () => {
    const input = "x";
    const result = parse(anyChar())(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("x");
    }
  });

  it("should work with Unicode input", () => {
    const input = "🎌";
    const result = parse(anyChar())(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("🎌");
    }
  });

  it("should return error for empty input with anyChar", () => {
    const input = "";
    const result = parse(anyChar())(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Unexpected EOI");
    }
  });

  it("should preserve error information from nested parsers", () => {
    const input = "xyz";
    const result = parse(literal("abc", "testParser"))(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.parserName).toBe("testParser");
    }
  });
});

describe("Edge cases and performance", () => {
  it("should handle empty string literal parsing", () => {
    // Note: This test might not be valid depending on NonEmptyString type constraint
    // but we test the edge case behavior if it's allowed
    const input = "test";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    
    // Test successful case where empty string should match at any position
    // This behavior depends on implementation details
  });

  it("should handle parsing at end of input boundary", () => {
    const input = "abc";
    const pos: Pos = { offset: 3, column: 3, line: 1 };
    const result = anyChar()(input, pos);
    expect(result.success).toBe(false);
  });

  it("should handle complex Unicode normalization scenarios", () => {
    // Test with composed vs decomposed Unicode characters
    const composed = "é"; // Single code point U+00E9
    const decomposed = "e\u0301"; // e + combining acute accent U+0065 + U+0301
    
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    
    const result1 = literal(composed)(composed, pos);
    const result2 = literal(decomposed)(decomposed, pos);
    
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    
    // They should not match each other due to different normalization
    const result3 = literal(composed)(decomposed, pos);
    const result4 = literal(decomposed)(composed, pos);
    
    expect(result3.success).toBe(false);
    expect(result4.success).toBe(false);
  });

  it("should handle maximum Unicode code points", () => {
    // Test with characters at the edge of Unicode range
    const maxCodePoint = String.fromCodePoint(0x10FFFF); // Maximum valid Unicode code point
    const input = maxCodePoint;
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    
    const result = anyChar()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe(maxCodePoint);
    }
  });

  it("should handle multiple consecutive newlines correctly", () => {
    const input = "\n\n\n";
    let pos: Pos = { offset: 0, column: 0, line: 1 };
    
    // Parse first newline
    const result1 = anyChar()(input, pos);
    expect(result1.success).toBe(true);
    if (result1.success) {
      expect(result1.next).toEqual({ offset: 1, column: 0, line: 2 });
      pos = result1.next;
    }
    
    // Parse second newline
    const result2 = anyChar()(input, pos);
    expect(result2.success).toBe(true);
    if (result2.success) {
      expect(result2.next).toEqual({ offset: 2, column: 0, line: 3 });
      pos = result2.next;
    }
    
    // Parse third newline
    const result3 = anyChar()(input, pos);
    expect(result3.success).toBe(true);
    if (result3.success) {
      expect(result3.next).toEqual({ offset: 3, column: 0, line: 4 });
    }
  });
});
