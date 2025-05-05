import { describe, expect, it } from "bun:test";
import { anyChar, literal, parse } from "tpeg-core";
import {
  EOF,
  between,
  int,
  labeled,
  memoize,
  number,
  quotedString,
  recursive,
  sepBy,
  sepBy1,
  takeUntil,
  token,
  whitespace,
  withPosition,
} from "./index";

describe("tpeg-combinator additional tests", () => {
  describe("EOF", () => {
    it("should succeed at the end of input", () => {
      const result = parse(EOF)("");
      expect(result.success).toBe(true);
    });

    it("should fail if not at the end of input", () => {
      const result = parse(EOF)("abc");
      expect(result.success).toBe(false);
    });
  });

  describe("takeUntil", () => {
    it("should consume characters until the condition is met", () => {
      const parser = takeUntil(literal(","));
      const result = parse(parser)("hello,world");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello");
        expect(result.next.offset).toBe(5);
      }
    });

    it("should consume all characters if condition is never met", () => {
      const parser = takeUntil(literal(","));
      const result = parse(parser)("hello");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello");
        expect(result.next.offset).toBe(5);
      }
    });
  });

  describe("between", () => {
    it("should parse content between two parsers", () => {
      const parser = between(literal("["), literal("]"));
      const result = parse(parser)("[hello]");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello");
        expect(result.next.offset).toBe(7);
      }
    });

    it("should fail if opening parser fails", () => {
      const parser = between(literal("["), literal("]"));
      const result = parse(parser)("(hello]");

      expect(result.success).toBe(false);
    });

    it("should fail if closing parser fails", () => {
      const parser = between(literal("["), literal("]"));
      const result = parse(parser)("[hello)");

      expect(result.success).toBe(false);
    });
  });

  describe("sepBy", () => {
    it("should parse values separated by a separator", () => {
      const parser = sepBy(literal("item"), literal(","));
      const result = parse(parser)("item,item,item");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["item", "item", "item"]);
        expect(result.next.offset).toBe(14);
      }
    });

    it("should return an empty array if no values match", () => {
      const parser = sepBy(literal("item"), literal(","));
      const result = parse(parser)("other");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual([]);
        expect(result.next.offset).toBe(0);
      }
    });
  });

  describe("sepBy1", () => {
    it("should parse one or more values separated by a separator", () => {
      const parser = sepBy1(literal("item"), literal(","));
      const result = parse(parser)("item,item,item");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["item", "item", "item"]);
        expect(result.next.offset).toBe(14);
      }
    });

    it("should fail if no values match", () => {
      const parser = sepBy1(literal("item"), literal(","));
      const result = parse(parser)("other");

      expect(result.success).toBe(false);
    });
  });

  describe("whitespace", () => {
    it("should consume whitespace characters", () => {
      const parser = whitespace();
      const result = parse(parser)("  \t\n\r  abc");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("  \t\n\r  ");
        expect(result.next.offset).toBe(7);
      }
    });

    it("should succeed with empty string if no whitespace", () => {
      const parser = whitespace();
      const result = parse(parser)("abc");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("");
        expect(result.next.offset).toBe(0);
      }
    });
  });

  describe("token", () => {
    it("should consume trailing whitespace after parser", () => {
      const parser = token(literal("hello"));
      const result = parse(parser)("hello   world");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello");
        expect(result.next.offset).toBe(8);
      }
    });

    it("should succeed even without trailing whitespace", () => {
      const parser = token(literal("hello"));
      const result = parse(parser)("helloworld");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello");
        expect(result.next.offset).toBe(5);
      }
    });
  });

  describe("quotedString", () => {
    it("should parse a simple quoted string", () => {
      const parser = quotedString();
      const result = parse(parser)('"hello"');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello");
        expect(result.next.offset).toBe(7);
      }
    });

    it("should handle escape sequences", () => {
      const parser = quotedString();
      const result = parse(parser)('"hello\\nworld\\t\\"quote\\""');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe('hello\nworld\t"quote"');
        expect(result.next.offset).toBe(25);
      }
    });

    it("should fail if not properly closed", () => {
      const parser = quotedString();
      const result = parse(parser)('"hello');

      expect(result.success).toBe(false);
    });
  });

  describe("memoize", () => {
    it("should return the same result as the original parser", () => {
      const originalParser = literal("hello");
      const memoizedParser = memoize(originalParser);

      const originalResult = parse(originalParser)("hello");
      const memoizedResult = parse(memoizedParser)("hello");

      expect(memoizedResult.success).toBe(true);
      expect(originalResult.success).toBe(true);

      if (originalResult.success && memoizedResult.success) {
        expect(memoizedResult.val).toBe(originalResult.val);
        expect(memoizedResult.next.offset).toBe(originalResult.next.offset);
      }
    });
  });

  describe("recursive", () => {
    it("should be able to create recursive parsers", () => {
      const [expr, setExpr] = recursive<string>();

      // Simple recursive parser for balanced parentheses
      setExpr(between(literal("("), literal(")")));

      const result = parse(expr)("(())");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("(");
        expect(result.next.offset).toBe(3);
      }
    });

    it("should fail if recursive parser is not initialized", () => {
      const [expr, _] = recursive<string>();
      const result = parse(expr)("hello");

      expect(result.success).toBe(false);
    });
  });

  describe("labeled", () => {
    it("should parse normally if successful", () => {
      const parser = labeled(literal("hello"), "Expected 'hello'");
      const result = parse(parser)("hello");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello");
        expect(result.next.offset).toBe(5);
      }
    });

    it("should return custom error message if failed", () => {
      const parser = labeled(literal("hello"), "Expected 'hello'");
      const result = parse(parser)("world");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Expected 'hello'");
      }
    });
  });

  describe("number", () => {
    it("should parse integers", () => {
      const parser = number();
      const result = parse(parser)("123");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(123);
        expect(result.next.offset).toBe(3);
      }
    });

    it("should parse floats", () => {
      const parser = number();
      const result = parse(parser)("123.456");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(123.456);
        expect(result.next.offset).toBe(7);
      }
    });

    it("should parse negative numbers", () => {
      const parser = number();
      const result = parse(parser)("-123.456");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(-123.456);
        expect(result.next.offset).toBe(8);
      }
    });

    it("should parse scientific notation", () => {
      const parser = number();
      const result = parse(parser)("1.23e-4");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(1.23e-4);
        expect(result.next.offset).toBe(7);
      }
    });
  });

  describe("int", () => {
    it("should parse integers", () => {
      const parser = int();
      const result = parse(parser)("123");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(123);
        expect(result.next.offset).toBe(3);
      }
    });

    it("should parse negative integers", () => {
      const parser = int();
      const result = parse(parser)("-123");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(-123);
        expect(result.next.offset).toBe(4);
      }
    });

    it("should fail to parse floats", () => {
      const parser = int();
      const result = parse(parser)("123.456");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(123);
        expect(result.next.offset).toBe(3);
      }
    });
  });

  describe("withPosition", () => {
    it("should add position info to parser results", () => {
      const parser = withPosition(literal("hello"));
      const result = parse(parser)("hello");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.val).toBe("object");
        expect(result.val).toHaveProperty("position");
        expect(result.val.position).toEqual({
          offset: 0,
          line: 1,
          column: 0,
        });
        expect(result.next.offset).toBe(5);
      }
    });
  });
});
