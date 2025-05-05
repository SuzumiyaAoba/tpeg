import { describe, expect, it } from "bun:test";
import type { ParseSuccess, Parser } from "tpeg-combinator";
import {
  between,
  choice,
  int,
  labeled,
  literal,
  map,
  memoize,
  number,
  parse,
  quotedString,
  recursive,
  sepBy,
  sepBy1,
  seq,
  takeUntil,
  token,
  whitespace,
  withPosition,
} from "tpeg-combinator";

describe("Tests for added combinators", () => {
  describe("takeUntil", () => {
    it("consumes characters until the condition is met", () => {
      const parser = takeUntil(literal(","));
      const result = parse(parser)("abc,def");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("abc");
        expect(result.next.offset).toBe(3);
      }
    });

    it("consumes all characters if the condition is not met", () => {
      const parser = takeUntil(literal(","));
      const result = parse(parser)("abcdef");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("abcdef");
        expect(result.next.offset).toBe(6);
      }
    });

    it("succeeds with empty input", () => {
      const parser = takeUntil(literal(","));
      const result = parse(parser)("");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("");
        expect(result.next.offset).toBe(0);
      }
    });
  });

  describe("between", () => {
    it("returns the content between start and end", () => {
      const parser = between(literal("["), literal("]"));
      const result = parse(parser)("[abc]");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("abc");
        expect(result.next.offset).toBe(5);
      }
    });

    it("returns content up to the first closing tag when nested", () => {
      const parser = between(literal("["), literal("]"));
      const result = parse(parser)("[abc[def]]");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("abc[def");
        expect(result.next.offset).toBe(9);
      }
    });

    it("fails if there is no closing tag", () => {
      const parser = between(literal("["), literal("]"));
      const result = parse(parser)("[abc");

      expect(result.success).toBe(false);
    });
  });

  describe("sepBy", () => {
    it("parses values separated by a delimiter", () => {
      const parser = sepBy(literal("a"), literal(","));
      const result = parse(parser)("a,a,a");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "a", "a"]);
        expect(result.next.offset).toBe(5);
      }
    });

    it("returns an empty array if there are no values", () => {
      const parser = sepBy(literal("a"), literal(","));
      const result = parse(parser)("b");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual([]);
        expect(result.next.offset).toBe(0);
      }
    });

    it("returns a single value if there are no delimiters", () => {
      const parser = sepBy(literal("a"), literal(","));
      const result = parse(parser)("a");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a"]);
        expect(result.next.offset).toBe(1);
      }
    });
  });

  describe("sepBy1", () => {
    it("parses values separated by a delimiter", () => {
      const parser = sepBy1(literal("a"), literal(","));
      const result = parse(parser)("a,a,a");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "a", "a"]);
        expect(result.next.offset).toBe(5);
      }
    });

    it("fails if there are no values", () => {
      const parser = sepBy1(literal("a"), literal(","));
      const result = parse(parser)("b");

      expect(result.success).toBe(false);
    });

    it("returns a single value if there are no delimiters", () => {
      const parser = sepBy1(literal("a"), literal(","));
      const result = parse(parser)("a");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a"]);
        expect(result.next.offset).toBe(1);
      }
    });
  });

  describe("whitespace", () => {
    it("parses whitespace characters", () => {
      const parser = whitespace();
      const result = parse(parser)("   \t\n\r");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("   \t\n\r");
        expect(result.next.offset).toBe(6); // \r\n is counted as one character
      }
    });

    it("returns an empty string if there is no whitespace", () => {
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
    it("skips trailing whitespace after the parser's result", () => {
      const parser = token(literal("abc"));
      const result = parse(parser)("abc   \t\ndef");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("abc");
        expect(result.next.offset).toBe(8);
      }
    });

    it("returns the parser's result as is if there is no trailing whitespace", () => {
      const parser = token(literal("abc"));
      const result = parse(parser)("abcdef");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("abc");
        expect(result.next.offset).toBe(3);
      }
    });
  });

  describe("quotedString", () => {
    it("parses a string enclosed in quotes", () => {
      const parser = quotedString();
      const result = parse(parser)('"abc"');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("abc");
        expect(result.next.offset).toBe(5);
      }
    });

    it("handles escape sequences", () => {
      const parser = quotedString();
      const result = parse(parser)('"a\\"b\\nc"');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe('a"b\nc');
        expect(result.next.offset).toBe(9);
      }
    });

    it("fails if there are no quotes", () => {
      const parser = quotedString();
      const result = parse(parser)("abc");

      expect(result.success).toBe(false);
    });

    it("fails if there is no closing quote", () => {
      const parser = quotedString();
      const result = parse(parser)('"abc');

      expect(result.success).toBe(false);
    });
  });

  describe("memoize", () => {
    it("caches parser results", () => {
      let callCount = 0;
      const baseParser: Parser<string> = (input, pos) => {
        callCount++;
        return literal("a")(input, pos);
      };

      const parser = memoize(baseParser);

      // First call
      const result1 = parser("a", { offset: 0, column: 0, line: 1 });
      expect(result1.success).toBe(true);
      expect(callCount).toBe(1);

      // Second call at the same position (cache hit)
      const result2 = parser("a", { offset: 0, column: 0, line: 1 });
      expect(result2.success).toBe(true);
      expect(callCount).toBe(1); // Call count should not increase

      // Call at a different position
      const result3 = parser("aa", { offset: 1, column: 1, line: 1 });
      expect(callCount).toBe(2); // Call count should increase
    });
  });

  describe("recursive", () => {
    it("creates a recursive parser", () => {
      // Simple example of a recursive parser: parenthesized string
      const [exprParser, setExprParser] = recursive<string>();

      // Simplest case: 'a'
      const simpleExpr = literal("a");

      setExprParser(
        choice(
          simpleExpr,
          map(
            seq(literal("("), exprParser, literal(")")),
            ([open, expr, close]) => `(${expr})`,
          ),
        ),
      );

      // Tests
      const result1 = parse(exprParser)("a");
      expect(result1.success).toBe(true);
      if (result1.success) {
        expect(result1.val).toBe("a");
      }

      const result2 = parse(exprParser)("(a)");
      expect(result2.success).toBe(true);
      if (result2.success) {
        expect(result2.val).toBe("(a)");
      }
    });
  });

  describe("labeled", () => {
    it("customizes error messages", () => {
      const parser = labeled(literal("a"), "Expected 'a'");

      const successResult = parse(parser)("a");
      expect(successResult.success).toBe(true);
      if (successResult.success) {
        expect(successResult.val).toBe("a");
      }

      const failureResult = parse(parser)("b");
      expect(failureResult.success).toBe(false);
      if (!failureResult.success) {
        expect(failureResult.error.message).toBe("Expected 'a'");
      }
    });
  });

  describe("number", () => {
    it("parses integers", () => {
      const parser = number();

      const result = parse(parser)("123");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(123);
        expect(result.next.offset).toBe(3);
      }
    });

    it("parses floating point numbers", () => {
      const parser = number();

      const result = parse(parser)("123.456");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(123.456);
        expect(result.next.offset).toBe(7);
      }
    });

    it("parses exponential notation", () => {
      const parser = number();

      const result1 = parse(parser)("1e3");
      expect(result1.success).toBe(true);
      if (result1.success) {
        expect(result1.val).toBe(1000);
        expect(result1.next.offset).toBe(3);
      }

      const result2 = parse(parser)("1.2e-3");
      expect(result2.success).toBe(true);
      if (result2.success) {
        expect(result2.val).toBe(0.0012);
        expect(result2.next.offset).toBe(6);
      }
    });

    it("parses negative numbers", () => {
      const parser = number();

      const result = parse(parser)("-123");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(-123);
        expect(result.next.offset).toBe(4);
      }
    });

    it("fails for non-numeric input", () => {
      const parser = number();

      const result = parse(parser)("abc");
      expect(result.success).toBe(false);
    });
  });

  describe("int", () => {
    it("parses integer numbers", () => {
      const parser = int();

      const result = parse(parser)("123");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(123);
        expect(result.next.offset).toBe(3);
      }
    });

    it("parses negative integers", () => {
      const parser = int();

      const result = parse(parser)("-123");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(-123);
        expect(result.next.offset).toBe(4);
      }
    });

    it("parses only the integer part of a floating point number", () => {
      const parser = int();

      const result = parse(parser)("123.456");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(123);
        expect(result.next.offset).toBe(3);
      }
    });

    it("fails for non-numeric input", () => {
      const parser = int();

      const result = parse(parser)("abc");
      expect(result.success).toBe(false);
    });
  });

  describe("withPosition", () => {
    it("adds position information to the parse result", () => {
      const parser = withPosition(literal("abc"));

      const result = parse(parser)("abc");
      expect(result.success).toBe(true);
      if (result.success) {
        // Check that position information is added
        expect(result.val.position).toEqual({
          offset: 0,
          column: 0,
          line: 1,
        });
        // Check that the original value is preserved
        expect(typeof result.val).toBe("object");
        expect(result.val).toHaveProperty("position");
      }
    });
  });

  describe("JSON Parser Integration Test", () => {
    it("parses valid JSON", () => {
      // Simple JSON that can be processed by JSON.parse
      const jsonString = `
      {
        "name": "John Doe",
        "age": 30,
        "isActive": true,
        "children": null,
        "scores": [85, 90, 78]
      }
      `;

      const { parseJSON } = require("./peg/json");
      const result = parseJSON(jsonString);

      expect(result).toEqual({
        name: "John Doe",
        age: 30,
        isActive: true,
        children: null,
        scores: [85, 90, 78],
      });
    });
  });

  describe("CSV Parser Integration Test", () => {
    it("parses basic CSV", () => {
      const csvString = `name,age,city
John,30,New York
Jane,25,Boston
Bob,40,Chicago`;

      const { parseCSV } = require("./peg/csv");
      const result = parseCSV(csvString);

      expect(result).toEqual([
        ["name", "age", "city"],
        ["John", "30", "New York"],
        ["Jane", "25", "Boston"],
        ["Bob", "40", "Chicago"],
      ]);
    });

    it("handles quoted fields", () => {
      // Simple example with quoted fields
      const csvString = `name,age
"John",30
"Jane",25`;

      const { parseCSV } = require("./peg/csv");
      const result = parseCSV(csvString);

      expect(result).toEqual([
        ["name", "age"],
        ["John", "30"],
        ["Jane", "25"],
      ]);
    });

    it("parses CSV with headers into an array of objects", () => {
      const csvString = `name,age,city
John,30,New York
Jane,25,Boston`;

      const { parseCSVWithHeaders } = require("./peg/csv");
      const result = parseCSVWithHeaders(csvString);

      expect(result).toEqual([
        { name: "John", age: "30", city: "New York" },
        { name: "Jane", age: "25", city: "Boston" },
      ]);
    });
  });
});
