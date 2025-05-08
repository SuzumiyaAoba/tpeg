import { describe, expect, it } from "bun:test";
import { lit } from "./basic";
import { choice, seq, sequence } from "./combinators";
import type { Pos } from "./types";

describe("seq", () => {
  it("should parse a sequence of parsers", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = seq(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "b", "c"]);
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  it("should return error if any parser fails", () => {
    const input = "abd";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = seq(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(false);
  });
});

describe("choice", () => {
  it("should parse with the first matching parser", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = choice(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should try the next parser if the previous one fails", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = choice(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("b");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should return error if all parsers fail", () => {
    const input = "d";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = choice(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(false);
  });
});

describe("sequence", () => {
  it("should be an alias for seq", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = sequence(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "b", "c"]);
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });
});
