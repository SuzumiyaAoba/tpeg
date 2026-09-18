/**
 * Performance analysis utilities for the Eta-based code generator.
 *
 * The dependency-graph machinery (`collectRuleDependencies`,
 * `findRecursiveRuleNames`, `PerformanceMonitor`/
 * `globalPerformanceMonitor`) is re-exported from `tpeg-parser`, whose
 * `performance-utils.ts` is the canonical implementation. This module
 * used to hand-maintain a ~400-line duplicate of that file ("keep them
 * in sync; there is no automated check tying the two together"), and the
 * copies had already drifted both ways: an `ActionExpression`-traversal
 * gap was found and fixed independently in each, and this copy's
 * quadratic `canReach` recursion check had to be re-ported after
 * `tpeg-parser`'s moved to an iterative Tarjan SCC pass.
 *
 * What stays local is only the ANALYSIS layer, because this package's
 * thresholds genuinely differ from `tpeg-parser`'s (its
 * `analyzeExpressionComplexity` counts `hasRecursion` toward "high" and
 * uses `nodeCount > 50`/`depth > 10` and `> 20`/`> 5`; the ones below
 * are tighter and don't consume the recursion flag) -- and they drive
 * `eta-generator.ts`'s `shouldMemoize`/`memoize`-import decisions.
 */

import { childExpressions } from "@suzumiyaaoba/tpeg-core";
import {
  collectRuleDependencies,
  findRecursiveRuleNames,
} from "@suzumiyaaoba/tpeg-parser";
import type {
  Expression,
  ExpressionComplexity,
  GrammarDefinition,
  GrammarPerformance,
} from "./types";

export {
  PerformanceMonitor,
  globalPerformanceMonitor,
} from "@suzumiyaaoba/tpeg-parser";

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
    // `childExpressions` descends into an `ActionExpression`'s wrapped
    // expression, so the action's subtree counts toward complexity like
    // any other nesting -- treating it as a leaf (as an earlier version
    // of this function did) undercounted `nodeCount`/`depth` for every
    // rule with a semantic action.
    for (const child of childExpressions(expression)) {
      analyze(child, currentDepth + 1);
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
  let highComplexityRules = 0;
  for (const c of ruleComplexity.values()) {
    if (c.estimatedComplexity === "high") {
      highComplexityRules++;
    }
  }

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
