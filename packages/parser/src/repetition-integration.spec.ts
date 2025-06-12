/**
 * Repetition-Composition Integration Tests
 *
 * Tests that verify repetition operators work correctly with composition operators.
 */

import { describe, expect, it } from "bun:test";
import { expression } from "./composition";

const pos = { offset: 0, line: 1, column: 1 };

describe("repetition-composition integration", () => {
  describe("repetition with string literals", () => {
    it("should parse string literal with star repetition", () => {
      const result = expression('"hello"*', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Star");
        if (result.val.type === "Star") {
          expect(result.val.expression.type).toBe("StringLiteral");
        }
      }
    });

    it("should parse string literal with plus repetition", () => {
      const result = expression('"hello"+', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Plus");
        if (result.val.type === "Plus") {
          expect(result.val.expression.type).toBe("StringLiteral");
        }
      }
    });

    it("should parse string literal with optional", () => {
      const result = expression('"hello"?', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Optional");
        if (result.val.type === "Optional") {
          expect(result.val.expression.type).toBe("StringLiteral");
        }
      }
    });

    it("should parse string literal with quantified repetition", () => {
      const result = expression('"hello"{3}', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Quantified");
        if (result.val.type === "Quantified") {
          expect(result.val.expression.type).toBe("StringLiteral");
          expect(result.val.min).toBe(3);
          expect(result.val.max).toBe(3);
        }
      }
    });
  });

  describe("repetition with groups", () => {
    it("should parse grouped expression with repetition", () => {
      const result = expression('("a" / "b")+', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Plus");
        if (result.val.type === "Plus") {
          expect(result.val.expression.type).toBe("Group");
        }
      }
    });
  });

  describe("complex combinations", () => {
    it("should parse sequence with repeated elements", () => {
      const result = expression('"a"+ "b"*', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Sequence");
        if (result.val.type === "Sequence") {
          expect(result.val.elements).toHaveLength(2);
          expect(result.val.elements[0].type).toBe("Plus");
          expect(result.val.elements[1].type).toBe("Star");
        }
      }
    });

    it("should parse choice with repeated alternatives", () => {
      const result = expression('"a"+ / "b"*', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Choice");
        if (result.val.type === "Choice") {
          expect(result.val.alternatives).toHaveLength(2);
          expect(result.val.alternatives[0].type).toBe("Plus");
          expect(result.val.alternatives[1].type).toBe("Star");
        }
      }
    });
  });

  describe("operator precedence with repetition", () => {
    it("should prioritize repetition over sequence", () => {
      const result = expression('"a"+ "b"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Sequence");
        if (result.val.type === "Sequence") {
          expect(result.val.elements).toHaveLength(2);
          expect(result.val.elements[0].type).toBe("Plus");
          expect(result.val.elements[1].type).toBe("StringLiteral");
        }
      }
    });

    it("should prioritize repetition over choice", () => {
      const result = expression('"a"+ / "b"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Choice");
        if (result.val.type === "Choice") {
          expect(result.val.alternatives).toHaveLength(2);
          expect(result.val.alternatives[0].type).toBe("Plus");
          expect(result.val.alternatives[1].type).toBe("StringLiteral");
        }
      }
    });
  });
});
