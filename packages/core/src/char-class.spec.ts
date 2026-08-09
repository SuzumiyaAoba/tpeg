import { beforeEach, describe, expect, it } from "bun:test";
import { charClass, charClassRun, negatedCharClass } from "./char-class";
import { resetFailureWatermark } from "./failure";
import { oneOrMore, zeroOrMore } from "./repetition";

// See `combinators.spec.ts`'s identical `beforeEach` -- the farthest-failure
// watermark (`./failure.ts`) is module-global, keyed by input string VALUE.
beforeEach(() => {
  resetFailureWatermark();
});

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
      // (`./failure.ts`) rather than a per-call template string.
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

  // Regression battery for the `charCodeAt`-first hot path
  // (`makeCharClassParser`): the only place its decode can diverge from
  // the old `getCharAt` (`codePointAt` + `String.fromCodePoint`, then a
  // re-decode) is an UNPAIRED surrogate. Each case below is one code
  // unit wide and must be treated as exactly that -- one array element,
  // `next` advancing by 1 -- never merged with, or split from, a
  // neighboring code unit.
  describe("unpaired surrogate handling (hot-path decode correctness)", () => {
    it("treats a lone lead surrogate at end-of-input as one code unit", () => {
      // Matched via a class covering the whole lead-surrogate range so
      // the non-ASCII / cold decode path is exercised.
      const result = charClass(["\uD800", "\uDBFF"])("\uD800", 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("\uD800");
        expect(result.next).toBe(1);
      }
    });

    it("treats a lead surrogate followed by a non-trail character as one code unit (does not merge with the next character)", () => {
      const result = charClass(["\uD800", "\uDBFF"])("\uD800X", 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("\uD800");
        expect(result.next).toBe(1);
      }
    });

    it("treats a lone trail surrogate as one code unit", () => {
      const result = charClass(["\uDC00", "\uDFFF"])("\uDC00", 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("\uDC00");
        expect(result.next).toBe(1);
      }
    });

    it("still decodes a well-formed surrogate pair as a single 2-code-unit character", () => {
      const result = charClass(["😀", "🤣"])("😁", 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("😁");
        expect(result.next).toBe(2);
      }
    });
  });
});

describe("charClassRun", () => {
  it("returns the same array, .next, and success as oneOrMore(charClass(...)) across a mixed corpus (min=1)", () => {
    const specs: [string, string] = ["0", "9"];
    const inputs = ["", "5", "42", "42abc", "abc", "1234567890x"];
    for (const input of inputs) {
      const viaRepetition = oneOrMore(charClass(specs))(input, 0);
      const viaRun = charClassRun([specs], 1)(input, 0);
      expect(viaRun.success).toBe(viaRepetition.success);
      if (viaRepetition.success && viaRun.success) {
        expect(viaRun.val).toEqual(viaRepetition.val);
        expect(viaRun.next).toEqual(viaRepetition.next);
      }
    }
  });

  it("returns the same array, .next, and success as zeroOrMore(charClass(...)) across a mixed corpus (min=0), including the zero-match empty-array case", () => {
    const specs: [string, string] = ["a", "z"];
    const inputs = ["", "hello", "hello123", "123", "HELLO"];
    for (const input of inputs) {
      const viaRepetition = zeroOrMore(charClass(specs))(input, 0);
      const viaRun = charClassRun([specs], 0)(input, 0);
      expect(viaRun.success).toBe(true);
      expect(viaRepetition.success).toBe(true);
      if (viaRepetition.success && viaRun.success) {
        expect(viaRun.val).toEqual(viaRepetition.val);
        expect(viaRun.next).toEqual(viaRepetition.next);
      }
    }
  });

  it("matches zeroOrMore(negatedCharClass(...)) when negated: true, across astral input", () => {
    const input = '"🌍 says hello 😀"x';
    const viaRepetition = zeroOrMore(negatedCharClass('"'))(input, 1);
    const viaRun = charClassRun(['"'], 0, true)(input, 1);
    expect(viaRepetition.success).toBe(true);
    expect(viaRun.success).toBe(true);
    if (viaRepetition.success && viaRun.success) {
      expect(viaRun.val).toEqual(viaRepetition.val);
      expect(viaRun.next).toEqual(viaRepetition.next);
      // Sanity: the run should have stopped exactly at the closing quote.
      expect(input[viaRun.next]).toBe('"');
    }
  });

  it("fails with min=1 and zero matches, matching oneOrMore's first-failure behavior", () => {
    const viaRepetition = oneOrMore(charClass(["0", "9"]))("abc", 0);
    const viaRun = charClassRun([["0", "9"]], 1)("abc", 0);
    expect(viaRepetition.success).toBe(false);
    expect(viaRun.success).toBe(false);
  });

  it("succeeds with an empty array with min=0 and zero matches, matching zeroOrMore", () => {
    const result = charClassRun([["0", "9"]], 0)("abc", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toBe(0);
    }
  });

  it("reconstructs a per-code-point array across an astral (surrogate-pair) run, one array element per emoji", () => {
    const emojis = "😀😁😂";
    const viaRepetition = zeroOrMore(charClass(["😀", "🤣"]))(emojis, 0);
    const viaRun = charClassRun([["😀", "🤣"]], 0)(emojis, 0);
    expect(viaRepetition.success).toBe(true);
    expect(viaRun.success).toBe(true);
    if (viaRepetition.success && viaRun.success) {
      expect(viaRun.val).toEqual(viaRepetition.val);
      expect(viaRun.val.length).toBe(3);
      expect(viaRun.next).toEqual(viaRepetition.next);
      expect(viaRun.next).toBe(6); // 3 astral chars * 2 code units each
    }
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

// Construction-time validation, shared by `charClass`/`negatedCharClass`/
// `charClassRun` since all three compile their specs through the same
// `compileSpecs` (`./char-class.ts`) -- see its doc comment for why each
// malformed shape below is rejected eagerly instead of silently compiling
// to a class that matches the wrong thing (or nothing at all). Mirrors
// `quantified`'s own construction-time validation of an invalid
// `min`/`max` (`./repetition.ts`).
describe("construction-time validation (malformed specs)", () => {
  it("throws for a single-char spec with more than one code point", () => {
    expect(() => charClass("ab")).toThrow(/not exactly one character/);
  });

  it("throws for a backwards range (start after end)", () => {
    expect(() => charClass(["z", "a"])).toThrow(/start .* is greater than end/);
  });

  it("throws for a range whose bound is more than one code point", () => {
    expect(() => charClass(["a", "bc"])).toThrow(
      /must be exactly one character/,
    );
    expect(() => charClass(["ab", "c"])).toThrow(
      /must be exactly one character/,
    );
  });

  it("does NOT throw for a single astral character (one code point, two UTF-16 code units)", () => {
    expect(() => charClass("😀")).not.toThrow();
    expect(() => charClass(["😀", "🤣"])).not.toThrow();
  });

  it("a same-character range (start === end) is valid, not backwards", () => {
    expect(() => charClass(["a", "a"])).not.toThrow();
  });

  it("negatedCharClass and charClassRun validate identically (same compileSpecs)", () => {
    expect(() => negatedCharClass("ab")).toThrow();
    expect(() => negatedCharClass(["z", "a"])).toThrow();
    expect(() => charClassRun(["ab"], 0)).toThrow();
    expect(() => charClassRun([["z", "a"]], 0)).toThrow();
  });

  it("a malformed spec among several valid ones still throws (the whole call is rejected, not just that entry)", () => {
    expect(() => charClass(["a", "z"], "toolong", ["0", "9"])).toThrow();
  });
});
