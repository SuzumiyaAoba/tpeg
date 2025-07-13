/**
 * TPEG Self-Transpilation System - Unified API
 *
 * This module provides a unified, high-level API for the complete
 * TPEG self-transpilation system including parsing, code generation,
 * testing, performance optimization, and coverage analysis.
 *
 * @version 1.0.0
 * @author SuzumiyaAoba
 * @license MIT
 */

// Re-export all core functionality
export * from "./self-transpile";
export * from "./types";
export * from "./comprehensive-test-suite";
export * from "./test-runner";
export * from "./test-coverage";
export * from "./performance-optimization";
export * from "./iteration-optimization";
export * from "./error-handling";
export * from "./bootstrap-validation";

// Import necessary types and functions for convenience API
import { readFileSync } from "node:fs";
import type { TestSuiteResult } from "./comprehensive-test-suite";
import { runComprehensiveTestSuite } from "./comprehensive-test-suite";
import { createOptimizedTranspiler } from "./performance-optimization";
import { selfTranspile } from "./self-transpile";
import type { CoverageAnalysis } from "./test-coverage";
import { analyzeCoverage } from "./test-coverage";
import type { SelfTranspileConfig, SelfTranspileResult } from "./types";

/**
 * TPEG Self-Transpilation System - Main API Class
 *
 * This class provides a high-level, object-oriented interface to the
 * entire TPEG self-transpilation system. It integrates all components
 * and provides convenient methods for common operations.
 */
export class TPEGSelfTranspilationSystem {
  private config: TPEGSystemConfig;

  constructor(config: Partial<TPEGSystemConfig> = {}) {
    this.config = {
      // Default configuration
      enableOptimization: true,
      enableTesting: true,
      enableCoverage: true,
      enablePerformanceMonitoring: true,
      enableErrorHandling: true,
      outputDirectory: "./output",
      cacheDirectory: "./cache",
      reportDirectory: "./reports",
      verbose: false,
      ...config,
    };
  }

  /**
   * Parse and transpile a TPEG grammar definition
   *
   * @param grammarSource - The TPEG grammar definition as string
   * @param config - Optional transpilation configuration
   * @returns Promise resolving to transpilation result
   */
  async transpile(
    grammarSource: string,
    config?: Partial<SelfTranspileConfig>,
  ): Promise<SelfTranspileResult> {
    const finalConfig = {
      targetLanguage: "typescript" as const,
      includeTypes: true,
      optimize: this.config.enableOptimization,
      enableMemoization: true,
      includeMonitoring: this.config.enablePerformanceMonitoring,
      ...config,
    };

    return await selfTranspile(grammarSource, finalConfig);
  }

  /**
   * Run comprehensive test suite
   *
   * @param config - Optional test configuration
   * @returns Promise resolving to test results
   */
  async runTests(config?: any): Promise<TestSuiteResult> {
    if (!this.config.enableTesting) {
      throw new Error("Testing is disabled in system configuration");
    }

    const testConfig = {
      stopOnFirstFailure: false,
      verbose: this.config.verbose,
      generateReport: true,
      reportPath: `${this.config.reportDirectory}/test-results.json`,
      ...config,
    };

    return await runComprehensiveTestSuite(testConfig);
  }

  /**
   * Analyze test coverage
   *
   * @param testResults - Test results to analyze coverage for
   * @param config - Optional coverage configuration
   * @returns Promise resolving to coverage analysis
   */
  async analyzeCoverage(
    testResults: TestSuiteResult,
    config?: any,
  ): Promise<CoverageAnalysis> {
    if (!this.config.enableCoverage) {
      throw new Error("Coverage analysis is disabled in system configuration");
    }

    const coverageConfig = {
      sourceDirectory: "./src",
      testDirectory: "./src",
      outputPath: `${this.config.reportDirectory}/coverage-results.json`,
      enableFunctionalCoverage: true,
      enableQualityAnalysis: true,
      ...config,
    };

    return await analyzeCoverage(testResults, coverageConfig);
  }

  /**
   * Run complete end-to-end workflow
   *
   * This method executes the complete workflow including:
   * 1. Grammar transpilation
   * 2. Testing
   * 3. Coverage analysis
   *
   * @param grammarSource - The TPEG grammar definition
   * @param config - Optional workflow configuration
   * @returns Promise resolving to complete workflow results
   */
  async runCompleteWorkflow(
    grammarSource: string,
    config?: Partial<WorkflowConfig>,
  ): Promise<WorkflowResult> {
    const workflowConfig = {
      enableTranspilation: true,
      enableTesting: this.config.enableTesting,
      enableCoverage: this.config.enableCoverage,
      stopOnError: false,
      generateReports: true,
      ...config,
    };

    const result: WorkflowResult = {
      success: true,
      steps: [],
      transpilation: null,
      testing: null,
      coverage: null,
      summary: "",
      recommendations: [],
    };

    try {
      // Step 1: Transpilation
      if (workflowConfig.enableTranspilation) {
        console.log("📋 Step 1: Running transpilation...");
        result.transpilation = await this.transpile(grammarSource);
        result.steps.push({
          name: "Transpilation",
          success: result.transpilation.success,
          duration: result.transpilation.performance.generationTime,
          message: result.transpilation.success
            ? "Transpilation completed successfully"
            : "Transpilation failed",
        });

        if (!result.transpilation.success && workflowConfig.stopOnError) {
          result.success = false;
          return result;
        }
      }

      // Step 2: Testing
      if (workflowConfig.enableTesting) {
        console.log("📋 Step 2: Running comprehensive tests...");
        result.testing = await this.runTests();
        result.steps.push({
          name: "Testing",
          success: result.testing.passedTests === result.testing.totalTests,
          duration: result.testing.totalDuration,
          message: `${result.testing.passedTests}/${result.testing.totalTests} tests passed`,
        });

        if (result.testing.failedTests > 0 && workflowConfig.stopOnError) {
          result.success = false;
          return result;
        }
      }

      // Step 3: Coverage Analysis
      if (workflowConfig.enableCoverage && result.testing) {
        console.log("📋 Step 3: Analyzing coverage...");
        result.coverage = await this.analyzeCoverage(result.testing);
        result.steps.push({
          name: "Coverage Analysis",
          success: result.coverage.summary.grade !== "F",
          duration: 0, // Coverage analysis doesn't track duration separately
          message: `Coverage grade: ${result.coverage.summary.grade} (${result.coverage.summary.score}/100)`,
        });
      }

      // Generate summary and recommendations
      result.summary = this.generateWorkflowSummary(result);
      result.recommendations = this.generateWorkflowRecommendations(result);

      console.log("✅ Complete workflow finished successfully!");
      return result;
    } catch (error) {
      result.success = false;
      result.steps.push({
        name: "Error",
        success: false,
        duration: 0,
        message: error instanceof Error ? error.message : String(error),
      });
      return result;
    }
  }

  /**
   * Generate workflow summary
   */
  private generateWorkflowSummary(result: WorkflowResult): string {
    const successfulSteps = result.steps.filter((step) => step.success).length;
    const totalSteps = result.steps.length;
    const successRate =
      totalSteps > 0 ? (successfulSteps / totalSteps) * 100 : 0;

    let summary = "TPEG Self-Transpilation Workflow Summary\n";
    summary += "========================================\n";
    summary += `Overall Success: ${result.success ? "YES" : "NO"}\n`;
    summary += `Steps Completed: ${successfulSteps}/${totalSteps} (${successRate.toFixed(1)}%)\n\n`;

    for (const step of result.steps) {
      const status = step.success ? "✅" : "❌";
      summary += `${status} ${step.name}: ${step.message}\n`;
    }

    return summary;
  }

  /**
   * Generate workflow recommendations
   */
  private generateWorkflowRecommendations(result: WorkflowResult): string[] {
    const recommendations: string[] = [];

    if (result.transpilation && !result.transpilation.success) {
      recommendations.push("Fix transpilation issues before proceeding");
    }

    if (result.testing && result.testing.failedTests > 0) {
      recommendations.push(
        "Address failing tests to improve system reliability",
      );
    }

    if (result.coverage && result.coverage.summary.grade === "F") {
      recommendations.push("Improve test coverage to meet quality standards");
    }

    if (recommendations.length === 0) {
      recommendations.push(
        "System is operating optimally - consider performance optimizations",
      );
    }

    return recommendations;
  }

  /**
   * Get system configuration
   */
  getConfig(): TPEGSystemConfig {
    return { ...this.config };
  }

  /**
   * Update system configuration
   */
  updateConfig(config: Partial<TPEGSystemConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * System configuration interface
 */
export interface TPEGSystemConfig {
  enableOptimization: boolean;
  enableTesting: boolean;
  enableCoverage: boolean;
  enablePerformanceMonitoring: boolean;
  enableErrorHandling: boolean;
  outputDirectory: string;
  cacheDirectory: string;
  reportDirectory: string;
  verbose: boolean;
}

/**
 * Workflow configuration interface
 */
export interface WorkflowConfig {
  enableTranspilation: boolean;
  enableTesting: boolean;
  enableCoverage: boolean;
  stopOnError: boolean;
  generateReports: boolean;
}

/**
 * Workflow step result
 */
export interface WorkflowStep {
  name: string;
  success: boolean;
  duration: number;
  message: string;
}

/**
 * Complete workflow result
 */
export interface WorkflowResult {
  success: boolean;
  steps: WorkflowStep[];
  transpilation: SelfTranspileResult | null;
  testing: TestSuiteResult | null;
  coverage: CoverageAnalysis | null;
  summary: string;
  recommendations: string[];
}

/**
 * Convenience function to create a new TPEG system instance
 */
export function createTPEGSystem(
  config?: Partial<TPEGSystemConfig>,
): TPEGSelfTranspilationSystem {
  return new TPEGSelfTranspilationSystem(config);
}

/**
 * Quick start function for basic transpilation
 */
export async function quickTranspile(
  grammarSource: string,
  options?: {
    optimize?: boolean;
    includeTypes?: boolean;
    outputPath?: string;
  },
): Promise<SelfTranspileResult> {
  const system = createTPEGSystem({
    enableOptimization: options?.optimize ?? true,
    enableTesting: false,
    enableCoverage: false,
    enablePerformanceMonitoring: false,
  });

  return await system.transpile(grammarSource, {
    includeTypes: options?.includeTypes ?? true,
  });
}

/**
 * Quick start function for running tests
 */
export async function quickTest(options?: {
  verbose?: boolean;
  stopOnFailure?: boolean;
  reportPath?: string;
}): Promise<TestSuiteResult> {
  const system = createTPEGSystem({
    enableTesting: true,
    verbose: options?.verbose ?? false,
  });

  return await system.runTests({
    stopOnFirstFailure: options?.stopOnFailure ?? false,
    reportPath: options?.reportPath,
  });
}

/**
 * Quick start function for complete workflow
 */
export async function quickWorkflow(
  grammarSource: string,
  options?: {
    enableAll?: boolean;
    stopOnError?: boolean;
    outputDirectory?: string;
  },
): Promise<WorkflowResult> {
  const system = createTPEGSystem({
    enableOptimization: true,
    enableTesting: options?.enableAll ?? true,
    enableCoverage: options?.enableAll ?? true,
    enablePerformanceMonitoring: options?.enableAll ?? true,
    outputDirectory: options?.outputDirectory ?? "./output",
  });

  return await system.runCompleteWorkflow(grammarSource, {
    stopOnError: options?.stopOnError ?? false,
  });
}

// Default export for easy importing
export default TPEGSelfTranspilationSystem;
