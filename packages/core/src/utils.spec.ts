import { describe, expect, it } from "bun:test";
import { literal } from "./basic";
import type { ParseResult, ParseSuccess } from "./types";
import {
  createFailure,
  getCharAndLength,
  isEmptyArray,
  isFailure,
  isNonEmptyArray,
  isSuccess,
  nextPos,
  parse,
} from "./utils";

describe("isEmptyArray", () => {
  it("should return true for an empty array", () => {
    expect(isEmptyArray([])).toBe(true);
  });

  it("should return false for a non-empty array", () => {
    expect(isEmptyArray([1, 2, 3])).toBe(false);
  });
});

describe("isNonEmptyArray", () => {
  it("should return false for an empty array", () => {
    expect(isNonEmptyArray([])).toBe(false);
  });

  it("should return true for a non-empty array", () => {
    expect(isNonEmptyArray([1, 2, 3])).toBe(true);
  });
});

describe("getCharAndLength", () => {
  it("should return the character and its length for a single-byte character", () => {
    const result = getCharAndLength("abc", 0);
    expect(result).toEqual(["a", 1]);
  });

  it("should return the character and its length for a multi-byte character", () => {
    // 🙂 is a surrogate pair (U+1F642)
    const result = getCharAndLength("🙂", 0);
    expect(result).toEqual(["🙂", 2]);
  });

  it("should return empty string and zero length for out-of-range offset", () => {
    const result = getCharAndLength("abc", 5);
    expect(result).toEqual(["", 0]);
  });
});

describe("nextPos", () => {
  it("should increment column for non-newline characters", () => {
    const pos = { offset: 0, column: 0, line: 1 };
    const result = nextPos("a", pos);
    expect(result).toEqual({ offset: 1, column: 1, line: 1 });
  });

  it("should increment line and reset column for newline characters", () => {
    const pos = { offset: 5, column: 5, line: 1 };
    const result = nextPos("\n", pos);
    expect(result).toEqual({ offset: 6, column: 0, line: 2 });
  });

  it("should adjust offset by character length for multi-byte characters", () => {
    const pos = { offset: 0, column: 0, line: 1 };
    const result = nextPos("🙂", pos);
    expect(result).toEqual({ offset: 2, column: 1, line: 1 });
  });
});

describe("createFailure", () => {
  it("should create a failure result with basic error information", () => {
    const pos = { offset: 0, column: 0, line: 1 };
    const result = createFailure("Test error", pos);
    expect(result.success).toBe(false);
    expect(result.error.message).toBe("Test error");
    expect(result.error.pos).toEqual(pos);
  });

  it("should include additional error information if provided", () => {
    const pos = { offset: 5, column: 5, line: 2 };
    const result = createFailure("Test error", pos, {
      expected: "a",
      found: "b",
      parserName: "testParser",
    });
    expect(result.success).toBe(false);
    expect(result.error.message).toBe("Test error");
    expect(result.error.pos).toEqual(pos);
    expect(result.error.expected).toBe("a");
    expect(result.error.found).toBe("b");
    expect(result.error.parserName).toBe("testParser");
  });
});

describe("parse", () => {
  it("should run a parser from the beginning of input", () => {
    const parser = literal("hello");
    const parseHello = parse(parser);
    const result = parseHello("hello world");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("hello");
    }
  });

  it("should return failure for non-matching input", () => {
    const parser = literal("hello");
    const parseHello = parse(parser);
    const result = parseHello("world");
    expect(result.success).toBe(false);
  });
});

describe("isFailure", () => {
  it("should return true for failure results", () => {
    const failure = createFailure("test error", {
      offset: 0,
      column: 0,
      line: 1,
    });
    expect(isFailure(failure)).toBe(true);
  });

  it("should return false for success results", () => {
    const success: ParseSuccess<string> = {
      success: true,
      val: "test",
      current: { offset: 0, column: 0, line: 1 },
      next: { offset: 4, column: 4, line: 1 },
    };
    expect(isFailure(success)).toBe(false);
  });
});

describe("isSuccess", () => {
  it("should return false for failure results", () => {
    const failure = createFailure("test error", {
      offset: 0,
      column: 0,
      line: 1,
    });
    expect(isSuccess(failure)).toBe(false);
  });

  it("should return true for success results", () => {
    const success: ParseSuccess<string> = {
      success: true,
      val: "test",
      current: { offset: 0, column: 0, line: 1 },
      next: { offset: 4, column: 4, line: 1 },
    };
    expect(isSuccess(success)).toBe(true);
  });
});
