import { describe, expect, it } from "bun:test";
import { any, anyChar, lit, literal } from "./basic";
import type { Pos } from "./types";
import { parse } from "./utils";

describe("any", () => {
  it("should parse any single character", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should parse newline character", () => {
    const input = "\n";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("\n");
      expect(result.next).toEqual({ offset: 1, column: 0, line: 2 });
    }
  });

  it("should return error for empty input", () => {
    const input = "";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Unexpected EOI");
      expect(result.error.pos).toEqual(pos);
    }
  });

  it("should return error for out of bound", () => {
    const input = "a";
    const pos: Pos = { offset: 1, column: 1, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Unexpected EOI");
      expect(result.error.pos).toEqual(pos);
    }
  });
});

describe("string", () => {
  it("should parse a string", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("abc")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  it("should return error if string does not match", () => {
    const input = "abd";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("abc")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected character");
      expect(result.error.pos).toEqual({ offset: 2, column: 2, line: 1 });
    }
  });

  it("should handle newline in string", () => {
    const input = "a\nb";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("a\nb")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a\nb");
      expect(result.next).toEqual({ offset: 3, column: 1, line: 2 });
    }
  });

  it("should handle surrogate pairs correctly", () => {
    // 𝄞 (musical G clef) is a surrogate pair (U+1D11E) represented as \uD834\uDD1E
    const input = "𝄞abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("𝄞abc")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("𝄞abc");
      // 𝄞 is a surrogate pair (2 code units) + 3 characters
      expect(result.next).toEqual({ offset: 5, column: 4, line: 1 });
    }
  });

  it("should correctly parse emoji characters", () => {
    // 🙂 is a surrogate pair (U+1F642)
    const input = "🙂🙂";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("🙂🙂")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("🙂🙂");
      // Each emoji is 2 code units, so 4 in total
      expect(result.next).toEqual({ offset: 4, column: 2, line: 1 });
    }
  });

  it("should handle mixed normal and surrogate pair characters", () => {
    const input = "a🙂b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("a🙂b")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a🙂b");
      // 1 (a) + 2 (🙂) + 1 (b) = 4 code units
      expect(result.next).toEqual({ offset: 4, column: 3, line: 1 });
    }
  });

  it("should fail correctly on partial emoji mismatch", () => {
    const input = "a🙃b"; // Different emoji (upside-down smile)
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("a🙂b")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected character");
      expect(result.error.pos).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });
});

describe("anyChar()", () => {
  it("should parse any single character", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = anyChar()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });
});

describe("literal(str)", () => {
  it("should parse a string", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = literal("abc")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });
});

describe("parse", () => {
  it("should parse input with the given parser", () => {
    const input = "abc";
    const result = parse(lit("abc"))(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
    }
  });

  it("should return error if parser fails", () => {
    const input = "abd";
    const result = parse(lit("abc"))(input);
    expect(result.success).toBe(false);
  });
});
