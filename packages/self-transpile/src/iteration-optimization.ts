/**
 * Iteration Optimization System for TPEG Self-Transpilation
 *
 * Advanced optimization techniques specifically designed for iterative
 * self-transpilation processes, including batch processing, parallel
 * execution, and intelligent caching strategies.
 */

import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { createOptimizedTranspiler } from "./performance-optimization";
import type { SelfTranspileConfig, SelfTranspileResult } from "./types";

/**
 * Iteration optimization configuration
 */
export interface IterationOptimizationConfig {
  batchSize: number;
  maxConcurrentWorkers: number;
  enableBatchProcessing: boolean;
  enableWorkerThreads: boolean;
  enableProgressiveOptimization: boolean;
  enablePredictivePreloading: boolean;
  adaptiveBatchSizing: boolean;
  maxMemoryUsage: number; // in MB
}

/**
 * Batch processing result
 */
interface BatchResult {
  batchId: number;
  results: SelfTranspileResult[];
  processingTime: number;
  memoryUsage: number;
  successRate: number;
  errors: string[];
}

/**
 * Iteration statistics
 */
interface IterationStats {
  totalIterations: number;
  completedIterations: number;
  avgIterationTime: number;
  totalTime: number;
  memoryEfficiency: number;
  cacheHitRate: number;
  throughput: number;
}

/**
 * Default iteration optimization configuration
 */
const DEFAULT_ITERATION_CONFIG: IterationOptimizationConfig = {
  batchSize: 5,
  maxConcurrentWorkers: Math.max(1, cpus().length - 1),
  enableBatchProcessing: true,
  enableWorkerThreads: false, // Disabled by default due to complexity
  enableProgressiveOptimization: true,
  enablePredictivePreloading: true,
  adaptiveBatchSizing: true,
  maxMemoryUsage: 500, // 500MB
};

/**
 * Optimized iteration processor for self-transpilation
 */
export class IterationOptimizer {
  private config: IterationOptimizationConfig;
  private transpiler: any;
  private stats: IterationStats;
  private batchSizeHistory: number[] = [];
  private performanceHistory: number[] = [];
  private preloadedCache: Map<string, Promise<SelfTranspileResult>> = new Map();

  constructor(config: Partial<IterationOptimizationConfig> = {}) {
    this.config = { ...DEFAULT_ITERATION_CONFIG, ...config };
    this.transpiler = createOptimizedTranspiler({
      enableCaching: true,
      enableMemoryPooling: true,
      enableParallelProcessing: true,
      enableLazyEvaluation: true,
      enableStringBuilderOptimization: true,
      cacheSize: 200,
      memoryPoolSize: 100,
    });

    this.stats = {
      totalIterations: 0,
      completedIterations: 0,
      avgIterationTime: 0,
      totalTime: 0,
      memoryEfficiency: 0,
      cacheHitRate: 0,
      throughput: 0,
    };
  }

  /**
   * Process multiple iterations with advanced optimization
   */
  async processIterations(
    iterations: Array<{
      grammarSource: string;
      config: Partial<SelfTranspileConfig>;
      id?: string;
    }>,
  ): Promise<{
    results: SelfTranspileResult[];
    stats: IterationStats;
    batchResults: BatchResult[];
  }> {
    console.log(
      `🚀 Processing ${iterations.length} iterations with optimization`,
    );

    const startTime = performance.now();
    const startMemory = process.memoryUsage().heapUsed;

    this.stats.totalIterations = iterations.length;
    this.stats.completedIterations = 0;

    const results: SelfTranspileResult[] = [];
    const batchResults: BatchResult[] = [];

    if (this.config.enableBatchProcessing) {
      // Predictive preloading
      if (this.config.enablePredictivePreloading) {
        await this.preloadCommonPatterns(iterations);
      }

      // Process in batches
      const batches = this.createOptimizedBatches(iterations);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(
          `📦 Processing batch ${i + 1}/${batches.length} (${batch.length} items)`,
        );

        const batchResult = await this.processBatch(batch, i);
        batchResults.push(batchResult);
        results.push(...batchResult.results);

        this.stats.completedIterations += batchResult.results.length;

        // Memory management
        if (this.getMemoryUsageMB() > this.config.maxMemoryUsage) {
          console.log("🧹 Memory threshold reached, cleaning up...");
          await this.performMemoryCleanup();
        }

        // Adaptive batch sizing
        if (this.config.adaptiveBatchSizing) {
          this.adjustBatchSize(batchResult);
        }

        // Progress reporting
        const progress =
          (this.stats.completedIterations / this.stats.totalIterations) * 100;
        console.log(
          `📊 Progress: ${progress.toFixed(1)}% (${this.stats.completedIterations}/${this.stats.totalIterations})`,
        );
      }
    } else {
      // Sequential processing
      for (let i = 0; i < iterations.length; i++) {
        const iteration = iterations[i];
        console.log(`🔄 Processing iteration ${i + 1}/${iterations.length}`);

        const result = await this.transpiler.transpile(
          iteration.grammarSource,
          iteration.config,
        );
        results.push(result);
        this.stats.completedIterations++;
      }
    }

    const endTime = performance.now();
    const endMemory = process.memoryUsage().heapUsed;

    // Calculate final statistics
    this.stats.totalTime = endTime - startTime;
    this.stats.avgIterationTime =
      this.stats.totalTime / this.stats.totalIterations;
    this.stats.memoryEfficiency = this.calculateMemoryEfficiency(
      startMemory,
      endMemory,
      results,
    );
    this.stats.cacheHitRate = this.calculateCacheHitRate();
    this.stats.throughput =
      this.stats.totalIterations / (this.stats.totalTime / 1000);

    console.log(
      `✅ Completed ${this.stats.completedIterations}/${this.stats.totalIterations} iterations`,
    );
    console.log(`⏱️  Total time: ${this.stats.totalTime.toFixed(2)}ms`);
    console.log(
      `📈 Throughput: ${this.stats.throughput.toFixed(2)} iterations/sec`,
    );

    return {
      results,
      stats: this.stats,
      batchResults,
    };
  }

  /**
   * Create optimized batches based on grammar complexity and similarity
   */
  private createOptimizedBatches(
    iterations: Array<{
      grammarSource: string;
      config: Partial<SelfTranspileConfig>;
      id?: string;
    }>,
  ): Array<
    Array<{
      grammarSource: string;
      config: Partial<SelfTranspileConfig>;
      id?: string;
    }>
  > {
    const batches: Array<
      Array<{
        grammarSource: string;
        config: Partial<SelfTranspileConfig>;
        id?: string;
      }>
    > = [];

    // Group similar iterations together for better cache efficiency
    const groupedIterations = this.groupSimilarIterations(iterations);

    let currentBatch: Array<{
      grammarSource: string;
      config: Partial<SelfTranspileConfig>;
      id?: string;
    }> = [];

    for (const group of groupedIterations) {
      for (const iteration of group) {
        currentBatch.push(iteration);

        if (currentBatch.length >= this.getCurrentBatchSize()) {
          batches.push([...currentBatch]);
          currentBatch = [];
        }
      }
    }

    // Add remaining iterations
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  /**
   * Group similar iterations for cache efficiency
   */
  private groupSimilarIterations(
    iterations: Array<{
      grammarSource: string;
      config: Partial<SelfTranspileConfig>;
      id?: string;
    }>,
  ): Array<
    Array<{
      grammarSource: string;
      config: Partial<SelfTranspileConfig>;
      id?: string;
    }>
  > {
    const _groups: Array<
      Array<{
        grammarSource: string;
        config: Partial<SelfTranspileConfig>;
        id?: string;
      }>
    > = [];

    // Simple grouping by source length and config similarity
    const groupMap = new Map<
      string,
      Array<{
        grammarSource: string;
        config: Partial<SelfTranspileConfig>;
        id?: string;
      }>
    >();

    for (const iteration of iterations) {
      const key = `${iteration.grammarSource.length}_${JSON.stringify(iteration.config)}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }

      groupMap.get(key)?.push(iteration);
    }

    return Array.from(groupMap.values());
  }

  /**
   * Process a batch of iterations
   */
  private async processBatch(
    batch: Array<{
      grammarSource: string;
      config: Partial<SelfTranspileConfig>;
      id?: string;
    }>,
    batchId: number,
  ): Promise<BatchResult> {
    const startTime = performance.now();
    const startMemory = process.memoryUsage().heapUsed;

    const results: SelfTranspileResult[] = [];
    const errors: string[] = [];

    if (this.config.enableWorkerThreads && batch.length > 2) {
      // Process with worker threads (if enabled)
      const batchResult = await this.processBatchWithWorkers(batch);
      results.push(...batchResult.results);
      errors.push(...batchResult.errors);
    } else {
      // Process sequentially within batch
      for (let i = 0; i < batch.length; i++) {
        const iteration = batch[i];

        try {
          const result = await this.transpiler.transpile(
            iteration.grammarSource,
            iteration.config,
          );
          results.push(result);

          if (!result.success) {
            errors.push(`Iteration ${i}: ${result.warnings.join(", ")}`);
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          errors.push(`Iteration ${i}: ${errorMessage}`);

          // Add placeholder result for failed iteration
          results.push({
            code: "",
            types: "",
            performance: {
              generationTime: 0,
              memoryUsage: 0,
              complexity: "low",
            },
            warnings: [errorMessage],
            success: false,
          });
        }
      }
    }

    const endTime = performance.now();
    const endMemory = process.memoryUsage().heapUsed;

    const processingTime = endTime - startTime;
    const memoryUsage = endMemory - startMemory;
    const successRate =
      results.filter((r) => r.success).length / results.length;

    return {
      batchId,
      results,
      processingTime,
      memoryUsage,
      successRate,
      errors,
    };
  }

  /**
   * Process batch with worker threads (simplified implementation)
   */
  private async processBatchWithWorkers(
    batch: Array<{
      grammarSource: string;
      config: Partial<SelfTranspileConfig>;
      id?: string;
    }>,
  ): Promise<{ results: SelfTranspileResult[]; errors: string[] }> {
    // This is a simplified implementation
    // In a real implementation, you would create worker threads
    // and distribute the work among them

    const results: SelfTranspileResult[] = [];
    const errors: string[] = [];

    const chunkSize = Math.ceil(
      batch.length / this.config.maxConcurrentWorkers,
    );
    const chunks = [];

    for (let i = 0; i < batch.length; i += chunkSize) {
      chunks.push(batch.slice(i, i + chunkSize));
    }

    // Process chunks in parallel
    const chunkPromises = chunks.map(async (chunk) => {
      const chunkResults: SelfTranspileResult[] = [];
      const chunkErrors: string[] = [];

      for (const iteration of chunk) {
        try {
          const result = await this.transpiler.transpile(
            iteration.grammarSource,
            iteration.config,
          );
          chunkResults.push(result);

          if (!result.success) {
            chunkErrors.push(`Chunk error: ${result.warnings.join(", ")}`);
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          chunkErrors.push(`Chunk error: ${errorMessage}`);

          chunkResults.push({
            code: "",
            types: "",
            performance: {
              generationTime: 0,
              memoryUsage: 0,
              complexity: "low",
            },
            warnings: [errorMessage],
            success: false,
          });
        }
      }

      return { chunkResults, chunkErrors };
    });

    const chunkResults = await Promise.all(chunkPromises);

    for (const { chunkResults: cr, chunkErrors: ce } of chunkResults) {
      results.push(...cr);
      errors.push(...ce);
    }

    return { results, errors };
  }

  /**
   * Preload common patterns for predictive optimization
   */
  private async preloadCommonPatterns(
    iterations: Array<{
      grammarSource: string;
      config: Partial<SelfTranspileConfig>;
      id?: string;
    }>,
  ): Promise<void> {
    console.log("🔮 Preloading common patterns...");

    const patternMap = new Map<string, number>();

    // Identify common patterns
    for (const iteration of iterations) {
      const pattern = this.extractPattern(iteration.grammarSource);
      patternMap.set(pattern, (patternMap.get(pattern) || 0) + 1);
    }

    // Preload top patterns
    const topPatterns = Array.from(patternMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [pattern, count] of topPatterns) {
      if (count > 1) {
        const sampleIteration = iterations.find(
          (i) => this.extractPattern(i.grammarSource) === pattern,
        );
        if (sampleIteration) {
          const preloadPromise = this.transpiler.transpile(
            sampleIteration.grammarSource,
            sampleIteration.config,
          );
          this.preloadedCache.set(pattern, preloadPromise);
        }
      }
    }

    console.log(`🎯 Preloaded ${topPatterns.length} common patterns`);
  }

  /**
   * Extract pattern from grammar source for similarity detection
   */
  private extractPattern(grammarSource: string): string {
    // Simple pattern extraction based on grammar structure
    const lines = grammarSource.split("\n");
    const ruleCount = lines.filter((line) => line.includes("=")).length;
    const complexity =
      grammarSource.length > 1000
        ? "high"
        : grammarSource.length > 500
          ? "medium"
          : "low";

    return `${ruleCount}_${complexity}`;
  }

  /**
   * Get current batch size (adaptive)
   */
  private getCurrentBatchSize(): number {
    if (!this.config.adaptiveBatchSizing) {
      return this.config.batchSize;
    }

    // Calculate optimal batch size based on performance history
    if (this.performanceHistory.length < 3) {
      return this.config.batchSize;
    }

    const recentPerformance = this.performanceHistory.slice(-3);
    const avgPerformance =
      recentPerformance.reduce((sum, p) => sum + p, 0) /
      recentPerformance.length;

    // Adjust batch size based on performance
    if (avgPerformance > 100) {
      // If processing is slow
      return Math.max(1, Math.floor(this.config.batchSize * 0.8));
    }
    if (avgPerformance < 20) {
      // If processing is fast
      return Math.min(20, Math.ceil(this.config.batchSize * 1.2));
    }

    return this.config.batchSize;
  }

  /**
   * Adjust batch size based on performance
   */
  private adjustBatchSize(batchResult: BatchResult): void {
    const avgTimePerIteration =
      batchResult.processingTime / batchResult.results.length;
    this.performanceHistory.push(avgTimePerIteration);

    // Keep only recent history
    if (this.performanceHistory.length > 10) {
      this.performanceHistory.shift();
    }

    this.batchSizeHistory.push(batchResult.results.length);
  }

  /**
   * Perform memory cleanup
   */
  private async performMemoryCleanup(): Promise<void> {
    // Clear caches
    this.preloadedCache.clear();
    this.transpiler.clearCache();

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    // Wait a bit for cleanup to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /**
   * Get memory usage in MB
   */
  private getMemoryUsageMB(): number {
    return process.memoryUsage().heapUsed / 1024 / 1024;
  }

  /**
   * Calculate memory efficiency
   */
  private calculateMemoryEfficiency(
    startMemory: number,
    endMemory: number,
    results: SelfTranspileResult[],
  ): number {
    const memoryUsed = endMemory - startMemory;
    const totalCodeGenerated = results.reduce(
      (sum, r) => sum + r.code.length,
      0,
    );

    return memoryUsed > 0 ? (totalCodeGenerated / memoryUsed) * 100 : 0;
  }

  /**
   * Calculate cache hit rate
   */
  private calculateCacheHitRate(): number {
    const transpilerStats = this.transpiler.getStats();
    const totalRequests =
      transpilerStats.cacheHits + transpilerStats.cacheMisses;

    return totalRequests > 0
      ? (transpilerStats.cacheHits / totalRequests) * 100
      : 0;
  }

  /**
   * Get optimization statistics
   */
  getStats(): IterationStats {
    return { ...this.stats };
  }

  /**
   * Reset optimizer state
   */
  reset(): void {
    this.stats = {
      totalIterations: 0,
      completedIterations: 0,
      avgIterationTime: 0,
      totalTime: 0,
      memoryEfficiency: 0,
      cacheHitRate: 0,
      throughput: 0,
    };

    this.batchSizeHistory = [];
    this.performanceHistory = [];
    this.preloadedCache.clear();
    this.transpiler.clearCache();
  }
}

/**
 * Create an iteration optimizer
 */
export function createIterationOptimizer(
  config?: Partial<IterationOptimizationConfig>,
): IterationOptimizer {
  return new IterationOptimizer(config);
}

/**
 * Process iterations with optimization
 */
export async function processIterationsOptimized(
  iterations: Array<{
    grammarSource: string;
    config: Partial<SelfTranspileConfig>;
    id?: string;
  }>,
  config?: Partial<IterationOptimizationConfig>,
): Promise<{
  results: SelfTranspileResult[];
  stats: IterationStats;
  batchResults: any[];
}> {
  const optimizer = createIterationOptimizer(config);
  return optimizer.processIterations(iterations);
}
