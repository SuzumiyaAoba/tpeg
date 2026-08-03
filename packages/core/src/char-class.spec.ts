import { describe, expect, it } from "bun:test";
import { charClass, negatedCharClass } from "./char-class";

describe("charClass", () => {
  it("should parse a single character", () => {
    const input = "a";
    const pos = 0;
    const result = charClass("a")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toBe(1);
    }
  });

  it("should parse a character within a range", () => {
    const input = "b";
    const pos = 0;
    const result = charClass(["a", "c"])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("b");
      expect(result.next).toBe(1);
    }
  });

  it("should return error if character does not match", () => {
    const input = "d";
    const pos = 0;
    const result = charClass(["a", "c"])(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Message now comes from the shared farthest-failure watermark
      // (`./failure.ts`, Pillar 6 of the perf plan) rather than a
      // per-call template string.
      expect(result.error.message).toBe('Expected a-c, found "d"');
      expect(result.error.expected).toBe("a-c");
      expect(result.error.found).toBe("d");
      expect(result.error.pos).toEqual(pos);
    }
  });

  it("should handle newline", () => {
    const input = "\n";
    const pos = 0;
    const result = charClass("\n")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("\n");
      expect(result.next).toBe(1);
    }
  });

  it("should return error for EOF", () => {
    const input = "";
    const pos = 0;
    const result = charClass("a")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Expected a, found "end of input"');
      expect(result.error.expected).toBe("a");
      expect(result.error.found).toBe("end of input");
    }
  });

  // Multiple character class specification tests
  it("should match multiple character specifications", () => {
    const input = "3";
    const pos = 0;
    const result = charClass("a", ["0", "9"], "z")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("3");
      expect(result.next).toBe(1);
    }
  });

  it("should match first specification in mixed character specs", () => {
    const input = "a";
    const pos = 0;
    const result = charClass("a", ["0", "9"], "z")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toBe(1);
    }
  });

  // Boundary value tests for ranges
  it("should match boundary characters of range", () => {
    const input1 = "a";
    const input2 = "z";
    const pos = 0;

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
    const pos = 0;
    const result = charClass("あ")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("あ");
      expect(result.next).toBe(1);
    }
  });

  it("should handle Unicode range", () => {
    const input = "か";
    const pos = 0;
    const result = charClass(["あ", "ん"])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("か");
      expect(result.next).toBe(1);
    }
  });

  // Special character tests
  it("should handle special characters", () => {
    const input = "\t";
    const pos = 0;
    const result = charClass("\t")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("\t");
      expect(result.next).toBe(1); // Tab is treated as single character
    }
  });

  it("should handle carriage return", () => {
    const input = "\r";
    const pos = 0;
    const result = charClass("\r")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("\r");
      expect(result.next).toBe(1); // CR is treated as single character
    }
  });

  // Detailed error message tests
  it("should provide correct error message for multiple specs", () => {
    const input = "x";
    const pos = 0;
    const result = charClass("a", ["0", "9"], "z")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Expected a, 0-9, z, found "x"');
      expect(result.error.expected).toBe("a, 0-9, z");
      expect(result.error.pos).toEqual(pos);
    }
  });

  // Position handling tests
  it("should correctly handle position in middle of input", () => {
    const input = "hello";
    const pos = 2;
    const result = charClass("l")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("l");
      expect(result.next).toBe(3);
    }
  });

  // Surrogate pair tests
  it("should handle surrogate pair characters (emoji)", () => {
    const input = "🌍";
    const pos = 0;
    const result = charClass("🌍")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("🌍");
      expect(result.next).toBe(2);
    }
  });

  it("should handle surrogate pair range", () => {
    const input = "😁";
    const pos = 0;
    // Range from 😀 (1F600) to 🤣 (1F923)
    const result = charClass(["😀", "🤣"])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("😁");
      expect(result.next).toBe(2);
    }
  });

  it("should fail for character outside surrogate pair range", () => {
    const input = "🤤"; // 1F924 (outside range)
    const pos = 0;
    // Range from 😀 (1F600) to 🤣 (1F923)
    const result = charClass(["😀", "🤣"])(input, pos);
    expect(result.success).toBe(false);
  });
});

describe("negatedCharClass", () => {
  it("should succeed on a character not in the exclusion set", () => {
    const input = "5";
    const pos = 0;
    const result = negatedCharClass(["a", "z"])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("5");
      expect(result.next).toBe(1);
    }
  });

  it("should fail on a character within an excluded range", () => {
    const input = "m";
    const pos = 0;
    const result = negatedCharClass(["a", "z"])(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Expected not one of: a-z, found "m"');
    }
  });

  it("should fail on an excluded single character", () => {
    const input = '"';
    const pos = 0;
    const result = negatedCharClass('"', "\\")(input, pos);
    expect(result.success).toBe(false);
  });

  it("should fail at end of input", () => {
    const input = "";
    const pos = 0;
    const result = negatedCharClass(["a", "z"])(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe(
        'Expected not one of: a-z, found "end of input"',
      );
    }
  });
});
