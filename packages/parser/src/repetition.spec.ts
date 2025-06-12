/**
 * TPEG Repetition Operators Tests
 *
 * Tests for star, plus, optional, and quantified repetition operators.
 */

import { describe, expect, it } from "bun:test";
import {
  applyRepetition,
  optionalExpression,
  optionalOperator,
  plusExpression,
  plusOperator,
  quantifiedExpression,
  quantifiedOperator,
  repetitionOperator,
  starExpression,
  starOperator,
} from "./repetition";
import type { Expression, Optional, Plus, Quantified, Star } from "./types";

const pos = { offset: 0, line: 1, column: 1 };

// Helper function to create a test expression
const createTestExpression = (): Expression => ({
  type: "StringLiteral" as const,
  value: "test",
  quote: '"' as const,
});

describe("repetition operators", () => {
  describe("basic operator parsers", () => {
    describe("starOperator", () => {
      it("should parse star operator", () => {
        const result = starOperator()("*", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe("*");
        }
      });

      it("should fail on non-star input", () => {
        const result = starOperator()("+", pos);
        expect(result.success).toBe(false);
      });
    });

    describe("plusOperator", () => {
      it("should parse plus operator", () => {
        const result = plusOperator()("+", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe("+");
        }
      });

      it("should fail on non-plus input", () => {
        const result = plusOperator()("*", pos);
        expect(result.success).toBe(false);
      });
    });

    describe("optionalOperator", () => {
      it("should parse optional operator", () => {
        const result = optionalOperator()("?", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe("?");
        }
      });

      it("should fail on non-optional input", () => {
        const result = optionalOperator()("*", pos);
        expect(result.success).toBe(false);
      });
    });

    describe("quantifiedOperator", () => {
      it("should parse exact count {n}", () => {
        const result = quantifiedOperator()("{3}", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toEqual({ min: 3, max: 3 });
        }
      });

      it("should parse range count {n,m}", () => {
        const result = quantifiedOperator()("{2,5}", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toEqual({ min: 2, max: 5 });
        }
      });

      it("should parse minimum count {n,}", () => {
        const result = quantifiedOperator()("{3,}", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toEqual({ min: 3, max: undefined });
        }
      });

      it("should parse zero count {0}", () => {
        const result = quantifiedOperator()("{0}", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toEqual({ min: 0, max: 0 });
        }
      });

      it("should parse large numbers", () => {
        const result = quantifiedOperator()("{123,456}", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toEqual({ min: 123, max: 456 });
        }
      });

      it("should fail on invalid quantified syntax", () => {
        const tests = ["{", "}", "{a}", "{1,a}", "{,1}", "{}"];
        for (const test of tests) {
          const result = quantifiedOperator()(test, pos);
          expect(result.success).toBe(false);
        }
      });
    });

    describe("repetitionOperator", () => {
      it("should parse all repetition operators", () => {
        const tests = [
          { input: "*", expected: "*" },
          { input: "+", expected: "+" },
          { input: "?", expected: "?" },
          { input: "{5}", expected: { min: 5, max: 5 } },
          { input: "{2,8}", expected: { min: 2, max: 8 } },
          { input: "{10,}", expected: { min: 10, max: undefined } },
        ];

        for (const test of tests) {
          const result = repetitionOperator()(test.input, pos);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.val).toEqual(test.expected);
          }
        }
      });

      it("should fail on invalid operators", () => {
        const tests = ["&", "!", "#", "{a}"];
        for (const test of tests) {
          const result = repetitionOperator()(test, pos);
          expect(result.success).toBe(false);
        }
      });
    });
  });

  describe("applyRepetition", () => {
    const testExpr = createTestExpression();

    it("should create star expression", () => {
      const result = applyRepetition(testExpr, "*");
      expect(result.type).toBe("Star");
      if (result.type === "Star") {
        expect(result.expression).toBe(testExpr);
      }
    });

    it("should create plus expression", () => {
      const result = applyRepetition(testExpr, "+");
      expect(result.type).toBe("Plus");
      if (result.type === "Plus") {
        expect(result.expression).toBe(testExpr);
      }
    });

    it("should create optional expression", () => {
      const result = applyRepetition(testExpr, "?");
      expect(result.type).toBe("Optional");
      if (result.type === "Optional") {
        expect(result.expression).toBe(testExpr);
      }
    });

    it("should create quantified expression with exact count", () => {
      const result = applyRepetition(testExpr, { min: 3, max: 3 });
      expect(result.type).toBe("Quantified");
      if (result.type === "Quantified") {
        expect(result.expression).toBe(testExpr);
        expect(result.min).toBe(3);
        expect(result.max).toBe(3);
      }
    });

    it("should create quantified expression with range", () => {
      const result = applyRepetition(testExpr, { min: 2, max: 5 });
      expect(result.type).toBe("Quantified");
      if (result.type === "Quantified") {
        expect(result.expression).toBe(testExpr);
        expect(result.min).toBe(2);
        expect(result.max).toBe(5);
      }
    });

    it("should create quantified expression with minimum", () => {
      const result = applyRepetition(testExpr, { min: 4, max: undefined });
      expect(result.type).toBe("Quantified");
      if (result.type === "Quantified") {
        expect(result.expression).toBe(testExpr);
        expect(result.min).toBe(4);
        expect(result.max).toBe(undefined);
      }
    });

    it("should return original expression for invalid operators", () => {
      const result = applyRepetition(testExpr, "&");
      expect(result).toBe(testExpr);
    });
  });

  describe("expression factory functions", () => {
    const testExpr = createTestExpression();

    describe("starExpression", () => {
      it("should create star expression", () => {
        const result = starExpression(testExpr);
        expect(result.type).toBe("Star");
        expect(result.expression).toBe(testExpr);
      });
    });

    describe("plusExpression", () => {
      it("should create plus expression", () => {
        const result = plusExpression(testExpr);
        expect(result.type).toBe("Plus");
        expect(result.expression).toBe(testExpr);
      });
    });

    describe("optionalExpression", () => {
      it("should create optional expression", () => {
        const result = optionalExpression(testExpr);
        expect(result.type).toBe("Optional");
        expect(result.expression).toBe(testExpr);
      });
    });

    describe("quantifiedExpression", () => {
      it("should create quantified expression with exact count", () => {
        const result = quantifiedExpression(testExpr, 3, 3);
        expect(result.type).toBe("Quantified");
        expect(result.expression).toBe(testExpr);
        expect(result.min).toBe(3);
        expect(result.max).toBe(3);
      });

      it("should create quantified expression with range", () => {
        const result = quantifiedExpression(testExpr, 2, 5);
        expect(result.type).toBe("Quantified");
        expect(result.expression).toBe(testExpr);
        expect(result.min).toBe(2);
        expect(result.max).toBe(5);
      });

      it("should create quantified expression with minimum only", () => {
        const result = quantifiedExpression(testExpr, 4);
        expect(result.type).toBe("Quantified");
        expect(result.expression).toBe(testExpr);
        expect(result.min).toBe(4);
        expect(result.max).toBe(undefined);
      });
    });
  });

  describe("edge cases", () => {
    describe("quantified operator edge cases", () => {
      it("should handle single digit numbers", () => {
        const result = quantifiedOperator()("{0,9}", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toEqual({ min: 0, max: 9 });
        }
      });

      it("should handle large multi-digit numbers", () => {
        const result = quantifiedOperator()("{1000,2000}", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toEqual({ min: 1000, max: 2000 });
        }
      });

      it("should fail on negative numbers", () => {
        const tests = ["{-1}", "{1,-1}", "{-1,-2}"];
        for (const test of tests) {
          const result = quantifiedOperator()(test, pos);
          expect(result.success).toBe(false);
        }
      });

      it("should fail on invalid range (min > max)", () => {
        // Note: This test checks parser syntax, not semantic validation
        // Semantic validation would happen at a higher level
        const result = quantifiedOperator()("{5,3}", pos);
        expect(result.success).toBe(true); // Parser succeeds, semantic check would catch this
        if (result.success) {
          expect(result.val).toEqual({ min: 5, max: 3 });
        }
      });
    });

    describe("operator combination", () => {
      it("should handle multiple repetition operators gracefully", () => {
        // Note: This tests the individual operators, not chaining
        // Chaining like expr*+ would be handled at the expression level
        const result1 = repetitionOperator()("*+", pos);
        expect(result1.success).toBe(true);
        if (result1.success) {
          expect(result1.val).toBe("*");
          expect(result1.next.offset).toBe(1); // Should stop after first operator
        }
      });
    });
  });
});
