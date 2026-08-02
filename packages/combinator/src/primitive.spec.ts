import { describe, expect, it } from "bun:test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { literal } from "@suzumiyaaoba/tpeg-core";
import {
  EOF,
  alpha,
  alphaNum,
  digit,
  endOfLine,
  identifier,
  int,
  number,
  spaces,
  startOfLine,
  token,
  whitespace,
} from "./primitive";

describe("primitive combinators", () => {
  describe("whitespace", () => {
    it("should match space", () => {
      const result = parse(whitespace)(" ");
      expect(result.success).toBe(true);
    });

    it("should match tab", () => {
      const result = parse(whitespace)("\t");
      expect(result.success).toBe(true);
    });

    it("should match newline", () => {
      const result = parse(whitespace)("\n");
      expect(result.success).toBe(true);
    });

    it("should fail on non-whitespace", () => {
      const result = parse(whitespace)("a");
      expect(result.success).toBe(false);
    });
  });

  describe("spaces", () => {
    it("should match multiple spaces", () => {
      const result = parse(spaces)("  \t\n ");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("  \t\n ");
      }
    });

    it("should match empty string", () => {
      const result = parse(spaces)("");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("");
      }
    });
  });

  describe("token", () => {
    it("should consume surrounding spaces", () => {
      const parser = token(literal("hello"));
      const result = parse(parser)("  hello  ");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello");
        expect(result.next).toBe(9);
      }
    });

    it("should fail if inner parser fails", () => {
      const parser = token(literal("hello"));
      const result = parse(parser)("  world  ");
      expect(result.success).toBe(false);
    });
  });

  describe("number", () => {
    it("should parse simple integer", () => {
      const result = parse(number)("123");
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe(123);
    });

    it("should parse negative integer", () => {
      const result = parse(number)("-123");
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe(-123);
    });

    it("should parse decimal", () => {
      const result = parse(number)("123.456");
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe(123.456);
    });

    it("should parse scientific notation", () => {
      const result = parse(number)("1.23e2");
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe(123);
    });

    it("should fail on invalid format", () => {
      const result = parse(number)("abc");
      expect(result.success).toBe(false);
    });
  });

  describe("int", () => {
    it("should parse integer", () => {
      const result = parse(int)("123");
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe(123);
    });

    it("should fail on decimal", () => {
      // int only parses the leading digits
      const result = parse(int)("123.45");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(123);
        expect(result.next).toBe(3);
      }
    });
  });

  describe("alpha", () => {
    it("should match letter", () => {
      expect(parse(alpha)("a").success).toBe(true);
      expect(parse(alpha)("Z").success).toBe(true);
    });

    it("should fail on digit", () => {
      expect(parse(alpha)("1").success).toBe(false);
    });
  });

  describe("digit", () => {
    it("should match digit", () => {
      expect(parse(digit)("0").success).toBe(true);
      expect(parse(digit)("9").success).toBe(true);
    });

    it("should fail on letter", () => {
      expect(parse(digit)("a").success).toBe(false);
    });
  });

  describe("alphaNum", () => {
    it("should match letter or digit", () => {
      expect(parse(alphaNum)("a").success).toBe(true);
      expect(parse(alphaNum)("1").success).toBe(true);
    });
  });

  describe("startOfLine", () => {
    it("should succeed at offset 0", () => {
      const result = startOfLine()("", 0);
      expect(result.success).toBe(true);
    });

    it("should fail at offset > 0", () => {
      const result = startOfLine()("a", 1);
      expect(result.success).toBe(false);
    });

    it("should succeed right after a newline", () => {
      const result = startOfLine()("a\nb", 2);
      expect(result.success).toBe(true);
    });

    it("should succeed after a CRLF line ending (position after the \\n)", () => {
      const result = startOfLine()("a\r\nb", 3);
      expect(result.success).toBe(true);
    });

    it("should fail between the \\r and \\n of a CRLF line ending", () => {
      const result = startOfLine()("a\r\nb", 2);
      expect(result.success).toBe(false);
    });
  });

  describe("EOF", () => {
    it("should succeed at end of input", () => {
      const result = parse(EOF)("");
      expect(result.success).toBe(true);
    });

    it("should fail if input remains", () => {
      const result = parse(EOF)("a");
      expect(result.success).toBe(false);
    });
  });

  describe("endOfLine", () => {
    it("should match newline", () => {
      expect(parse(endOfLine())("\n").success).toBe(true);
      expect(parse(endOfLine())("\r\n").success).toBe(true);
    });

    it("should match EOF", () => {
      expect(parse(endOfLine())("").success).toBe(true);
    });
  });

  describe("identifier", () => {
    it("should match valid identifier", () => {
      const result = parse(identifier)("foo_123");
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe("foo_123");
    });

    it("should not start with digit", () => {
      expect(parse(identifier)("1foo").success).toBe(false);
    });
  });
});
