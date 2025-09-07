/**
 * Lookahead Operators Tests
 *
 * Tests for TPEG lookahead operators (&expr, !expr) parsing functionality.
 */

import { describe, expect, it } from "bun:test";
import { literal } from "@suzumiyaaoba/tpeg-core";
import {
  applyLookahead,
  createNegativeLookahead,
  createPositiveLookahead,
  lookaheadOperator,
  negativeLookaheadExpression,
  negativeLookaheadOperator,
  positiveLookaheadExpression,
  positiveLookaheadOperator,
  withLookahead,
} from "./lookahead";
import type { StringLiteral } from "./types";

const pos = { offset: 0, line: 1, column: 1 };

describe("lookahead operators", () => {
  describe("operator parsing", () => {
    describe("positive lookahead operator (&)", () => {
      it("should parse & operator", () => {
        const result = positiveLookaheadOperator("&", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe("&");
          expect(result.next.offset).toBe(1);
        }
      });

      it("should fail on non-& characters", () => {
        const result = positiveLookaheadOperator("!", pos);
        expect(result.success).toBe(false);
      });

      it("should fail on empty input", () => {
        const result = positiveLookaheadOperator("", pos);
        expect(result.success).toBe(false);
      });
    });

    describe("negative lookahead operator (!)", () => {
      it("should parse ! operator", () => {
        const result = negativeLookaheadOperator("!", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe("!");
          expect(result.next.offset).toBe(1);
        }
      });

      it("should fail on non-! characters", () => {
        const result = negativeLookaheadOperator("&", pos);
        expect(result.success).toBe(false);
      });

      it("should fail on empty input", () => {
        const result = negativeLookaheadOperator("", pos);
        expect(result.success).toBe(false);
      });
    });

    describe("lookahead operator choice", () => {
      it("should parse & operator", () => {
        const result = lookaheadOperator("&", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe("&");
        }
      });

      it("should parse ! operator", () => {
        const result = lookaheadOperator("!", pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe("!");
        }
      });

      it("should fail on other characters", () => {
        const result = lookaheadOperator("*", pos);
        expect(result.success).toBe(false);
      });

      it("should fail on empty input", () => {
        const result = lookaheadOperator("", pos);
        expect(result.success).toBe(false);
      });
    });
  });

  describe("AST node creation", () => {
    const stringLiteral: StringLiteral = {
      type: "StringLiteral",
      value: "hello",
      quote: '"',
    };

    describe("positive lookahead AST creation", () => {
      it("should create PositiveLookahead node", () => {
        const node = createPositiveLookahead(stringLiteral);
        expect(node).toEqual({
          type: "PositiveLookahead",
          expression: stringLiteral,
        });
      });

      it("should create PositiveLookahead using helper function", () => {
        const node = positiveLookaheadExpression(stringLiteral);
        expect(node.type).toBe("PositiveLookahead");
        expect(node.expression).toEqual(stringLiteral);
      });
    });

    describe("negative lookahead AST creation", () => {
      it("should create NegativeLookahead node", () => {
        const node = createNegativeLookahead(stringLiteral);
        expect(node).toEqual({
          type: "NegativeLookahead",
          expression: stringLiteral,
        });
      });

      it("should create NegativeLookahead using helper function", () => {
        const node = negativeLookaheadExpression(stringLiteral);
        expect(node.type).toBe("NegativeLookahead");
        expect(node.expression).toEqual(stringLiteral);
      });
    });
  });

  describe("lookahead operator application", () => {
    const stringLiteral: StringLiteral = {
      type: "StringLiteral",
      value: "test",
      quote: '"',
    };

    it("should apply positive lookahead operator", () => {
      const result = applyLookahead("&", stringLiteral);
      expect(result).toEqual({
        type: "PositiveLookahead",
        expression: stringLiteral,
      });
    });

    it("should apply negative lookahead operator", () => {
      const result = applyLookahead("!", stringLiteral);
      expect(result).toEqual({
        type: "NegativeLookahead",
        expression: stringLiteral,
      });
    });

    it("should return expression unchanged for unknown operator", () => {
      const result = applyLookahead("*", stringLiteral);
      expect(result).toEqual(stringLiteral);
    });
  });

  describe("withLookahead higher-order parser", () => {
    const stringLiteralParser = literal('"hello"');
    const lookaheadParser = withLookahead(stringLiteralParser);

    it("should parse positive lookahead expression", () => {
      const result = lookaheadParser('&"hello"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("PositiveLookahead");
        if (result.val.type === "PositiveLookahead") {
          expect(result.val.expression).toBe('"hello"');
        }
        expect(result.next.offset).toBe(8); // & + "hello"
      }
    });

    it("should parse negative lookahead expression", () => {
      const result = lookaheadParser('!"hello"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("NegativeLookahead");
        if (result.val.type === "NegativeLookahead") {
          expect(result.val.expression).toBe('"hello"');
        }
        expect(result.next.offset).toBe(8); // ! + "hello"
      }
    });

    it("should parse expression without lookahead", () => {
      const result = lookaheadParser('"hello"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe('"hello"');
        expect(result.next.offset).toBe(7); // "hello"
      }
    });

    it("should fail if expression after lookahead operator fails", () => {
      const result = lookaheadParser('&"world"', pos);
      expect(result.success).toBe(false);
    });

    it("should fail if expression after negative lookahead operator fails", () => {
      const result = lookaheadParser('!"world"', pos);
      expect(result.success).toBe(false);
    });
  });

  describe("complex lookahead expressions", () => {
    // Test with more complex base parsers
    const numberParser = literal("123");
    const lookaheadNumberParser = withLookahead(numberParser);

    it("should handle positive lookahead with numbers", () => {
      const result = lookaheadNumberParser("&123", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("PositiveLookahead");
        if (result.val.type === "PositiveLookahead") {
          expect(result.val.expression).toBe("123");
        }
      }
    });

    it("should handle negative lookahead with numbers", () => {
      const result = lookaheadNumberParser("!123", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("NegativeLookahead");
        if (result.val.type === "NegativeLookahead") {
          expect(result.val.expression).toBe("123");
        }
      }
    });
  });

  describe("edge cases", () => {
    const simpleParser = literal("a");
    const lookaheadParser = withLookahead(simpleParser);

    it("should handle empty string after lookahead operator", () => {
      const result = lookaheadParser("&", pos);
      expect(result.success).toBe(false);
    });

    it("should handle incomplete lookahead expressions", () => {
      const result = lookaheadParser("!", pos);
      expect(result.success).toBe(false);
    });

    it("should handle whitespace correctly", () => {
      // Note: This test assumes no automatic whitespace handling
      const result = lookaheadParser("& a", pos);
      expect(result.success).toBe(false); // Should fail because "& a" ≠ "&a"
    });
  });
});
