/**
 * Performance analysis utilities for code generation
 *
 * Lightweight version focused on code generation needs.
 */

import type {
  Choice,
  Expression,
  ExpressionComplexity,
  GrammarDefinition,
  GrammarPerformance,
  Group,
  Identifier,
  LabeledExpression,
  NegativeLookahead,
  Optional,
  Plus,
  PositiveLookahead,
  Quantified,
  Sequence,
  Star,
} from "./types";

/**
 * Simple performance monitoring for generation timing
 */
export class PerformanceMonitor {
  private timers = new Map<string, number>();

  start(name: string): void {
    this.timers.set(name, performance.now());
  }

  end(name: string): number {
    const startTime = this.timers.get(name);
    if (!startTime) {
      return 0;
    }
    const elapsed = performance.now() - startTime;
    this.timers.delete(name);
    return elapsed;
  }
}

/**
 * Global performance monitor instance
 */
export const globalPerformanceMonitor = new PerformanceMonitor();

/**
 * Analyze the complexity of a single expression
 *
 * Whether the rule this expression belongs to is (directly or indirectly)
 * recursive cannot be determined from the expression tree alone: a
 * genuinely recursive PEG rule refers to itself (or a rule that refers back
 * to it) by name through an `Identifier` node, which looks identical to any
 * other rule reference from inside a single expression tree. Resolving that
 * requires the full grammar's rule map, which this function doesn't have --
 * so recursion is computed once per grammar by
 * {@link analyzeGrammarPerformance} (via a dependency-graph cycle check)
 * and passed in here.
 */
export function analyzeExpressionComplexity(
  expr: Expression,
  hasRecursion = false,
): ExpressionComplexity {
  let depth = 0;
  let nodeCount = 0;

  function analyze(expression: Expression, currentDepth: number): void {
    nodeCount++;
    depth = Math.max(depth, currentDepth);

    switch (expression.type) {
      case "Sequence":
        for (const element of (expression as Sequence).elements) {
          analyze(element, currentDepth + 1);
        }
        break;
      case "Choice":
        for (const alternative of (expression as Choice).alternatives) {
          analyze(alternative, currentDepth + 1);
        }
        break;
      case "Star":
        analyze((expression as Star).expression, currentDepth + 1);
        break;
      case "Plus":
        analyze((expression as Plus).expression, currentDepth + 1);
        break;
      case "Optional":
        analyze((expression as Optional).expression, currentDepth + 1);
        break;
      case "Group":
        analyze((expression as Group).expression, currentDepth + 1);
        break;
      case "LabeledExpression":
        analyze((expression as LabeledExpression).expression, currentDepth + 1);
        break;
      case "Quantified":
        analyze((expression as Quantified).expression, currentDepth + 1);
        break;
      case "PositiveLookahead":
        analyze((expression as PositiveLookahead).expression, currentDepth + 1);
        break;
      case "NegativeLookahead":
        analyze((expression as NegativeLookahead).expression, currentDepth + 1);
        break;
    }
  }

  analyze(expr, 0);

  let estimatedComplexity: "low" | "medium" | "high" = "low";
  if (nodeCount > 20 || depth > 10) {
    estimatedComplexity = "high";
  } else if (nodeCount > 5 || depth > 3) {
    estimatedComplexity = "medium";
  }

  return {
    depth,
    nodeCount,
    hasRecursion,
    estimatedComplexity,
  };
}

/**
 * Analyze the performance characteristics of an entire grammar
 */
export function analyzeGrammarPerformance(
  grammar: GrammarDefinition,
): GrammarPerformance {
  const ruleComplexity = new Map<string, ExpressionComplexity>();
  const optimizationSuggestions: string[] = [];

  // Build the rule dependency graph once, then find every rule that's part
  // of a reference cycle (direct or indirect) -- the only way to know a
  // rule is genuinely recursive.
  const ruleDependencies = new Map<string, Set<string>>();
  for (const rule of grammar.rules) {
    const dependencies = new Set<string>();
    collectRuleDependencies(rule.pattern, dependencies);
    ruleDependencies.set(rule.name, dependencies);
  }
  const recursiveRuleNames = findRecursiveRuleNames(ruleDependencies);

  // Analyze each rule
  for (const rule of grammar.rules) {
    const complexity = analyzeExpressionComplexity(
      rule.pattern,
      recursiveRuleNames.has(rule.name),
    );
    ruleComplexity.set(rule.name, complexity);
  }

  // Determine overall complexity
  const ruleCount = grammar.rules.length;
  const highComplexityRules = Array.from(ruleComplexity.values()).filter(
    (c) => c.estimatedComplexity === "high",
  ).length;

  let estimatedParseComplexity: "low" | "medium" | "high" = "low";
  if (ruleCount > 50 || highComplexityRules > 5) {
    estimatedParseComplexity = "high";
  } else if (ruleCount > 20 || highComplexityRules > 2) {
    estimatedParseComplexity = "medium";
  }

  // Generate optimization suggestions
  if (ruleCount > 50) {
    optimizationSuggestions.push(
      `Large grammar with ${ruleCount} rules - consider splitting into modules`,
    );
  }
  if (highComplexityRules > 0) {
    optimizationSuggestions.push(
      `${highComplexityRules} high-complexity rules - consider memoization`,
    );
  }

  return {
    ruleCount,
    estimatedParseComplexity,
    optimizationSuggestions,
    ruleComplexity,
  };
}

/**
 * Collect the names of rules directly referenced from an expression
 */
function collectRuleDependencies(
  expr: Expression,
  dependencies: Set<string>,
): void {
  switch (expr.type) {
    case "Identifier":
      dependencies.add((expr as Identifier).name);
      break;
    case "Sequence":
      for (const element of (expr as Sequence).elements) {
        collectRuleDependencies(element, dependencies);
      }
      break;
    case "Choice":
      for (const alternative of (expr as Choice).alternatives) {
        collectRuleDependencies(alternative, dependencies);
      }
      break;
    case "Star":
    case "Plus":
    case "Optional":
    case "Group":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "LabeledExpression":
    case "Quantified":
      collectRuleDependencies(
        (
          expr as
            | Star
            | Plus
            | Optional
            | Group
            | PositiveLookahead
            | NegativeLookahead
            | LabeledExpression
            | Quantified
        ).expression,
        dependencies,
      );
      break;
  }
}

/**
 * Finds every rule name that is part of a reference cycle in the given
 * dependency graph, whether direct (A -> A) or indirect (A -> B -> A).
 */
function findRecursiveRuleNames(
  dependencies: Map<string, Set<string>>,
): Set<string> {
  const recursive = new Set<string>();

  const canReach = (
    from: string,
    target: string,
    visited: Set<string>,
  ): boolean => {
    for (const next of dependencies.get(from) ?? []) {
      if (next === target) return true;
      if (visited.has(next)) continue;
      visited.add(next);
      if (canReach(next, target, visited)) return true;
    }
    return false;
  };

  for (const ruleName of dependencies.keys()) {
    if (canReach(ruleName, ruleName, new Set())) {
      recursive.add(ruleName);
    }
  }

  return recursive;
}
