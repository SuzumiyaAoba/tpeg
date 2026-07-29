/**
 * Recursion Detection Tests
 *
 * `analyzeExpressionComplexity` cannot tell on its own whether a rule is
 * recursive -- a genuinely recursive PEG rule refers to itself (or a rule
 * that refers back to it) by name through an Identifier node, which looks
 * identical to any other rule reference from inside a single expression
 * tree. Real recursion can only be determined from the whole grammar's
 * rule dependency graph, which is what `analyzeGrammarPerformance` builds.
 */

import { describe, expect, it } from "bun:test";
import { analyzeGrammarPerformance } from "./performance-utils";
import {
  createChoice,
  createGrammarDefinition,
  createIdentifier,
  createRuleDefinition,
  createSequence,
  createStringLiteral,
} from "./types";

describe("analyzeGrammarPerformance recursion detection", () => {
  it("flags a directly self-referential rule as recursive", () => {
    // Expr = "a" | ("a" Expr)  -- classic right recursion
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "Expr",
          createChoice([
            createStringLiteral("a", '"'),
            createSequence([
              createStringLiteral("a", '"'),
              createIdentifier("Expr"),
            ]),
          ]),
        ),
      ],
    );

    const analysis = analyzeGrammarPerformance(grammar);
    const complexity = analysis.ruleComplexity.get("Expr");

    expect(complexity?.hasRecursion).toBe(true);
  });

  it("flags indirect (A -> B -> A) recursion, not just direct self-reference", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("A", createIdentifier("B")),
        createRuleDefinition("B", createIdentifier("A")),
      ],
    );

    const analysis = analyzeGrammarPerformance(grammar);

    expect(analysis.ruleComplexity.get("A")?.hasRecursion).toBe(true);
    expect(analysis.ruleComplexity.get("B")?.hasRecursion).toBe(true);
  });

  it("does not flag an ordinary, non-recursive reference to another rule", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("Digit", createStringLiteral("0", '"')),
        createRuleDefinition("Number", createIdentifier("Digit")),
      ],
    );

    const analysis = analyzeGrammarPerformance(grammar);

    expect(analysis.ruleComplexity.get("Digit")?.hasRecursion).toBe(false);
    expect(analysis.ruleComplexity.get("Number")?.hasRecursion).toBe(false);
  });

  it("surfaces a memoization suggestion only for the genuinely recursive rule", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("Digit", createStringLiteral("0", '"')),
        createRuleDefinition(
          "Expr",
          createChoice([
            createIdentifier("Digit"),
            createSequence([
              createIdentifier("Digit"),
              createIdentifier("Expr"),
            ]),
          ]),
        ),
      ],
    );

    const analysis = analyzeGrammarPerformance(grammar);

    expect(
      analysis.optimizationSuggestions.some((s) =>
        s.includes("'Expr' contains recursion"),
      ),
    ).toBe(true);
    expect(
      analysis.optimizationSuggestions.some((s) => s.includes("'Digit'")),
    ).toBe(false);
  });
});
