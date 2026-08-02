/**
 * Performance Optimization Utilities for TPEG Parser
 *
 * This module provides performance-optimized functions and utilities
 * for grammar parsing and code generation operations.
 */

import type { Expression, GrammarDefinition } from "./types";

/**
 * High-performance string hashing function
 * Uses djb2 algorithm for fast, reasonably good distribution
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

/**
 * Optimized string interning for frequently used strings
 * Reduces memory usage by reusing string instances
 */
class StringInterner {
  private cache = new Map<string, string>();
  private maxSize = 1000; // Prevent unbounded growth

  intern(str: string): string {
    const cached = this.cache.get(str);
    if (cached) {
      return cached;
    }

    if (this.cache.size >= this.maxSize) {
      // Simple LRU: clear oldest half when full
      const entries = Array.from(this.cache.entries());
      this.cache.clear();
      // Keep newer half
      for (let i = Math.floor(entries.length / 2); i < entries.length; i++) {
        const entry = entries[i];
        if (entry) {
          this.cache.set(entry[0], entry[1]);
        }
      }
    }

    this.cache.set(str, str);
    return str;
  }

  clear(): void {
    this.cache.clear();
  }
}

export const stringInterner = new StringInterner();

/**
 * Expression complexity analyzer for optimization decisions
 * Helps determine when to apply memoization or other optimizations
 *
 * Whether the rule this expression belongs to is (directly or indirectly)
 * recursive cannot be determined from the expression tree alone: a genuinely
 * recursive PEG rule refers to itself (or a rule that refers back to it) by
 * name through an `Identifier` node, not by containing a repeated object
 * instance. Resolving that requires the full grammar's rule map, which this
 * function doesn't have -- so recursion is computed once per grammar by
 * {@link analyzeGrammarPerformance} (via a proper dependency-graph cycle
 * check) and passed in here.
 */
export function analyzeExpressionComplexity(
  expr: Expression,
  hasRecursion = false,
): {
  depth: number;
  nodeCount: number;
  hasRecursion: boolean;
  estimatedComplexity: "low" | "medium" | "high";
} {
  let maxDepth = 0;
  let nodeCount = 0;

  function analyze(expr: Expression, depth: number): void {
    nodeCount++;
    maxDepth = Math.max(maxDepth, depth);

    switch (expr.type) {
      case "Sequence":
        for (const element of expr.elements) {
          analyze(element, depth + 1);
        }
        break;
      case "Choice":
        for (const alternative of expr.alternatives) {
          analyze(alternative, depth + 1);
        }
        break;
      case "Star":
      case "Plus":
      case "Optional":
      case "Group":
        analyze(expr.expression, depth + 1);
        break;
      case "PositiveLookahead":
      case "NegativeLookahead":
        analyze(expr.expression, depth + 1);
        break;
      case "LabeledExpression":
        analyze(expr.expression, depth + 1);
        break;
      case "Quantified":
        analyze(expr.expression, depth + 1);
        break;
    }
  }

  analyze(expr, 0);

  let estimatedComplexity: "low" | "medium" | "high" = "low";
  if (hasRecursion || maxDepth > 10 || nodeCount > 50) {
    estimatedComplexity = "high";
  } else if (maxDepth > 5 || nodeCount > 20) {
    estimatedComplexity = "medium";
  }

  return {
    depth: maxDepth,
    nodeCount,
    hasRecursion,
    estimatedComplexity,
  };
}

/**
 * Grammar optimization analyzer
 * Identifies opportunities for performance improvements
 */
export function analyzeGrammarPerformance(grammar: GrammarDefinition): {
  ruleComplexity: Map<string, ReturnType<typeof analyzeExpressionComplexity>>;
  optimizationSuggestions: string[];
  estimatedParseComplexity: "low" | "medium" | "high";
} {
  const ruleComplexity = new Map<
    string,
    ReturnType<typeof analyzeExpressionComplexity>
  >();
  const optimizationSuggestions: string[] = [];
  let maxComplexity: "low" | "medium" | "high" = "low";

  // Build the rule dependency graph once, then find every rule that's part
  // of a reference cycle -- direct (A -> A) or indirect (A -> B -> A). This
  // is the only way to know a rule is genuinely recursive: recursion in a
  // PEG grammar happens through name references between rules, not through
  // repeated object instances within a single expression tree.
  const ruleDependencies = new Map<string, Set<string>>();
  const leftmostRuleDependencies = new Map<string, Set<string>>();
  for (const rule of grammar.rules) {
    const dependencies = new Set<string>();
    collectRuleDependencies(rule.pattern, dependencies);
    ruleDependencies.set(rule.name, dependencies);

    const leftmostDependencies = new Set<string>();
    collectLeftmostRuleDependencies(rule.pattern, leftmostDependencies);
    leftmostRuleDependencies.set(rule.name, leftmostDependencies);
  }
  const recursiveRuleNames = findRecursiveRuleNames(ruleDependencies);
  const leftRecursiveRuleNames = findRecursiveRuleNames(
    leftmostRuleDependencies,
  );

  for (const rule of grammar.rules) {
    const complexity = analyzeExpressionComplexity(
      rule.pattern,
      recursiveRuleNames.has(rule.name),
    );
    ruleComplexity.set(rule.name, complexity);

    if (complexity.estimatedComplexity === "high") {
      maxComplexity = "high";
      optimizationSuggestions.push(
        `Rule '${rule.name}' has high complexity (depth: ${complexity.depth}, nodes: ${complexity.nodeCount})`,
      );

      if (complexity.hasRecursion) {
        optimizationSuggestions.push(
          `Rule '${rule.name}' contains recursion - consider memoization`,
        );
      }
    } else if (
      complexity.estimatedComplexity === "medium" &&
      maxComplexity === "low"
    ) {
      maxComplexity = "medium";
    }
  }

  for (const ruleName of leftRecursiveRuleNames) {
    optimizationSuggestions.push(
      `Rule '${ruleName}' has left recursion - this will cause infinite loops in a PEG parser`,
    );
  }

  if (grammar.rules.length > 50) {
    optimizationSuggestions.push(
      `Grammar has ${grammar.rules.length} rules - consider splitting into smaller grammars`,
    );
  }

  return {
    ruleComplexity,
    optimizationSuggestions,
    estimatedParseComplexity: maxComplexity,
  };
}

/**
 * Collect rule dependencies from an expression
 */
function collectRuleDependencies(
  expr: Expression,
  dependencies: Set<string>,
): void {
  switch (expr.type) {
    case "Identifier":
      dependencies.add(expr.name);
      break;
    case "Sequence":
      for (const element of expr.elements) {
        collectRuleDependencies(element, dependencies);
      }
      break;
    case "Choice":
      for (const alternative of expr.alternatives) {
        collectRuleDependencies(alternative, dependencies);
      }
      break;
    case "Star":
    case "Plus":
    case "Optional":
    case "Group":
      collectRuleDependencies(expr.expression, dependencies);
      break;
    case "PositiveLookahead":
    case "NegativeLookahead":
      collectRuleDependencies(expr.expression, dependencies);
      break;
    case "LabeledExpression":
      collectRuleDependencies(expr.expression, dependencies);
      break;
    case "Quantified":
      collectRuleDependencies(expr.expression, dependencies);
      break;
  }
}

/**
 * Collect only the *leftmost* rule dependencies of an expression: the rules
 * that can be referenced at the very start of the input position this
 * expression is tried at, without first requiring some other token to be
 * consumed. This is the set of references relevant to left-recursion
 * detection, which is distinct from (and a subset of) general recursion:
 * a rule that only references itself after consuming a token first (e.g.
 * `Expr = "a" Expr / "a"`, ordinary right recursion) is perfectly safe in a
 * PEG parser, while a rule reachable from itself with nothing consumed first
 * (e.g. `Expr = Expr "a" / "a"`) causes infinite recursion.
 *
 * - `Sequence`: only the first element is leftmost -- later elements are
 *   only tried after the first has already matched (and consumed input, in
 *   the common case).
 * - `Choice`: every alternative is leftmost, since each is tried at the same
 *   starting position.
 * - `Star` / `Plus` / `Optional` / `Group` / `Quantified` / `LabeledExpression`:
 *   the wrapped expression is tried at the same starting position.
 * - `PositiveLookahead` / `NegativeLookahead`: the wrapped expression is
 *   evaluated at the same position too (lookaheads don't consume input), so
 *   a self-reference through a lookahead can still recurse without
 *   progressing.
 */
function collectLeftmostRuleDependencies(
  expr: Expression,
  dependencies: Set<string>,
): void {
  switch (expr.type) {
    case "Identifier":
      dependencies.add(expr.name);
      break;
    case "Sequence": {
      const first = expr.elements[0];
      if (first) {
        collectLeftmostRuleDependencies(first, dependencies);
      }
      break;
    }
    case "Choice":
      for (const alternative of expr.alternatives) {
        collectLeftmostRuleDependencies(alternative, dependencies);
      }
      break;
    case "Star":
    case "Plus":
    case "Optional":
    case "Group":
      collectLeftmostRuleDependencies(expr.expression, dependencies);
      break;
    case "PositiveLookahead":
    case "NegativeLookahead":
      collectLeftmostRuleDependencies(expr.expression, dependencies);
      break;
    case "LabeledExpression":
      collectLeftmostRuleDependencies(expr.expression, dependencies);
      break;
    case "Quantified":
      collectLeftmostRuleDependencies(expr.expression, dependencies);
      break;
  }
}

/**
 * Finds every rule name that is part of a reference cycle in the given
 * dependency graph, whether direct (A -> A) or indirect (A -> B -> ... -> A).
 * References to names outside the graph (e.g. rules imported from another
 * module) are not tracked as dependencies and can't participate in a cycle.
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

/**
 * Performance monitoring utilities
 */
export class PerformanceMonitor {
  private startTimes = new Map<string, number>();
  private metrics = new Map<string, { totalTime: number; count: number }>();

  start(operation: string): void {
    this.startTimes.set(operation, performance.now());
  }

  end(operation: string): number {
    const startTime = this.startTimes.get(operation);
    if (startTime === undefined) {
      return 0;
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    const existing = this.metrics.get(operation) || { totalTime: 0, count: 0 };
    this.metrics.set(operation, {
      totalTime: existing.totalTime + duration,
      count: existing.count + 1,
    });

    this.startTimes.delete(operation);
    return duration;
  }

  getMetrics(): Map<
    string,
    { totalTime: number; count: number; averageTime: number }
  > {
    const result = new Map();
    for (const [operation, metrics] of this.metrics) {
      result.set(operation, {
        ...metrics,
        averageTime: metrics.totalTime / metrics.count,
      });
    }
    return result;
  }

  clear(): void {
    this.startTimes.clear();
    this.metrics.clear();
  }

  report(): string {
    const metrics = this.getMetrics();
    const lines = ["Performance Report:"];

    for (const [operation, data] of metrics) {
      lines.push(
        `  ${operation}: ${data.count} calls, avg ${data.averageTime.toFixed(2)}ms, total ${data.totalTime.toFixed(2)}ms`,
      );
    }

    return lines.join("\n");
  }
}

export const globalPerformanceMonitor = new PerformanceMonitor();
