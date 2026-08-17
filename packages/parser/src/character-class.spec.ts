/**
 * Character Class Parser Tests
 */

import { describe, expect, it } from "bun:test";
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
  });
});
