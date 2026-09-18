/**
 * Performance Optimization Utilities for TPEG Parser
 *
 * This module provides performance-optimized functions and utilities
 * for grammar parsing and code generation operations.
 */

import { childExpressions, forEachExpression } from "@suzumiyaaoba/tpeg-core";
import { collectZeroOffsetRuleRefs, computeNullableRules } from "./first-sets";
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

    // `childExpressions` includes an `ActionExpression`'s wrapped
    // expression, so a rule reference reachable only through a semantic
    // action (e.g. `x = ( y ) { ... }`) still counts toward this rule's
    // complexity -- an earlier hand-written switch here omitted that case
    // and undercounted `nodeCount`/`depth` for every action-bearing rule.
    for (const child of childExpressions(expr)) {
      analyze(child, depth + 1);
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
  const nullableRules = computeNullableRules(grammar);
  for (const rule of grammar.rules) {
    const dependencies = new Set<string>();
    collectRuleDependencies(rule.pattern, dependencies);
    ruleDependencies.set(rule.name, dependencies);

    const leftmostDependencies = new Set<string>();
    collectZeroOffsetRuleRefs(
      rule.pattern,
      nullableRules,
      leftmostDependencies,
    );
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

  // Advisory only: `collectZeroOffsetRuleRefs` (`./first-sets.ts`) is the
  // same zero-offset edge relation `./grammar-validation.ts`'s
  // authoritative `validateGrammar` left-recursion check propagates
  // along, so this set now sees through a nullable `Sequence` prefix too
  // (e.g. `e = "a"? e "b" / "c"`). `validateGrammar` still runs first as
  // the hard error; this loop only adds the human-readable suggestion
  // text.
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
 * Collect rule dependencies from an expression: the name of every
 * `Identifier` (local rule reference) in its subtree. `QualifiedIdentifier`
 * nodes are skipped -- a `module.rule` reference points outside this
 * grammar's own rule set.
 *
 * The traversal goes through `forEachExpression`/`childExpressions`
 * (`@suzumiyaaoba/tpeg-core`), which descends into an `ActionExpression`'s
 * wrapped expression -- a rule reference reachable only through a semantic
 * action (e.g. `x = ( y ) { ... }`) is a real dependency for
 * `findRecursiveRuleNames`; omitting that case (as earlier hand-written
 * switches in this repo did, in three separate copies) made such a
 * reference invisible and reported `hasRecursion: false` for a genuinely
 * recursive rule. Exported so `tpeg-generator` shares this exact walk
 * instead of hand-maintaining a second copy.
 */
export function collectRuleDependencies(
  expr: Expression,
  dependencies: Set<string>,
): void {
  forEachExpression(expr, (node) => {
    if (node.type === "Identifier") {
      dependencies.add(node.name);
    }
  });
}

/**
 * Finds every rule name that is part of a reference cycle in the given
 * dependency graph, whether direct (A -> A) or indirect (A -> B -> ... -> A).
 * References to names outside the graph (e.g. rules imported from another
 * module) are not tracked as dependencies and can't participate in a cycle.
 *
 * A rule is on a cycle exactly when it belongs to a strongly connected
 * component of size > 1, or has a self-loop -- so this is one iterative
 * Tarjan SCC pass over the whole graph, O(rules + edges). The `canReach(
 * rule, rule)`-per-rule DFS this replaces was O(rules x edges) (a
 * 10,000-rule reference chain took ~9.4s inside every
 * `generateOptimizedTypeScriptParser` call, which runs this analysis
 * unconditionally) and recursed as deep as the chain itself.
 */
export function findRecursiveRuleNames(
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const recursive = new Set<string>();
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const sccStack: string[] = [];
  let nextIndex = 0;

  for (const root of dependencies.keys()) {
    if (index.has(root)) continue;
    // Iterative DFS: each work entry carries a node plus the iterator
    // over its successors, so the post-order lowlink merge into the
    // parent happens exactly when a node's frame completes.
    index.set(root, nextIndex);
    lowlink.set(root, nextIndex);
    nextIndex++;
    sccStack.push(root);
    onStack.add(root);
    const work: { node: string; it: Iterator<string> }[] = [
      {
        node: root,
        it: dependencies.get(root)?.values() ?? [][Symbol.iterator](),
      },
    ];

    while (work.length > 0) {
      const frame = work[work.length - 1] as {
        node: string;
        it: Iterator<string>;
      };
      const step = frame.it.next();
      if (step.done) {
        work.pop();
        const node = frame.node;
        const parentFrame = work[work.length - 1];
        if (parentFrame) {
          // Tree edge parent -> node: fold node's lowlink into parent's.
          lowlink.set(
            parentFrame.node,
            Math.min(
              lowlink.get(parentFrame.node) as number,
              lowlink.get(node) as number,
            ),
          );
        }
        if (lowlink.get(node) === index.get(node)) {
          // `node` is an SCC root: everything above it on `sccStack` is
          // its component.
          const scc: string[] = [];
          for (;;) {
            const member = sccStack.pop() as string;
            onStack.delete(member);
            scc.push(member);
            if (member === node) break;
          }
          if (scc.length > 1) {
            for (const member of scc) recursive.add(member);
          } else if ((dependencies.get(node) as Set<string>).has(node)) {
            // Singleton component: recursive only via a self-loop.
            recursive.add(node);
          }
        }
        continue;
      }
      const succ = step.value;
      if (!dependencies.has(succ)) continue; // unresolvable: a dead end
      if (!index.has(succ)) {
        index.set(succ, nextIndex);
        lowlink.set(succ, nextIndex);
        nextIndex++;
        sccStack.push(succ);
        onStack.add(succ);
        work.push({
          node: succ,
          it: dependencies.get(succ)?.values() ?? [][Symbol.iterator](),
        });
      } else if (onStack.has(succ)) {
        // Back/cross edge to a node still on the SCC stack.
        lowlink.set(
          frame.node,
          Math.min(
            lowlink.get(frame.node) as number,
            index.get(succ) as number,
          ),
        );
      }
    }
  }
  return recursive;
}

/**
 * Performance monitoring utilities
 */
export class PerformanceMonitor {
  // A STACK of start times per operation, not a single timestamp: a
  // monitored operation can be re-entered before the previous call ends
  // (a recursive grammar rule under `includeMonitoring` wraps every
  // invocation in start/end pairs, so `nested` calling `nested` nests
  // same-operation measurements). A lone `Map<string, number>` dropped
  // the outer measurement entirely -- the inner `end` consumed the only
  // timestamp, the outer `end` then recorded 0 and the call count was
  // halved (#109).
  private startTimes = new Map<string, number[]>();
  private metrics = new Map<string, { totalTime: number; count: number }>();

  start(operation: string): void {
    const stack = this.startTimes.get(operation);
    if (stack) {
      stack.push(performance.now());
    } else {
      this.startTimes.set(operation, [performance.now()]);
    }
  }

  end(operation: string): number {
    const stack = this.startTimes.get(operation);
    if (!stack || stack.length === 0) {
      return 0;
    }
    const startTime = stack.pop() as number;
    if (stack.length === 0) {
      this.startTimes.delete(operation);
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    const existing = this.metrics.get(operation) || { totalTime: 0, count: 0 };
    this.metrics.set(operation, {
      totalTime: existing.totalTime + duration,
      count: existing.count + 1,
    });

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
