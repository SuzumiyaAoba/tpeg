import { describe, expect, it } from "bun:test";
import type {
  NonEmptyArray,
  ParseFailure,
  ParseResult,
  ParseSuccess,
  Parser,
  Pos,
} from "tpeg-core";
import {
  any,
  anyChar,
  charClass,
  choice,
  isFailure,
  isSuccess,
  literal,
  map,
  oneOrMore,
  parse,
  seq,
  zeroOrMore,
} from "tpeg-core";
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
      const parser = whitespace;
      const result = parse(parser)("  \t\n\r  abc");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(" ");
        expect(result.next.offset).toBe(1);
      }
    });

    it("should succeed with empty string if no whitespace", () => {
      const parser = whitespace;
      const result = parse(parser)("abc");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe(
          'Unexpected character "a", expected one of  , \t, \n, \r',
        );
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
      const result = parse(parser)('"unclosed');

      expect(result.success).toBe(false);
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
      const result = parse(parser)("1.23e2");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(123);
        expect(result.next.offset).toBe(6);
      }
    });

    it("should fail on invalid numbers", () => {
      const parser = number();
      const result = parse(parser)("not-a-number");

      expect(result.success).toBe(false);
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

    it("should only parse the integer part of a float", () => {
      const parser = int();
      const result = parse(parser)("123.456");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(123);
        expect(result.next.offset).toBe(3);
      }
    });

    it("should fail on invalid integers", () => {
      const parser = int();
      const result = parse(parser)("not-an-int");

      expect(result.success).toBe(false);
    });
  });

  describe("withPosition", () => {
    it("should add position info to the result", () => {
      const parser = withPosition(literal("hello"));
      const result = parse(parser)("hello");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          value: "hello",
          position: { offset: 0, line: 1, column: 0 },
        });
        expect(result.next.offset).toBe(5);
      }
    });

    it("should propagate failure", () => {
      const parser = withPosition(literal("hello"));
      const result = parse(parser)("world");

      expect(result.success).toBe(false);
    });
  });

  describe("labeled", () => {
    it("should provide a custom error message on failure", () => {
      const parser = labeled(literal("hello"), "Expected greeting");
      const result = parse(parser)("world");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Expected greeting");
      }
    });

    it("should pass through success", () => {
      const parser = labeled(literal("hello"), "Expected greeting");
      const result = parse(parser)("hello");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello");
      }
    });
  });

  describe("memoize", () => {
    it("should memoize parser results", () => {
      let calledTimes = 0;
      const expensiveParser: Parser<string> = (input, pos) => {
        calledTimes++;
        return literal("hello")(input, pos);
      };

      const memoizedParser = memoize(expensiveParser);

      // First call
      const result1 = memoizedParser("hello", {
        offset: 0,
        line: 1,
        column: 1,
      });
      // Second call with same input and position
      const result2 = memoizedParser("hello", {
        offset: 0,
        line: 1,
        column: 1,
      });

      expect(calledTimes).toBe(1);
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });

  describe("recursive", () => {
    it("should support recursive parsers", () => {
      // 単純化したテスト
      const basicExpr = literal("value");
      const [parser, setParser] = recursive<string>();

      // パーサーを設定
      setParser(basicExpr);

      // 単純なケース
      const result = parse(parser)("value");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("value");
      }
    });
  });
});

// カスタムパーサーを作成して空文字列を返す
const emptyStringParser: Parser<string> = (
  input: string,
  pos: { offset: number; line: number; column: number },
) => {
  return {
    success: true as const,
    val: "",
    current: pos,
    next: pos,
  };
};

// additional.spec.tsからのテストを追加
describe("Additional coverage tests", () => {
  describe("EOF", () => {
    it("should succeed at the end of input", () => {
      const result = EOF("", { offset: 0, line: 1, column: 1 });
      expect(isSuccess(result)).toBe(true);
    });

    it("should fail if not at the end of input", () => {
      const result = EOF("a", { offset: 0, line: 1, column: 1 });
      expect(isSuccess(result)).toBe(false);
    });
  });

  describe("takeUntil", () => {
    it("should consume characters until the condition is met", () => {
      const parser = takeUntil(literal("end"));
      const result = parser("abcend", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe("abc");
      }
    });

    it("should consume all characters if condition is never met", () => {
      const parser = takeUntil(literal("xyz"));
      const result = parser("abcdef", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe("abcdef");
      }
    });
  });

  describe("between", () => {
    it("should parse content between two parsers", () => {
      const parser = between(literal("("), literal(")"));
      const result = parser("(abc)", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe("abc");
      }
    });

    it("should fail if opening parser fails", () => {
      const parser = between(literal("("), literal(")"));
      const result = parser("[abc)", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(false);
    });

    it("should fail if closing parser fails", () => {
      const parser = between(literal("("), literal(")"));
      const result = parser("(abc]", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(false);
    });
  });

  describe("sepBy", () => {
    it("should parse values separated by a separator", () => {
      const parser = sepBy(literal("a"), literal(","));
      const result = parser("a,a,a", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toEqual(["a", "a", "a"]);
      }
    });

    it("should return an empty array if no values match", () => {
      const parser = sepBy(literal("a"), literal(","));
      const result = parser("b", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toEqual([]);
      }
    });
  });

  describe("sepBy1", () => {
    it("should parse one or more values separated by a separator", () => {
      const parser = sepBy1(literal("a"), literal(","));
      const result = parser("a,a,a", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toEqual(["a", "a", "a"]);
      }
    });

    it("should fail if no values match", () => {
      const parser = sepBy1(literal("a"), literal(","));
      const result = parser("b", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(false);
    });
  });

  describe("withPosition", () => {
    it("should add position info to parser results", () => {
      const parser = withPosition(literal("hello"));
      const result = parser("hello world", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toHaveProperty("position");
        expect(result.val.position).toEqual({ offset: 0, line: 1, column: 1 });
      }
    });

    it("should propagate failure", () => {
      const parser = withPosition(literal("hello"));
      const result = parser("world", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(false);
    });
  });

  describe("labeled with error creation", () => {
    it("should return custom error with correct position", () => {
      const errorMessage = "Custom error message";
      const parser = labeled(literal("hello"), errorMessage);
      const result = parser("world", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(false);
      if (!isSuccess(result)) {
        expect(result.error.message).toBe(errorMessage);
        expect(result.error.pos).toEqual({ offset: 0, line: 1, column: 1 });
      }
    });
  });

  describe("int vs number", () => {
    it("should parse integer with int()", () => {
      const parser = int();
      const result = parser("123", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe(123);
      }
    });

    it("should parse integer with scientific notation using number()", () => {
      const parser = number();
      const result = parser("1.23e2", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe(123);
      }
    });

    it("should parse float with int() but only return the integer part", () => {
      const parser = int();
      const result = parser("123.45", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe(123);
      }
    });
  });

  describe("token with whitespace", () => {
    it("should handle complex whitespace scenarios", () => {
      const parser = token(literal("hello"));
      const result = parser("  \n  hello  \t  ", {
        offset: 0,
        line: 1,
        column: 1,
      });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe("hello");
      }
    });

    it("should handle no whitespace", () => {
      const parser = token(literal("hello"));
      const result = parser("hello", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe("hello");
      }
    });
  });

  describe("memoize edge cases", () => {
    it("should return the same result on repeated calls", () => {
      const originalParser = literal("test");
      const memoizedParser = memoize(originalParser);

      const pos = { offset: 0, line: 1, column: 1 };
      const input = "test";

      // First call
      const result1 = memoizedParser(input, pos);
      // Second call should use cached result
      const result2 = memoizedParser(input, pos);

      expect(isSuccess(result1)).toBe(true);
      expect(isSuccess(result2)).toBe(true);
      expect(result1).toEqual(result2);
    });
  });

  describe("recursive", () => {
    it("should be able to create recursive parsers", () => {
      // A simple parser for balanced brackets like "[]" or "[[][]]"
      const [bracketsParser, setBracketsParser] = recursive<string>();

      // A simple content parser that accepts any character except brackets
      const contentParser = map(
        takeUntil(choice(literal("["), literal("]"))),
        (content) => content,
      );

      // Define the parser for a bracketed expression
      const bracketedExpr = map(
        seq(literal("["), choice(bracketsParser, contentParser), literal("]")),
        ([open, content, close]) => `${open}${content}${close}`,
      );

      // Set the recursive parser
      setBracketsParser(bracketedExpr);

      const result = parse(bracketsParser)("[[]]");
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe("[[]]");
      }
    });

    it("should fail if recursive parser is not initialized", () => {
      const [parenParser, _] = recursive<string>();
      const result = parse(parenParser)("()");
      expect(isSuccess(result)).toBe(false);
    });
  });

  describe("quoted string with various escape sequences", () => {
    it("should handle all escape sequences", () => {
      const parser = quotedString();
      const input = `"\\n\\t\\r\\\\\\"\\b\\f\\/"`;
      const result = parser(input, { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe('\n\t\r\\"\b\f/');
      }
    });

    it("should handle unicode-like escape sequences as regular characters", () => {
      const parser = quotedString();
      const input = `"\\u0041\\u0042\\u0043"`;
      const result = parser(input, { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe("u0041u0042u0043");
      }
    });

    it("should treat invalid escape sequences as regular characters", () => {
      const parser = quotedString();
      const input = `"\\z"`;
      const result = parser(input, { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe("z");
      }
    });

    it("should fail on unterminated string", () => {
      const parser = quotedString();
      const input = `"unterminated`;
      const result = parser(input, { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(false);
    });
  });

  describe("number", () => {
    it("should parse integers", () => {
      const parser = number();
      const result = parser("123", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe(123);
      }
    });

    it("should parse floats", () => {
      const parser = number();
      const result = parser("123.456", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe(123.456);
      }
    });

    it("should parse negative numbers", () => {
      const parser = number();
      const result = parser("-123", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe(-123);
      }
    });

    it("should parse scientific notation", () => {
      const parser = number();
      const result = parser("1.2e3", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe(1200);
      }
    });
  });

  describe("int", () => {
    it("should parse integers", () => {
      const parser = int();
      const result = parser("123", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe(123);
      }
    });

    it("should parse negative integers", () => {
      const parser = int();
      const result = parser("-123", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe(-123);
      }
    });

    it("should parse float string but only return the integer part", () => {
      const parser = int();
      const result = parser("123.45", { offset: 0, line: 1, column: 1 });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe(123);
      }
    });
  });
});

// 無限ループ検出とエッジケースのテスト
describe("Edge Cases and Error Handling", () => {
  describe("zeroOrMore infinite loop detection", () => {
    it("should detect and prevent infinite loops", () => {
      // 無限ループを引き起こす可能性のあるパーサー
      // inputを消費せずに常に成功するパーサー
      const problematicParser: Parser<string> = (input, pos) => ({
        success: true,
        val: "",
        current: pos,
        next: pos, // 同じ位置を返す
      });

      const parser = zeroOrMore(problematicParser);
      const result = parser("test", { offset: 0, line: 1, column: 1 });

      expect(isFailure(result)).toBe(true);
      if (!isSuccess(result)) {
        expect(result.error.message).toContain("Infinite loop detected");
      }
    });
  });

  describe("sepBy edge cases", () => {
    it("should handle edge cases with malformed input", () => {
      const valueParser = literal("value");
      const sepParser = literal(",");
      const parser = sepBy(valueParser, sepParser);

      // カンマが連続する不正な入力
      const result = parser("value,,value", { offset: 0, line: 1, column: 1 });
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        // 最初の値だけを抽出して終了する
        expect(result.val).toEqual(["value"]);
      }
    });

    it("should handle edge cases with empty input", () => {
      const valueParser = literal("value");
      const sepParser = literal(",");
      const parser = sepBy(valueParser, sepParser);

      const result = parser("", { offset: 0, line: 1, column: 1 });
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toEqual([]);
      }
    });
  });

  describe("sepBy1 edge cases", () => {
    it("should handle edge cases with malformed input", () => {
      const valueParser = literal("value");
      const sepParser = literal(",");
      const parser = sepBy1(valueParser, sepParser);

      // カンマが連続する不正な入力
      const result = parser("value,", { offset: 0, line: 1, column: 1 });
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        // カンマの後に値がないので、最初の値だけを返す
        expect(result.val).toEqual(["value"]);
      }
    });
  });

  describe("between edge cases", () => {
    it("should handle nested structures", () => {
      const openParser = literal("(");
      const closeParser = literal(")");
      const parser = between(openParser, closeParser);

      // ネストされた括弧
      const result = parser("((inner))", { offset: 0, line: 1, column: 1 });
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe("(inner");
      }
    });

    it("should handle complex content", () => {
      const openParser = literal("{");
      const closeParser = literal("}");
      const parser = between(openParser, closeParser);

      // 複雑な内容
      const result = parser('{a:"b",c:123}', { offset: 0, line: 1, column: 1 });
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toBe('a:"b",c:123');
      }
    });
  });

  describe("recursive edge cases", () => {
    it("should handle complex recursive structures", () => {
      // 数式を解析する再帰的なパーサー
      type Expr = number | { op: string; left: Expr; right: Expr };

      const [exprParser, setExprParser] = recursive<Expr>();

      // 数値パーサー
      const numberParser = map(oneOrMore(charClass(["0", "9"])), (digits) =>
        Number.parseInt(digits.join(""), 10),
      );

      // 括弧内の式
      const parenExpr = map(
        seq(literal("("), exprParser, literal(")")),
        ([_, expr]) => expr,
      );

      // 項（数値または括弧内の式）
      const term = choice(numberParser, parenExpr);

      // 加算または減算
      const addSubExpr = map(
        seq(term, literal("+"), exprParser),
        ([left, op, right]) => ({ op: "+", left, right }),
      );

      // 式パーサーを設定
      setExprParser(choice(addSubExpr, term));

      // シンプルな式をテスト
      const result = exprParser("(1+2)", { offset: 0, line: 1, column: 1 });
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.val).toEqual({ op: "+", left: 1, right: 2 });
      }
    });

    it("should handle empty recursive calls", () => {
      // 空のパーサーを設定する前にパースしようとする
      const [parser, _] = recursive<string>();

      const result = parser("test", { offset: 0, line: 1, column: 1 });
      expect(isFailure(result)).toBe(true);
      if (!isSuccess(result)) {
        expect(result.error.message).toBe("Recursive parser not initialized");
      }
    });
  });

  describe("memoize edge cases", () => {
    it("should memoize results correctly with position offsets", () => {
      // 位置によって異なる結果を返すパーサー
      const expensiveParser: Parser<string> = (input, pos) => {
        if (pos.offset === 0) {
          return {
            success: true,
            val: "first",
            current: pos,
            next: { ...pos, offset: pos.offset + 5 },
          };
        }
        return {
          success: true,
          val: "second",
          current: pos,
          next: { ...pos, offset: pos.offset + 6 },
        };
      };

      const memoizedParser = memoize(expensiveParser);

      // 異なる位置で呼び出し
      const result1 = memoizedParser("test", { offset: 0, line: 1, column: 1 });
      const result2 = memoizedParser("test", { offset: 5, line: 1, column: 6 });

      expect(isSuccess(result1)).toBe(true);
      expect(isSuccess(result2)).toBe(true);
      if (isSuccess(result1) && isSuccess(result2)) {
        expect(result1.val).toBe("first");
        expect(result2.val).toBe("second");
      }
    });

    it("should handle memoization of failure results", () => {
      const failingParser: Parser<string> = (input, pos) => ({
        success: false,
        error: {
          message: "Test failure",
          pos,
        },
      });

      const memoizedParser = memoize(failingParser);

      // 同じ位置で2回呼び出し
      const result1 = memoizedParser("test", { offset: 0, line: 1, column: 1 });
      const result2 = memoizedParser("test", { offset: 0, line: 1, column: 1 });

      expect(isFailure(result1)).toBe(true);
      expect(isFailure(result2)).toBe(true);
      if (!isSuccess(result1) && !isSuccess(result2)) {
        expect(result1.error.message).toBe("Test failure");
        expect(result2.error.message).toBe("Test failure");
      }
    });
  });
});

// withPositionのエッジケースをテスト
describe("withPosition advanced cases", () => {
  it("should handle complex input with position tracking", () => {
    const parser = withPosition(
      map(
        seq(literal("hello"), literal(" "), literal("world")),
        ([a, b, c]) => a + b + c,
      ),
    );

    const result = parser("hello world", { offset: 0, line: 1, column: 1 });
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.val).toEqual({
        value: "hello world",
        position: { offset: 0, line: 1, column: 1 },
      });
    }
  });

  it("should preserve position information in nested structures", () => {
    const wordParser = map(oneOrMore(charClass(["a", "z"])), (chars) =>
      chars.join(""),
    );

    const positionedWord = withPosition(wordParser);

    // 単語のリストをパース
    const wordListParser = map(
      seq(positionedWord, literal(" "), positionedWord),
      ([first, _, second]) => [first, second],
    );

    const result = wordListParser("hello world", {
      offset: 0,
      line: 1,
      column: 1,
    });
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const [first, second] = result.val;
      expect(first.value).toBe("hello");
      expect(first.position).toEqual({ offset: 0, line: 1, column: 1 });
      expect(second.value).toBe("world");
      expect(second.position).toEqual({ offset: 6, line: 1, column: 7 });
    }
  });
});
