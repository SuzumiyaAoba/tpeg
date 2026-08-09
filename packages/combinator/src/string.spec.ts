import { describe, expect, it } from "bun:test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { literal } from "@suzumiyaaoba/tpeg-core";
import {
  anyQuotedString,
  between,
  quotedString,
  singleQuotedString,
  takeUntil,
} from "./string";

describe("string combinators", () => {
  describe("takeUntil", () => {
    it("should consume characters until condition", () => {
      const parser = takeUntil(literal(";"));
      const result = parse(parser)("part1;part2");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("part1");
        expect(result.next).toBe(5);
      }
    });

    it("should consume all if condition never met", () => {
      const parser = takeUntil(literal(";"));
      const result = parse(parser)("no-semicolon");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("no-semicolon");
      }
    });
  });

  describe("between", () => {
    it("should extract content between delimiters", () => {
      const parser = between(literal("("), literal(")"));
      const result = parse(parser)("(inner)");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("inner");
      }
    });

    it("should fail if delimiters missing", () => {
      const parser = between(literal("("), literal(")"));
      expect(parse(parser)("inner)").success).toBe(false);
      expect(parse(parser)("(inner").success).toBe(false);
    });
  });

  describe("quotedString", () => {
    it("should parse double quoted string", () => {
      const result = parse(quotedString)('"hello"');
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe("hello");
    });

    it("should handle escape sequences", () => {
      const result = parse(quotedString)('"line1\\nline2"');
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe("line1\nline2");
    });

    it("should handle escaped quotes", () => {
      const result = parse(quotedString)('"quote: \\""');
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe('quote: "');
    });

    it('decodes a \\uXXXX escape (regression: previously fell through escapeSeq\'s default case and passed through as the literal text "u0041" instead of decoding to "A")', () => {
      const result = parse(quotedString)('"\\u0041BC"');
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe("ABC");
    });

    it("decodes a \\uXXXX surrogate pair into the correct astral character", () => {
      // U+1F600 (😀) as a JS/JSON-style UTF-16 surrogate pair.
      const result = parse(quotedString)('"\\ud83d\\ude00"');
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe("\u{1F600}");
    });
  });

  describe("singleQuotedString", () => {
    it("should parse single quoted string", () => {
      const result = parse(singleQuotedString)("'hello'");
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe("hello");
    });
  });

  describe("anyQuotedString", () => {
    it("should parse either type", () => {
      expect(parse(anyQuotedString)('"double"').success).toBe(true);
      expect(parse(anyQuotedString)("'single'").success).toBe(true);
    });
  });
});
