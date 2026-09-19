/**
 * Character Class Parser Tests
 */

import { describe, expect, it } from "vite-plus/test";
import { characterClass } from "./character-class";

describe("characterClass", () => {
  const parser = characterClass;
  const pos = 0;

  describe("any character dot", () => {
    it("should parse dot as any character", () => {
      const result = parser(".", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("AnyChar");
      }
    });
  });

  describe("character classes", () => {
    it("should parse simple character classes", () => {
      const result = parser("[abc]", pos);
      expect(result.success).toBe(true);
      if (result.success && result.val.type === "CharacterClass") {
        expect(result.val.type).toBe("CharacterClass");
        expect(result.val.negated).toBe(false);
        expect(result.val.ranges).toHaveLength(3);
        expect(result.val.ranges[0]).toEqual({ start: "a" });
        expect(result.val.ranges[1]).toEqual({ start: "b" });
        expect(result.val.ranges[2]).toEqual({ start: "c" });
      }
    });

    it("should parse character ranges", () => {
      const result = parser("[a-z]", pos);
      expect(result.success).toBe(true);
      if (result.success && result.val.type === "CharacterClass") {
        expect(result.val.negated).toBe(false);
        expect(result.val.ranges).toHaveLength(1);
        expect(result.val.ranges[0]).toEqual({ start: "a", end: "z" });
      }
    });

    it("should parse multiple ranges and characters", () => {
      const result = parser("[a-zA-Z0-9_]", pos);
      expect(result.success).toBe(true);
      if (result.success && result.val.type === "CharacterClass") {
        expect(result.val.negated).toBe(false);
        expect(result.val.ranges).toHaveLength(4);
        expect(result.val.ranges[0]).toEqual({ start: "a", end: "z" });
        expect(result.val.ranges[1]).toEqual({ start: "A", end: "Z" });
        expect(result.val.ranges[2]).toEqual({ start: "0", end: "9" });
        expect(result.val.ranges[3]).toEqual({ start: "_" });
      }
    });

    it("should parse negated character classes", () => {
      const result = parser("[^0-9]", pos);
      expect(result.success).toBe(true);
      if (result.success && result.val.type === "CharacterClass") {
        expect(result.val.negated).toBe(true);
        expect(result.val.ranges).toHaveLength(1);
        expect(result.val.ranges[0]).toEqual({ start: "0", end: "9" });
      }
    });

    it("should parse character classes with escaped characters", () => {
      const result = parser("[\\]\\\\\\^]", pos);
      expect(result.success).toBe(true);
      if (result.success && result.val.type === "CharacterClass") {
        expect(result.val.negated).toBe(false);
        expect(result.val.ranges).toHaveLength(3);
        expect(result.val.ranges[0]).toEqual({ start: "]" });
        expect(result.val.ranges[1]).toEqual({ start: "\\" });
        expect(result.val.ranges[2]).toEqual({ start: "^" });
      }
    });
  });

  describe("error cases", () => {
    it("should fail on unclosed character class", () => {
      const result = parser("[abc", pos);
      expect(result.success).toBe(false);
    });

    it("should fail on empty input", () => {
      const result = parser("", pos);
      expect(result.success).toBe(false);
    });

    it("should fail on invalid characters", () => {
      const result = parser("abc", pos);
      expect(result.success).toBe(false);
    });

    it('allows a literal comma inside a character class (regression: "," has no special meaning in TPEG character class syntax, but a gap in the "regular characters" range previously made it impossible to write one, escaped or not)', () => {
      const result = parser("[a,b]", pos);
      expect(result.success).toBe(true);
      if (result.success && result.val.type === "CharacterClass") {
        expect(result.val.ranges).toEqual([
          { start: "a" },
          { start: "," },
          { start: "b" },
        ]);
      }
    });

    it("rejects a reversed character-class range instead of silently reinterpreting it as unrelated single characters (regression: `[z-a]` used to parse successfully -- either as a CharRange whose start code point is greater than end, matching nothing with no diagnostic, or by falling back to reparsing z, -, and a as three separate single-character alternatives)", () => {
      for (const input of ["[z-a]", "[Z-A]", "[9-0]"]) {
        const result = parser(input, pos);
        expect(result.success).toBe(false);
      }
    });

    // Regression: `charClassChar` only ever accepted ASCII printable
    // characters as a class member, so `[é]`, `[あ-ん]`, `[😀-🙏]`, and a
    // mixed `[a-zあ]` were all syntax errors even though the RUNTIME
    // (`char-set.ts`, `core/char-class.ts`) has always been code-point
    // based and already differentially tested against astral ranges
    // (`core/combinator-oracle.spec.ts`). See `character-class.ts`'s
    // non-ASCII `charClassChar` alternative.
    describe("non-ASCII characters", () => {
      it("parses a single non-ASCII character", () => {
        const result = parser("[é]", pos);
        expect(result.success).toBe(true);
        if (result.success && result.val.type === "CharacterClass") {
          expect(result.val.ranges).toEqual([{ start: "é" }]);
        }
      });

      it("parses a non-ASCII character range", () => {
        const result = parser("[あ-ん]", pos);
        expect(result.success).toBe(true);
        if (result.success && result.val.type === "CharacterClass") {
          expect(result.val.ranges).toEqual([{ start: "あ", end: "ん" }]);
        }
      });

      it("parses an astral (outside the BMP) character range as one code point per bound, not a UTF-16 surrogate half", () => {
        const result = parser("[😀-🙏]", pos);
        expect(result.success).toBe(true);
        if (result.success && result.val.type === "CharacterClass") {
          expect(result.val.ranges).toEqual([{ start: "😀", end: "🙏" }]);
        }
        // Consumed the whole 4-code-unit-each range, not just its
        // leading surrogates.
        expect(result.success && result.next).toBe("[😀-🙏]".length);
      });

      it("mixes an ASCII range with a non-ASCII single character in the same class", () => {
        const result = parser("[a-zあ]", pos);
        expect(result.success).toBe(true);
        if (result.success && result.val.type === "CharacterClass") {
          expect(result.val.ranges).toEqual([
            { start: "a", end: "z" },
            { start: "あ" },
          ]);
        }
      });

      it("negates a non-ASCII character class", () => {
        const result = parser("[^あ]", pos);
        expect(result.success).toBe(true);
        if (result.success && result.val.type === "CharacterClass") {
          expect(result.val.negated).toBe(true);
          expect(result.val.ranges).toEqual([{ start: "あ" }]);
        }
      });

      it("still rejects a reversed non-ASCII range", () => {
        const result = parser("[ん-あ]", pos);
        expect(result.success).toBe(false);
      });
    });

    describe("raw control bytes (#89)", () => {
      // docs/peg-grammar.md's escape-asymmetry note documents that a raw,
      // unescaped control character works in both string literals and
      // character classes; without these ranges, bytes like 0x01-0x07,
      // 0x0E-0x1F and DEL had no valid spelling at all.
      it("accepts a raw control-byte range", () => {
        const result = parser("[\x01-\x07]", pos);
        expect(result.success).toBe(true);
        if (result.success && result.val.type === "CharacterClass") {
          expect(result.val.ranges).toEqual([{ start: "\x01", end: "\x07" }]);
        }
      });

      it("accepts raw bytes 0x0E-0x1F and DEL", () => {
        expect(parser("[\x0e-\x1f]", pos).success).toBe(true);
        expect(parser("[\x7f]", pos).success).toBe(true);
      });

      it("still rejects the class metacharacters unescaped", () => {
        expect(parser("[a^]", pos).success).toBe(false);
        expect(parser("[z-a]", pos).success).toBe(false);
      });
    });

    describe("unified escape sequences (escape-sequence.ts)", () => {
      it("decodes \\xNN escapes", () => {
        const result = parser("[\\x41-\\x5a]", pos);
        expect(result.success).toBe(true);
        if (result.success && result.val.type === "CharacterClass") {
          expect(result.val.ranges).toEqual([{ start: "A", end: "Z" }]);
        }
      });

      it("decodes \\uXXXX escapes", () => {
        const result = parser("[\\u0041\\u3042]", pos);
        expect(result.success).toBe(true);
        if (result.success && result.val.type === "CharacterClass") {
          expect(result.val.ranges).toEqual([{ start: "A" }, { start: "あ" }]);
        }
      });

      it("decodes \\u{...} escapes including astral code points", () => {
        const result = parser("[\\u{1F600}-\\u{1F64F}]", pos);
        expect(result.success).toBe(true);
        if (result.success && result.val.type === "CharacterClass") {
          expect(result.val.ranges).toEqual([
            { start: "\u{1F600}", end: "\u{1F64F}" },
          ]);
        }
      });

      it("decodes named escapes that strings previously lacked", () => {
        // `"\b"` is a syntax error inside a string in many PEG dialects'
        // ad-hoc escape sets; TPEG's unified set decodes it as BACKSPACE
        // in both contexts.
        const result = parser("[\\b\\f\\v\\0]", pos);
        expect(result.success).toBe(true);
        if (result.success && result.val.type === "CharacterClass") {
          expect(result.val.ranges).toEqual([
            { start: "\b" },
            { start: "\f" },
            { start: "\v" },
            { start: "\0" },
          ]);
        }
      });

      it("rejects malformed numeric escapes", () => {
        expect(parser("[\\x4]", pos).success).toBe(false);
        expect(parser("[\\u041]", pos).success).toBe(false);
        expect(parser("[\\u{}]", pos).success).toBe(false);
        expect(parser("[\\u{110000}]", pos).success).toBe(false);
      });

      it("rejects a reversed range written with numeric escapes", () => {
        expect(parser("[\\x5a-\\x41]", pos).success).toBe(false);
      });
    });
  });
});
