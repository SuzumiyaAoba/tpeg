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
 */
export function analyzeExpressionComplexity(
  expr: Expression,
): ExpressionComplexity {
  let depth = 0;
  let nodeCount = 0;
  let hasRecursion = false;

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
      case "Identifier":
        // Note: Recursive reference detection would require rule context
        // For now, we assume identifiers could be recursive
        hasRecursion = true;
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

  // Analyze each rule
  for (const rule of grammar.rules) {
    const complexity = analyzeExpressionComplexity(rule.pattern);
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
