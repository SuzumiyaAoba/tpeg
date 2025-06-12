/**
 * Lookahead-Composition Integration Tests
 *
 * Tests that verify lookahead operators work correctly with composition and repetition operators.
 */

import { describe, expect, it } from "bun:test";
import { expression } from "./composition";

const pos = { offset: 0, line: 1, column: 1 };

describe("lookahead-composition integration", () => {
  describe("lookahead with basic syntax", () => {
    it("should parse positive lookahead with string literal", () => {
      const result = expression('&"hello"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("PositiveLookahead");
        if (result.val.type === "PositiveLookahead") {
          expect(result.val.expression.type).toBe("StringLiteral");
          if (result.val.expression.type === "StringLiteral") {
            expect(result.val.expression.value).toBe("hello");
          }
        }
      }
    });

    it("should parse negative lookahead with string literal", () => {
      const result = expression('!"hello"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("NegativeLookahead");
        if (result.val.type === "NegativeLookahead") {
          expect(result.val.expression.type).toBe("StringLiteral");
          if (result.val.expression.type === "StringLiteral") {
            expect(result.val.expression.value).toBe("hello");
          }
        }
      }
    });

    it("should parse positive lookahead with character class", () => {
      const result = expression("&[a-z]", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("PositiveLookahead");
        if (result.val.type === "PositiveLookahead") {
          expect(result.val.expression.type).toBe("CharacterClass");
        }
      }
    });

    it("should parse negative lookahead with identifier", () => {
      const result = expression("!identifier", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("NegativeLookahead");
        if (result.val.type === "NegativeLookahead") {
          expect(result.val.expression.type).toBe("Identifier");
          if (result.val.expression.type === "Identifier") {
            expect(result.val.expression.name).toBe("identifier");
          }
        }
      }
    });
  });

  describe("lookahead with groups", () => {
    it("should parse positive lookahead with grouped expression", () => {
      const result = expression('&("a" / "b")', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("PositiveLookahead");
        if (result.val.type === "PositiveLookahead") {
          expect(result.val.expression.type).toBe("Group");
          if (result.val.expression.type === "Group") {
            expect(result.val.expression.expression.type).toBe("Choice");
          }
        }
      }
    });

    it("should parse negative lookahead with grouped sequence", () => {
      const result = expression('!("a" "b")', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("NegativeLookahead");
        if (result.val.type === "NegativeLookahead") {
          expect(result.val.expression.type).toBe("Group");
          if (result.val.expression.type === "Group") {
            expect(result.val.expression.expression.type).toBe("Sequence");
          }
        }
      }
    });
  });

  describe("lookahead with repetition operators", () => {
    it("should parse lookahead followed by repetition with correct precedence", () => {
      // &"hello"* should be parsed as (&"hello")*, not &("hello"*)
      // Lookahead has higher precedence than repetition
      const result = expression('&"hello"*', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Star");
        if (result.val.type === "Star") {
          expect(result.val.expression.type).toBe("PositiveLookahead");
          if (result.val.expression.type === "PositiveLookahead") {
            expect(result.val.expression.expression.type).toBe("StringLiteral");
          }
        }
      }
    });

    it("should parse lookahead with plus repetition", () => {
      const result = expression('!"hello"+', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Plus");
        if (result.val.type === "Plus") {
          expect(result.val.expression.type).toBe("NegativeLookahead");
          if (result.val.expression.type === "NegativeLookahead") {
            expect(result.val.expression.expression.type).toBe("StringLiteral");
          }
        }
      }
    });

    it("should parse lookahead with optional", () => {
      const result = expression('&"hello"?', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Optional");
        if (result.val.type === "Optional") {
          expect(result.val.expression.type).toBe("PositiveLookahead");
          if (result.val.expression.type === "PositiveLookahead") {
            expect(result.val.expression.expression.type).toBe("StringLiteral");
          }
        }
      }
    });

    it("should parse lookahead with quantified repetition", () => {
      const result = expression('!"hello"{3}', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Quantified");
        if (result.val.type === "Quantified") {
          expect(result.val.expression.type).toBe("NegativeLookahead");
          if (result.val.expression.type === "NegativeLookahead") {
            expect(result.val.expression.expression.type).toBe("StringLiteral");
          }
          expect(result.val.min).toBe(3);
          expect(result.val.max).toBe(3);
        }
      }
    });
  });

  describe("lookahead in sequences", () => {
    it("should parse sequence with lookahead elements", () => {
      const result = expression('&"start" "middle" !"end"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Sequence");
        if (result.val.type === "Sequence") {
          expect(result.val.elements).toHaveLength(3);
          expect(result.val.elements[0].type).toBe("PositiveLookahead");
          expect(result.val.elements[1].type).toBe("StringLiteral");
          expect(result.val.elements[2].type).toBe("NegativeLookahead");
        }
      }
    });

    it("should parse mixed sequence with lookahead and repetition", () => {
      const result = expression('&"start" "middle"* !"end"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Sequence");
        if (result.val.type === "Sequence") {
          expect(result.val.elements).toHaveLength(3);
          expect(result.val.elements[0].type).toBe("PositiveLookahead");
          expect(result.val.elements[1].type).toBe("Star");
          expect(result.val.elements[2].type).toBe("NegativeLookahead");
        }
      }
    });
  });

  describe("lookahead in choices", () => {
    it("should parse choice with lookahead alternatives", () => {
      const result = expression('&"option1" / !"option2"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Choice");
        if (result.val.type === "Choice") {
          expect(result.val.alternatives).toHaveLength(2);
          expect(result.val.alternatives[0].type).toBe("PositiveLookahead");
          expect(result.val.alternatives[1].type).toBe("NegativeLookahead");
        }
      }
    });

    it("should parse complex choice with mixed elements", () => {
      const result = expression('&"test"* / "normal" / !"avoid"+', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Choice");
        if (result.val.type === "Choice") {
          expect(result.val.alternatives).toHaveLength(3);
          expect(result.val.alternatives[0].type).toBe("Star"); // (&"test")*
          expect(result.val.alternatives[1].type).toBe("StringLiteral");
          expect(result.val.alternatives[2].type).toBe("Plus"); // (!"avoid")+
        }
      }
    });
  });

  describe("operator precedence with lookahead", () => {
    it("should give lookahead higher precedence than sequence", () => {
      const result = expression('&"a" "b"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Sequence");
        if (result.val.type === "Sequence") {
          expect(result.val.elements).toHaveLength(2);
          expect(result.val.elements[0].type).toBe("PositiveLookahead");
          expect(result.val.elements[1].type).toBe("StringLiteral");
        }
      }
    });

    it("should give lookahead higher precedence than choice", () => {
      const result = expression('&"a" / "b"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Choice");
        if (result.val.type === "Choice") {
          expect(result.val.alternatives).toHaveLength(2);
          expect(result.val.alternatives[0].type).toBe("PositiveLookahead");
          expect(result.val.alternatives[1].type).toBe("StringLiteral");
        }
      }
    });

    it("should integrate lookahead with repetition correctly", () => {
      // This tests that &"hello"* is parsed as (&"hello")*, not &("hello"*)
      const result = expression('&"hello"*', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Star");
        if (result.val.type === "Star") {
          expect(result.val.expression.type).toBe("PositiveLookahead");
        }
      }
    });
  });

  describe("nested lookahead expressions", () => {
    it("should parse nested lookahead with groups", () => {
      const result = expression('&(&"inner")', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("PositiveLookahead");
        if (result.val.type === "PositiveLookahead") {
          expect(result.val.expression.type).toBe("Group");
          if (result.val.expression.type === "Group") {
            expect(result.val.expression.expression.type).toBe(
              "PositiveLookahead",
            );
          }
        }
      }
    });

    it("should parse mixed nested lookahead", () => {
      const result = expression('!(!"test")', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("NegativeLookahead");
        if (result.val.type === "NegativeLookahead") {
          expect(result.val.expression.type).toBe("Group");
          if (result.val.expression.type === "Group") {
            expect(result.val.expression.expression.type).toBe(
              "NegativeLookahead",
            );
          }
        }
      }
    });
  });
});
