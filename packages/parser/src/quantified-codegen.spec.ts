/**
 * Quantified Expression Code Generation Tests
 *
 * Tests for quantified expression code generation functionality.
 */

import { describe, expect, it } from "vite-plus/test";
import { TPEGCodeGenerator, generateTypeScriptParser } from "./codegen";
import {
  createGrammarDefinition,
  createOptional,
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

    it("should keep {1} as quantified so the result stays T[]", () => {
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
      // {1} is a degenerate repetition: emitting the bare inner parser
      // would return a scalar where {2}, {0,1}, `*` etc. all produce
      // `T[]` (and where `quantified(inner, 1, 1)` produces `["a"]`).
      expect(result.code).toContain('quantified(literal("a"), 1, 1)');
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

    it("should keep {0,1} on quantified (uniform T[] shape across {n,m})", () => {
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
      // {0,1} used to lower to `optional(...)`, but `optional` now
      // returns `T | null` where every other `{n,m}` range produces
      // `T[]` -- emitting `quantified(...)` here keeps the capture
      // shape uniform across all range quantifiers.
      expect(result.code).toContain('quantified(literal("a"), 0, 1)');
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
        'import { literal, quantified, untagCapture } from "@suzumiyaaoba/tpeg-core";',
      );
    });

    it("should include appropriate combinators for optimized cases", () => {
      const grammar = createGrammarDefinition(
        "Test",
        [],
        [
          createRuleDefinition(
            // Not named "quantified": this rule's `{0,1}` quantifier
            // generates to a `quantified(...)` call, so "quantified" as
            // the rule name would collide with that import (rejected by
            // `validateGeneratedIdentifiers`, `grammar-validation.ts`).
            "quantifiedRule",
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
        'import { literal, oneOrMore, quantified, untagCapture, zeroOrMore } from "@suzumiyaaoba/tpeg-core";',
      );
    });
  });

  describe("bounded repetition over a nullable inner expression (regression)", () => {
    it('`("a"?){2,3}` succeeds on input with no leading "a", per standard PEG semantics for a bounded quantifier', async () => {
      // Regression test for a real bug in `quantified` (tpeg-core's
      // repetition.ts): its infinite-loop guard used to fire even when the
      // repetition count is bounded (a `for` loop, never actually able to
      // loop forever), turning a well-defined `e{n,m}` match over a
      // nullable `e` into a hard parse failure. `("a"?){2,3}` compiles to
      // `quantified(optional(literal("a")), 2, 3)` -- see the "range
      // quantifiers" describe block above for the plain codegen-text
      // version of this same shape.
      const core = await import("@suzumiyaaoba/tpeg-core");

      const grammar = createGrammarDefinition(
        "Test",
        [],
        [
          createRuleDefinition(
            "rule",
            createQuantified(
              createOptional(createStringLiteral("a", '"')),
              2,
              3,
            ),
          ),
        ],
      );

      const result = generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      });
      const body = result.code.replace(/^export const (\w+)/gm, "const $1");
      const moduleFactory = new Function(
        ...Object.keys(core),
        `${body}\nreturn { rule };`,
      );
      const { rule } = moduleFactory(...Object.values(core));

      // Nothing to match, but the repetition is greedy: it still runs all
      // the way to `max` = 3 (each iteration's zero-width `null` is a
      // genuine success, not a stopping condition) -- it just consumes no
      // input while doing so.
      const noLeadingA = rule("bbb", 0);
      expect(noLeadingA.success).toBe(true);
      if (noLeadingA.success) {
        expect(noLeadingA.val).toEqual([null, null, null]);
        expect(noLeadingA.next).toBe(0);
      }

      const oneLeadingA = rule("a", 0);
      expect(oneLeadingA.success).toBe(true);
      if (oneLeadingA.success) {
        expect(oneLeadingA.val).toEqual(["a", null, null]);
        expect(oneLeadingA.next).toBe(1);
      }

      const threeLeadingAs = rule("aaaa", 0);
      expect(threeLeadingAs.success).toBe(true);
      if (threeLeadingAs.success) {
        expect(threeLeadingAs.val).toEqual(["a", "a", "a"]);
        expect(threeLeadingAs.next).toBe(3); // Stops at max = 3
      }
    });
  });
});
