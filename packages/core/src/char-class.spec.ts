import { describe, expect, it } from "bun:test";
import { charClass } from "./char-class";
import type { Pos } from "./types";

describe("charClass", () => {
  it("should parse a single character", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("a")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should parse a character within a range", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass(["a", "c"])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("b");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should return error if character does not match", () => {
    const input = "d";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass(["a", "c"])(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected character");
      expect(result.error.message).toContain("expected one of a-c");
      expect(result.error.pos).toEqual(pos);
    }
  });

  it("should handle newline", () => {
    const input = "\n";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("\n")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("\n");
      expect(result.next).toEqual({ offset: 1, column: 0, line: 2 });
    }
  });

  it("should return error for EOF", () => {
    const input = "";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("a")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected EOI");
      expect(result.error.message).toContain("expected a");
    }
  });
});
