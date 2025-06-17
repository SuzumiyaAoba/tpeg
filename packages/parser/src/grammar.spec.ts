/**
 * Tests for Grammar Definition Block parsing (Phase 1.6)
 */

import { describe, expect, test } from "bun:test";
import { type Parser, parse } from "tpeg-core";

// Helper function for easier testing
const testParse = <T>(parser: Parser<T>, input: string) => parse(parser)(input);
import {
  documentationComment,
  grammarAnnotation,
  grammarDefinition,
  quotedString,
  ruleDefinition,
  singleLineComment,
} from "./grammar";

describe("Grammar Definition Block Tests", () => {
  describe("quotedString", () => {
    test("should parse double-quoted strings", () => {
      const result = testParse(quotedString, '"hello world"');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello world");
      }
    });

    test("should parse single-quoted strings", () => {
      const result = testParse(quotedString, "'hello world'");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello world");
      }
    });

    test("should handle escaped characters", () => {
      const result = testParse(quotedString, '"hello \\"world\\""');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe('hello "world"');
      }
    });
  });

  describe("singleLineComment", () => {
    test("should parse single-line comments", () => {
      const result = testParse(singleLineComment, "// This is a comment");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("This is a comment");
      }
    });

    test("should handle empty comments", () => {
      const result = testParse(singleLineComment, "//");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("");
      }
    });
  });

  describe("documentationComment", () => {
    test("should parse documentation comments", () => {
      const result = testParse(
        documentationComment,
        "/// This is documentation",
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("This is documentation");
      }
    });
  });

  describe("grammarAnnotation", () => {
    test("should parse version annotation", () => {
      const result = testParse(grammarAnnotation, '@version: "1.0"');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          type: "GrammarAnnotation",
          key: "version",
          value: "1.0",
        });
      }
    });

    test("should parse description annotation", () => {
      const result = testParse(
        grammarAnnotation,
        '@description: "A simple grammar"',
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          type: "GrammarAnnotation",
          key: "description",
          value: "A simple grammar",
        });
      }
    });

    test("should handle whitespace around colon", () => {
      const result = testParse(grammarAnnotation, '@start : "expression"');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          type: "GrammarAnnotation",
          key: "start",
          value: "expression",
        });
      }
    });
  });

  describe("ruleDefinition", () => {
    test("should parse simple rule definition", () => {
      const result = testParse(ruleDefinition, "number = [0-9]+");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("RuleDefinition");
        expect(result.val.name).toBe("number");
        expect(result.val.pattern).toBeDefined();
        expect(result.val.documentation).toBeUndefined();
      }
    });

    test("should parse rule with whitespace", () => {
      const result = testParse(ruleDefinition, "  expression  =  left:term  ");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("expression");
      }
    });
  });

  describe("grammarDefinition", () => {
    test("should parse grammar with annotations and single rule", () => {
      const input = `grammar SimpleCalc {
        @version: "1.0"
        @start: "expression"
        
        expression = [0-9]+
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("GrammarDefinition");
        expect(result.val.name).toBe("SimpleCalc");
        expect(result.val.annotations).toHaveLength(2);
        expect(result.val.rules).toHaveLength(1);

        expect(result.val.annotations[0]).toEqual({
          type: "GrammarAnnotation",
          key: "version",
          value: "1.0",
        });

        expect(result.val.annotations[1]).toEqual({
          type: "GrammarAnnotation",
          key: "start",
          value: "expression",
        });

        expect(result.val.rules[0].name).toBe("expression");
      }
    });

    test("should handle empty grammar block", () => {
      const input = `grammar Empty {
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("Empty");
        expect(result.val.annotations).toHaveLength(0);
        expect(result.val.rules).toHaveLength(0);
      }
    });

    test("should handle grammar with single rule only", () => {
      const input = `grammar TestGrammar {
        expression = [a-zA-Z]+
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("TestGrammar");
        expect(result.val.annotations).toHaveLength(0);
        expect(result.val.rules).toHaveLength(1);
        expect(result.val.rules[0].name).toBe("expression");
      }
    });

    test.skip("should parse multiple rules with newlines (Phase 1.6 - work in progress)", () => {
      // Test with explicit newlines between rules
      const input = `grammar MultiRule {
  expression = number
  number = [0-9]+
}`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("MultiRule");
        expect(result.val.rules).toHaveLength(2);
        expect(result.val.rules[0].name).toBe("expression");
        expect(result.val.rules[1].name).toBe("number");
      }
    });

    test.skip("debug: try simple two rules (Phase 1.6 - work in progress)", () => {
      const input = `grammar Test { a=b c=d }`;
      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
    });
  });
});
