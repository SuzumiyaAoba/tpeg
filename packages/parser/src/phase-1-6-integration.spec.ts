/**
 * Phase 1.6 Integration Tests - Grammar Definition Blocks
 * Tests the integration of Phase 1.6 grammar definition parsing
 * with the main TPEG parser module.
 */

import { describe, expect, test } from "bun:test";
import { type Parser, parse } from "@suzumiyaaoba/tpeg-core";
import {
  documentationComment,
  grammarAnnotation,
  grammarDefinition,
  quotedString,
  ruleDefinition,
  singleLineComment,
} from "./index";

// Helper function for easier testing
const testParse = <T>(parser: Parser<T>, input: string) => parse(parser)(input);

describe("Phase 1.6 Integration Tests", () => {
  describe("exported parsers from index", () => {
    test("should export grammarAnnotation parser", () => {
      const result = testParse(grammarAnnotation, '@version: "1.0"');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("GrammarAnnotation");
        expect(result.val.key).toBe("version");
        expect(result.val.value).toBe("1.0");
      }
    });

    test("should export ruleDefinition parser", () => {
      const result = testParse(ruleDefinition, "number = [0-9]+");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("RuleDefinition");
        expect(result.val.name).toBe("number");
        expect(result.val.pattern).toBeDefined();
      }
    });

    test("should export quotedString parser", () => {
      const result = testParse(quotedString, '"hello world"');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello world");
      }
    });

    test("should export singleLineComment parser", () => {
      const result = testParse(singleLineComment, "// This is a comment");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("This is a comment");
      }
    });

    test("should export documentationComment parser", () => {
      const result = testParse(documentationComment, "/// Documentation");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("Documentation");
      }
    });

    test("should export grammarDefinition parser for simple cases", () => {
      const input = "grammar Empty {}";
      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("GrammarDefinition");
        expect(result.val.name).toBe("Empty");
        expect(result.val.annotations).toHaveLength(0);
        expect(result.val.rules).toHaveLength(0);
      }
    });
  });

  describe("Phase 1.6 functionality verification", () => {
    test("should parse grammar with annotations", () => {
      const input = `grammar TestGrammar {
        @version: "1.0"
        @description: "Test grammar"
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.annotations).toHaveLength(2);
        expect(result.val.annotations[0].key).toBe("version");
        expect(result.val.annotations[1].key).toBe("description");
      }
    });

    test("should parse grammar with single rule", () => {
      const input = `grammar SimpleGrammar {
        expression = [a-zA-Z]+
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.rules).toHaveLength(1);
        expect(result.val.rules[0].name).toBe("expression");
      }
    });

    test("should handle mixed annotations and single rule", () => {
      const input = `grammar MixedGrammar {
        @version: "1.0"
        
        expression = [0-9]+
        
        @start: "expression"
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.annotations).toHaveLength(2);
        expect(result.val.rules).toHaveLength(1);
      }
    });
  });

  describe("backward compatibility", () => {
    test("should maintain existing TPEG expression parsing", () => {
      // Import the main tpegExpression parser
      const { tpegExpression } = require("./index");

      const result = testParse(tpegExpression, '"hello" / "world"');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Choice");
      }
    });

    test("should maintain all existing exports", () => {
      const index = require("./index");

      // Check that all previous exports still exist
      expect(index.stringLiteral).toBeDefined();
      expect(index.characterClass).toBeDefined();
      expect(index.identifier).toBeDefined();
      expect(index.tpegExpression).toBeDefined();
      expect(index.expression).toBeDefined();

      // Check new grammar exports
      expect(index.grammarAnnotation).toBeDefined();
      expect(index.ruleDefinition).toBeDefined();
      expect(index.grammarDefinition).toBeDefined();
      expect(index.quotedString).toBeDefined();
      expect(index.singleLineComment).toBeDefined();
      expect(index.documentationComment).toBeDefined();
    });
  });
});
