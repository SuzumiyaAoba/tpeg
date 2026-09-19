/**
 * String Literal Parser Tests
 */

import { describe, expect, it } from "vite-plus/test";
import { stringLiteral } from "./string-literal";

const pos = 0;

describe("stringLiteral", () => {
  const parser = stringLiteral;

  describe("double-quoted strings", () => {
    it("should parse simple double-quoted strings", () => {
      const result = parser('"hello"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("StringLiteral");
        expect(result.val.value).toBe("hello");
        expect(result.val.quote).toBe('"');
      }
    });

    it("should parse empty double-quoted strings", () => {
      const result = parser('""', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe("");
        expect(result.val.quote).toBe('"');
      }
    });

    it("should parse double-quoted strings with escape sequences", () => {
      const result = parser('"hello\\nworld\\t"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe("hello\nworld\t");
        expect(result.val.quote).toBe('"');
      }
    });

    it("should parse double-quoted strings with escaped quotes", () => {
      const result = parser('"say \\"hello\\""', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe('say "hello"');
        expect(result.val.quote).toBe('"');
      }
    });
  });

  describe("single-quoted strings", () => {
    it("should parse simple single-quoted strings", () => {
      const result = parser("'hello'", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("StringLiteral");
        expect(result.val.value).toBe("hello");
        expect(result.val.quote).toBe("'");
      }
    });

    it("should parse single-quoted strings with escape sequences", () => {
      const result = parser("'hello\\nworld'", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe("hello\nworld");
        expect(result.val.quote).toBe("'");
      }
    });

    it("should parse single-quoted strings with escaped quotes", () => {
      const result = parser("'can\\'t'", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe("can't");
        expect(result.val.quote).toBe("'");
      }
    });
  });

  describe("unified escape sequences (escape-sequence.ts)", () => {
    it("should decode the full named-escape set, not just n/r/t", () => {
      const result = parser('"\\b\\f\\v\\0"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe("\b\f\v\0");
      }
    });

    it("should decode \\xNN hex escapes", () => {
      const result = parser('"\\x41\\x5a\\x00\\xff"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe("AZ\x00\xff");
      }
    });

    it("should decode \\uXXXX escapes", () => {
      const result = parser('"\\u0041\\u3042"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe("Aあ");
      }
    });

    it("should decode \\u{...} escapes including astral code points", () => {
      const result = parser('"\\u{41}\\u{1F600}\\u{10FFFF}"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe("A\u{1F600}\u{10FFFF}");
      }
    });

    it("should reject \\x with fewer than two hex digits", () => {
      expect(parser('"\\x4"', pos).success).toBe(false);
      expect(parser('"\\x"', pos).success).toBe(false);
      expect(parser('"\\xzz"', pos).success).toBe(false);
    });

    it("should reject \\u with fewer than four hex digits", () => {
      expect(parser('"\\u041"', pos).success).toBe(false);
      expect(parser('"\\u"', pos).success).toBe(false);
    });

    it("should reject malformed \\u{...} escapes", () => {
      // empty braces
      expect(parser('"\\u{}"', pos).success).toBe(false);
      // missing close brace
      expect(parser('"\\u{41"', pos).success).toBe(false);
      // too many digits
      expect(parser('"\\u{1234567}"', pos).success).toBe(false);
      // above U+10FFFF
      expect(parser('"\\u{110000}"', pos).success).toBe(false);
      expect(parser('"\\u{FFFFFF}"', pos).success).toBe(false);
    });

    it("should reject unknown single-letter escapes", () => {
      expect(parser('"\\q"', pos).success).toBe(false);
      expect(parser('"\\a"', pos).success).toBe(false);
    });
  });

  describe("error cases", () => {
    it("should fail on unclosed double quotes", () => {
      const result = parser('"hello', pos);
      expect(result.success).toBe(false);
    });

    it("should fail on unclosed single quotes", () => {
      const result = parser("'hello", pos);
      expect(result.success).toBe(false);
    });

    it("should fail on empty input", () => {
      const result = parser("", pos);
      expect(result.success).toBe(false);
    });
  });
});
