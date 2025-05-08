import { describe, expect, it } from "bun:test";
import { lit } from "./basic";
import { map, mapResult } from "./transform";
import type { ParseSuccess, Pos } from "./types";

describe("map", () => {
  it("should transform the result value", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = map(lit("abc"), (val) => val.length)(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe(3);
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  it("should propagate failure", () => {
    const input = "def";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = map(lit("abc"), (val) => val.length)(input, pos);
    expect(result.success).toBe(false);
  });
});

describe("mapResult(parser, f)", () => {
  it("should transform the success result", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = mapResult(lit("abc"), (result: ParseSuccess<string>) =>
      result.val.toUpperCase(),
    )(input, pos);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("ABC");
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  it("should propagate failure", () => {
    const input = "def";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = mapResult(lit("abc"), (result: ParseSuccess<string>) =>
      result.val.toUpperCase(),
    )(input, pos);

    expect(result.success).toBe(false);
  });
});
