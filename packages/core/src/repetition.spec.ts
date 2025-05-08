import { describe, expect, it } from "bun:test";
import { lit } from "./basic";
import { oneOrMore, opt, optional, plus, star, zeroOrMore } from "./repetition";
import type { Pos } from "./types";

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
