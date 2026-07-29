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
import type {
  Choice,
  GrammarDefinition,
  Identifier,
  RuleDefinition,
  Sequence,
  StringLiteral,
} from "./types";

const stringLiteral = (value: string): StringLiteral => ({
  type: "StringLiteral",
  value,
});
const identifier = (name: string): Identifier => ({
  type: "Identifier",
  name,
});
const sequence = (elements: Sequence["elements"]): Sequence => ({
  type: "Sequence",
  elements,
});
const choice = (alternatives: Choice["alternatives"]): Choice => ({
  type: "Choice",
  alternatives,
});
const rule = (
  name: string,
  pattern: RuleDefinition["pattern"],
): RuleDefinition => ({
  type: "RuleDefinition",
  name,
  pattern,
});
const grammar = (rules: RuleDefinition[]): GrammarDefinition => ({
  type: "GrammarDefinition",
  name: "Test",
  annotations: [],
  rules,
});

describe("analyzeGrammarPerformance recursion detection", () => {
  it("flags a directly self-referential rule as recursive", () => {
    // Expr = "a" | ("a" Expr)
    const g = grammar([
      rule(
        "Expr",
        choice([
          stringLiteral("a"),
          sequence([stringLiteral("a"), identifier("Expr")]),
        ]),
      ),
    ]);

    const analysis = analyzeGrammarPerformance(g);

    expect(analysis.ruleComplexity.get("Expr")?.hasRecursion).toBe(true);
  });

  it("flags indirect (A -> B -> A) recursion, not just direct self-reference", () => {
    const g = grammar([rule("A", identifier("B")), rule("B", identifier("A"))]);

    const analysis = analyzeGrammarPerformance(g);

    expect(analysis.ruleComplexity.get("A")?.hasRecursion).toBe(true);
    expect(analysis.ruleComplexity.get("B")?.hasRecursion).toBe(true);
  });

  it("does not flag an ordinary, non-recursive reference to another rule", () => {
    const g = grammar([
      rule("Digit", stringLiteral("0")),
      rule("Number", identifier("Digit")),
    ]);

    const analysis = analyzeGrammarPerformance(g);

    expect(analysis.ruleComplexity.get("Digit")?.hasRecursion).toBe(false);
    expect(analysis.ruleComplexity.get("Number")?.hasRecursion).toBe(false);
  });
});
