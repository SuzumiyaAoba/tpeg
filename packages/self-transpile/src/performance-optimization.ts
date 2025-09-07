/**
 * Performance Optimization System for TPEG Self-Transpilation
 *
 * Advanced optimization techniques to improve performance and efficiency
 * including caching, memory management, and parallel processing.
 */

import { performance } from "node:perf_hooks";
import type { GrammarDefinition, RuleDefinition } from "@SuzumiyaAoba/core";
import { generateEtaTypeScriptParser } from "@SuzumiyaAoba/generator";
import type {
  ExpressionNode,
  PerformanceStats,
  SelfTranspileConfig,
  SelfTranspileResult,
} from "./types";

/**
 * Performance optimization configuration
 */
export interface OptimizationConfig {
  enableCaching: boolean;
  enableMemoryPooling: boolean;
  enableParallelProcessing: boolean;
  enableLazyEvaluation: boolean;
  enableStringBuilderOptimization: boolean;
  cacheSize: number;
  memoryPoolSize: number;
  parallelThreshold: number;
}

/**
 * Default optimization configuration
 */
const DEFAULT_OPTIMIZATION_CONFIG: OptimizationConfig = {
  enableCaching: true,
  enableMemoryPooling: true,
  enableParallelProcessing: true,
  enableLazyEvaluation: true,
  enableStringBuilderOptimization: true,
  cacheSize: 100,
  memoryPoolSize: 50,
  parallelThreshold: 10,
};

/**
 * Cache entry structure
 */
interface CacheEntry {
  key: string;
  result: SelfTranspileResult;
  timestamp: number;
  hitCount: number;
  size: number;
}

/**
 * Memory pool for object reuse
 */
class MemoryPool<T> {
  private pool: T[] = [];
  private factory: () => T;
  private reset: (item: T) => void;
  private maxSize: number;

  constructor(factory: () => T, reset: (item: T) => void, maxSize = 50) {
    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;
  }

  acquire(): T {
    if (this.pool.length > 0) {
      const item = this.pool.pop();
      if (item) {
        this.reset(item);
        return item;
      }
    }
    return this.factory();
  }

  release(item: T): void {
    if (this.pool.length < this.maxSize) {
      this.pool.push(item);
    }
  }

  clear(): void {
    this.pool = [];
  }

  size(): number {
    return this.pool.length;
  }
}

/**
 * String builder for efficient code generation
 */
class OptimizedStringBuilder {
  private chunks: string[] = [];
  private totalLength = 0;

  append(str: string): void {
    this.chunks.push(str);
    this.totalLength += str.length;
  }

  appendLine(str = ""): void {
    this.append(`${str}\n`);
  }

  toString(): string {
    return this.chunks.join("");
  }

  clear(): void {
    this.chunks = [];
    this.totalLength = 0;
  }

  length(): number {
    return this.totalLength;
  }
}

interface GeneratedCodeResult {
  code: string;
  types: string;
  warnings: string[];
}

/**
 * Performance-optimized self-transpilation engine
 */
export class OptimizedSelfTranspiler {
  private cache: Map<string, CacheEntry> = new Map();
  private stringBuilderPool: MemoryPool<OptimizedStringBuilder>;
  private rulePool: MemoryPool<Record<string, unknown>>;
  private config: OptimizationConfig;
  private stats: {
    cacheHits: number;
    cacheMisses: number;
    memoryPoolHits: number;
    memoryPoolMisses: number;
    parallelProcessingUsed: number;
  };

  constructor(config: Partial<OptimizationConfig> = {}) {
    this.config = { ...DEFAULT_OPTIMIZATION_CONFIG, ...config };
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      memoryPoolHits: 0,
      memoryPoolMisses: 0,
      parallelProcessingUsed: 0,
    };

    // Initialize memory pools
    this.stringBuilderPool = new MemoryPool(
      () => new OptimizedStringBuilder(),
      (sb) => sb.clear(),
      this.config.memoryPoolSize,
    );

    this.rulePool = new MemoryPool(
      () => ({}) as Record<string, unknown>,
      (rule: Record<string, unknown>) => {
        for (const key of Object.keys(rule)) {
          delete rule[key];
        }
      },
      this.config.memoryPoolSize,
    );
  }

  /**
   * Optimized self-transpilation with caching and memory pooling
   */
  async transpile(
    grammarSource: string,
    config: Partial<SelfTranspileConfig> = {},
  ): Promise<SelfTranspileResult> {
    const cacheKey = this.generateCacheKey(grammarSource, config);

    // Check cache first
    if (this.config.enableCaching) {
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
      this.stats.cacheMisses++;
    }

    const startTime = performance.now();
    const startMemory = process.memoryUsage().heapUsed;

    try {
      // Parse grammar with optimization
      const grammar = this.parseGrammarOptimized(grammarSource);

      if (!grammar) {
        throw new Error("Failed to parse grammar");
      }

      // Generate code with optimizations
      const result = await this.generateCodeOptimized(grammar, config);

      const endTime = performance.now();
      const endMemory = process.memoryUsage().heapUsed;

      const transpileResult: SelfTranspileResult = {
        code: result.code,
        types: result.types || "",
        performance: {
          generationTime: endTime - startTime,
          memoryUsage: endMemory - startMemory,
          complexity: this.estimateComplexity(grammar),
        },
        warnings: result.warnings || [],
        success: true,
      };

      // Cache the result
      if (this.config.enableCaching) {
        this.setCachedResult(cacheKey, transpileResult);
      }

      return transpileResult;
    } catch (error) {
      const endTime = performance.now();
      const endMemory = process.memoryUsage().heapUsed;

      return {
        code: "",
        types: "",
        performance: {
          generationTime: endTime - startTime,
          memoryUsage: endMemory - startMemory,
          complexity: "low",
        },
        warnings: [
          `Optimization failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
        success: false,
      };
    }
  }

  /**
   * Optimized grammar parsing with lazy evaluation
   */
  private parseGrammarOptimized(source: string): GrammarDefinition | null {
    try {
      const { grammarDefinition } = require("@SuzumiyaAoba/parser");
      const { parse } = require("@SuzumiyaAoba/core");

      const parser = parse(grammarDefinition);
      const result = parser(source);

      if (result.success) {
        const grammar = result.val as GrammarDefinition;

        // Apply lazy evaluation optimization
        if (this.config.enableLazyEvaluation) {
          this.applyLazyEvaluation(grammar);
        }

        return grammar;
      }

      return null;
    } catch (error) {
      console.error("Optimized parsing failed:", error);
      return null;
    }
  }

  /**
   * Optimized code generation with parallel processing
   */
  private async generateCodeOptimized(
    grammar: GrammarDefinition,
    config: Partial<SelfTranspileConfig>,
  ): Promise<GeneratedCodeResult> {
    const shouldUseParallel =
      this.config.enableParallelProcessing &&
      grammar.rules.length > this.config.parallelThreshold;

    if (shouldUseParallel) {
      this.stats.parallelProcessingUsed++;
      return this.generateCodeParallel(grammar, config);
    }

    if (this.config.enableStringBuilderOptimization) {
      return this.generateCodeWithStringBuilder(grammar, config);
    }
    // @ts-ignore - Temporary type compatibility
    return await generateEtaTypeScriptParser(grammar as GrammarDefinition, {
      namePrefix: config.namePrefix || "opt_",
      includeTypes: config.includeTypes || true,
      optimize: true,
    });
  }

  private async generateCodeSequential(
    grammar: GrammarDefinition,
    config: Partial<SelfTranspileConfig>,
  ): Promise<GeneratedCodeResult> {
    if (this.config.enableStringBuilderOptimization) {
      return this.generateCodeWithStringBuilder(grammar, config);
    }
    // @ts-ignore - Temporary type compatibility
    return await generateEtaTypeScriptParser(grammar as GrammarDefinition, {
      namePrefix: config.namePrefix || "seq_",
      includeTypes: config.includeTypes || true,
      optimize: false,
    });
  }

  private async generateCodeParallel(
    grammar: GrammarDefinition,
    config: Partial<SelfTranspileConfig>,
  ): Promise<GeneratedCodeResult> {
    const chunks = this.partitionGrammar(grammar);
    const promises = chunks.map((chunk) =>
      this.generateCodeSequential(chunk, config),
    );

    const results = await Promise.all(promises);
    return this.mergeGeneratedCode(results);
  }

  private async generateCodeWithStringBuilder(
    grammar: GrammarDefinition,
    config: Partial<SelfTranspileConfig>,
  ): Promise<GeneratedCodeResult> {
    const builder = this.stringBuilderPool.acquire();
    this.stats.memoryPoolHits++;

    try {
      // Generate imports
      builder.appendLine('import { memoize } from "./utils";');
      builder.appendLine(
        'import { charClass, literal, sequence, choice } from "./combinators";',
      );
      builder.appendLine();

      // Generate rules
      for (const rule of grammar.rules) {
        const ruleCode = this.generateRuleCode(rule, config);
        builder.appendLine(`export const ${rule.name} = ${ruleCode};`);
      }

      return {
        code: builder.toString(),
        types: "",
        warnings: [],
      };
    } finally {
      this.stringBuilderPool.release(builder);
    }
  }

  /**
   * Generate code for a single rule with optimization
   */
  private generateRuleCode(
    rule: RuleDefinition,
    config: Partial<SelfTranspileConfig>,
  ): string {
    const memoized = config.enableMemoization || true;
    const ruleCode = this.generateExpressionCode(rule.pattern);

    return memoized ? `memoize(${ruleCode})` : ruleCode;
  }

  /**
   * Generate code for expressions with optimization
   */
  private generateExpressionCode(expression: ExpressionNode): string {
    if (!expression || typeof expression !== "object") {
      return 'literal("")';
    }

    switch (expression.type) {
      case "literal":
        return `literal("${expression.value}")`;
      case "charClass":
        return `charClass("${expression.value}")`;
      case "sequence": {
        const sequenceItems = (expression.items || []).map(
          (item: ExpressionNode) => this.generateExpressionCode(item),
        );
        return `sequence(${sequenceItems.join(", ")})`;
      }
      case "choice": {
        const choiceItems = (expression.items || []).map(
          (item: ExpressionNode) => this.generateExpressionCode(item),
        );
        return `choice(${choiceItems.join(", ")})`;
      }
      case "ruleRef":
        return expression.name;
      case "optional":
        return `choice(${this.generateExpressionCode(expression.item)}, literal(""))`;
      case "zeroOrMore":
        return `sequence(${this.generateExpressionCode(expression.item)}, choice(${this.generateExpressionCode(expression.item)}, literal("")))`;
      case "oneOrMore":
        return `sequence(${this.generateExpressionCode(expression.item)}, zeroOrMore(${this.generateExpressionCode(expression.item)}))`;
      default:
        return 'literal("")';
    }
  }

  /**
   * Apply lazy evaluation to grammar
   */
  private applyLazyEvaluation(grammar: GrammarDefinition): void {
    const usedRules = new Set<string>();

    // Find all rule references
    const findRuleReferences = (expression: ExpressionNode): void => {
      if (expression && typeof expression === "object") {
        if (expression.type === "ruleRef") {
          usedRules.add(expression.name);
        }
        // Recursively check nested expressions
        for (const key in expression) {
          if (Array.isArray(expression[key])) {
            for (const item of expression[key]) {
              findRuleReferences(item);
            }
          } else if (typeof expression[key] === "object") {
            findRuleReferences(expression[key]);
          }
        }
      }
    };

    // Start from the first rule (usually the main grammar rule)
    if (grammar.rules.length > 0) {
      const firstRule = grammar.rules[0];
      if (firstRule) {
        findRuleReferences(firstRule.pattern);
      }
    }

    // Mark unused rules
    for (const rule of grammar.rules) {
      if (!usedRules.has(rule.name)) {
        (rule as unknown as Record<string, unknown>).lazy = true;
      }
    }
  }

  /**
   * Partition grammar for parallel processing
   */
  private partitionGrammar(grammar: GrammarDefinition): GrammarDefinition[] {
    const chunkSize = Math.ceil(grammar.rules.length / 3);
    const chunks: GrammarDefinition[] = [];

    for (let i = 0; i < grammar.rules.length; i += chunkSize) {
      chunks.push({
        name: `${grammar.name}_chunk_${chunks.length}`,
        rules: grammar.rules.slice(i, i + chunkSize),
        annotations: grammar.annotations,
        type: grammar.type,
      });
    }

    return chunks;
  }

  /**
   * Merge generated code from parallel processing
   */
  private mergeGeneratedCode(
    results: GeneratedCodeResult[],
  ): GeneratedCodeResult {
    const builder = this.stringBuilderPool.acquire();

    try {
      // Merge imports (deduplicate)
      const imports = new Set<string>();
      for (const result of results) {
        const lines = result.code.split("\n");
        for (const line of lines) {
          if (line.startsWith("import")) {
            imports.add(line);
          }
        }
      }

      for (const imp of imports) {
        builder.appendLine(imp);
      }
      builder.appendLine();

      // Merge generated functions
      for (const result of results) {
        const lines = result.code.split("\n");
        for (const line of lines) {
          if (line.startsWith("export const")) {
            builder.appendLine(line);
          }
        }
      }

      return {
        code: builder.toString(),
        types: "",
        warnings: results.flatMap((r) => r.warnings || []),
      };
    } finally {
      this.stringBuilderPool.release(builder);
    }
  }

  /**
   * Generate cache key for a transpilation request
   */
  private generateCacheKey(
    grammarSource: string,
    config: Partial<SelfTranspileConfig>,
  ): string {
    const configStr = JSON.stringify(config);
    return `${grammarSource.length}_${this.simpleHash(grammarSource)}_${this.simpleHash(configStr)}`;
  }

  /**
   * Simple hash function for cache keys
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  /**
   * Get cached result
   */
  private getCachedResult(key: string): SelfTranspileResult | null {
    const entry = this.cache.get(key);
    if (entry) {
      entry.hitCount++;
      return entry.result;
    }
    return null;
  }

  /**
   * Set cached result
   */
  private setCachedResult(key: string, result: SelfTranspileResult): void {
    // Implement LRU cache eviction
    if (this.cache.size >= this.config.cacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      key,
      result,
      timestamp: Date.now(),
      hitCount: 0,
      size: result.code.length,
    });
  }

  /**
   * Estimate grammar complexity
   */
  private estimateComplexity(
    grammar: GrammarDefinition,
  ): "low" | "medium" | "high" {
    const ruleCount = grammar.rules.length;
    const annotationCount = grammar.annotations.length;

    if (ruleCount < 10 && annotationCount < 5) {
      return "low";
    }
    if (ruleCount < 30 && annotationCount < 10) {
      return "medium";
    }
    return "high";
  }

  /**
   * Get performance statistics
   */
  getStats(): PerformanceStats {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      cacheHitRate:
        (this.stats.cacheHits /
          (this.stats.cacheHits + this.stats.cacheMisses)) *
        100,
      memoryPoolSize: this.stringBuilderPool.size(),
      memoryPoolHitRate:
        (this.stats.memoryPoolHits /
          (this.stats.memoryPoolHits + this.stats.memoryPoolMisses)) *
        100,
    };
  }

  /**
   * Clear all caches and reset statistics
   */
  clearCache(): void {
    this.cache.clear();
    this.stringBuilderPool.clear();
    this.rulePool.clear();
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      memoryPoolHits: 0,
      memoryPoolMisses: 0,
      parallelProcessingUsed: 0,
    };
  }
}

/**
 * Create an optimized self-transpiler instance
 */
export function createOptimizedTranspiler(
  config?: Partial<OptimizationConfig>,
): OptimizedSelfTranspiler {
  return new OptimizedSelfTranspiler(config);
}

/**
 * Optimized self-transpile function
 */
export async function selfTranspileOptimized(
  grammarSource: string,
  config: Partial<SelfTranspileConfig> = {},
  optimizationConfig: Partial<OptimizationConfig> = {},
): Promise<SelfTranspileResult> {
  const transpiler = createOptimizedTranspiler(optimizationConfig);
  return transpiler.transpile(grammarSource, config);
}
