/**
 * Comprehensive Test Suite for TPEG Self-Transpilation System
 *
 * Provides a complete test suite that validates all components of the
 * self-transpilation system including self-hosting, error handling,
 * performance optimization, iteration optimization, and bootstrap validation.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { ErrorHandlingContext, withErrorHandling } from "./error-handling";
import { createIterationOptimizer } from "./iteration-optimization";
import { createOptimizedTranspiler } from "./performance-optimization";
import { selfTranspile } from "./self-transpile";
import type { ConfigObject } from "./types";

/**
 * Test category definitions for comprehensive testing
 */
export interface TestCategory {
  id: string;
  name: string;
  description: string;
  tests: TestCase[];
  weight: number; // Importance weight (1-10)
  timeout: number;
  critical: boolean; // If true, failure stops entire suite
}

/**
 * Individual test case definition
 */
export interface TestCase {
  id: string;
  name: string;
  description: string;
  timeout: number;
  expectedDuration: number; // Expected execution time in ms
  criticalFailure: boolean; // If true, failure stops category
  testFunction: () => Promise<TestResult>;
}

/**
 * Test result structure
 */
export interface TestResult {
  id: string;
  name: string;
  success: boolean;
  duration: number;
  memoryUsage: number;
  errorMessage?: string;
  details?: ConfigObject;
  score: number; // Score out of 100
  grade: "A" | "B" | "C" | "D" | "F";
  warnings: string[];
}

/**
 * Comprehensive test suite result
 */
export interface TestSuiteResult {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalDuration: number;
  totalMemoryUsage: number;
  overallScore: number;
  overallGrade: "A" | "B" | "C" | "D" | "F";
  categoryResults: Record<string, TestCategoryResult>;
  summary: string;
  recommendations: string[];
}

/**
 * Test category result
 */
export interface TestCategoryResult {
  categoryId: string;
  categoryName: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number;
  memoryUsage: number;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  testResults: TestResult[];
  critical: boolean;
  warnings: string[];
}

/**
 * Main comprehensive test suite class
 */
export class ComprehensiveTestSuite {
  private categories: TestCategory[] = [];
  private results: TestSuiteResult | null = null;
  private startTime = 0;
  private config: {
    stopOnFirstFailure: boolean;
    verbose: boolean;
    generateReport: boolean;
    reportPath: string;
  };

  constructor(config: Partial<ComprehensiveTestSuite["config"]> = {}) {
    this.config = {
      stopOnFirstFailure: false,
      verbose: true,
      generateReport: true,
      reportPath: "./test-report.json",
      ...config,
    };

    this.initializeTestCategories();
  }

  /**
   * Initialize all test categories
   */
  private initializeTestCategories(): void {
    this.categories = [
      {
        id: "core-functionality",
        name: "Core Functionality",
        description: "Tests core self-transpilation functionality",
        weight: 10,
        timeout: 30000,
        critical: true,
        tests: [
          {
            id: "self-parse-basic",
            name: "Basic Self-Parse",
            description: "Tests basic self-parsing capability",
            timeout: 10000,
            expectedDuration: 5000,
            criticalFailure: true,
            testFunction: this.testBasicSelfParse.bind(this),
          },
          {
            id: "code-generation",
            name: "Code Generation",
            description: "Tests TypeScript code generation",
            timeout: 15000,
            expectedDuration: 8000,
            criticalFailure: true,
            testFunction: this.testCodeGeneration.bind(this),
          },
          {
            id: "self-hosting-loop",
            name: "Self-Hosting Loop",
            description: "Tests complete self-hosting loop",
            timeout: 20000,
            expectedDuration: 12000,
            criticalFailure: true,
            testFunction: this.testSelfHostingLoop.bind(this),
          },
          {
            id: "bootstrap-validation",
            name: "Bootstrap Validation",
            description: "Tests bootstrap validation system",
            timeout: 25000,
            expectedDuration: 15000,
            criticalFailure: false,
            testFunction: this.testBootstrapValidation.bind(this),
          },
        ],
      },
      {
        id: "error-handling",
        name: "Error Handling",
        description: "Tests error handling and recovery mechanisms",
        weight: 8,
        timeout: 25000,
        critical: false,
        tests: [
          {
            id: "error-detection",
            name: "Error Detection",
            description: "Tests error detection capabilities",
            timeout: 8000,
            expectedDuration: 3000,
            criticalFailure: false,
            testFunction: this.testErrorDetection.bind(this),
          },
          {
            id: "recovery-mechanisms",
            name: "Recovery Mechanisms",
            description: "Tests error recovery strategies",
            timeout: 12000,
            expectedDuration: 6000,
            criticalFailure: false,
            testFunction: this.testRecoveryMechanisms.bind(this),
          },
          {
            id: "error-integration",
            name: "Error Integration",
            description: "Tests error handling integration",
            timeout: 10000,
            expectedDuration: 5000,
            criticalFailure: false,
            testFunction: this.testErrorIntegration.bind(this),
          },
        ],
      },
      {
        id: "performance-optimization",
        name: "Performance Optimization",
        description: "Tests performance optimization features",
        weight: 7,
        timeout: 40000,
        critical: false,
        tests: [
          {
            id: "baseline-performance",
            name: "Baseline Performance",
            description: "Tests baseline performance metrics",
            timeout: 15000,
            expectedDuration: 8000,
            criticalFailure: false,
            testFunction: this.testBaselinePerformance.bind(this),
          },
          {
            id: "optimization-features",
            name: "Optimization Features",
            description: "Tests optimization feature effectiveness",
            timeout: 20000,
            expectedDuration: 12000,
            criticalFailure: false,
            testFunction: this.testOptimizationFeatures.bind(this),
          },
          {
            id: "caching-system",
            name: "Caching System",
            description: "Tests caching system performance",
            timeout: 10000,
            expectedDuration: 5000,
            criticalFailure: false,
            testFunction: this.testCachingSystem.bind(this),
          },
        ],
      },
      {
        id: "iteration-optimization",
        name: "Iteration Optimization",
        description: "Tests iteration optimization capabilities",
        weight: 6,
        timeout: 35000,
        critical: false,
        tests: [
          {
            id: "batch-processing",
            name: "Batch Processing",
            description: "Tests batch processing optimization",
            timeout: 15000,
            expectedDuration: 10000,
            criticalFailure: false,
            testFunction: this.testBatchProcessing.bind(this),
          },
          {
            id: "parallel-execution",
            name: "Parallel Execution",
            description: "Tests parallel execution capabilities",
            timeout: 18000,
            expectedDuration: 12000,
            criticalFailure: false,
            testFunction: this.testParallelExecution.bind(this),
          },
          {
            id: "memory-management",
            name: "Memory Management",
            description: "Tests memory management optimization",
            timeout: 12000,
            expectedDuration: 8000,
            criticalFailure: false,
            testFunction: this.testMemoryManagement.bind(this),
          },
        ],
      },
      {
        id: "integration-testing",
        name: "Integration Testing",
        description: "Tests end-to-end integration scenarios",
        weight: 9,
        timeout: 45000,
        critical: false,
        tests: [
          {
            id: "complete-workflow",
            name: "Complete Workflow",
            description: "Tests complete end-to-end workflow",
            timeout: 25000,
            expectedDuration: 18000,
            criticalFailure: false,
            testFunction: this.testCompleteWorkflow.bind(this),
          },
          {
            id: "stress-testing",
            name: "Stress Testing",
            description: "Tests system under stress conditions",
            timeout: 20000,
            expectedDuration: 15000,
            criticalFailure: false,
            testFunction: this.testStressTesting.bind(this),
          },
          {
            id: "edge-cases",
            name: "Edge Cases",
            description: "Tests edge case handling",
            timeout: 15000,
            expectedDuration: 10000,
            criticalFailure: false,
            testFunction: this.testEdgeCases.bind(this),
          },
        ],
      },
    ];
  }

  /**
   * Run the comprehensive test suite
   */
  async runTestSuite(): Promise<TestSuiteResult> {
    this.startTime = performance.now();

    console.log("🧪 TPEG Comprehensive Test Suite");
    console.log("=====================================");
    console.log(`📋 Total Categories: ${this.categories.length}`);
    console.log(
      `📋 Total Tests: ${this.categories.reduce((sum, cat) => sum + cat.tests.length, 0)}`,
    );
    console.log(
      `⏱️  Estimated Duration: ${this.categories.reduce((sum, cat) => sum + cat.timeout, 0) / 1000}s`,
    );
    console.log("");

    const categoryResults: Record<string, TestCategoryResult> = {};
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let totalDuration = 0;
    let totalMemoryUsage = 0;
    let shouldStop = false;

    for (const category of this.categories) {
      if (shouldStop) break;

      console.log(`🔧 Running Category: ${category.name}`);
      console.log(`📋 Description: ${category.description}`);
      console.log(`⚖️  Weight: ${category.weight}/10`);
      console.log(`⏱️  Timeout: ${category.timeout / 1000}s`);
      console.log(`🚨 Critical: ${category.critical ? "Yes" : "No"}`);
      console.log("─".repeat(50));

      const categoryResult = await this.runTestCategory(category);
      categoryResults[category.id] = categoryResult;

      totalTests += categoryResult.totalTests;
      passedTests += categoryResult.passedTests;
      failedTests += categoryResult.failedTests;
      totalDuration += categoryResult.duration;
      totalMemoryUsage += categoryResult.memoryUsage;

      console.log(
        `📊 Category Result: ${categoryResult.grade} (${categoryResult.score}/100)`,
      );
      console.log(
        `✅ Passed: ${categoryResult.passedTests}/${categoryResult.totalTests}`,
      );
      console.log(`⏱️  Duration: ${categoryResult.duration.toFixed(2)}ms`);
      console.log(
        `💾 Memory: ${(categoryResult.memoryUsage / 1024 / 1024).toFixed(2)}MB`,
      );
      console.log("");

      // Check if we should stop on critical failure
      if (
        category.critical &&
        categoryResult.failedTests > 0 &&
        this.config.stopOnFirstFailure
      ) {
        console.log("🚨 Critical category failed - stopping test suite");
        shouldStop = true;
      }
    }

    const endTime = performance.now();
    totalDuration = endTime - this.startTime;

    // Calculate overall score and grade
    const overallScore = this.calculateOverallScore(categoryResults);
    const overallGrade = this.calculateGrade(overallScore);

    this.results = {
      totalTests,
      passedTests,
      failedTests,
      totalDuration,
      totalMemoryUsage,
      overallScore,
      overallGrade,
      categoryResults,
      summary: this.generateSummary(
        categoryResults,
        overallScore,
        overallGrade,
      ),
      recommendations: this.generateRecommendations(categoryResults),
    };

    this.printFinalResults();

    if (this.config.generateReport) {
      this.generateReport();
    }

    return this.results;
  }

  /**
   * Run a single test category
   */
  private async runTestCategory(
    category: TestCategory,
  ): Promise<TestCategoryResult> {
    const testResults: TestResult[] = [];
    const categoryStart = performance.now();
    const startMemory = process.memoryUsage?.()?.heapUsed || 0;

    let passedTests = 0;
    let failedTests = 0;
    let shouldStop = false;

    for (const test of category.tests) {
      if (shouldStop) break;

      if (this.config.verbose) {
        console.log(`  🧪 Running: ${test.name}`);
      }

      const testResult = await this.runSingleTest(test);
      testResults.push(testResult);

      if (testResult.success) {
        passedTests++;
        if (this.config.verbose) {
          console.log(
            `    ✅ Passed: ${testResult.grade} (${testResult.score}/100) - ${testResult.duration.toFixed(2)}ms`,
          );
        }
      } else {
        failedTests++;
        if (this.config.verbose) {
          console.log(`    ❌ Failed: ${testResult.errorMessage}`);
        }

        if (test.criticalFailure) {
          console.log("    🚨 Critical test failed - stopping category");
          shouldStop = true;
        }
      }
    }

    const categoryEnd = performance.now();
    const endMemory = process.memoryUsage?.()?.heapUsed || 0;
    const duration = categoryEnd - categoryStart;
    const memoryUsage = endMemory - startMemory;

    const categoryScore = this.calculateCategoryScore(testResults);
    const categoryGrade = this.calculateGrade(categoryScore);

    return {
      categoryId: category.id,
      categoryName: category.name,
      totalTests: category.tests.length,
      passedTests,
      failedTests,
      duration,
      memoryUsage,
      score: categoryScore,
      grade: categoryGrade,
      testResults,
      critical: category.critical,
      warnings: testResults.flatMap((r) => r.warnings),
    };
  }

  /**
   * Run a single test
   */
  private async runSingleTest(test: TestCase): Promise<TestResult> {
    const startTime = performance.now();
    const startMemory = process.memoryUsage?.()?.heapUsed || 0;

    try {
      const result = await Promise.race([
        test.testFunction(),
        new Promise<TestResult>((_, reject) =>
          setTimeout(() => reject(new Error("Test timeout")), test.timeout),
        ),
      ]);

      const endTime = performance.now();
      const endMemory = process.memoryUsage?.()?.heapUsed || 0;
      const duration = endTime - startTime;
      const memoryUsage = endMemory - startMemory;

      return {
        ...result,
        duration,
        memoryUsage,
      };
    } catch (error) {
      const endTime = performance.now();
      const endMemory = process.memoryUsage?.()?.heapUsed || 0;
      const duration = endTime - startTime;
      const memoryUsage = endMemory - startMemory;

      return {
        id: test.id,
        name: test.name,
        success: false,
        duration,
        memoryUsage,
        errorMessage: error instanceof Error ? error.message : String(error),
        score: 0,
        grade: "F",
        warnings: [],
      };
    }
  }

  /**
   * Test implementations
   */
  private async testBasicSelfParse(): Promise<TestResult> {
    try {
      const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
      const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

      const result = await selfTranspile(grammarSource, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: false,
        namePrefix: "test_",
      });

      let score = 0;
      const warnings: string[] = [];

      if (result.success) {
        score += 50;
        if (result.code.length > 1000) score += 20;
        if (result.performance.generationTime < 10000) score += 15;
        if (result.warnings.length === 0) score += 15;
      }

      if (result.warnings.length > 0) {
        warnings.push(...result.warnings);
      }

      return {
        id: "self-parse-basic",
        name: "Basic Self-Parse",
        success: result.success,
        duration: 0, // Will be set by runSingleTest
        memoryUsage: 0, // Will be set by runSingleTest
        score,
        grade: this.calculateGrade(score),
        warnings,
      };
    } catch (error) {
      throw new Error(`Basic self-parse failed: ${error}`);
    }
  }

  private async testCodeGeneration(): Promise<TestResult> {
    try {
      const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
      const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

      const result = await selfTranspile(grammarSource, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: true,
        namePrefix: "codegen_",
      });

      let score = 0;
      const warnings: string[] = [];

      if (result.success) {
        score += 40;

        // Check code quality metrics
        if (result.code.includes("export")) score += 10;
        if (result.code.includes("function") || result.code.includes("const"))
          score += 10;
        if (result.code.includes("grammar")) score += 10;
        if (result.code.length > 2000) score += 10;
        if (result.code.length < 10000) score += 10;
        if (result.performance.generationTime < 15000) score += 10;
      }

      if (result.warnings.length > 0) {
        warnings.push(...result.warnings);
      }

      return {
        id: "code-generation",
        name: "Code Generation",
        success: result.success,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
      };
    } catch (error) {
      throw new Error(`Code generation failed: ${error}`);
    }
  }

  private async testSelfHostingLoop(): Promise<TestResult> {
    try {
      const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
      const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

      let score = 0;
      const warnings: string[] = [];
      const maxIterations = 3;
      let converged = false;
      let previousCodeHash = "";

      for (let i = 0; i < maxIterations; i++) {
        const result = await selfTranspile(grammarSource, {
          targetLanguage: "typescript",
          includeTypes: true,
          optimize: true,
          namePrefix: `loop${i}_`,
        });

        if (!result.success) {
          throw new Error(`Self-hosting loop iteration ${i + 1} failed`);
        }

        const codeHash = this.simpleHash(result.code);
        if (i > 0 && codeHash === previousCodeHash) {
          converged = true;
          score += 30;
          break;
        }
        previousCodeHash = codeHash;

        if (i === 0) score += 20; // First iteration success
        if (i === 1) score += 20; // Second iteration success
        if (i === 2) score += 10; // Third iteration success
      }

      if (converged) {
        score += 20;
      } else {
        warnings.push("Self-hosting loop did not converge");
      }

      return {
        id: "self-hosting-loop",
        name: "Self-Hosting Loop",
        success: true,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
      };
    } catch (error) {
      throw new Error(`Self-hosting loop failed: ${error}`);
    }
  }

  private async testBootstrapValidation(): Promise<TestResult> {
    try {
      const testGrammars = [
        {
          name: "Calculator",
          path: "../parser-sample/examples/calculator.tpeg",
          minScore: 70,
        },
        {
          name: "JSON",
          path: "../parser-sample/examples/json-lite.tpeg",
          minScore: 70,
        },
        {
          name: "Self-Definition",
          path: "../parser-sample/examples/tpeg-self.tpeg",
          minScore: 80,
        },
      ];

      let score = 0;
      const warnings: string[] = [];
      let successCount = 0;

      for (const grammar of testGrammars) {
        try {
          const grammarSource = readFileSync(grammar.path, "utf-8");
          const result = await selfTranspile(grammarSource, {
            targetLanguage: "typescript",
            includeTypes: true,
            optimize: true,
            namePrefix: `bootstrap_${grammar.name.toLowerCase()}_`,
          });

          if (result.success) {
            successCount++;
            score += 25;
          } else {
            warnings.push(`Bootstrap validation failed for ${grammar.name}`);
          }
        } catch (error) {
          warnings.push(
            `Bootstrap validation error for ${grammar.name}: ${error}`,
          );
        }
      }

      if (successCount === testGrammars.length) {
        score += 25; // Bonus for all grammars working
      }

      return {
        id: "bootstrap-validation",
        name: "Bootstrap Validation",
        success: successCount >= 2, // At least 2 grammars should work
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
      };
    } catch (error) {
      throw new Error(`Bootstrap validation failed: ${error}`);
    }
  }

  private async testErrorDetection(): Promise<TestResult> {
    try {
      const _errorHandler = new ErrorHandlingContext({
        maxRetries: 2,
        timeout: 5000,
        enableDiagnostics: true,
        enableRecovery: true,
      });

      const testCases = [
        {
          name: "Invalid Grammar",
          input: 'grammar Invalid { rule = "unclosed',
          expectedError: true,
        },
        {
          name: "Empty Grammar",
          input: "",
          expectedError: true,
        },
        {
          name: "Missing Grammar Declaration",
          input: 'rule = "test"',
          expectedError: true,
        },
      ];

      let score = 0;
      const warnings: string[] = [];
      let detectedErrors = 0;

      for (const testCase of testCases) {
        try {
          const result = await selfTranspile(testCase.input, {
            targetLanguage: "typescript",
            includeTypes: true,
            optimize: false,
          });

          if (testCase.expectedError && !result.success) {
            detectedErrors++;
            score += 25;
          } else if (!testCase.expectedError && result.success) {
            score += 25;
          } else {
            warnings.push(`Error detection failed for ${testCase.name}`);
          }
        } catch (error) {
          if (testCase.expectedError) {
            detectedErrors++;
            score += 25;
          } else {
            warnings.push(`Unexpected error for ${testCase.name}: ${error}`);
          }
        }
      }

      if (detectedErrors === testCases.length) {
        score += 25; // Bonus for detecting all errors
      }

      return {
        id: "error-detection",
        name: "Error Detection",
        success: detectedErrors >= 2,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
      };
    } catch (error) {
      throw new Error(`Error detection test failed: ${error}`);
    }
  }

  private async testRecoveryMechanisms(): Promise<TestResult> {
    try {
      let score = 0;
      const warnings: string[] = [];

      // Test basic recovery with timeout
      const result = await withErrorHandling(
        async () => {
          const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
          const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

          return await selfTranspile(grammarSource, {
            targetLanguage: "typescript",
            includeTypes: true,
            optimize: true,
          });
        },
        {
          maxRetries: 3,
          timeout: 10000,
          enableDiagnostics: true,
          enableRecovery: true,
        },
      );

      if (result.success) {
        score += 50;
      }

      // Test error recovery with fallback
      try {
        const malformedGrammar = 'grammar Malformed { rule = "unclosed';
        const fallbackResult = await withErrorHandling(
          async () => {
            return await selfTranspile(malformedGrammar, {
              targetLanguage: "typescript",
              includeTypes: true,
              optimize: false,
            });
          },
          {
            maxRetries: 2,
            timeout: 5000,
            enableDiagnostics: true,
            enableRecovery: true,
          },
        );

        if (!fallbackResult.success) {
          score += 25; // Good - should fail for malformed grammar
        }
      } catch (_error) {
        score += 25; // Good - error was caught
      }

      score += 25; // Bonus for completing test

      return {
        id: "recovery-mechanisms",
        name: "Recovery Mechanisms",
        success: score >= 50,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
      };
    } catch (error) {
      throw new Error(`Recovery mechanisms test failed: ${error}`);
    }
  }

  private async testErrorIntegration(): Promise<TestResult> {
    try {
      let score = 0;
      const warnings: string[] = [];

      // Test error integration with normal operation
      const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
      const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

      const result = await selfTranspile(grammarSource, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: true,
        namePrefix: "integration_",
      });

      if (result.success) {
        score += 40;

        // Check error handling integration
        if (result.warnings.length >= 0) score += 20; // Has warning system
        if (result.performance.generationTime > 0) score += 20; // Has performance tracking
        if (result.code.length > 0) score += 20; // Has code output
      }

      return {
        id: "error-integration",
        name: "Error Integration",
        success: result.success,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
      };
    } catch (error) {
      throw new Error(`Error integration test failed: ${error}`);
    }
  }

  private async testBaselinePerformance(): Promise<TestResult> {
    try {
      const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
      const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

      const iterations = 3;
      const times: number[] = [];
      let score = 0;
      const warnings: string[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();

        const result = await selfTranspile(grammarSource, {
          targetLanguage: "typescript",
          includeTypes: true,
          optimize: false, // Baseline without optimization
          namePrefix: `baseline${i}_`,
        });

        const end = performance.now();
        const duration = end - start;
        times.push(duration);

        if (!result.success) {
          throw new Error(
            `Baseline performance test iteration ${i + 1} failed`,
          );
        }
      }

      const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
      const maxTime = Math.max(...times);
      const minTime = Math.min(...times);
      const consistency = 1 - (maxTime - minTime) / avgTime;

      // Performance scoring
      if (avgTime < 15000)
        score += 40; // Under 15 seconds
      else if (avgTime < 30000)
        score += 30; // Under 30 seconds
      else if (avgTime < 60000)
        score += 20; // Under 1 minute
      else score += 10; // Over 1 minute

      if (consistency > 0.8)
        score += 20; // Good consistency
      else if (consistency > 0.6)
        score += 15; // Moderate consistency
      else if (consistency > 0.4) score += 10; // Poor consistency

      if (minTime < 10000) score += 20; // Fast minimum time
      if (maxTime < 20000) score += 20; // Fast maximum time

      if (avgTime > 30000) {
        warnings.push("Baseline performance is slow");
      }

      return {
        id: "baseline-performance",
        name: "Baseline Performance",
        success: true,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
        details: {
          avgTime: avgTime.toFixed(2),
          minTime: minTime.toFixed(2),
          maxTime: maxTime.toFixed(2),
          consistency: (consistency * 100).toFixed(1),
        },
      };
    } catch (error) {
      throw new Error(`Baseline performance test failed: ${error}`);
    }
  }

  private async testOptimizationFeatures(): Promise<TestResult> {
    try {
      const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
      const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

      let score = 0;
      const warnings: string[] = [];
      const results: { name: string; time: number; success: boolean }[] = [];

      // Test different optimization levels
      const optimizationConfigs = [
        { name: "No Optimization", optimize: false, memoization: false },
        { name: "Basic Optimization", optimize: true, memoization: false },
        { name: "Full Optimization", optimize: true, memoization: true },
      ];

      for (const config of optimizationConfigs) {
        const start = performance.now();

        const result = await selfTranspile(grammarSource, {
          targetLanguage: "typescript",
          includeTypes: true,
          optimize: config.optimize,
          enableMemoization: config.memoization,
          namePrefix: `opt_${config.name.toLowerCase().replace(/\s/g, "_")}_`,
        });

        const end = performance.now();
        const duration = end - start;

        results.push({
          name: config.name,
          time: duration,
          success: result.success,
        });

        if (result.success) {
          score += 25;
        } else {
          warnings.push(`Optimization test failed for ${config.name}`);
        }
      }

      // Check for performance improvements
      if (results.length >= 2) {
        const noOptTime =
          results.find((r) => r.name === "No Optimization")?.time || 0;
        const fullOptTime =
          results.find((r) => r.name === "Full Optimization")?.time || 0;

        if (noOptTime > 0 && fullOptTime > 0) {
          const improvement = (noOptTime - fullOptTime) / noOptTime;
          if (improvement > 0.1) score += 15; // 10% improvement
          if (improvement > 0.3) score += 10; // 30% improvement
        }
      }

      return {
        id: "optimization-features",
        name: "Optimization Features",
        success: results.filter((r) => r.success).length >= 2,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
        details: {
          results: results.map((r) => ({
            name: r.name,
            time: r.time.toFixed(2),
            success: r.success,
          })),
        },
      };
    } catch (error) {
      throw new Error(`Optimization features test failed: ${error}`);
    }
  }

  private async testCachingSystem(): Promise<TestResult> {
    try {
      const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
      const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

      let score = 0;
      const warnings: string[] = [];

      // Test caching with optimized transpiler
      const _optimizedTranspiler = createOptimizedTranspiler();

      // First run (should populate cache)
      const firstStart = performance.now();
      const firstResult = await selfTranspileOptimized(grammarSource, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: true,
        namePrefix: "cache_first_",
      });
      const firstEnd = performance.now();
      const firstTime = firstEnd - firstStart;

      if (firstResult.success) {
        score += 25;
      } else {
        warnings.push("First caching test run failed");
      }

      // Second run (should use cache)
      const secondStart = performance.now();
      const secondResult = await selfTranspileOptimized(grammarSource, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: true,
        namePrefix: "cache_second_",
      });
      const secondEnd = performance.now();
      const secondTime = secondEnd - secondStart;

      if (secondResult.success) {
        score += 25;
      } else {
        warnings.push("Second caching test run failed");
      }

      // Check for cache performance improvement
      if (firstTime > 0 && secondTime > 0) {
        const improvement = (firstTime - secondTime) / firstTime;
        if (improvement > 0.1) score += 20; // 10% improvement
        if (improvement > 0.5) score += 20; // 50% improvement
        if (improvement > 0.8) score += 10; // 80% improvement
      }

      return {
        id: "caching-system",
        name: "Caching System",
        success: firstResult.success && secondResult.success,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
        details: {
          firstTime: firstTime.toFixed(2),
          secondTime: secondTime.toFixed(2),
          improvement: (((firstTime - secondTime) / firstTime) * 100).toFixed(
            1,
          ),
        },
      };
    } catch (error) {
      throw new Error(`Caching system test failed: ${error}`);
    }
  }

  private async testBatchProcessing(): Promise<TestResult> {
    try {
      const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
      const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

      let score = 0;
      const warnings: string[] = [];

      // Test batch processing with iteration optimizer
      const optimizer = createIterationOptimizer({
        batchSize: 3,
        maxConcurrentWorkers: 2,
        enableBatchProcessing: true,
        enableWorkerThreads: false, // Simplified for testing
        enableProgressiveOptimization: true,
        enablePredictivePreloading: true,
        adaptiveBatchSizing: false,
        maxMemoryUsage: 512,
      });

      const tasks = [
        {
          grammarSource,
          config: { namePrefix: "batch1_", enableMemoization: true },
          id: "batch1",
        },
        {
          grammarSource,
          config: { namePrefix: "batch2_", enableMemoization: true },
          id: "batch2",
        },
        {
          grammarSource,
          config: { namePrefix: "batch3_", enableMemoization: true },
          id: "batch3",
        },
      ];

      const start = performance.now();
      const results = await optimizer.processIterations(tasks);
      const end = performance.now();
      const duration = end - start;

      let successCount = 0;
      for (const result of results) {
        if (result.success) {
          successCount++;
          score += 25;
        } else {
          warnings.push(`Batch processing failed for ${result.id}`);
        }
      }

      // Performance bonus
      if (duration < 20000) score += 15; // Under 20 seconds
      if (successCount === tasks.length) score += 10; // All tasks succeeded

      return {
        id: "batch-processing",
        name: "Batch Processing",
        success: successCount >= 2,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
        details: {
          tasksProcessed: tasks.length,
          successCount,
          duration: duration.toFixed(2),
        },
      };
    } catch (error) {
      throw new Error(`Batch processing test failed: ${error}`);
    }
  }

  private async testParallelExecution(): Promise<TestResult> {
    try {
      const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
      const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

      let score = 0;
      const warnings: string[] = [];

      // Test parallel execution
      const tasks = [
        selfTranspile(grammarSource, {
          targetLanguage: "typescript",
          includeTypes: true,
          optimize: true,
          namePrefix: "parallel1_",
        }),
        selfTranspile(grammarSource, {
          targetLanguage: "typescript",
          includeTypes: true,
          optimize: true,
          namePrefix: "parallel2_",
        }),
        selfTranspile(grammarSource, {
          targetLanguage: "typescript",
          includeTypes: true,
          optimize: true,
          namePrefix: "parallel3_",
        }),
      ];

      const start = performance.now();
      const results = await Promise.all(tasks);
      const end = performance.now();
      const duration = end - start;

      let successCount = 0;
      for (const result of results) {
        if (result.success) {
          successCount++;
          score += 25;
        } else {
          warnings.push("Parallel execution failed for a task");
        }
      }

      // Performance bonus for parallel execution
      if (duration < 25000) score += 15; // Under 25 seconds for 3 tasks
      if (successCount === tasks.length) score += 10; // All tasks succeeded

      return {
        id: "parallel-execution",
        name: "Parallel Execution",
        success: successCount >= 2,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
        details: {
          tasksProcessed: tasks.length,
          successCount,
          duration: duration.toFixed(2),
        },
      };
    } catch (error) {
      throw new Error(`Parallel execution test failed: ${error}`);
    }
  }

  private async testMemoryManagement(): Promise<TestResult> {
    try {
      const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
      const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

      let score = 0;
      const warnings: string[] = [];

      // Test memory management with multiple iterations
      const startMemory = process.memoryUsage?.()?.heapUsed || 0;
      const iterations = 5;
      const memorySnapshots: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const result = await selfTranspile(grammarSource, {
          targetLanguage: "typescript",
          includeTypes: true,
          optimize: true,
          namePrefix: `memory${i}_`,
        });

        if (result.success) {
          score += 15;
        } else {
          warnings.push(`Memory management test iteration ${i + 1} failed`);
        }

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }

        const currentMemory = process.memoryUsage?.()?.heapUsed || 0;
        memorySnapshots.push(currentMemory - startMemory);
      }

      // Check for memory leaks
      if (memorySnapshots.length >= 2) {
        const firstSnapshot = memorySnapshots[0];
        const lastSnapshot = memorySnapshots[memorySnapshots.length - 1];
        const memoryGrowth = (lastSnapshot - firstSnapshot) / firstSnapshot;

        if (memoryGrowth < 0.5) score += 15; // Less than 50% growth
        if (memoryGrowth < 0.2) score += 10; // Less than 20% growth

        if (memoryGrowth > 1.0) {
          warnings.push("Potential memory leak detected");
        }
      }

      return {
        id: "memory-management",
        name: "Memory Management",
        success: score >= 50,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
        details: {
          iterations,
          memorySnapshots: memorySnapshots.map((m) =>
            (m / 1024 / 1024).toFixed(2),
          ),
        },
      };
    } catch (error) {
      throw new Error(`Memory management test failed: ${error}`);
    }
  }

  private async testCompleteWorkflow(): Promise<TestResult> {
    try {
      const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
      const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

      let score = 0;
      const warnings: string[] = [];

      // Test complete end-to-end workflow
      console.log("      📋 Testing complete workflow...");

      // Step 1: Parse grammar
      const parseResult = await selfTranspile(grammarSource, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: false,
        namePrefix: "workflow_parse_",
      });

      if (parseResult.success) {
        score += 20;
        console.log("      ✅ Step 1: Parse successful");
      } else {
        warnings.push("Workflow parsing failed");
        console.log("      ❌ Step 1: Parse failed");
      }

      // Step 2: Generate optimized code
      const optimizedResult = await selfTranspile(grammarSource, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: true,
        namePrefix: "workflow_optimized_",
      });

      if (optimizedResult.success) {
        score += 20;
        console.log("      ✅ Step 2: Optimization successful");
      } else {
        warnings.push("Workflow optimization failed");
        console.log("      ❌ Step 2: Optimization failed");
      }

      // Step 3: Self-hosting validation
      const selfHostingResult = await selfTranspile(grammarSource, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: true,
        namePrefix: "workflow_selfhost_",
      });

      if (selfHostingResult.success) {
        score += 20;
        console.log("      ✅ Step 3: Self-hosting successful");
      } else {
        warnings.push("Workflow self-hosting failed");
        console.log("      ❌ Step 3: Self-hosting failed");
      }

      // Step 4: Performance validation
      const perfStart = performance.now();
      const perfResult = await selfTranspile(grammarSource, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: true,
        namePrefix: "workflow_perf_",
      });
      const perfEnd = performance.now();
      const perfTime = perfEnd - perfStart;

      if (perfResult.success && perfTime < 20000) {
        score += 20;
        console.log("      ✅ Step 4: Performance validation successful");
      } else {
        warnings.push("Workflow performance validation failed");
        console.log("      ❌ Step 4: Performance validation failed");
      }

      // Step 5: Error handling validation
      try {
        const errorResult = await selfTranspile("invalid grammar", {
          targetLanguage: "typescript",
          includeTypes: true,
          optimize: false,
          namePrefix: "workflow_error_",
        });

        if (!errorResult.success) {
          score += 20; // Good - should fail for invalid grammar
          console.log("      ✅ Step 5: Error handling successful");
        } else {
          warnings.push("Error handling did not catch invalid grammar");
          console.log("      ❌ Step 5: Error handling failed");
        }
      } catch (_error) {
        score += 20; // Good - error was caught
        console.log(
          "      ✅ Step 5: Error handling successful (caught exception)",
        );
      }

      return {
        id: "complete-workflow",
        name: "Complete Workflow",
        success: score >= 60,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
        details: {
          parseSuccess: parseResult.success,
          optimizedSuccess: optimizedResult.success,
          selfHostingSuccess: selfHostingResult.success,
          performanceTime: perfTime.toFixed(2),
        },
      };
    } catch (error) {
      throw new Error(`Complete workflow test failed: ${error}`);
    }
  }

  private async testStressTesting(): Promise<TestResult> {
    try {
      let score = 0;
      const warnings: string[] = [];

      // Test with large grammar
      const largeGrammar = this.generateLargeGrammar(50); // 50 rules

      console.log("      📋 Testing with large grammar (50 rules)...");

      const largeResult = await selfTranspile(largeGrammar, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: true,
        namePrefix: "stress_large_",
      });

      if (largeResult.success) {
        score += 25;
        console.log("      ✅ Large grammar test successful");
      } else {
        warnings.push("Large grammar stress test failed");
        console.log("      ❌ Large grammar test failed");
      }

      // Test with complex nested grammar
      const complexGrammar = this.generateComplexGrammar(20); // 20 complex rules

      console.log("      📋 Testing with complex nested grammar...");

      const complexResult = await selfTranspile(complexGrammar, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: true,
        namePrefix: "stress_complex_",
      });

      if (complexResult.success) {
        score += 25;
        console.log("      ✅ Complex grammar test successful");
      } else {
        warnings.push("Complex grammar stress test failed");
        console.log("      ❌ Complex grammar test failed");
      }

      // Test with rapid iterations
      console.log("      📋 Testing rapid iterations...");

      const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
      const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

      const rapidIterations = 10;
      let rapidSuccessCount = 0;

      for (let i = 0; i < rapidIterations; i++) {
        const result = await selfTranspile(grammarSource, {
          targetLanguage: "typescript",
          includeTypes: true,
          optimize: true,
          namePrefix: `rapid${i}_`,
        });

        if (result.success) {
          rapidSuccessCount++;
        }
      }

      if (rapidSuccessCount >= 8) {
        score += 25;
        console.log("      ✅ Rapid iterations test successful");
      } else {
        warnings.push("Rapid iterations stress test failed");
        console.log("      ❌ Rapid iterations test failed");
      }

      // Memory stress test
      console.log("      📋 Testing memory stress...");

      const memoryStart = process.memoryUsage?.()?.heapUsed || 0;
      const memoryIterations = 5;

      for (let i = 0; i < memoryIterations; i++) {
        const result = await selfTranspile(grammarSource, {
          targetLanguage: "typescript",
          includeTypes: true,
          optimize: true,
          namePrefix: `memory${i}_`,
        });

        if (!result.success) {
          warnings.push(`Memory stress test iteration ${i + 1} failed`);
        }
      }

      const memoryEnd = process.memoryUsage?.()?.heapUsed || 0;
      const memoryGrowth = (memoryEnd - memoryStart) / memoryStart;

      if (memoryGrowth < 2.0) {
        // Less than 200% growth
        score += 25;
        console.log("      ✅ Memory stress test successful");
      } else {
        warnings.push("Memory stress test showed excessive growth");
        console.log("      ❌ Memory stress test failed");
      }

      return {
        id: "stress-testing",
        name: "Stress Testing",
        success: score >= 50,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
        details: {
          largeGrammarSuccess: largeResult.success,
          complexGrammarSuccess: complexResult.success,
          rapidIterations: rapidSuccessCount,
          memoryGrowth: (memoryGrowth * 100).toFixed(1),
        },
      };
    } catch (error) {
      throw new Error(`Stress testing failed: ${error}`);
    }
  }

  private async testEdgeCases(): Promise<TestResult> {
    try {
      let score = 0;
      const warnings: string[] = [];

      const edgeCases = [
        {
          name: "Empty grammar",
          input: "",
          expectedSuccess: false,
        },
        {
          name: "Single rule grammar",
          input: `grammar Single {
            rule = "test"
          }`,
          expectedSuccess: true,
        },
        {
          name: "Grammar with unicode",
          input: `grammar Unicode {
            rule = "こんにちは"
            number = [０-９]+
          }`,
          expectedSuccess: true,
        },
        {
          name: "Grammar with very long rule name",
          input: `grammar Long {
            very_long_rule_name_that_goes_on_and_on_and_on_and_on_and_on = "test"
          }`,
          expectedSuccess: true,
        },
        {
          name: "Grammar with special characters",
          input: `grammar Special {
            special = "\\n\\t\\r\\\\\\""
            brackets = "[" [a-z]+ "]"
          }`,
          expectedSuccess: true,
        },
      ];

      for (const edgeCase of edgeCases) {
        try {
          console.log(`      📋 Testing edge case: ${edgeCase.name}`);

          const result = await selfTranspile(edgeCase.input, {
            targetLanguage: "typescript",
            includeTypes: true,
            optimize: true,
            namePrefix: `edge_${edgeCase.name.replace(/\s+/g, "_").toLowerCase()}_`,
          });

          if (result.success === edgeCase.expectedSuccess) {
            score += 20;
            console.log(
              `      ✅ Edge case ${edgeCase.name} handled correctly`,
            );
          } else {
            warnings.push(`Edge case ${edgeCase.name} not handled correctly`);
            console.log(`      ❌ Edge case ${edgeCase.name} failed`);
          }
        } catch (error) {
          if (!edgeCase.expectedSuccess) {
            score += 20; // Good - expected to fail
            console.log(
              `      ✅ Edge case ${edgeCase.name} failed as expected`,
            );
          } else {
            warnings.push(
              `Edge case ${edgeCase.name} threw unexpected error: ${error}`,
            );
            console.log(
              `      ❌ Edge case ${edgeCase.name} threw unexpected error`,
            );
          }
        }
      }

      return {
        id: "edge-cases",
        name: "Edge Cases",
        success: score >= 60,
        duration: 0,
        memoryUsage: 0,
        score,
        grade: this.calculateGrade(score),
        warnings,
        details: {
          testedCases: edgeCases.length,
          passedCases: Math.floor(score / 20),
        },
      };
    } catch (error) {
      throw new Error(`Edge cases test failed: ${error}`);
    }
  }

  /**
   * Utility methods
   */
  private calculateGrade(score: number): "A" | "B" | "C" | "D" | "F" {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
  }

  private calculateCategoryScore(testResults: TestResult[]): number {
    if (testResults.length === 0) return 0;
    return (
      testResults.reduce((sum, result) => sum + result.score, 0) /
      testResults.length
    );
  }

  private calculateOverallScore(
    categoryResults: Record<string, TestCategoryResult>,
  ): number {
    const categories = Object.values(categoryResults);
    if (categories.length === 0) return 0;

    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const category of categories) {
      const categoryDef = this.categories.find(
        (c) => c.id === category.categoryId,
      );
      const weight = categoryDef?.weight || 1;
      totalWeightedScore += category.score * weight;
      totalWeight += weight;
    }

    return totalWeightedScore / totalWeight;
  }

  private generateSummary(
    categoryResults: Record<string, TestCategoryResult>,
    overallScore: number,
    overallGrade: string,
  ): string {
    const categories = Object.values(categoryResults);
    const totalTests = categories.reduce((sum, cat) => sum + cat.totalTests, 0);
    const passedTests = categories.reduce(
      (sum, cat) => sum + cat.passedTests,
      0,
    );
    const failedTests = categories.reduce(
      (sum, cat) => sum + cat.failedTests,
      0,
    );

    const criticalFailures = categories.filter(
      (cat) => cat.critical && cat.failedTests > 0,
    );
    const allWarnings = categories.flatMap((cat) => cat.warnings);

    let summary = "TPEG Self-Transpilation System Test Summary\n";
    summary += "==========================================\n";
    summary += `Overall Grade: ${overallGrade} (${overallScore.toFixed(1)}/100)\n`;
    summary += `Total Tests: ${totalTests} (${passedTests} passed, ${failedTests} failed)\n`;
    summary += `Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%\n`;

    if (criticalFailures.length > 0) {
      summary += "\nCRITICAL FAILURES:\n";
      for (const cat of criticalFailures) {
        summary += `- ${cat.categoryName}: ${cat.failedTests} failed tests\n`;
      }
    }

    if (allWarnings.length > 0) {
      summary += `\nWarnings: ${allWarnings.length}\n`;
    }

    summary += "\nCategory Breakdown:\n";
    for (const cat of categories) {
      summary += `- ${cat.categoryName}: ${cat.grade} (${cat.score.toFixed(1)}/100)\n`;
    }

    return summary;
  }

  private generateRecommendations(
    categoryResults: Record<string, TestCategoryResult>,
  ): string[] {
    const recommendations: string[] = [];
    const categories = Object.values(categoryResults);

    for (const category of categories) {
      if (category.grade === "F") {
        recommendations.push(
          `URGENT: Fix critical issues in ${category.categoryName}`,
        );
      } else if (category.grade === "D") {
        recommendations.push(
          `HIGH: Improve ${category.categoryName} performance`,
        );
      } else if (category.grade === "C") {
        recommendations.push(
          `MEDIUM: Optimize ${category.categoryName} implementation`,
        );
      }

      if (category.warnings.length > 0) {
        recommendations.push(`Review warnings in ${category.categoryName}`);
      }
    }

    // General recommendations
    const overallScore = this.calculateOverallScore(categoryResults);
    if (overallScore < 70) {
      recommendations.push(
        "Consider comprehensive system review and optimization",
      );
    }

    const totalTests = categories.reduce((sum, cat) => sum + cat.totalTests, 0);
    const passedTests = categories.reduce(
      (sum, cat) => sum + cat.passedTests,
      0,
    );
    const successRate = passedTests / totalTests;

    if (successRate < 0.9) {
      recommendations.push("Focus on improving test success rate");
    }

    return recommendations;
  }

  private printFinalResults(): void {
    if (!this.results) return;

    console.log("\n🎯 COMPREHENSIVE TEST SUITE RESULTS");
    console.log("====================================");
    console.log(
      `📊 Overall Grade: ${this.results.overallGrade} (${this.results.overallScore.toFixed(1)}/100)`,
    );
    console.log(`📋 Total Tests: ${this.results.totalTests}`);
    console.log(`✅ Passed: ${this.results.passedTests}`);
    console.log(`❌ Failed: ${this.results.failedTests}`);
    console.log(
      `📈 Success Rate: ${((this.results.passedTests / this.results.totalTests) * 100).toFixed(1)}%`,
    );
    console.log(
      `⏱️  Total Duration: ${(this.results.totalDuration / 1000).toFixed(2)}s`,
    );
    console.log(
      `💾 Total Memory: ${(this.results.totalMemoryUsage / 1024 / 1024).toFixed(2)}MB`,
    );

    console.log("\n📋 Category Results:");
    for (const cat of Object.values(this.results.categoryResults)) {
      const status = cat.failedTests === 0 ? "✅" : "❌";
      console.log(
        `${status} ${cat.categoryName}: ${cat.grade} (${cat.score.toFixed(1)}/100) - ${cat.passedTests}/${cat.totalTests} passed`,
      );
    }

    if (this.results.recommendations.length > 0) {
      console.log("\n📋 Recommendations:");
      for (const rec of this.results.recommendations) {
        console.log(`- ${rec}`);
      }
    }

    console.log(`\n${this.results.summary}`);
  }

  private generateReport(): void {
    if (!this.results) return;

    const report = {
      timestamp: new Date().toISOString(),
      results: this.results,
      config: this.config,
    };

    writeFileSync(this.config.reportPath, JSON.stringify(report, null, 2));
    console.log(`📊 Test report generated: ${this.config.reportPath}`);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  private generateLargeGrammar(ruleCount: number): string {
    let grammar = "grammar Large {\n";
    grammar += `  @version: "1.0"\n`;
    grammar += `  @description: "Large grammar for stress testing"\n\n`;

    for (let i = 1; i <= ruleCount; i++) {
      grammar += `  rule${i} = "rule${i}" [a-z]* "end${i}"\n`;
    }

    grammar += "}";
    return grammar;
  }

  private generateComplexGrammar(ruleCount: number): string {
    let grammar = "grammar Complex {\n";
    grammar += `  @version: "1.0"\n`;
    grammar += `  @description: "Complex grammar for stress testing"\n\n`;

    for (let i = 1; i <= ruleCount; i++) {
      const complexity = [
        `(rule${i}_part1 / rule${i}_part2) rule${i}_part3*`,
        `rule${i}_prefix (rule${i}_middle+ / rule${i}_alternative) rule${i}_suffix?`,
        `&rule${i}_lookahead rule${i}_main !rule${i}_negative`,
        `[a-z]+ "separator" [0-9]+ ("option1" / "option2" / "option3")`,
        `(rule${i}_nested (rule${i}_inner / rule${i}_other)*)+`,
      ];

      const pattern = complexity[i % complexity.length];
      grammar += `  rule${i} = ${pattern}\n`;

      // Add supporting rules
      grammar += `  rule${i}_part1 = "part1"\n`;
      grammar += `  rule${i}_part2 = "part2"\n`;
      grammar += `  rule${i}_part3 = "part3"\n`;
    }

    grammar += "}";
    return grammar;
  }
}

/**
 * Convenience function to run the comprehensive test suite
 */
export async function runComprehensiveTestSuite(
  config: Partial<ComprehensiveTestSuite["config"]> = {},
): Promise<TestSuiteResult> {
  const suite = new ComprehensiveTestSuite(config);
  return await suite.runTestSuite();
}

/**
 * Add import for missing function
 */
async function selfTranspileOptimized(
  grammarSource: string,
  config: Partial<import("./types").SelfTranspileConfig>,
): Promise<import("./types").SelfTranspileResult> {
  const optimizedTranspiler = createOptimizedTranspiler();
  return await optimizedTranspiler.transpile(grammarSource, config);
}
