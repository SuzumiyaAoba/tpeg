import { describe, expect, it } from "bun:test";
import { Grammar } from "./arith";

// Helper function to create a Pos object
const createPos = (offset: number, line = 1, column?: number) => ({
  offset,
  line,
  column: column ?? offset,
});

describe("Grammar", () => {
  it("should parse simple numbers", () => {
    expect(Grammar("123", createPos(0))).toEqual({
      success: true,
      val: 123,
      next: createPos(3),
    });
  });

  it("should parse addition", () => {
    expect(Grammar("1+2", createPos(0))).toEqual({
      success: true,
      val: 3,
      next: createPos(3),
    });
  });

  it("should parse subtraction", () => {
    expect(Grammar("3-1", createPos(0))).toEqual({
      success: true,
      val: 2,
      next: createPos(3),
    });
  });

  it("should parse multiplication", () => {
    expect(Grammar("2*3", createPos(0))).toEqual({
      success: true,
      val: 6,
      next: createPos(3),
    });
  });

  it("should parse division", () => {
    expect(Grammar("6/2", createPos(0))).toEqual({
      success: true,
      val: 3,
      next: createPos(3),
    });
  });

  it("should calculate float numbers", () => {
    expect(Grammar("1/2", createPos(0))).toEqual({
      success: true,
      val: 0.5,
      next: createPos(3),
    });
  });

  it("should parse modulo", () => {
    expect(Grammar("7%3", createPos(0))).toEqual({
      success: true,
      val: 1,
      next: createPos(3),
    });
  });

  it("should parse complex expressions", () => {
    expect(Grammar("1+2*3", createPos(0))).toEqual({
      success: true,
      val: 7,
      next: createPos(5),
    });
  });

  it("should parse expressions with parentheses", () => {
    expect(Grammar("(1+2)*3", createPos(0))).toEqual({
      success: true,
      val: 9,
      next: createPos(7),
    });
  });

  it("should parse a more complex expression", () => {
    expect(Grammar("(1+2)*3-4/2", createPos(0))).toEqual({
      success: true,
      val: 7,
      next: createPos(11),
    });
  });

  it("should handle errors gracefully (missing operand)", () => {
    const result = Grammar("1+", createPos(0));
    expect(result.success).toBe(false);
  });

  it("should handle errors gracefully (invalid character)", () => {
    const result = Grammar("1+a", createPos(0));
    expect(result.success).toBe(false);
  });

  it("should handle errors gracefully (unclosed parenthesis)", () => {
    const result = Grammar("(1+2)*3-", createPos(0));
    expect(result.success).toBe(false);
  });

  it("should handle spaces correctly", () => {
    expect(Grammar(" 1 + 2 ", createPos(0))).toEqual({
      success: true,
      val: 3,
      next: createPos(7),
    });
  });

  it("should handle multiple spaces correctly", () => {
    expect(Grammar("  1  +  2  ", createPos(0))).toEqual({
      success: true,
      val: 3,
      next: createPos(11),
    });
  });

  it("should handle tabs correctly", () => {
    expect(Grammar("1\t+\t2", createPos(0))).toEqual({
      success: true,
      val: 3,
      next: createPos(5),
    });
  });
});
