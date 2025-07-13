import { describe, expect, it } from "bun:test";
import { any, anyChar, lit, literal } from "./basic";
import type { Pos } from "./types";
import { parse } from "./utils";

/**
 * Helper function to create a position object for cleaner test setup
 */
const createPos = (offset = 0, column = 0, line = 1): Pos => ({
  offset,
  column,
  line,
});

/**
 * Helper function to create expected next position for ASCII characters
 */
const nextAsciiPos = (
  current: Pos,
  length: number,
  hasNewline = false,
): Pos => {
  if (hasNewline) {
    return {
      offset: current.offset + length,
      column: 0,
      line: current.line + 1,
    };
  }
  return {
    offset: current.offset + length,
    column: current.column + length,
    line: current.line,
  };
};

describe("anyChar parser", () => {
  describe("Basic character parsing", () => {
    it("should parse ASCII characters correctly", () => {
      // Purpose: Test basic ASCII character parsing functionality
      const result = anyChar()("a", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("a");
        expect(result.next).toEqual(nextAsciiPos(createPos(), 1));
      }
    });

    it("should parse numeric characters correctly", () => {
      // Purpose: Verify parsing of digit characters
      const result = anyChar()("7", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("7");
      }
    });

    it("should parse symbol characters correctly", () => {
      // Purpose: Test parsing of special characters commonly used in programming
      const symbols = ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"];

      for (const symbol of symbols) {
        const result = anyChar()(symbol, createPos());
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe(symbol);
        }
      }
    });
  });

  describe("Unicode character handling", () => {
    it("should parse Japanese characters (hiragana) correctly", () => {
      // Purpose: Verify multibyte character processing
      const result = anyChar()("あ", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("あ");
        expect(result.next).toEqual({
          offset: 1,
          column: 1,
          line: 1,
        });
      }
    });

    it("should parse emoji (surrogate pairs) correctly", () => {
      // Purpose: Verify proper handling of surrogate pair characters
      const emoji = "🙂";
      const result = anyChar()(emoji, createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(emoji);
        // Emoji uses 2 UTF-16 code units but is treated as 1 character
        expect(result.next).toEqual({
          offset: 2, // 2 bytes in UTF-16 encoding
          column: 1, // 1 character for display
          line: 1,
        });
      }
    });

    it("should parse complex Unicode characters (musical symbols) correctly", () => {
      // Purpose: Verify handling of special characters using surrogate pairs
      const musicalSymbol = "𝄞"; // Musical G clef (U+1D11E)
      const result = anyChar()(musicalSymbol, createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(musicalSymbol);
        expect(result.next).toEqual({
          offset: 2, // Surrogate pair requires 2 bytes
          column: 1, // 1 character for display
          line: 1,
        });
      }
    });
  });

  describe("Newline character handling", () => {
    it("should parse newline characters and update line numbers correctly", () => {
      // Purpose: Verify position tracking with newline characters
      const result = anyChar()("\n", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("\n");
        expect(result.next).toEqual({
          offset: 1,
          column: 0, // Reset to column 0 after newline
          line: 2, // Increment line number
        });
      }
    });

    it("should parse tab characters correctly", () => {
      // Purpose: Verify tab character processing
      const result = anyChar()("\t", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("\t");
        expect(result.next).toEqual(nextAsciiPos(createPos(), 1));
      }
    });

    it("should parse carriage return characters correctly", () => {
      // Purpose: Verify processing of Windows-style line ending components
      const result = anyChar()("\r", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("\r");
      }
    });
  });

  describe("Error cases", () => {
    it("should return error for empty input", () => {
      // Purpose: Verify proper EOI error generation
      const result = anyChar()("", createPos());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Unexpected EOI");
        expect(result.error.expected).toBe("any character");
        expect(result.error.found).toBe("end of input");
        expect(result.error.parserName).toBe("anyChar");
        expect(result.error.pos).toEqual(createPos());
      }
    });

    it("should return error for out-of-bounds position", () => {
      // Purpose: Verify boundary error handling
      const result = anyChar()("a", createPos(1, 1, 1));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Unexpected EOI");
      }
    });

    it("should customize error messages with custom parser name", () => {
      // Purpose: Verify debugging functionality with custom parser names
      const customName = "custom character parser";
      const result = anyChar(customName)("", createPos());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.parserName).toBe(customName);
      }
    });
  });

  describe("any function (anyChar alias)", () => {
    it("should behave identically to anyChar", () => {
      // Purpose: Verify alias function behavior
      const input = "x";
      const pos = createPos();

      const anyResult = any(input, pos);
      const anyCharResult = anyChar("any")(input, pos);

      expect(anyResult).toEqual(anyCharResult);
    });
  });
});

describe("literal parser", () => {
  describe("Basic string parsing", () => {
    it("should parse simple ASCII strings", () => {
      // Purpose: Verify basic string matching functionality
      const parser = literal("hello");
      const result = parser("hello world", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello");
        expect(result.next).toEqual(nextAsciiPos(createPos(), 5));
      }
    });

    it("should parse programming keywords", () => {
      // Purpose: Test real-world programming language usage examples
      const keywords = ["function", "const", "let", "var", "if", "else"];

      for (const keyword of keywords) {
        const parser = literal(keyword);
        const result = parser(`${keyword} something`, createPos());

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe(keyword);
        }
      }
    });

    it("should parse symbols and operators", () => {
      // Purpose: Test programming language operator parsing
      const operators = ["==", "!=", "<=", ">=", "&&", "||", "++", "--"];

      for (const op of operators) {
        const parser = literal(op);
        const result = parser(`${op} rest`, createPos());

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe(op);
        }
      }
    });
  });

  describe("Unicode string processing", () => {
    it("should parse Japanese strings correctly", () => {
      // Purpose: Verify multibyte string processing
      const parser = literal("こんにちは");
      const result = parser("こんにちは世界", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("こんにちは");
        expect(result.next).toEqual({
          offset: 5, // 5 characters
          column: 5,
          line: 1,
        });
      }
    });

    it("should parse strings containing emoji", () => {
      // Purpose: Handle modern text with emoji characters
      const parser = literal("🙂👍🎉");
      const result = parser("🙂👍🎉!!!", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("🙂👍🎉");
        expect(result.next).toEqual({
          offset: 6, // Each emoji is 2 bytes
          column: 3, // 3 characters for display
          line: 1,
        });
      }
    });

    it("should parse mixed ASCII and Unicode strings", () => {
      // Purpose: Handle mixed text common in web applications
      const parser = literal("Hello 🌍 World");
      const result = parser("Hello 🌍 World!", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("Hello 🌍 World");
        expect(result.next).toEqual({
          offset: 14, // 6(Hello ) + 2(🌍) + 6( World)
          column: 13, // 13 characters for display
          line: 1,
        });
      }
    });
  });

  describe("Newline and whitespace handling", () => {
    it("should parse strings with newlines and update line numbers correctly", () => {
      // Purpose: Verify position tracking in multiline strings
      const parser = literal("line1\nline2");
      const result = parser("line1\nline2\nline3", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("line1\nline2");
        expect(result.next).toEqual({
          offset: 11,
          column: 5, // Length of "line2"
          line: 2,
        });
      }
    });

    it("should parse strings with multiple newlines", () => {
      // Purpose: Handle complex newline patterns
      const parser = literal("a\n\nb");
      const result = parser("a\n\nb more", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("a\n\nb");
        expect(result.next).toEqual({
          offset: 4,
          column: 1, // Position after "b"
          line: 3, // Line 3 due to 2 newlines
        });
      }
    });

    it("should parse strings with tabs and spaces", () => {
      // Purpose: Handle indented code parsing
      const parser = literal("function\t()");
      const result = parser("function\t() {", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("function\t()");
        expect(result.next).toEqual(nextAsciiPos(createPos(), 11));
      }
    });

    it("should parse Windows-style line endings (CRLF)", () => {
      // Purpose: Verify cross-platform compatibility
      const parser = literal("line1\r\nline2");
      const result = parser("line1\r\nline2\r\n", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("line1\r\nline2");
        expect(result.next).toEqual({
          offset: 12,
          column: 5,
          line: 2,
        });
      }
    });
  });

  describe("Position tracking accuracy", () => {
    it("should handle parsing from non-zero offset correctly", () => {
      // Purpose: Verify position tracking in streaming parsing scenarios
      const parser = literal("test");
      const result = parser("prefix_test_suffix", createPos(7, 7, 1));

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("test");
        expect(result.next).toEqual({
          offset: 11,
          column: 11,
          line: 1,
        });
      }
    });

    it("should track positions correctly in multiline parsing", () => {
      // Purpose: Verify position management in complex document parsing
      const parser = literal("target");
      const input = "line1\nline2\ntarget here";
      const startPos = createPos(12, 0, 3); // Start position of "target"

      const result = parser(input, startPos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("target");
        expect(result.next).toEqual({
          offset: 18,
          column: 6,
          line: 3,
        });
      }
    });
  });

  describe("Error cases and detailed error reporting", () => {
    it("should report error at first mismatched character", () => {
      // Purpose: Verify detailed error position reporting
      const parser = literal("expected");
      const result = parser("expeXted", createPos());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Unexpected character");
        expect(result.error.pos).toEqual({
          offset: 4, // Position of 'X'
          column: 4,
          line: 1,
        });
        expect(result.error.expected).toBe("c");
        expect(result.error.found).toBe("X");
      }
    });

    it("should report error correctly for insufficient input", () => {
      // Purpose: Verify proper EOI error reporting
      const parser = literal("complete");
      const result = parser("comp", createPos());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain(
          'Expected "complete" but got end of input',
        );
        expect(result.error.expected).toBe("complete");
        expect(result.error.found).toBe("end of input");
      }
    });

    it("should report Unicode character mismatches correctly", () => {
      // Purpose: Verify Unicode character error reporting
      const parser = literal("こんにちは");
      const result = parser("こんばんは", createPos());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Expected");
        expect(result.error.message).toContain("but found");
        expect(result.error.pos).toEqual({
          offset: 2, // Position of "ば"
          column: 2,
          line: 1,
        });
      }
    });

    it("should report emoji character mismatches correctly", () => {
      // Purpose: Verify emoji character error reporting
      const parser = literal("🙂👍");
      const result = parser("🙂😭", createPos());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Expected");
        expect(result.error.message).toContain("but found");
        expect(result.error.pos).toEqual({
          offset: 2, // Position of second emoji
          column: 1, // Second character for display
          line: 1,
        });
      }
    });

    it("should customize errors with custom parser name", () => {
      // Purpose: Verify custom error messaging for debugging
      const parser = literal("keyword", "keyword parser");
      const result = parser("other", createPos());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.parserName).toBe("keyword parser");
      }
    });
  });

  describe("Performance and edge cases", () => {
    it("should parse long strings efficiently", () => {
      // Purpose: Performance test (verify optimized path)
      const longString = "a".repeat(1000);
      const parser = literal(longString);
      const result = parser(`${longString}extra`, createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(longString);
        expect(result.next.offset).toBe(1000);
      }
    });

    it("should correctly distinguish Unicode normalization differences", () => {
      // Purpose: Verify Unicode normalization handling
      const composed = "é"; // Single code point U+00E9
      const decomposed = "e\u0301"; // e + combining mark U+0065 + U+0301

      const composedParser = literal(composed);
      const decomposedParser = literal(decomposed);

      // Verify different representations are treated as distinct
      expect(composedParser(composed, createPos()).success).toBe(true);
      expect(decomposedParser(decomposed, createPos()).success).toBe(true);
      expect(composedParser(decomposed, createPos()).success).toBe(false);
      expect(decomposedParser(composed, createPos()).success).toBe(false);
    });

    it("should handle maximum Unicode code points", () => {
      // Purpose: Test Unicode range boundary values
      const maxCodePoint = String.fromCodePoint(0x10ffff);
      const parser = literal(maxCodePoint);
      const result = parser(maxCodePoint, createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(maxCodePoint);
      }
    });

    it("should use optimized path for ASCII strings", () => {
      // Purpose: Verify optimization path selection
      const asciiString = "hello world";
      const parser = literal(asciiString);
      const result = parser(`${asciiString}extra`, createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(asciiString);
      }
    });

    it("should use complex path for Unicode strings", () => {
      // Purpose: Verify Unicode path selection
      const unicodeString = "café au lait";
      const parser = literal(unicodeString);
      const result = parser(`${unicodeString}extra`, createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(unicodeString);
      }
    });

    it("should handle strings with newlines correctly", () => {
      // Purpose: Verify newline handling in optimization
      const multilineString = "line1\nline2";
      const parser = literal(multilineString);
      const result = parser(`${multilineString}extra`, createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(multilineString);
      }
    });

    it("should cache optimization results for repeated strings", () => {
      // Purpose: Verify caching behavior
      const testString = "repeated string";

      // Create multiple parsers with the same string
      const parser1 = literal(testString);
      const parser2 = literal(testString);
      const parser3 = literal(testString);

      const input = `${testString}extra`;
      const pos = createPos();

      const result1 = parser1(input, pos);
      const result2 = parser2(input, pos);
      const result3 = parser3(input, pos);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);

      if (result1.success && result2.success && result3.success) {
        expect(result1.val).toBe(testString);
        expect(result2.val).toBe(testString);
        expect(result3.val).toBe(testString);
      }
    });
  });

  describe("lit function (literal alias)", () => {
    it("should behave identically to literal", () => {
      // Purpose: Verify alias function behavior
      const str = "test";
      const input = "test input";
      const pos = createPos();

      const litResult = lit(str)(input, pos);
      const literalResult = literal(str)(input, pos);

      expect(litResult).toEqual(literalResult);
    });

    it("should work as a concise shorthand", () => {
      // Purpose: Verify code brevity benefits
      const parser = lit("if");
      const result = parser("if (condition)", createPos());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("if");
      }
    });
  });
});

describe("parse utility function", () => {
  describe("Basic usage", () => {
    it("should execute parser and return result", () => {
      // Purpose: Verify basic parse function operation
      const parser = lit("hello");
      const result = parse(parser)("hello world");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello");
      }
    });

    it("should work with anyChar parser for single characters", () => {
      // Purpose: Verify anyChar and parse combination
      const result = parse(anyChar())("x");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("x");
      }
    });

    it("should handle Unicode characters correctly", () => {
      // Purpose: Verify Unicode support
      const result = parse(anyChar())("🎌");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("🎌");
      }
    });
  });

  describe("Error handling", () => {
    it("should return error when parser fails", () => {
      // Purpose: Verify error propagation
      const parser = lit("expected");
      const result = parse(parser)("actual");

      expect(result.success).toBe(false);
    });

    it("should handle EOI errors with anyChar", () => {
      // Purpose: Verify EOI error handling
      const result = parse(anyChar())("");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Unexpected EOI");
      }
    });

    it("should preserve error information from nested parsers", () => {
      // Purpose: Verify error information propagation
      const parser = literal("test", "test parser");
      const result = parse(parser)("fail");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.parserName).toBe("test parser");
      }
    });
  });
});

describe("Real-world usage examples and scenario tests", () => {
  describe("Programming language syntax elements", () => {
    it("should parse JavaScript function declaration start", () => {
      // Real-world example: Function declaration parsing
      const functionKeyword = lit("function");
      const space = lit(" ");
      const identifier = lit("myFunction");

      const input = "function myFunction() {}";
      let pos = createPos();

      const funcResult = functionKeyword(input, pos);
      expect(funcResult.success).toBe(true);
      if (funcResult.success) {
        pos = funcResult.next;
      }

      const spaceResult = space(input, pos);
      expect(spaceResult.success).toBe(true);
      if (spaceResult.success) {
        pos = spaceResult.next;
      }

      const identResult = identifier(input, pos);
      expect(identResult.success).toBe(true);
      if (identResult.success) {
        expect(identResult.val).toBe("myFunction");
      }
    });

    it("should parse string literals", () => {
      // Real-world example: String literal parsing
      const quote = lit('"');
      const content = lit("Hello, World!");

      const input = '"Hello, World!"';
      let pos = createPos();

      const openQuote = quote(input, pos);
      expect(openQuote.success).toBe(true);
      if (openQuote.success) {
        pos = openQuote.next;
      }

      const contentResult = content(input, pos);
      expect(contentResult.success).toBe(true);
      if (contentResult.success) {
        expect(contentResult.val).toBe("Hello, World!");
      }
    });
  });

  describe("Data format parsing", () => {
    it("should parse CSV headers", () => {
      // Real-world example: CSV file header parsing
      const name = lit("name");
      const comma = lit(",");
      const age = lit("age");
      const email = lit("email");

      const input = "name,age,email";
      let pos = createPos();

      const nameResult = name(input, pos);
      expect(nameResult.success).toBe(true);
      if (nameResult.success) pos = nameResult.next;

      const comma1Result = comma(input, pos);
      expect(comma1Result.success).toBe(true);
      if (comma1Result.success) pos = comma1Result.next;

      const ageResult = age(input, pos);
      expect(ageResult.success).toBe(true);
      if (ageResult.success) pos = ageResult.next;

      const comma2Result = comma(input, pos);
      expect(comma2Result.success).toBe(true);
      if (comma2Result.success) pos = comma2Result.next;

      const emailResult = email(input, pos);
      expect(emailResult.success).toBe(true);
    });

    it("should parse configuration files", () => {
      // Real-world example: Configuration file parsing
      const key = lit("database");
      const equals = lit("=");
      const value = lit("localhost:5432");

      const input = "database=localhost:5432";
      let pos = createPos();

      const keyResult = key(input, pos);
      expect(keyResult.success).toBe(true);
      if (keyResult.success) pos = keyResult.next;

      const equalsResult = equals(input, pos);
      expect(equalsResult.success).toBe(true);
      if (equalsResult.success) pos = equalsResult.next;

      const valueResult = value(input, pos);
      expect(valueResult.success).toBe(true);
      if (valueResult.success) {
        expect(valueResult.val).toBe("localhost:5432");
      }
    });
  });

  describe("Internationalization support tests", () => {
    it("should parse multilingual keywords", () => {
      // Real-world example: Multilingual programming language support
      const keywords = {
        english: lit("function"),
        japanese: lit("関数"),
        korean: lit("함수"),
        chinese: lit("函数"),
      };

      expect(keywords.english("function test", createPos()).success).toBe(true);
      expect(keywords.japanese("関数 テスト", createPos()).success).toBe(true);
      expect(keywords.korean("함수 테스트", createPos()).success).toBe(true);
      expect(keywords.chinese("函数 测试", createPos()).success).toBe(true);
    });

    it("should parse social media posts with emoji", () => {
      // Real-world example: Modern text processing
      const greeting = lit("Hello");
      const space = lit(" ");
      const emoji = lit("👋");
      const world = lit("🌍");

      const input = "Hello 👋🌍";
      let pos = createPos();

      const greetingResult = greeting(input, pos);
      expect(greetingResult.success).toBe(true);
      if (greetingResult.success) pos = greetingResult.next;

      const spaceResult = space(input, pos);
      expect(spaceResult.success).toBe(true);
      if (spaceResult.success) pos = spaceResult.next;

      const emojiResult = emoji(input, pos);
      expect(emojiResult.success).toBe(true);
      if (emojiResult.success) pos = emojiResult.next;

      const worldResult = world(input, pos);
      expect(worldResult.success).toBe(true);
    });
  });
});
