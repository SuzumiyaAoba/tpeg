import { describe, expect, it } from "bun:test";
import { literal as lit } from "./basic";
import { charClass } from "./char-class";
import { seq } from "./combinators";
import {
  oneOrMore,
  opt,
  optional,
  plus,
  quantified,
  star,
  zeroOrMore,
} from "./repetition";
import type { Parser, Pos } from "./types";
import { isFailure, isSuccess } from "./utils";

describe("opt", () => {
  it("should parse with the given parser", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = opt(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a"]);
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should return empty array and not consume input if parser fails", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = opt(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toEqual(pos);
    }
  });
});

describe("star", () => {
  it("should parse zero or more occurrences", () => {
    const input = "aaa";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = star(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a", "a"]);
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  it("should return empty array if parser never matches", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = star(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toEqual(pos);
    }
  });
});

describe("plus", () => {
  it("should parse one or more occurrences", () => {
    const input = "aaa";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = plus(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a", "a"]);
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  it("should return error if parser never matches", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = plus(lit("a"))(input, pos);
    expect(result.success).toBe(false);
  });
});

describe("optional", () => {
  it("should be an alias for opt", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = optional(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a"]);
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });
});

describe("zeroOrMore", () => {
  it("should be an alias for star", () => {
    const input = "aaa";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = zeroOrMore(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a", "a"]);
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });
});

describe("oneOrMore", () => {
  it("should be an alias for plus", () => {
    const input = "aaa";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = oneOrMore(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a", "a"]);
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });
});

// Additional tests - edge cases and misuse scenarios
describe("repetition edge cases", () => {
  // Test for infinite loop detection
  it("should detect infinite loops in zeroOrMore", () => {
    // Parser that always returns the same position
    const infiniteParser: Parser<string> = (_input, pos) => ({
      success: true,
      val: "",
      current: pos,
      next: pos, // Does not consume input
    });

    const parser = zeroOrMore(infiniteParser);
    const result = parser("test", { offset: 0, line: 1, column: 0 });

    expect(isFailure(result)).toBe(true);
    if (!isSuccess(result)) {
      expect(result.error.message).toContain("Infinite loop detected");
    }
  });

  it("should detect infinite loops in oneOrMore", () => {
    // Parser that always returns the same position
    const infiniteParser: Parser<string> = (_input, pos) => ({
      success: true,
      val: "",
      current: pos,
      next: pos, // Does not consume input
    });

    const parser = oneOrMore(infiniteParser);
    const result = parser("test", { offset: 0, line: 1, column: 0 });

    // First match succeeds, but second and subsequent would cause infinite loop
    expect(isFailure(result)).toBe(true);
    if (!isSuccess(result)) {
      expect(result.error.message).toContain("Infinite loop detected");
    }
  });

  // 新しいテストケース：空文字列の処理
  it("should handle empty input correctly", () => {
    const input = "";
    const pos: Pos = { offset: 0, column: 0, line: 1 };

    // optional should return empty array
    const optResult = opt(lit("a"))(input, pos);
    expect(optResult.success).toBe(true);
    if (optResult.success) {
      expect(optResult.val).toEqual([]);
      expect(optResult.next).toEqual(pos);
    }

    // zeroOrMore should return empty array
    const starResult = star(lit("a"))(input, pos);
    expect(starResult.success).toBe(true);
    if (starResult.success) {
      expect(starResult.val).toEqual([]);
      expect(starResult.next).toEqual(pos);
    }

    // oneOrMore should fail
    const plusResult = plus(lit("a"))(input, pos);
    expect(plusResult.success).toBe(false);
    if (!plusResult.success) {
      expect(plusResult.error.message).toContain("end of input");
    }
  });

  // 新しいテストケース：エラーメッセージの品質確認
  it("should provide meaningful error messages for oneOrMore failures", () => {
    const input = "xyz";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = plus(lit("a"))(input, pos);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected character");
      expect(result.error.pos.offset).toBe(0);
    }
  });

  // 新しいテストケース：位置情報の正確性確認
  it("should maintain correct position information", () => {
    const input = "abcdef";
    const pos: Pos = { offset: 2, column: 3, line: 1 };

    // Position should be maintained correctly
    const result = zeroOrMore(lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["c"]);
      expect(result.current).toEqual(pos);
      expect(result.next).toEqual({ offset: 3, column: 4, line: 1 });
    }
  });

  // 新しいテストケース：複雑なネストしたパターン
  it("should handle deeply nested repetitions", () => {
    // Pattern: zero or more groups of (one or more 'a' followed by optional 'b')
    const groupParser = seq(oneOrMore(lit("a")), optional(lit("b")));
    const parser = zeroOrMore(groupParser);

    const result = parser("aaabaaab", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.val).toEqual([
        [["a", "a", "a"], ["b"]],
        [["a", "a", "a"], ["b"]],
      ]);
    }
  });

  // 新しいテストケース：NonEmptyArray型の型安全性確認
  it("should ensure type safety for NonEmptyArray", () => {
    const input = "aaa";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = oneOrMore(lit("a"))(input, pos);

    expect(result.success).toBe(true);
    if (result.success) {
      // TypeScriptの型システムによりNonEmptyArrayであることが保証される
      expect(result.val.length).toBeGreaterThan(0);
      expect(result.val[0]).toBe("a");
    }
  });

  // 新しいテストケース：パフォーマンス関連
  it("should handle large inputs efficiently", () => {
    const largeInput = "a".repeat(1000);
    const pos: Pos = { offset: 0, column: 0, line: 1 };

    const startTime = performance.now();
    const result = zeroOrMore(lit("a"))(largeInput, pos);
    const endTime = performance.now();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.length).toBe(1000);
      // 1秒以内に完了することを確認（合理的なパフォーマンス期待）
      expect(endTime - startTime).toBeLessThan(1000);
    }
  });

  // 新しいテストケース：複数行の処理
  it("should handle multiline input correctly", () => {
    const input = "a\na\na";
    const pos: Pos = { offset: 0, column: 0, line: 1 };

    // Should parse first 'a' only (literal doesn't cross lines)
    const result = zeroOrMore(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a"]);
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should handle sequences of repetitions", () => {
    // Pattern with sequence of digits followed by sequence of letters
    const digitParser = charClass(["0", "9"]);
    const letterParser = charClass(["a", "z"]);

    const parser = seq(oneOrMore(digitParser), oneOrMore(letterParser));
    const result = parser("123abc", { offset: 0, line: 1, column: 0 });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.val).toEqual([
        ["1", "2", "3"],
        ["a", "b", "c"],
      ]);
    }
  });

  it("should handle optional parser with nested structure", () => {
    // Optional nested structure
    const innerParser = seq(lit("("), lit(")"));
    const parser = optional(innerParser);

    // Matching case
    const result1 = parser("()", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result1)).toBe(true);
    if (isSuccess(result1)) {
      expect(result1.val).toEqual([["(", ")"]]);
    }

    // Non-matching case
    const result2 = parser("x", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result2)) {
      expect(result2.val).toEqual([]);
    }
  });

  it("should handle complex zeroOrMore patterns", () => {
    // Complex zeroOrMore: zero or more repetitions of (digit+letter)
    const pattern = seq(charClass(["0", "9"]), charClass(["a", "z"]));

    const parser = zeroOrMore(pattern);

    // Multiple match case
    const result1 = parser("1a2b3c", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result1)).toBe(true);
    if (isSuccess(result1)) {
      expect(result1.val).toEqual([
        ["1", "a"],
        ["2", "b"],
        ["3", "c"],
      ]);
    }

    // Non-matching case
    const result2 = parser("xyz", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result2)) {
      expect(result2.val).toEqual([]);
    }
  });

  it("should test the boundary between opt and zeroOrMore", () => {
    // Test the difference between optional (0 or 1) and zeroOrMore (0 or more)
    const charA = lit("a");
    const optParser = optional(charA);
    const zeroOrMoreParser = zeroOrMore(charA);

    // For a single character
    const resultOpt1 = optParser("a", { offset: 0, line: 1, column: 0 });
    const resultZeroOrMore1 = zeroOrMoreParser("a", {
      offset: 0,
      line: 1,
      column: 1,
    });

    expect(isSuccess(resultOpt1)).toBe(true);
    expect(isSuccess(resultZeroOrMore1)).toBe(true);
    if (isSuccess(resultOpt1) && isSuccess(resultZeroOrMore1)) {
      expect(resultOpt1.val).toEqual(["a"]);
      expect(resultZeroOrMore1.val).toEqual(["a"]);
    }

    // For multiple characters
    const resultOpt2 = optParser("aaa", { offset: 0, line: 1, column: 0 });
    const resultZeroOrMore2 = zeroOrMoreParser("aaa", {
      offset: 0,
      line: 1,
      column: 1,
    });

    expect(isSuccess(resultOpt2)).toBe(true);
    expect(isSuccess(resultZeroOrMore2)).toBe(true);
    if (isSuccess(resultOpt2) && isSuccess(resultZeroOrMore2)) {
      // optional matches at most once
      expect(resultOpt2.val).toEqual(["a"]);
      expect(resultOpt2.next.offset).toBe(1);

      // zeroOrMore matches as much as possible
      expect(resultZeroOrMore2.val).toEqual(["a", "a", "a"]);
      expect(resultZeroOrMore2.next.offset).toBe(3);
    }
  });
});

describe("quantified", () => {
  it("should parse exactly n times", () => {
    const parser = quantified(lit("a"), 3, 3);
    const result = parser("aaa", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.val).toEqual(["a", "a", "a"]);
      expect(result.next.offset).toBe(3);
    }
  });

  it("should parse range {n,m}", () => {
    const parser = quantified(lit("a"), 2, 4);

    // Test minimum case
    const result1 = parser("aa", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result1)).toBe(true);
    if (isSuccess(result1)) {
      expect(result1.val).toEqual(["a", "a"]);
    }

    // Test middle case
    const result2 = parser("aaa", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result2)) {
      expect(result2.val).toEqual(["a", "a", "a"]);
    }

    // Test maximum case
    const result3 = parser("aaaa", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result3)).toBe(true);
    if (isSuccess(result3)) {
      expect(result3.val).toEqual(["a", "a", "a", "a"]);
    }

    // Test beyond maximum (should stop at max)
    const result4 = parser("aaaaa", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result4)).toBe(true);
    if (isSuccess(result4)) {
      expect(result4.val).toEqual(["a", "a", "a", "a"]);
      expect(result4.next.offset).toBe(4); // Should not consume the 5th 'a'
    }
  });

  it("should parse minimum {n,} (unbounded)", () => {
    const parser = quantified(lit("a"), 2);

    // Test minimum case
    const result1 = parser("aa", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result1)).toBe(true);
    if (isSuccess(result1)) {
      expect(result1.val).toEqual(["a", "a"]);
    }

    // Test many repetitions
    const result2 = parser("aaaaaa", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result2)) {
      expect(result2.val).toEqual(["a", "a", "a", "a", "a", "a"]);
    }
  });

  it("should handle zero minimum {0,n}", () => {
    const parser = quantified(lit("a"), 0, 3);

    // Test no matches
    const result1 = parser("b", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result1)).toBe(true);
    if (isSuccess(result1)) {
      expect(result1.val).toEqual([]);
    }

    // Test some matches
    const result2 = parser("aa", { offset: 0, line: 1, column: 0 });
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result2)) {
      expect(result2.val).toEqual(["a", "a"]);
    }
  });

  it("should fail if minimum not met", () => {
    const parser = quantified(lit("a"), 3, 5);

    // Test insufficient matches
    const result1 = parser("aa", { offset: 0, line: 1, column: 0 });
    expect(isFailure(result1)).toBe(true);
    if (isFailure(result1)) {
      // Should fail when trying to parse 3rd "a" but only 2 available
      expect(result1.error.message).toContain("end of input");
      expect(result1.error.parserName).toBe("quantified");
    }

    // Test no matches
    const result2 = parser("b", { offset: 0, line: 1, column: 0 });
    expect(isFailure(result2)).toBe(true);
    if (isFailure(result2)) {
      // Should fail when trying to parse 1st "a" but got "b"
      expect(result2.error.message).toContain('Unexpected character "b"');
      expect(result2.error.parserName).toBe("quantified");
    }
  });

  it("should validate parameters", () => {
    // Test negative minimum
    const parser1 = quantified(lit("a"), -1, 3);
    const result1 = parser1("a", { offset: 0, line: 1, column: 0 });
    expect(isFailure(result1)).toBe(true);
    if (isFailure(result1)) {
      expect(result1.error.message).toContain(
        "minimum (-1) cannot be negative",
      );
    }

    // Test max < min
    const parser2 = quantified(lit("a"), 5, 3);
    const result2 = parser2("a", { offset: 0, line: 1, column: 0 });
    expect(isFailure(result2)).toBe(true);
    if (isFailure(result2)) {
      expect(result2.error.message).toContain(
        "maximum (3) cannot be less than minimum (5)",
      );
    }
  });

  it("should detect infinite loops", () => {
    // Parser that always succeeds but consumes no input
    const infiniteParser: Parser<string> = (_input, pos) => ({
      success: true,
      val: "",
      current: pos,
      next: pos, // Does not advance position
    });

    const parser = quantified(infiniteParser, 1, 3);
    const result = parser("test", { offset: 0, line: 1, column: 0 });

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.message).toContain("Infinite loop detected");
    }
  });

  it("should be equivalent to existing parsers for special cases", () => {
    // {0,} should be equivalent to zeroOrMore
    const quantifiedParser = quantified(lit("a"), 0);
    const zeroOrMoreParser = zeroOrMore(lit("a"));

    const input = "aaab";
    const pos = { offset: 0, line: 1, column: 0 };

    const result1 = quantifiedParser(input, pos);
    const result2 = zeroOrMoreParser(input, pos);

    expect(isSuccess(result1)).toBe(true);
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result1) && isSuccess(result2)) {
      expect(result1.val).toEqual(result2.val);
      expect(result1.next.offset).toBe(result2.next.offset);
    }

    // {1,} should be equivalent to oneOrMore
    const quantifiedParser2 = quantified(lit("a"), 1);
    const oneOrMoreParser = oneOrMore(lit("a"));

    const result3 = quantifiedParser2(input, pos);
    const result4 = oneOrMoreParser(input, pos);

    expect(isSuccess(result3)).toBe(true);
    expect(isSuccess(result4)).toBe(true);
    if (isSuccess(result3) && isSuccess(result4)) {
      expect(result3.val).toEqual(result4.val);
      expect(result3.next.offset).toBe(result4.next.offset);
    }

    // {0,1} should be equivalent to optional
    const quantifiedParser3 = quantified(lit("a"), 0, 1);
    const optionalParser = optional(lit("a"));

    const result5 = quantifiedParser3(input, pos);
    const result6 = optionalParser(input, pos);

    expect(isSuccess(result5)).toBe(true);
    expect(isSuccess(result6)).toBe(true);
    if (isSuccess(result5) && isSuccess(result6)) {
      expect(result5.val).toEqual(result6.val);
      expect(result5.next.offset).toBe(result6.next.offset);
    }
  });
});
