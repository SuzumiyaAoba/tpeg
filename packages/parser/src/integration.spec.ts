/**
 * Integration Tests for TPEG Phase 1.2 Implementation
 *
 * Tests that verify the complete Phase 1.2 implementation works together.
 */

import { describe, expect, it } from "bun:test";
import { tpegExpression } from "./index";
import type { Expression } from "./types";

const pos = { offset: 0, line: 1, column: 1 };

describe("Phase 1.2 Integration Tests", () => {
  describe("tpegExpression parser", () => {
    it("should parse complex grammar expressions", () => {
      // Test a realistic grammar rule like: ("+" / "-") [0-9]+ "." [0-9]*
      const result = tpegExpression('("+" / "-") [0-9] "." [0-9]', pos);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.val.type).toBe("Sequence");
        if (result.val.type === "Sequence") {
          expect(result.val.elements).toHaveLength(4);

          // First element should be a group containing a choice
          expect(result.val.elements[0].type).toBe("Group");
          if (result.val.elements[0].type === "Group") {
            expect(result.val.elements[0].expression.type).toBe("Choice");
          }

          // Second element should be character class [0-9]
          expect(result.val.elements[1].type).toBe("CharacterClass");

          // Third element should be literal "."
          expect(result.val.elements[2].type).toBe("StringLiteral");

          // Fourth element should be character class [0-9]
          expect(result.val.elements[3].type).toBe("CharacterClass");
        }
      }
    });

    it("should handle deeply nested expressions", () => {
      // Test: (("a" / "b") ("c" / "d")) / "e"
      const result = tpegExpression('(("a" / "b") ("c" / "d")) / "e"', pos);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.val.type).toBe("Choice");
        if (result.val.type === "Choice") {
          expect(result.val.alternatives).toHaveLength(2);

          // First alternative should be a group
          expect(result.val.alternatives[0].type).toBe("Group");

          // Second alternative should be string literal "e"
          expect(result.val.alternatives[1].type).toBe("StringLiteral");
        }
      }
    });

    it("should correctly handle operator precedence", () => {
      // Test: "a" "b" / "c" "d" (should parse as ("a" "b") / ("c" "d"))
      const result = tpegExpression('"a" "b" / "c" "d"', pos);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.val.type).toBe("Choice");
        if (result.val.type === "Choice") {
          expect(result.val.alternatives).toHaveLength(2);

          // Both alternatives should be sequences
          expect(result.val.alternatives[0].type).toBe("Sequence");
          expect(result.val.alternatives[1].type).toBe("Sequence");
        }
      }
    });

    it("should parse identifier references in complex expressions", () => {
      // Test: number / (letter identifier)
      const result = tpegExpression("number / (letter identifier)", pos);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.val.type).toBe("Choice");
        if (result.val.type === "Choice") {
          expect(result.val.alternatives).toHaveLength(2);

          // First alternative: identifier "number"
          expect(result.val.alternatives[0].type).toBe("Identifier");
          if (result.val.alternatives[0].type === "Identifier") {
            expect(result.val.alternatives[0].name).toBe("number");
          }

          // Second alternative: group containing sequence
          expect(result.val.alternatives[1].type).toBe("Group");
          if (result.val.alternatives[1].type === "Group") {
            expect(result.val.alternatives[1].expression.type).toBe("Sequence");
          }
        }
      }
    });

    it("should work with real PEG grammar patterns", () => {
      // Test: [a-zA-Z_] [a-zA-Z0-9_]*
      const result = tpegExpression("[a-zA-Z_] [a-zA-Z0-9_]", pos);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.val.type).toBe("Sequence");
        if (result.val.type === "Sequence") {
          expect(result.val.elements).toHaveLength(2);
          expect(result.val.elements[0].type).toBe("CharacterClass");
          expect(result.val.elements[1].type).toBe("CharacterClass");
        }
      }
    });

    it("should handle mixed whitespace correctly", () => {
      // Test with various whitespace: "hello"   /\n  \t"world"
      const input = '"hello"   /\n  \t"world"';
      const result = tpegExpression(input, pos);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.val.type).toBe("Choice");
        if (result.val.type === "Choice") {
          expect(result.val.alternatives).toHaveLength(2);
          expect(result.val.alternatives[0].type).toBe("StringLiteral");
          expect(result.val.alternatives[1].type).toBe("StringLiteral");
        }
      }
    });
  });

  describe("error handling", () => {
    it("should provide meaningful errors for malformed expressions", () => {
      const result = tpegExpression("(unclosed group", pos);
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.message).toContain("Expected");
      }
    });

    it("should handle empty groups gracefully", () => {
      const result = tpegExpression("()", pos);
      expect(result.success).toBe(false);
    });
  });

  describe("backward compatibility", () => {
    it("should still parse basic syntax elements", () => {
      const tests = [
        { input: '"hello"', expectedType: "StringLiteral" },
        { input: "[a-z]", expectedType: "CharacterClass" },
        { input: "identifier", expectedType: "Identifier" },
        { input: "[.]", expectedType: "CharacterClass" },
      ];

      for (const test of tests) {
        const result = tpegExpression(test.input, pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe(test.expectedType);
        }
      }
    });
  });
});
