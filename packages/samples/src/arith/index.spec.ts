import { describe, expect, it } from "bun:test";

import { Grammar } from "./index";

const START = {
  offset: 0,
  column: 0,
  line: 1,
} as const;

const pos = (offset: number) => ({ offset, line: 1, column: offset });

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
});
