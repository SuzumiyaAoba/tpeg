/**
 * Quantified Expression Code Generation Tests
 *
 * Tests for quantified expression code generation functionality.
 */

import { describe, expect, it } from "bun:test";
import { TPEGCodeGenerator } from "./codegen";
import {
  createGrammarDefinition,
  createQuantified,
  createRuleDefinition,
  createStringLiteral,
} from "./types";

describe("quantified expression code generation", () => {
  const generator = new TPEGCodeGenerator();

  describe("exact count quantifiers", () => {
    it("should generate quantified combinator for {3}", () => {
      const grammar = createGrammarDefinition(
        "Test",
        [],
        [
          createRuleDefinition(
            "rule",
            createQuantified(createStringLiteral("a", '"'), 3, 3),
          ),
        ],
      );

      const result = generator.generateGrammar(grammar);
      expect(result.code).toContain('quantified(literal("a"), 3, 3)');
    });

    it("should optimize {1} to direct expression", () => {
      const grammar = createGrammarDefinition(
        "Test",
        [],
        [
          createRuleDefinition(
            "rule",
            createQuantified(createStringLiteral("a", '"'), 1, 1),
          ),
        ],
      );

      const result = generator.generateGrammar(grammar);
      expect(result.code).toContain('literal("a")');
      expect(result.code).not.toContain("quantified");
    });

    it("should handle {0} as an always-matching zero repetition, not an always-failing empty choice", () => {
      const grammar = createGrammarDefinition(
        "Test",
        [],
        [
          createRuleDefinition(
            "rule",
            createQuantified(createStringLiteral("a", '"'), 0, 0),
          ),
        ],
      );

      const result = generator.generateGrammar(grammar);
      // quantified(x, 0, 0) always succeeds with an empty array; choice()
      // (no alternatives) always fails -- {0} must never generate the latter.
      expect(result.code).toContain('quantified(literal("a"), 0, 0)');
      expect(result.code).not.toContain("choice()");
    });
  });

  describe("range quantifiers", () => {
    it("should generate quantified combinator for {2,5}", () => {
      const grammar = createGrammarDefinition(
        "Test",
        [],
        [
          createRuleDefinition(
            "rule",
            createQuantified(createStringLiteral("a", '"'), 2, 5),
          ),
        ],
      );

      const result = generator.generateGrammar(grammar);
      expect(result.code).toContain('quantified(literal("a"), 2, 5)');
    });

    it("should optimize {0,1} to optional", () => {
      const grammar = createGrammarDefinition(
        "Test",
        [],
        [
          createRuleDefinition(
            "rule",
            createQuantified(createStringLiteral("a", '"'), 0, 1),
          ),
        ],
      );

      const result = generator.generateGrammar(grammar);
      expect(result.code).toContain('optional(literal("a"))');
    });
  });

  describe("minimum quantifiers", () => {
    it("should generate quantified combinator for {3,}", () => {
      const grammar = createGrammarDefinition(
        "Test",
        [],
        [
          createRuleDefinition(
            "rule",
            createQuantified(createStringLiteral("a", '"'), 3),
          ),
        ],
      );

      const result = generator.generateGrammar(grammar);
      expect(result.code).toContain('quantified(literal("a"), 3)');
    });

    it("should optimize {0,} to zeroOrMore", () => {
      const grammar = createGrammarDefinition(
        "Test",
        [],
        [
          createRuleDefinition(
            "rule",
            createQuantified(createStringLiteral("a", '"'), 0),
          ),
        ],
      );

      const result = generator.generateGrammar(grammar);
      expect(result.code).toContain('zeroOrMore(literal("a"))');
    });

    it("should optimize {1,} to oneOrMore", () => {
      const grammar = createGrammarDefinition(
        "Test",
        [],
        [
          createRuleDefinition(
            "rule",
            createQuantified(createStringLiteral("a", '"'), 1),
          ),
        ],
      );

      const result = generator.generateGrammar(grammar);
      expect(result.code).toContain('oneOrMore(literal("a"))');
    });
  });

  describe("imports and dependencies", () => {
    it("should include quantified in imports when used", () => {
      const grammar = createGrammarDefinition(
        "Test",
        [],
        [
          createRuleDefinition(
            "rule",
            createQuantified(createStringLiteral("a", '"'), 2, 4),
          ),
        ],
      );

      const result = generator.generateGrammar(grammar);
      expect(result.imports).toContain(
        'import { literal, quantified } from "@suzumiyaaoba/tpeg-core";',
      );
    });

    it("should include appropriate combinators for optimized cases", () => {
      const grammar = createGrammarDefinition(
        "Test",
        [],
        [
          createRuleDefinition(
            "optional",
            createQuantified(createStringLiteral("a", '"'), 0, 1),
          ),
          createRuleDefinition(
            "star",
            createQuantified(createStringLiteral("b", '"'), 0),
          ),
          createRuleDefinition(
            "plus",
            createQuantified(createStringLiteral("c", '"'), 1),
          ),
        ],
      );

      const result = generator.generateGrammar(grammar);
      expect(result.imports).toContain(
        'import { literal, oneOrMore, optional, zeroOrMore } from "@suzumiyaaoba/tpeg-core";',
      );
    });
  });
});
