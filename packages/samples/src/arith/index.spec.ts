import { describe, expect, it } from "vite-plus/test";

import { Grammar } from "./index";

const START = 0;

const pos = (offset: number): number => offset;

describe("Grammar", () => {
  it("should parse simple numbers", () => {
    expect(Grammar("123", START)).toEqual({
      success: true,
      val: 123,
      current: START,
      next: pos(3),
    });
  });

  it("should parse addition", () => {
    expect(Grammar("1+2", START)).toEqual({
      success: true,
      val: 3,
      current: START,
      next: pos(3),
    });
  });

  it("should parse subtraction", () => {
    expect(Grammar("3-1", START)).toEqual({
      success: true,
      val: 2,
      current: START,
      next: pos(3),
    });
  });

  it("should parse multiplication", () => {
    expect(Grammar("2*3", START)).toEqual({
      success: true,
      val: 6,
      current: START,
      next: pos(3),
    });
  });

  it("should parse division", () => {
    expect(Grammar("6/2", START)).toEqual({
      success: true,
      val: 3,
      current: START,
      next: pos(3),
    });
  });

  it("should calculate float numbers", () => {
    expect(Grammar("1/2", START)).toEqual({
      success: true,
      val: 0.5,
      current: START,
      next: pos(3),
    });
  });

  it("should parse modulo", () => {
    expect(Grammar("7%3", START)).toEqual({
      success: true,
      val: 1,
      current: START,
      next: pos(3),
    });
  });

  it("should parse complex expressions", () => {
    expect(Grammar("1+2*3", START)).toEqual({
      success: true,
      val: 7,
      current: START,
      next: pos(5),
    });
  });

  it("should parse expressions with parentheses", () => {
    expect(Grammar("(1+2)*3", START)).toEqual({
      success: true,
      val: 9,
      current: START,
      next: pos(7),
    });
  });

  it("should parse a more complex expression", () => {
    expect(Grammar("(1+2)*3-4/2", START)).toEqual({
      success: true,
      val: 7,
      current: START,
      next: pos(11),
    });
  });

  it("should handle errors gracefully (missing operand)", () => {
    const result = Grammar("1+", START);
    expect(result.success).toBe(false);
  });

  it("should handle errors gracefully (invalid character)", () => {
    const result = Grammar("1+a", START);
    expect(result.success).toBe(false);
  });

  it("should handle errors gracefully (unclosed parenthesis)", () => {
    const result = Grammar("(1+2)*3-", START);
    expect(result.success).toBe(false);
  });

  it("should handle spaces correctly", () => {
    expect(Grammar(" 1 + 2 ", START)).toEqual({
      success: true,
      val: 3,
      current: START,
      next: pos(7),
    });
  });

  it("should handle multiple spaces correctly", () => {
    expect(Grammar("  1  +  2  ", START)).toEqual({
      success: true,
      val: 3,
      current: START,
      next: pos(11),
    });
  });

  it("should handle tabs correctly", () => {
    expect(Grammar("1\t+\t2", START)).toEqual({
      success: true,
      val: 3,
      current: START,
      next: pos(5),
    });
  });

  // Regression: the Factor->Expr parenthesized-expression recursion used
  // to be a bare `(input, pos) => Expr(input, pos)` lambda, which bypassed
  // `guardedParserCall` (`PARSER_LIMITS.MAX_RECURSION_DEPTH`) entirely --
  // an input nesting deeper than the JS stack threw an uncaught
  // `RangeError` out of the parser instead of returning a ParseResult
  // failure (the fix class of #114, applied to generated parsers but
  // missed here).
  it("should fail cleanly rather than overflow the stack on pathological nesting", () => {
    const depth = 2000; // > PARSER_LIMITS.MAX_RECURSION_DEPTH (1000)
    const input = `${"(".repeat(depth)}1${")".repeat(depth)}`;

    let result: ReturnType<typeof Grammar> | undefined;
    expect(() => {
      result = Grammar(input, START);
    }).not.toThrow();

    expect(result?.success).toBe(false);
    if (result && !result.success) {
      expect(result.error.abort).toBe(true);
      expect(result.error.message).toContain("Recursion depth limit");
    }
  });

  it("should still parse nesting within the recursion limit", () => {
    const depth = 50;
    const input = `${"(".repeat(depth)}1${")".repeat(depth)}`;
    const result = Grammar(input, START);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe(1);
    }
  });
});
