import { describe, expect, it } from "bun:test";
import { lit } from "./basic";
import { and, andPredicate, not, notPredicate } from "./lookahead";
import type { Pos } from "./types";

describe("andPredicate", () => {
  it("should succeed if the parser succeeds", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = andPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeUndefined();
      expect(result.next).toEqual(pos); // position is not advanced
    }
  });

  it("should fail if the parser fails", () => {
    const input = "bcd";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = andPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(false);
  });
});

describe("notPredicate", () => {
  it("should succeed if the parser fails", () => {
    const input = "bcd";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = notPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeUndefined();
      expect(result.next).toEqual(pos); // position is not advanced
    }
  });

  it("should fail if the parser succeeds", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = notPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(false);
  });
});

describe("and", () => {
  it("should be an alias for andPredicate", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = and(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeUndefined();
      expect(result.next).toEqual(pos);
    }
  });
});

describe("not", () => {
  it("should be an alias for notPredicate", () => {
    const input = "bcd";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = not(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeUndefined();
      expect(result.next).toEqual(pos);
    }
  });
});
