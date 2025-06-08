import { describe, expect, it } from "bun:test";
import { lit } from "./basic";
import { map, mapResult, mapError, filter, tap } from "./transform";
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

describe("mapError", () => {
  it("should transform error on failure", () => {
    const input = "def";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = mapError(
      lit("abc"),
      (error) => ({ ...error, error: { ...error.error, message: "Custom error message" } })
    )(input, pos);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Custom error message");
    }
  });

  it("should propagate success", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = mapError(
      lit("abc"),
      (error) => ({ ...error, error: { ...error.error, message: "This shouldn't be called" } })
    )(input, pos);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
    }
  });
});

describe("filter", () => {
  it("should succeed when predicate returns true", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = filter(
      lit("abc"),
      (val) => val.length === 3,
      "Length must be 3"
    )(input, pos);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
    }
  });

  it("should fail when predicate returns false", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = filter(
      lit("abc"),
      (val) => val.length === 5,
      "Length must be 5"
    )(input, pos);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Length must be 5");
      expect(result.error.parserName).toBe("filter");
    }
  });

  it("should propagate parsing failure", () => {
    const input = "def";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = filter(
      lit("abc"),
      (val) => val.length === 3,
      "Length must be 3"
    )(input, pos);

    expect(result.success).toBe(false);
  });
});

describe("tap", () => {
  it("should execute side effect on success", () => {
    let sideEffectValue = "";
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    
    const result = tap(
      lit("abc"),
      (val: string) => { sideEffectValue = val; }
    )(input, pos);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
    }
    expect(sideEffectValue).toBe("abc");
  });

  it("should not execute side effect on failure", () => {
    let sideEffectCalled = false;
    const input = "def";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    
    const result = tap(
      lit("abc"),
      () => { sideEffectCalled = true; }
    )(input, pos);

    expect(result.success).toBe(false);
    expect(sideEffectCalled).toBe(false);
  });

  it("should return original result unchanged", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    
    const originalResult = lit("abc")(input, pos);
    const tappedResult = tap(
      lit("abc"),
      () => { /* do nothing */ }
    )(input, pos);

    expect(tappedResult).toEqual(originalResult);
  });
});
