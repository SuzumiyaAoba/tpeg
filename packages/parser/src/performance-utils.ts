/**
 * Performance Optimization Utilities for TPEG Parser
 * 
 * This module provides performance-optimized functions and utilities
 * for grammar parsing and code generation operations.
 */

import type { Expression, GrammarDefinition } from "./types";

/**
 * Simple memoization cache for parser results
 * Uses Map for string-based caching
 */
// const parseCache = new Map<string, Map<number, any>>();

/**
 * High-performance string hashing function
 * Uses djb2 algorithm for fast, reasonably good distribution
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
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
 * Fast character classification using lookup tables
 * Pre-computed for common character ranges
 */
const charClassCache = new Map<string, boolean[]>();

export function createCharClassLookup(ranges: Array<{ start: string; end?: string | undefined }>): boolean[] {
  const key = JSON.stringify(ranges);
  
  if (charClassCache.has(key)) {
    return charClassCache.get(key)!;
  }
  
  const lookup = new Array(256).fill(false);
  
  for (const range of ranges) {
    if (range.end) {
      // Character range
      const start = range.start.charCodeAt(0);
      const end = range.end.charCodeAt(0);
      for (let i = start; i <= end && i < 256; i++) {
        lookup[i] = true;
      }
    } else {
      // Single character
      const code = range.start.charCodeAt(0);
      if (code < 256) {
        lookup[code] = true;
      }
    }
  }
  
  charClassCache.set(key, lookup);
  return lookup;
}

/**
 * Optimized position tracking for large inputs
 * Uses incremental updates instead of recalculating from scratch
 */
export class PositionTracker {
  private lineStarts: number[] = [0];
  private lastOffset = 0;
  private lastLine = 1;
  private lastColumn = 1;
  
  constructor(private input: string) {
    // Pre-compute line starts for large inputs
    if (input.length > 10000) {
      this.precomputeLineStarts();
    }
  }
  
  private precomputeLineStarts() {
    for (let i = 0; i < this.input.length; i++) {
      if (this.input[i] === '\n') {
        this.lineStarts.push(i + 1);
      }
    }
  }
  
  getPosition(offset: number): { line: number; column: number } {
    if (offset === this.lastOffset) {
      return { line: this.lastLine, column: this.lastColumn };
    }
    
    if (this.lineStarts.length > 1) {
      // Use pre-computed line starts
      let line = 1;
      for (let i = 1; i < this.lineStarts.length; i++) {
        const lineStart = this.lineStarts[i];
        if (lineStart !== undefined && lineStart > offset) {
          break;
        }
        line = i + 1;
      }
      const lineStart = this.lineStarts[line - 1];
      const column = lineStart !== undefined ? offset - lineStart + 1 : 1;
      
      this.lastOffset = offset;
      this.lastLine = line;
      this.lastColumn = column;
      
      return { line, column };
    } else {
      // Incremental calculation for small inputs
      if (offset >= this.lastOffset) {
        // Forward scan
        let line = this.lastLine;
        let column = this.lastColumn;
        
        for (let i = this.lastOffset; i < offset; i++) {
          if (this.input[i] === '\n') {
            line++;
            column = 1;
          } else {
            column++;
          }
        }
        
        this.lastOffset = offset;
        this.lastLine = line;
        this.lastColumn = column;
        
        return { line, column };
      } else {
        // Backward scan (less common, fallback to simple calculation)
        let line = 1;
        let column = 1;
        
        for (let i = 0; i < offset; i++) {
          if (this.input[i] === '\n') {
            line++;
            column = 1;
          } else {
            column++;
          }
        }
        
        return { line, column };
      }
    }
  }
}

/**
 * Expression complexity analyzer for optimization decisions
 * Helps determine when to apply memoization or other optimizations
 */
export function analyzeExpressionComplexity(expr: Expression): {
  depth: number;
  nodeCount: number;
  hasRecursion: boolean;
  estimatedComplexity: 'low' | 'medium' | 'high';
} {
  const visited = new Set<Expression>();
  let maxDepth = 0;
  let nodeCount = 0;
  let hasRecursion = false;
  
  function analyze(expr: Expression, depth: number): void {
    if (visited.has(expr)) {
      hasRecursion = true;
      return;
    }
    
    visited.add(expr);
    nodeCount++;
    maxDepth = Math.max(maxDepth, depth);
    
    switch (expr.type) {
      case 'Sequence':
        for (const element of expr.elements) {
          analyze(element, depth + 1);
        }
        break;
      case 'Choice':
        for (const alternative of expr.alternatives) {
          analyze(alternative, depth + 1);
        }
        break;
      case 'Star':
      case 'Plus':
      case 'Optional':
      case 'Group':
        analyze(expr.expression, depth + 1);
        break;
      case 'PositiveLookahead':
      case 'NegativeLookahead':
        analyze(expr.expression, depth + 1);
        break;
      case 'LabeledExpression':
        analyze(expr.expression, depth + 1);
        break;
      case 'Quantified':
        analyze(expr.expression, depth + 1);
        break;
    }
  }
  
  analyze(expr, 0);
  
  let estimatedComplexity: 'low' | 'medium' | 'high' = 'low';
  if (hasRecursion || maxDepth > 10 || nodeCount > 50) {
    estimatedComplexity = 'high';
  } else if (maxDepth > 5 || nodeCount > 20) {
    estimatedComplexity = 'medium';
  }
  
  return {
    depth: maxDepth,
    nodeCount,
    hasRecursion,
    estimatedComplexity
  };
}

/**
 * Grammar optimization analyzer
 * Identifies opportunities for performance improvements
 */
export function analyzeGrammarPerformance(grammar: GrammarDefinition): {
  ruleComplexity: Map<string, ReturnType<typeof analyzeExpressionComplexity>>;
  optimizationSuggestions: string[];
  estimatedParseComplexity: 'low' | 'medium' | 'high';
} {
  const ruleComplexity = new Map<string, ReturnType<typeof analyzeExpressionComplexity>>();
  const optimizationSuggestions: string[] = [];
  let maxComplexity: 'low' | 'medium' | 'high' = 'low';
  
  for (const rule of grammar.rules) {
    const complexity = analyzeExpressionComplexity(rule.pattern);
    ruleComplexity.set(rule.name, complexity);
    
    if (complexity.estimatedComplexity === 'high') {
      maxComplexity = 'high';
      optimizationSuggestions.push(
        `Rule '${rule.name}' has high complexity (depth: ${complexity.depth}, nodes: ${complexity.nodeCount})`
      );
      
      if (complexity.hasRecursion) {
        optimizationSuggestions.push(
          `Rule '${rule.name}' contains recursion - consider memoization`
        );
      }
    } else if (complexity.estimatedComplexity === 'medium' && maxComplexity === 'low') {
      maxComplexity = 'medium';
    }
  }
  
  // Check for potential left recursion
  const ruleDependencies = new Map<string, Set<string>>();
  for (const rule of grammar.rules) {
    ruleDependencies.set(rule.name, new Set());
    collectRuleDependencies(rule.pattern, ruleDependencies.get(rule.name)!);
  }
  
  // Detect cycles (potential left recursion)
  for (const [ruleName, dependencies] of ruleDependencies) {
    if (dependencies.has(ruleName)) {
      optimizationSuggestions.push(
        `Rule '${ruleName}' may have left recursion - this can cause infinite loops`
      );
    }
  }
  
  if (grammar.rules.length > 50) {
    optimizationSuggestions.push(
      `Grammar has ${grammar.rules.length} rules - consider splitting into smaller grammars`
    );
  }
  
  return {
    ruleComplexity,
    optimizationSuggestions,
    estimatedParseComplexity: maxComplexity
  };
}

/**
 * Collect rule dependencies from an expression
 */
function collectRuleDependencies(expr: Expression, dependencies: Set<string>): void {
  switch (expr.type) {
    case 'Identifier':
      dependencies.add(expr.name);
      break;
    case 'Sequence':
      for (const element of expr.elements) {
        collectRuleDependencies(element, dependencies);
      }
      break;
    case 'Choice':
      for (const alternative of expr.alternatives) {
        collectRuleDependencies(alternative, dependencies);
      }
      break;
    case 'Star':
    case 'Plus':
    case 'Optional':
    case 'Group':
      collectRuleDependencies(expr.expression, dependencies);
      break;
    case 'PositiveLookahead':
    case 'NegativeLookahead':
      collectRuleDependencies(expr.expression, dependencies);
      break;
    case 'LabeledExpression':
      collectRuleDependencies(expr.expression, dependencies);
      break;
    case 'Quantified':
      collectRuleDependencies(expr.expression, dependencies);
      break;
  }
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
      count: existing.count + 1
    });
    
    this.startTimes.delete(operation);
    return duration;
  }
  
  getMetrics(): Map<string, { totalTime: number; count: number; averageTime: number }> {
    const result = new Map();
    for (const [operation, metrics] of this.metrics) {
      result.set(operation, {
        ...metrics,
        averageTime: metrics.totalTime / metrics.count
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
    const lines = ['Performance Report:'];
    
    for (const [operation, data] of metrics) {
      lines.push(
        `  ${operation}: ${data.count} calls, avg ${data.averageTime.toFixed(2)}ms, total ${data.totalTime.toFixed(2)}ms`
      );
    }
    
    return lines.join('\n');
  }
}

export const globalPerformanceMonitor = new PerformanceMonitor();