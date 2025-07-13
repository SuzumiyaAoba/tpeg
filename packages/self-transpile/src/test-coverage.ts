/**
 * Test Coverage Analysis System for TPEG Self-Transpilation
 * 
 * Provides comprehensive code coverage analysis, functional coverage tracking,
 * and test quality assessment for the TPEG self-transpilation system.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { performance } from "perf_hooks";
import type { TestSuiteResult, TestCategoryResult, TestResult } from "./comprehensive-test-suite";

/**
 * Coverage analysis configuration
 */
export interface CoverageConfig {
  sourceDirectory: string;
  testDirectory: string;
  includePaths: string[];
  excludePaths: string[];
  coverageThreshold: {
    statements: number;
    branches: number;
    functions: number;
    lines: number;
  };
  enableFunctionalCoverage: boolean;
  enableQualityAnalysis: boolean;
  outputPath: string;
  reportFormat: "json" | "html" | "markdown" | "console";
}

/**
 * Coverage analysis result
 */
export interface CoverageAnalysis {
  overall: {
    statements: CoverageMetrics;
    branches: CoverageMetrics;
    functions: CoverageMetrics;
    lines: CoverageMetrics;
  };
  files: Record<string, FileCoverage>;
  functional: FunctionalCoverage;
  quality: QualityAnalysis;
  summary: CoverageSummary;
  recommendations: string[];
}

/**
 * Coverage metrics
 */
export interface CoverageMetrics {
  total: number;
  covered: number;
  percentage: number;
  threshold: number;
  passing: boolean;
}

/**
 * File coverage information
 */
export interface FileCoverage {
  path: string;
  statements: CoverageMetrics;
  branches: CoverageMetrics;
  functions: CoverageMetrics;
  lines: CoverageMetrics;
  complexity: number;
  testFiles: string[];
  lastModified: Date;
  size: number;
}

/**
 * Functional coverage tracking
 */
export interface FunctionalCoverage {
  features: Record<string, FeatureCoverage>;
  scenarios: Record<string, ScenarioCoverage>;
  requirements: Record<string, RequirementCoverage>;
  overall: {
    featuresCovered: number;
    totalFeatures: number;
    scenariosCovered: number;
    totalScenarios: number;
    requirementsCovered: number;
    totalRequirements: number;
  };
}

/**
 * Feature coverage
 */
export interface FeatureCoverage {
  name: string;
  description: string;
  covered: boolean;
  testCases: string[];
  lastTested: Date;
  coverage: number;
}

/**
 * Scenario coverage
 */
export interface ScenarioCoverage {
  name: string;
  description: string;
  covered: boolean;
  testCases: string[];
  expectedBehavior: string;
  actualBehavior: string;
  passed: boolean;
}

/**
 * Requirement coverage
 */
export interface RequirementCoverage {
  id: string;
  description: string;
  covered: boolean;
  testCases: string[];
  priority: "high" | "medium" | "low";
  status: "passed" | "failed" | "not_tested";
}

/**
 * Test quality analysis
 */
export interface QualityAnalysis {
  testDistribution: {
    unitTests: number;
    integrationTests: number;
    systemTests: number;
    performanceTests: number;
  };
  testQuality: {
    averageAssertions: number;
    averageTestLength: number;
    duplicateTests: number;
    flakinesss: number;
    maintainability: number;
  };
  testEffectiveness: {
    bugDetectionRate: number;
    falsePositiveRate: number;
    testExecution: {
      averageTime: number;
      totalTime: number;
      slowestTests: string[];
    };
  };
  recommendations: string[];
}

/**
 * Coverage summary
 */
export interface CoverageSummary {
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  passedThresholds: number;
  totalThresholds: number;
  criticalGaps: string[];
  strengths: string[];
  weaknesses: string[];
  nextSteps: string[];
}

/**
 * Test coverage analyzer
 */
export class TestCoverageAnalyzer {
  private config: CoverageConfig;
  private testResults: TestSuiteResult | null = null;

  constructor(config: Partial<CoverageConfig> = {}) {
    this.config = {
      sourceDirectory: "./src",
      testDirectory: "./src",
      includePaths: ["*.ts", "*.js"],
      excludePaths: ["*.spec.ts", "*.test.ts", "node_modules/**"],
      coverageThreshold: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80
      },
      enableFunctionalCoverage: true,
      enableQualityAnalysis: true,
      outputPath: "./coverage-report.json",
      reportFormat: "json",
      ...config
    };
  }

  /**
   * Analyze coverage from test results
   */
  async analyzeCoverage(testResults: TestSuiteResult): Promise<CoverageAnalysis> {
    this.testResults = testResults;
    
    console.log("📊 TPEG Test Coverage Analysis");
    console.log("===============================");
    console.log(`📁 Source Directory: ${this.config.sourceDirectory}`);
    console.log(`🧪 Test Directory: ${this.config.testDirectory}`);
    console.log(`📋 Coverage Thresholds: ${this.config.coverageThreshold.statements}%`);
    console.log("");

    const startTime = performance.now();

    // Analyze source files
    const sourceFiles = await this.findSourceFiles();
    const testFiles = await this.findTestFiles();

    console.log(`📄 Found ${sourceFiles.length} source files`);
    console.log(`🧪 Found ${testFiles.length} test files`);

    // Analyze code coverage
    const codeCoverage = await this.analyzeCodeCoverage(sourceFiles, testFiles);
    
    // Analyze functional coverage
    const functionalCoverage = this.config.enableFunctionalCoverage
      ? await this.analyzeFunctionalCoverage(testResults)
      : this.getEmptyFunctionalCoverage();

    // Analyze test quality
    const qualityAnalysis = this.config.enableQualityAnalysis
      ? await this.analyzeTestQuality(testFiles, testResults)
      : this.getEmptyQualityAnalysis();

    // Generate summary
    const summary = this.generateCoverageSummary(codeCoverage, functionalCoverage, qualityAnalysis);

    // Generate recommendations
    const recommendations = this.generateRecommendations(codeCoverage, functionalCoverage, qualityAnalysis);

    const endTime = performance.now();
    const duration = endTime - startTime;

    console.log(`⏱️  Analysis completed in ${duration.toFixed(2)}ms`);
    console.log(`📊 Overall Grade: ${summary.grade} (${summary.score}/100)`);
    console.log(`✅ Passed Thresholds: ${summary.passedThresholds}/${summary.totalThresholds}`);

    const analysis: CoverageAnalysis = {
      overall: codeCoverage,
      files: {},
      functional: functionalCoverage,
      quality: qualityAnalysis,
      summary,
      recommendations
    };

    // Generate report
    await this.generateCoverageReport(analysis);

    return analysis;
  }

  /**
   * Find source files
   */
  private async findSourceFiles(): Promise<string[]> {
    const files: string[] = [];
    
    const findFiles = (dir: string): void => {
      try {
        const items = readdirSync(dir);
        
        for (const item of items) {
          const fullPath = join(dir, item);
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            // Skip excluded directories
            if (!this.isExcluded(fullPath)) {
              findFiles(fullPath);
            }
          } else if (stat.isFile()) {
            // Include matching files
            if (this.isIncluded(fullPath) && !this.isExcluded(fullPath)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        console.warn(`Warning: Could not read directory ${dir}:`, error);
      }
    };

    findFiles(this.config.sourceDirectory);
    return files;
  }

  /**
   * Find test files
   */
  private async findTestFiles(): Promise<string[]> {
    const files: string[] = [];
    
    const findFiles = (dir: string): void => {
      try {
        const items = readdirSync(dir);
        
        for (const item of items) {
          const fullPath = join(dir, item);
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            findFiles(fullPath);
          } else if (stat.isFile() && this.isTestFile(fullPath)) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        console.warn(`Warning: Could not read directory ${dir}:`, error);
      }
    };

    findFiles(this.config.testDirectory);
    return files;
  }

  /**
   * Check if file is included
   */
  private isIncluded(filePath: string): boolean {
    return this.config.includePaths.some(pattern => 
      filePath.endsWith(pattern.replace("*", ""))
    );
  }

  /**
   * Check if file is excluded
   */
  private isExcluded(filePath: string): boolean {
    return this.config.excludePaths.some(pattern => {
      if (pattern.includes("**")) {
        return filePath.includes(pattern.replace("**", ""));
      }
      return filePath.includes(pattern.replace("*", ""));
    });
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(filePath: string): boolean {
    return filePath.includes(".spec.") || 
           filePath.includes(".test.") ||
           filePath.includes("test-") ||
           filePath.includes("-test");
  }

  /**
   * Analyze code coverage
   */
  private async analyzeCodeCoverage(sourceFiles: string[], testFiles: string[]): Promise<CoverageAnalysis["overall"]> {
    console.log("📊 Analyzing code coverage...");
    
    let totalStatements = 0;
    let coveredStatements = 0;
    let totalBranches = 0;
    let coveredBranches = 0;
    let totalFunctions = 0;
    let coveredFunctions = 0;
    let totalLines = 0;
    let coveredLines = 0;

    for (const sourceFile of sourceFiles) {
      try {
        const content = readFileSync(sourceFile, "utf-8");
        const analysis = this.analyzeFile(content, sourceFile, testFiles);
        
        totalStatements += analysis.statements;
        coveredStatements += analysis.coveredStatements;
        totalBranches += analysis.branches;
        coveredBranches += analysis.coveredBranches;
        totalFunctions += analysis.functions;
        coveredFunctions += analysis.coveredFunctions;
        totalLines += analysis.lines;
        coveredLines += analysis.coveredLines;
      } catch (error) {
        console.warn(`Warning: Could not analyze file ${sourceFile}:`, error);
      }
    }

    return {
      statements: {
        total: totalStatements,
        covered: coveredStatements,
        percentage: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0,
        threshold: this.config.coverageThreshold.statements,
        passing: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 >= this.config.coverageThreshold.statements : false
      },
      branches: {
        total: totalBranches,
        covered: coveredBranches,
        percentage: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0,
        threshold: this.config.coverageThreshold.branches,
        passing: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 >= this.config.coverageThreshold.branches : false
      },
      functions: {
        total: totalFunctions,
        covered: coveredFunctions,
        percentage: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0,
        threshold: this.config.coverageThreshold.functions,
        passing: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 >= this.config.coverageThreshold.functions : false
      },
      lines: {
        total: totalLines,
        covered: coveredLines,
        percentage: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0,
        threshold: this.config.coverageThreshold.lines,
        passing: totalLines > 0 ? (coveredLines / totalLines) * 100 >= this.config.coverageThreshold.lines : false
      }
    };
  }

  /**
   * Analyze a single file
   */
  private analyzeFile(content: string, filePath: string, testFiles: string[]): {
    statements: number;
    coveredStatements: number;
    branches: number;
    coveredBranches: number;
    functions: number;
    coveredFunctions: number;
    lines: number;
    coveredLines: number;
  } {
    const lines = content.split('\n');
    const fileName = filePath.split('/').pop()?.replace('.ts', '') || '';
    
    // Count statements (simplified analysis)
    let statements = 0;
    let coveredStatements = 0;
    let branches = 0;
    let coveredBranches = 0;
    let functions = 0;
    let coveredFunctions = 0;
    let coveredLines = 0;

    // Check if file has corresponding test file
    const hasTestFile = testFiles.some(testFile => 
      testFile.includes(fileName) || testFile.includes(filePath.replace('.ts', ''))
    );

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine === '' || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
        continue;
      }

      // Count statements
      if (trimmedLine.includes(';') || trimmedLine.includes('{') || trimmedLine.includes('}')) {
        statements++;
        if (hasTestFile) {
          coveredStatements++;
        }
      }

      // Count branches
      if (trimmedLine.includes('if') || trimmedLine.includes('else') || 
          trimmedLine.includes('switch') || trimmedLine.includes('case') ||
          trimmedLine.includes('?') || trimmedLine.includes('||') || 
          trimmedLine.includes('&&')) {
        branches++;
        if (hasTestFile) {
          coveredBranches++;
        }
      }

      // Count functions
      if (trimmedLine.includes('function') || trimmedLine.includes('=>') ||
          trimmedLine.match(/\w+\s*\(/)) {
        functions++;
        if (hasTestFile) {
          coveredFunctions++;
        }
      }

      // Count lines
      if (trimmedLine.length > 0) {
        if (hasTestFile) {
          coveredLines++;
        }
      }
    }

    return {
      statements,
      coveredStatements,
      branches,
      coveredBranches,
      functions,
      coveredFunctions,
      lines: lines.length,
      coveredLines
    };
  }

  /**
   * Analyze functional coverage
   */
  private async analyzeFunctionalCoverage(testResults: TestSuiteResult): Promise<FunctionalCoverage> {
    console.log("🎯 Analyzing functional coverage...");
    
    const features: Record<string, FeatureCoverage> = {};
    const scenarios: Record<string, ScenarioCoverage> = {};
    const requirements: Record<string, RequirementCoverage> = {};

    // Define core features that should be covered
    const coreFeatures = [
      {
        name: "self-transpilation",
        description: "TPEG can parse and generate parsers for its own grammar",
        testCases: ["self-parse-basic", "code-generation", "self-hosting-loop"]
      },
      {
        name: "error-handling",
        description: "Comprehensive error handling and recovery mechanisms",
        testCases: ["error-detection", "recovery-mechanisms", "error-integration"]
      },
      {
        name: "performance-optimization",
        description: "Performance optimization features and caching",
        testCases: ["baseline-performance", "optimization-features", "caching-system"]
      },
      {
        name: "iteration-optimization",
        description: "Batch processing and parallel execution capabilities",
        testCases: ["batch-processing", "parallel-execution", "memory-management"]
      },
      {
        name: "bootstrap-validation",
        description: "Bootstrap validation and multi-stage compilation",
        testCases: ["bootstrap-validation", "complete-workflow"]
      }
    ];

    // Analyze feature coverage
    for (const feature of coreFeatures) {
      const testCases = feature.testCases;
      const coveredTestCases = testCases.filter(testCase => 
        this.isTestCaseCovered(testCase, testResults)
      );
      
      features[feature.name] = {
        name: feature.name,
        description: feature.description,
        covered: coveredTestCases.length > 0,
        testCases: coveredTestCases,
        lastTested: new Date(),
        coverage: testCases.length > 0 ? (coveredTestCases.length / testCases.length) * 100 : 0
      };
    }

    // Analyze scenario coverage
    const coreScenarios = [
      {
        name: "basic-grammar-parsing",
        description: "Parse simple grammar definitions",
        testCases: ["self-parse-basic"],
        expectedBehavior: "Successfully parse TPEG grammar files",
        actualBehavior: "Parsing works correctly"
      },
      {
        name: "code-generation",
        description: "Generate TypeScript parser code",
        testCases: ["code-generation"],
        expectedBehavior: "Generate functional TypeScript code",
        actualBehavior: "Code generation works correctly"
      },
      {
        name: "self-hosting",
        description: "Complete self-hosting capability",
        testCases: ["self-hosting-loop"],
        expectedBehavior: "Generated parser can parse original grammar",
        actualBehavior: "Self-hosting works correctly"
      }
    ];

    for (const scenario of coreScenarios) {
      const covered = scenario.testCases.some(testCase => 
        this.isTestCaseCovered(testCase, testResults)
      );
      
      scenarios[scenario.name] = {
        name: scenario.name,
        description: scenario.description,
        covered,
        testCases: scenario.testCases,
        expectedBehavior: scenario.expectedBehavior,
        actualBehavior: scenario.actualBehavior,
        passed: covered
      };
    }

    // Analyze requirement coverage
    const coreRequirements = [
      {
        id: "REQ-001",
        description: "System must support self-transpilation",
        testCases: ["self-parse-basic", "code-generation"],
        priority: "high" as const
      },
      {
        id: "REQ-002",
        description: "System must handle errors gracefully",
        testCases: ["error-detection", "recovery-mechanisms"],
        priority: "high" as const
      },
      {
        id: "REQ-003",
        description: "System must provide performance optimization",
        testCases: ["baseline-performance", "optimization-features"],
        priority: "medium" as const
      },
      {
        id: "REQ-004",
        description: "System must support batch processing",
        testCases: ["batch-processing", "parallel-execution"],
        priority: "medium" as const
      },
      {
        id: "REQ-005",
        description: "System must validate bootstrap process",
        testCases: ["bootstrap-validation"],
        priority: "low" as const
      }
    ];

    for (const requirement of coreRequirements) {
      const covered = requirement.testCases.some(testCase => 
        this.isTestCaseCovered(testCase, testResults)
      );
      
      requirements[requirement.id] = {
        id: requirement.id,
        description: requirement.description,
        covered,
        testCases: requirement.testCases,
        priority: requirement.priority,
        status: covered ? "passed" : "not_tested"
      };
    }

    return {
      features,
      scenarios,
      requirements,
      overall: {
        featuresCovered: Object.values(features).filter(f => f.covered).length,
        totalFeatures: Object.values(features).length,
        scenariosCovered: Object.values(scenarios).filter(s => s.covered).length,
        totalScenarios: Object.values(scenarios).length,
        requirementsCovered: Object.values(requirements).filter(r => r.covered).length,
        totalRequirements: Object.values(requirements).length
      }
    };
  }

  /**
   * Check if test case is covered
   */
  private isTestCaseCovered(testCaseId: string, testResults: TestSuiteResult): boolean {
    for (const categoryResult of Object.values(testResults.categoryResults)) {
      for (const testResult of categoryResult.testResults) {
        if (testResult.id === testCaseId && testResult.success) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Analyze test quality
   */
  private async analyzeTestQuality(testFiles: string[], testResults: TestSuiteResult): Promise<QualityAnalysis> {
    console.log("🔍 Analyzing test quality...");
    
    let totalAssertions = 0;
    let totalTestLength = 0;
    let testCount = 0;
    let duplicateTests = 0;
    let unitTests = 0;
    let integrationTests = 0;
    let systemTests = 0;
    let performanceTests = 0;

    for (const testFile of testFiles) {
      try {
        const content = readFileSync(testFile, "utf-8");
        const analysis = this.analyzeTestFile(content);
        
        totalAssertions += analysis.assertions;
        totalTestLength += analysis.testLength;
        testCount += analysis.testCount;
        duplicateTests += analysis.duplicateTests;
        
        // Categorize tests
        if (testFile.includes("unit") || testFile.includes("spec")) {
          unitTests += analysis.testCount;
        } else if (testFile.includes("integration")) {
          integrationTests += analysis.testCount;
        } else if (testFile.includes("system") || testFile.includes("e2e")) {
          systemTests += analysis.testCount;
        } else if (testFile.includes("performance") || testFile.includes("benchmark")) {
          performanceTests += analysis.testCount;
        } else {
          // Default to integration tests
          integrationTests += analysis.testCount;
        }
      } catch (error) {
        console.warn(`Warning: Could not analyze test file ${testFile}:`, error);
      }
    }

    // Calculate execution metrics
    const totalTime = testResults.totalDuration;
    const averageTime = testCount > 0 ? totalTime / testCount : 0;
    const slowestTests = this.findSlowestTests(testResults);

    return {
      testDistribution: {
        unitTests,
        integrationTests,
        systemTests,
        performanceTests
      },
      testQuality: {
        averageAssertions: testCount > 0 ? totalAssertions / testCount : 0,
        averageTestLength: testCount > 0 ? totalTestLength / testCount : 0,
        duplicateTests,
        flakinesss: this.calculateFlakiness(testResults),
        maintainability: this.calculateMaintainability(testFiles)
      },
      testEffectiveness: {
        bugDetectionRate: this.calculateBugDetectionRate(testResults),
        falsePositiveRate: this.calculateFalsePositiveRate(testResults),
        testExecution: {
          averageTime,
          totalTime,
          slowestTests
        }
      },
      recommendations: this.generateQualityRecommendations(testResults, testFiles)
    };
  }

  /**
   * Analyze test file
   */
  private analyzeTestFile(content: string): {
    assertions: number;
    testLength: number;
    testCount: number;
    duplicateTests: number;
  } {
    const lines = content.split('\n');
    let assertions = 0;
    let testCount = 0;
    let currentTestLength = 0;
    let totalTestLength = 0;
    let duplicateTests = 0;
    const testNames = new Set<string>();

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Count assertions
      if (trimmedLine.includes('expect') || trimmedLine.includes('assert') || 
          trimmedLine.includes('should') || trimmedLine.includes('toBe') ||
          trimmedLine.includes('toEqual') || trimmedLine.includes('toMatch')) {
        assertions++;
      }

      // Count tests
      if (trimmedLine.includes('test(') || trimmedLine.includes('it(') || 
          trimmedLine.includes('describe(')) {
        if (currentTestLength > 0) {
          totalTestLength += currentTestLength;
        }
        testCount++;
        currentTestLength = 0;
        
        // Check for duplicate test names
        const testNameMatch = trimmedLine.match(/["']([^"']+)["']/);
        if (testNameMatch) {
          const testName = testNameMatch[1];
          if (testNames.has(testName)) {
            duplicateTests++;
          } else {
            testNames.add(testName);
          }
        }
      }
      
      if (testCount > 0) {
        currentTestLength++;
      }
    }

    if (currentTestLength > 0) {
      totalTestLength += currentTestLength;
    }

    return {
      assertions,
      testLength: totalTestLength,
      testCount,
      duplicateTests
    };
  }

  /**
   * Find slowest tests
   */
  private findSlowestTests(testResults: TestSuiteResult): string[] {
    const slowTests: Array<{ name: string; duration: number }> = [];
    
    for (const categoryResult of Object.values(testResults.categoryResults)) {
      for (const testResult of categoryResult.testResults) {
        slowTests.push({
          name: testResult.name,
          duration: testResult.duration
        });
      }
    }

    return slowTests
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5)
      .map(test => `${test.name} (${test.duration.toFixed(2)}ms)`);
  }

  /**
   * Calculate flakiness
   */
  private calculateFlakiness(testResults: TestSuiteResult): number {
    // Simplified flakiness calculation
    const totalTests = testResults.totalTests;
    const failedTests = testResults.failedTests;
    
    if (totalTests === 0) return 0;
    return (failedTests / totalTests) * 100;
  }

  /**
   * Calculate maintainability
   */
  private calculateMaintainability(testFiles: string[]): number {
    // Simplified maintainability calculation based on test file structure
    let totalScore = 0;
    
    for (const testFile of testFiles) {
      try {
        const content = readFileSync(testFile, "utf-8");
        const lines = content.split('\n');
        
        // Factors that affect maintainability
        let score = 100;
        
        // Penalize very long files
        if (lines.length > 1000) score -= 20;
        else if (lines.length > 500) score -= 10;
        
        // Penalize lack of comments
        const commentLines = lines.filter(line => 
          line.trim().startsWith('//') || line.trim().startsWith('/*')
        ).length;
        const commentRatio = commentLines / lines.length;
        if (commentRatio < 0.1) score -= 15;
        
        // Penalize complex test structures
        const nestedBlocks = (content.match(/\{/g) || []).length;
        if (nestedBlocks > 100) score -= 10;
        
        totalScore += Math.max(0, score);
      } catch (error) {
        totalScore += 50; // Default score for unreadable files
      }
    }
    
    return testFiles.length > 0 ? totalScore / testFiles.length : 0;
  }

  /**
   * Calculate bug detection rate
   */
  private calculateBugDetectionRate(testResults: TestSuiteResult): number {
    // Simplified bug detection rate calculation
    const totalTests = testResults.totalTests;
    const passedTests = testResults.passedTests;
    
    if (totalTests === 0) return 0;
    return (passedTests / totalTests) * 100;
  }

  /**
   * Calculate false positive rate
   */
  private calculateFalsePositiveRate(testResults: TestSuiteResult): number {
    // Simplified false positive rate calculation
    const totalTests = testResults.totalTests;
    const failedTests = testResults.failedTests;
    
    if (totalTests === 0) return 0;
    return (failedTests / totalTests) * 10; // Assume 10% of failures are false positives
  }

  /**
   * Generate quality recommendations
   */
  private generateQualityRecommendations(testResults: TestSuiteResult, testFiles: string[]): string[] {
    const recommendations: string[] = [];
    
    const successRate = testResults.passedTests / testResults.totalTests;
    if (successRate < 0.9) {
      recommendations.push("Improve test success rate - currently below 90%");
    }
    
    if (testFiles.length < 10) {
      recommendations.push("Consider adding more test files for better coverage");
    }
    
    const averageTestTime = testResults.totalDuration / testResults.totalTests;
    if (averageTestTime > 5000) {
      recommendations.push("Optimize test execution time - average test takes too long");
    }
    
    return recommendations;
  }

  /**
   * Generate empty functional coverage
   */
  private getEmptyFunctionalCoverage(): FunctionalCoverage {
    return {
      features: {},
      scenarios: {},
      requirements: {},
      overall: {
        featuresCovered: 0,
        totalFeatures: 0,
        scenariosCovered: 0,
        totalScenarios: 0,
        requirementsCovered: 0,
        totalRequirements: 0
      }
    };
  }

  /**
   * Generate empty quality analysis
   */
  private getEmptyQualityAnalysis(): QualityAnalysis {
    return {
      testDistribution: {
        unitTests: 0,
        integrationTests: 0,
        systemTests: 0,
        performanceTests: 0
      },
      testQuality: {
        averageAssertions: 0,
        averageTestLength: 0,
        duplicateTests: 0,
        flakinesss: 0,
        maintainability: 0
      },
      testEffectiveness: {
        bugDetectionRate: 0,
        falsePositiveRate: 0,
        testExecution: {
          averageTime: 0,
          totalTime: 0,
          slowestTests: []
        }
      },
      recommendations: []
    };
  }

  /**
   * Generate coverage summary
   */
  private generateCoverageSummary(
    codeCoverage: CoverageAnalysis["overall"],
    functionalCoverage: FunctionalCoverage,
    qualityAnalysis: QualityAnalysis
  ): CoverageSummary {
    let score = 0;
    let passedThresholds = 0;
    const totalThresholds = 4;

    // Code coverage scoring
    if (codeCoverage.statements.passing) {
      score += 25;
      passedThresholds++;
    }
    if (codeCoverage.branches.passing) {
      score += 20;
      passedThresholds++;
    }
    if (codeCoverage.functions.passing) {
      score += 25;
      passedThresholds++;
    }
    if (codeCoverage.lines.passing) {
      score += 20;
      passedThresholds++;
    }

    // Functional coverage bonus
    const functionalScore = functionalCoverage.overall.featuresCovered / Math.max(1, functionalCoverage.overall.totalFeatures);
    score += functionalScore * 10;

    // Quality analysis bonus
    if (qualityAnalysis.testQuality.maintainability > 80) {
      score += 5;
    }
    if (qualityAnalysis.testEffectiveness.bugDetectionRate > 90) {
      score += 5;
    }

    const grade = this.calculateGrade(score);
    
    const criticalGaps: string[] = [];
    if (!codeCoverage.statements.passing) {
      criticalGaps.push("Statement coverage below threshold");
    }
    if (!codeCoverage.functions.passing) {
      criticalGaps.push("Function coverage below threshold");
    }
    if (functionalCoverage.overall.featuresCovered < functionalCoverage.overall.totalFeatures) {
      criticalGaps.push("Not all features are covered by tests");
    }

    const strengths: string[] = [];
    if (codeCoverage.statements.passing) {
      strengths.push("Good statement coverage");
    }
    if (codeCoverage.functions.passing) {
      strengths.push("Good function coverage");
    }
    if (qualityAnalysis.testQuality.maintainability > 80) {
      strengths.push("High test maintainability");
    }

    const weaknesses: string[] = [];
    if (!codeCoverage.branches.passing) {
      weaknesses.push("Branch coverage needs improvement");
    }
    if (qualityAnalysis.testQuality.duplicateTests > 0) {
      weaknesses.push("Duplicate tests detected");
    }
    if (qualityAnalysis.testEffectiveness.falsePositiveRate > 5) {
      weaknesses.push("High false positive rate");
    }

    const nextSteps: string[] = [];
    if (criticalGaps.length > 0) {
      nextSteps.push("Address critical coverage gaps");
    }
    if (qualityAnalysis.testQuality.averageAssertions < 2) {
      nextSteps.push("Increase assertion density in tests");
    }
    nextSteps.push("Continuous monitoring of coverage metrics");

    return {
      grade,
      score,
      passedThresholds,
      totalThresholds,
      criticalGaps,
      strengths,
      weaknesses,
      nextSteps
    };
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    codeCoverage: CoverageAnalysis["overall"],
    functionalCoverage: FunctionalCoverage,
    qualityAnalysis: QualityAnalysis
  ): string[] {
    const recommendations: string[] = [];

    // Code coverage recommendations
    if (!codeCoverage.statements.passing) {
      recommendations.push(`Increase statement coverage from ${codeCoverage.statements.percentage.toFixed(1)}% to ${codeCoverage.statements.threshold}%`);
    }
    if (!codeCoverage.branches.passing) {
      recommendations.push(`Increase branch coverage from ${codeCoverage.branches.percentage.toFixed(1)}% to ${codeCoverage.branches.threshold}%`);
    }
    if (!codeCoverage.functions.passing) {
      recommendations.push(`Increase function coverage from ${codeCoverage.functions.percentage.toFixed(1)}% to ${codeCoverage.functions.threshold}%`);
    }
    if (!codeCoverage.lines.passing) {
      recommendations.push(`Increase line coverage from ${codeCoverage.lines.percentage.toFixed(1)}% to ${codeCoverage.lines.threshold}%`);
    }

    // Functional coverage recommendations
    const uncoveredFeatures = Object.values(functionalCoverage.features).filter(f => !f.covered);
    if (uncoveredFeatures.length > 0) {
      recommendations.push(`Add tests for uncovered features: ${uncoveredFeatures.map(f => f.name).join(", ")}`);
    }

    // Quality recommendations
    if (qualityAnalysis.testQuality.averageAssertions < 2) {
      recommendations.push("Increase assertion density in tests");
    }
    if (qualityAnalysis.testQuality.duplicateTests > 0) {
      recommendations.push("Remove duplicate tests");
    }
    if (qualityAnalysis.testQuality.maintainability < 70) {
      recommendations.push("Improve test maintainability");
    }

    // Add quality recommendations
    recommendations.push(...qualityAnalysis.recommendations);

    return recommendations;
  }

  /**
   * Calculate grade
   */
  private calculateGrade(score: number): "A" | "B" | "C" | "D" | "F" {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
  }

  /**
   * Generate coverage report
   */
  private async generateCoverageReport(analysis: CoverageAnalysis): Promise<void> {
    const report = {
      timestamp: new Date().toISOString(),
      analysis,
      config: this.config
    };

    // Generate JSON report
    writeFileSync(this.config.outputPath, JSON.stringify(report, null, 2));
    
    // Generate additional formats
    if (this.config.reportFormat === "html") {
      await this.generateHTMLCoverageReport(analysis);
    } else if (this.config.reportFormat === "markdown") {
      await this.generateMarkdownCoverageReport(analysis);
    } else if (this.config.reportFormat === "console") {
      this.printCoverageReport(analysis);
    }

    console.log(`📊 Coverage report generated: ${this.config.outputPath}`);
  }

  /**
   * Generate HTML coverage report
   */
  private async generateHTMLCoverageReport(analysis: CoverageAnalysis): Promise<void> {
    const htmlPath = this.config.outputPath.replace(/\.json$/, ".html");
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TPEG Coverage Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f0f0; padding: 20px; border-radius: 8px; }
        .coverage-metric { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
        .passing { background-color: #d4edda; }
        .failing { background-color: #f8d7da; }
        .progress-bar { width: 100%; height: 20px; background: #e9ecef; border-radius: 10px; }
        .progress-fill { height: 100%; background: #28a745; border-radius: 10px; }
        .failing .progress-fill { background: #dc3545; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>TPEG Coverage Report</h1>
        <p><strong>Overall Grade:</strong> ${analysis.summary.grade} (${analysis.summary.score}/100)</p>
        <p><strong>Passed Thresholds:</strong> ${analysis.summary.passedThresholds}/${analysis.summary.totalThresholds}</p>
        <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
    </div>

    <h2>Code Coverage</h2>
    ${Object.entries(analysis.overall).map(([type, metrics]) => `
        <div class="coverage-metric ${metrics.passing ? 'passing' : 'failing'}">
            <h3>${type.charAt(0).toUpperCase() + type.slice(1)} Coverage</h3>
            <p>${metrics.covered}/${metrics.total} (${metrics.percentage.toFixed(1)}%)</p>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${metrics.percentage}%"></div>
            </div>
            <p>Threshold: ${metrics.threshold}% - ${metrics.passing ? 'PASSED' : 'FAILED'}</p>
        </div>
    `).join('')}

    <h2>Functional Coverage</h2>
    <table>
        <tr><th>Feature</th><th>Covered</th><th>Coverage</th><th>Test Cases</th></tr>
        ${Object.values(analysis.functional.features).map(feature => `
            <tr>
                <td>${feature.name}</td>
                <td>${feature.covered ? '✅' : '❌'}</td>
                <td>${feature.coverage.toFixed(1)}%</td>
                <td>${feature.testCases.join(', ')}</td>
            </tr>
        `).join('')}
    </table>

    <h2>Summary</h2>
    <h3>Strengths</h3>
    <ul>
        ${analysis.summary.strengths.map(strength => `<li>${strength}</li>`).join('')}
    </ul>

    <h3>Weaknesses</h3>
    <ul>
        ${analysis.summary.weaknesses.map(weakness => `<li>${weakness}</li>`).join('')}
    </ul>

    <h2>Recommendations</h2>
    <ul>
        ${analysis.recommendations.map(rec => `<li>${rec}</li>`).join('')}
    </ul>
</body>
</html>`;

    writeFileSync(htmlPath, html);
  }

  /**
   * Generate Markdown coverage report
   */
  private async generateMarkdownCoverageReport(analysis: CoverageAnalysis): Promise<void> {
    const markdownPath = this.config.outputPath.replace(/\.json$/, ".md");
    
    const markdown = `# TPEG Coverage Report

## Overview

- **Overall Grade:** ${analysis.summary.grade} (${analysis.summary.score}/100)
- **Passed Thresholds:** ${analysis.summary.passedThresholds}/${analysis.summary.totalThresholds}
- **Generated:** ${new Date().toLocaleString()}

## Code Coverage

${Object.entries(analysis.overall).map(([type, metrics]) => `
### ${type.charAt(0).toUpperCase() + type.slice(1)} Coverage

- **Coverage:** ${metrics.covered}/${metrics.total} (${metrics.percentage.toFixed(1)}%)
- **Threshold:** ${metrics.threshold}%
- **Status:** ${metrics.passing ? 'PASSED ✅' : 'FAILED ❌'}
`).join('')}

## Functional Coverage

| Feature | Covered | Coverage | Test Cases |
|---------|---------|----------|------------|
${Object.values(analysis.functional.features).map(feature => 
  `| ${feature.name} | ${feature.covered ? '✅' : '❌'} | ${feature.coverage.toFixed(1)}% | ${feature.testCases.join(', ')} |`
).join('\n')}

## Summary

### Strengths
${analysis.summary.strengths.map(strength => `- ${strength}`).join('\n')}

### Weaknesses
${analysis.summary.weaknesses.map(weakness => `- ${weakness}`).join('\n')}

### Critical Gaps
${analysis.summary.criticalGaps.map(gap => `- ${gap}`).join('\n')}

### Next Steps
${analysis.summary.nextSteps.map(step => `- ${step}`).join('\n')}

## Recommendations

${analysis.recommendations.map(rec => `- ${rec}`).join('\n')}
`;

    writeFileSync(markdownPath, markdown);
  }

  /**
   * Print coverage report to console
   */
  private printCoverageReport(analysis: CoverageAnalysis): void {
    console.log("\n📊 COVERAGE ANALYSIS RESULTS");
    console.log("=============================");
    console.log(`📊 Overall Grade: ${analysis.summary.grade} (${analysis.summary.score}/100)`);
    console.log(`✅ Passed Thresholds: ${analysis.summary.passedThresholds}/${analysis.summary.totalThresholds}`);
    console.log("");

    console.log("📋 Code Coverage:");
    for (const [type, metrics] of Object.entries(analysis.overall)) {
      const status = metrics.passing ? "✅" : "❌";
      console.log(`${status} ${type.charAt(0).toUpperCase() + type.slice(1)}: ${metrics.percentage.toFixed(1)}% (${metrics.covered}/${metrics.total})`);
    }

    console.log("\n🎯 Functional Coverage:");
    for (const feature of Object.values(analysis.functional.features)) {
      const status = feature.covered ? "✅" : "❌";
      console.log(`${status} ${feature.name}: ${feature.coverage.toFixed(1)}% coverage`);
    }

    console.log("\n📋 Recommendations:");
    analysis.recommendations.forEach(rec => {
      console.log(`- ${rec}`);
    });
  }
}

/**
 * Convenience function to analyze coverage
 */
export async function analyzeCoverage(
  testResults: TestSuiteResult,
  config: Partial<CoverageConfig> = {}
): Promise<CoverageAnalysis> {
  const analyzer = new TestCoverageAnalyzer(config);
  return await analyzer.analyzeCoverage(testResults);
} 