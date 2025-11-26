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
      expect(result.error.message).toContain("expected one of: a-c");
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
      expect(result.error.message).toContain("Unexpected end of input");
      expect(result.error.message).toContain("expected one of: a");
    }
  });

  // Multiple character class specification tests
  it("should match multiple character specifications", () => {
    const input = "3";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("a", ["0", "9"], "z")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("3");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should match first specification in mixed character specs", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("a", ["0", "9"], "z")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  // Boundary value tests for ranges
  it("should match boundary characters of range", () => {
    const input1 = "a";
    const input2 = "z";
    const pos: Pos = { offset: 0, column: 0, line: 1 };

    const result1 = charClass(["a", "z"])(input1, pos);
    const result2 = charClass(["a", "z"])(input2, pos);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    if (result1.success) expect(result1.val).toBe("a");
    if (result2.success) expect(result2.val).toBe("z");
  });

  // Unicode character tests
  it("should handle Unicode characters", () => {
    const input = "あ";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("あ")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("あ");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should handle Unicode range", () => {
    const input = "か";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass(["あ", "ん"])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("か");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  // Special character tests
  it("should handle special characters", () => {
    const input = "\t";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("\t")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("\t");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 }); // Tab is treated as single character
    }
  });

  it("should handle carriage return", () => {
    const input = "\r";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("\r")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("\r");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 }); // CR is treated as single character
    }
  });

  // Detailed error message tests
  it("should provide correct error message for multiple specs", () => {
    const input = "x";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("a", ["0", "9"], "z")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Unexpected character "x"');
      expect(result.error.message).toContain("expected one of: a, 0-9, z");
      expect(result.error.pos).toEqual(pos);
    }
  });

  // Position handling tests
  it("should correctly handle position in middle of input", () => {
    const input = "hello";
    const pos: Pos = { offset: 2, column: 2, line: 1 };
    const result = charClass("l")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("l");
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  // Surrogate pair tests
  it("should handle surrogate pair characters (emoji)", () => {
    const input = "🌍";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("🌍")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("🌍");
      expect(result.next).toEqual({ offset: 2, column: 1, line: 1 });
    }
  });

  it("should handle surrogate pair range", () => {
    const input = "😁";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    // Range from 😀 (1F600) to 🤣 (1F923)
    const result = charClass(["😀", "🤣"])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("😁");
      expect(result.next).toEqual({ offset: 2, column: 1, line: 1 });
    }
  });

  it("should fail for character outside surrogate pair range", () => {
    const input = "🤤"; // 1F924 (outside range)
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    // Range from 😀 (1F600) to 🤣 (1F923)
    const result = charClass(["😀", "🤣"])(input, pos);
    expect(result.success).toBe(false);
  });
});
