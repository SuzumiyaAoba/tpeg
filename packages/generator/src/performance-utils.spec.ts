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

import { describe, expect, it } from "vite-plus/test";
import {
  analyzeExpressionComplexity,
  analyzeGrammarPerformance,
} from "./performance-utils";
import type {
  ActionExpression,
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
  quote: '"',
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
const actionExpression = (
  expression: ActionExpression["expression"],
  code = "return $$;",
): ActionExpression => ({
  type: "ActionExpression",
  expression,
  code,
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

  // Regression: `collectRuleDependencies`'s switch had no `ActionExpression`
  // case, so a self-reference reachable only through a semantic action's
  // own wrapped expression was invisible to the dependency graph --
  // `findRecursiveRuleNames` (built on that graph) silently reported
  // `hasRecursion: false` for a genuinely recursive rule shaped this way,
  // with no error (a `switch` with no `default` doesn't fail to compile
  // just because one branch is unhandled). See
  // `packages/type-inference/src/type-integration.ts`'s `analyzeDependencies`,
  // which independently fixed the identical gap in its own (separate)
  // dependency walk.
  it("flags a self-reference reachable only through an ActionExpression's wrapped expression as recursive", () => {
    // Expr = ("a" Expr)? { return $$; }
    const g = grammar([
      rule(
        "Expr",
        actionExpression(sequence([stringLiteral("a"), identifier("Expr")])),
      ),
    ]);

    const analysis = analyzeGrammarPerformance(g);

    expect(analysis.ruleComplexity.get("Expr")?.hasRecursion).toBe(true);
  });

  it("flags indirect (A -> B -> A) recursion through an ActionExpression on one leg", () => {
    const g = grammar([
      rule("A", actionExpression(identifier("B"))),
      rule("B", identifier("A")),
    ]);

    const analysis = analyzeGrammarPerformance(g);

    expect(analysis.ruleComplexity.get("A")?.hasRecursion).toBe(true);
    expect(analysis.ruleComplexity.get("B")?.hasRecursion).toBe(true);
  });
});

describe("analyzeExpressionComplexity", () => {
  // Regression: the `analyze` switch had no `ActionExpression` case
  // either, so an action-wrapped subtree counted as a single depth-0 leaf
  // node instead of contributing its own nested nodeCount/depth --
  // under-reporting complexity for every rule with a semantic action.
  it("counts nodes inside an ActionExpression's wrapped expression, not just the action itself", () => {
    const withoutAction = sequence([
      stringLiteral("a"),
      stringLiteral("b"),
      stringLiteral("c"),
    ]);
    const wrapped = actionExpression(withoutAction);

    const bare = analyzeExpressionComplexity(withoutAction);
    const viaAction = analyzeExpressionComplexity(wrapped);

    // The action wrapper itself is one more node, and the depth of
    // everything inside it is one deeper -- but the inner Sequence's own
    // three StringLiteral children must still be counted and walked, not
    // collapsed away.
    expect(viaAction.nodeCount).toBe(bare.nodeCount + 1);
    expect(viaAction.depth).toBe(bare.depth + 1);
  });
});
