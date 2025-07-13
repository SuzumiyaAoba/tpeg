/**
 * Test Runner for TPEG Self-Transpilation System
 *
 * Provides command-line interface and orchestration for running
 * the comprehensive test suite with various options and configurations.
 */

import { writeFileSync } from "node:fs";
import { runComprehensiveTestSuite } from "./comprehensive-test-suite";
import type { TestSuiteResult } from "./comprehensive-test-suite";

/**
 * Test runner configuration
 */
export interface TestRunnerConfig {
  // Test execution options
  categories?: string[];
  skipCategories?: string[];
  stopOnFirstFailure?: boolean;
  maxConcurrentTests?: number;
  timeout?: number;

  // Output options
  verbose?: boolean;
  quiet?: boolean;
  outputFormat?: "console" | "json" | "html" | "markdown";
  outputFile?: string;

  // Performance options
  enablePerformanceMonitoring?: boolean;
  memoryLimit?: number;

  // Retry options
  maxRetries?: number;
  retryDelay?: number;

  // Report options
  generateReport?: boolean;
  reportPath?: string;
  includeDetails?: boolean;

  // CI/CD options
  exitOnFailure?: boolean;
  minimumPassRate?: number;
  minimumGrade?: string;

  // Debug options
  debugMode?: boolean;
  saveIntermediateResults?: boolean;
}

/**
 * Test execution result with additional runner metadata
 */
export interface TestRunnerResult {
  config: TestRunnerConfig;
  testSuiteResult: TestSuiteResult;
  execution: {
    startTime: Date;
    endTime: Date;
    duration: number;
    memoryUsage: number;
    retries: number;
    interrupted: boolean;
  };
  environment: {
    nodeVersion: string;
    platform: string;
    architecture: string;
    memoryLimit: number;
    cpuCount: number;
  };
  exitCode: number;
  messages: string[];
}

/**
 * Main test runner class
 */
export class TestRunner {
  private config: TestRunnerConfig;
  private result: TestRunnerResult | null = null;
  private startTime: Date = new Date();
  private interrupted = false;
  private retries = 0;

  constructor(config: TestRunnerConfig = {}) {
    this.config = {
      // Default configuration
      categories: [],
      skipCategories: [],
      stopOnFirstFailure: false,
      maxConcurrentTests: 4,
      timeout: 300000, // 5 minutes
      verbose: true,
      quiet: false,
      outputFormat: "console",
      outputFile: "",
      enablePerformanceMonitoring: true,
      memoryLimit: 1024, // 1GB
      maxRetries: 0,
      retryDelay: 1000,
      generateReport: true,
      reportPath: "./test-results.json",
      includeDetails: true,
      exitOnFailure: false,
      minimumPassRate: 0.8,
      minimumGrade: "C",
      debugMode: false,
      saveIntermediateResults: false,
      ...config,
    };
  }

  /**
   * Run the test suite with the configured options
   */
  async run(): Promise<TestRunnerResult> {
    this.startTime = new Date();

    if (!this.config.quiet) {
      this.printHeader();
    }

    // Set up signal handlers for graceful shutdown
    this.setupSignalHandlers();

    // Initialize performance monitoring
    if (this.config.enablePerformanceMonitoring) {
      this.startPerformanceMonitoring();
    }

    try {
      const testSuiteResult = await this.runTestSuiteWithRetry();

      const endTime = new Date();
      const duration = endTime.getTime() - this.startTime.getTime();

      this.result = {
        config: this.config,
        testSuiteResult,
        execution: {
          startTime: this.startTime,
          endTime,
          duration,
          memoryUsage: process.memoryUsage?.()?.heapUsed || 0,
          retries: this.retries,
          interrupted: this.interrupted,
        },
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          memoryLimit: this.config.memoryLimit || 1024,
          cpuCount: require("node:os").cpus().length,
        },
        exitCode: this.calculateExitCode(testSuiteResult),
        messages: [],
      };

      if (this.config.generateReport) {
        await this.generateReports();
      }

      if (!this.config.quiet) {
        this.printSummary();
      }

      return this.result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - this.startTime.getTime();

      this.result = {
        config: this.config,
        testSuiteResult: {
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          totalDuration: duration,
          totalMemoryUsage: process.memoryUsage?.()?.heapUsed || 0,
          overallScore: 0,
          overallGrade: "F",
          categoryResults: {},
          summary: `Test runner failed: ${error}`,
          recommendations: ["Fix test runner configuration and try again"],
        },
        execution: {
          startTime: this.startTime,
          endTime,
          duration,
          memoryUsage: process.memoryUsage?.()?.heapUsed || 0,
          retries: this.retries,
          interrupted: this.interrupted,
        },
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          memoryLimit: this.config.memoryLimit || 1024,
          cpuCount: require("node:os").cpus().length,
        },
        exitCode: 1,
        messages: [error instanceof Error ? error.message : String(error)],
      };

      if (!this.config.quiet) {
        console.error("🚨 Test runner failed:", error);
      }

      return this.result;
    }
  }

  /**
   * Run test suite with retry logic
   */
  private async runTestSuiteWithRetry(): Promise<TestSuiteResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= (this.config.maxRetries || 0); attempt++) {
      try {
        if (attempt > 0) {
          this.retries++;
          if (!this.config.quiet) {
            console.log(
              `🔄 Retry attempt ${attempt}/${this.config.maxRetries}...`,
            );
          }

          if (this.config.retryDelay && this.config.retryDelay > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, this.config.retryDelay),
            );
          }
        }

        const testSuiteResult = await runComprehensiveTestSuite({
          stopOnFirstFailure: this.config.stopOnFirstFailure || false,
          verbose: (this.config.verbose && !this.config.quiet) || false,
          generateReport: false, // We'll generate our own report
          reportPath: this.config.reportPath || "./test-results.json",
        });

        return testSuiteResult;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (this.config.debugMode) {
          console.error(`Attempt ${attempt + 1} failed:`, error);
        }

        if (attempt === (this.config.maxRetries || 0)) {
          break; // Last attempt, don't retry
        }
      }
    }

    throw lastError || new Error("Test suite failed after all retry attempts");
  }

  /**
   * Calculate exit code based on test results
   */
  private calculateExitCode(testSuiteResult: TestSuiteResult): number {
    // Success
    if (testSuiteResult.failedTests === 0) {
      return 0;
    }

    // Check minimum pass rate
    const passRate = testSuiteResult.passedTests / testSuiteResult.totalTests;
    if (passRate < (this.config.minimumPassRate || 0.8)) {
      return 2; // Insufficient pass rate
    }

    // Check minimum grade
    const gradeValues = { A: 4, B: 3, C: 2, D: 1, F: 0 };
    const actualGrade = gradeValues[testSuiteResult.overallGrade] || 0;
    const requiredGrade =
      gradeValues[this.config.minimumGrade as keyof typeof gradeValues] || 2;

    if (actualGrade < requiredGrade) {
      return 3; // Insufficient grade
    }

    // Some tests failed but within acceptable limits
    return this.config.exitOnFailure ? 1 : 0;
  }

  /**
   * Set up signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const handleSignal = (signal: string) => {
      console.log(`\n🚨 Received ${signal}, shutting down gracefully...`);
      this.interrupted = true;

      if (this.config.saveIntermediateResults && this.result) {
        this.generateReports();
      }

      process.exit(130); // Standard exit code for SIGINT
    };

    process.on("SIGINT", () => handleSignal("SIGINT"));
    process.on("SIGTERM", () => handleSignal("SIGTERM"));
  }

  /**
   * Start performance monitoring
   */
  private startPerformanceMonitoring(): void {
    if (this.config.memoryLimit) {
      const memoryCheckInterval = setInterval(() => {
        const memoryUsage = process.memoryUsage?.()?.heapUsed || 0;
        const memoryLimitBytes =
          (this.config.memoryLimit || 1024) * 1024 * 1024;

        if (memoryUsage > memoryLimitBytes) {
          console.error(
            `🚨 Memory usage (${Math.round(memoryUsage / 1024 / 1024)}MB) exceeded limit (${this.config.memoryLimit}MB)`,
          );
          process.exit(4); // Memory limit exceeded
        }
      }, 5000); // Check every 5 seconds

      // Clear interval on exit
      process.on("exit", () => clearInterval(memoryCheckInterval));
    }
  }

  /**
   * Print header information
   */
  private printHeader(): void {
    console.log("🧪 TPEG Test Runner");
    console.log("===================");
    console.log(`⏰ Started: ${this.startTime.toLocaleString()}`);
    console.log(`🖥️  Platform: ${process.platform} (${process.arch})`);
    console.log(`📦 Node.js: ${process.version}`);
    console.log(`🧠 CPU Cores: ${require("node:os").cpus().length}`);
    console.log(`💾 Memory Limit: ${this.config.memoryLimit}MB`);
    console.log(`⏱️  Timeout: ${(this.config.timeout || 300000) / 1000}s`);
    console.log(`🔄 Max Retries: ${this.config.maxRetries || 0}`);
    console.log(`📊 Output Format: ${this.config.outputFormat}`);
    console.log("");
  }

  /**
   * Print summary information
   */
  private printSummary(): void {
    if (!this.result) return;

    const { testSuiteResult, execution, exitCode } = this.result;

    console.log("\n🎯 TEST RUNNER SUMMARY");
    console.log("======================");
    console.log(
      `📊 Overall Result: ${testSuiteResult.overallGrade} (${testSuiteResult.overallScore.toFixed(1)}/100)`,
    );
    console.log(
      `📋 Tests: ${testSuiteResult.passedTests}/${testSuiteResult.totalTests} passed`,
    );
    console.log(
      `📈 Success Rate: ${((testSuiteResult.passedTests / testSuiteResult.totalTests) * 100).toFixed(1)}%`,
    );
    console.log(`⏱️  Duration: ${(execution.duration / 1000).toFixed(2)}s`);
    console.log(
      `💾 Memory Used: ${(execution.memoryUsage / 1024 / 1024).toFixed(2)}MB`,
    );
    console.log(`🔄 Retries: ${execution.retries}`);
    console.log(`📤 Exit Code: ${exitCode}`);

    if (execution.interrupted) {
      console.log("🚨 Execution was interrupted");
    }

    if (this.config.generateReport) {
      console.log(`📊 Report: ${this.config.reportPath}`);
    }

    // Print status indicator
    if (exitCode === 0) {
      console.log("✅ All tests passed successfully!");
    } else {
      console.log("❌ Some tests failed or requirements not met.");
    }
  }

  /**
   * Generate reports in various formats
   */
  private async generateReports(): Promise<void> {
    if (!this.result) return;

    try {
      // Always generate JSON report
      const jsonReport = JSON.stringify(this.result, null, 2);
      writeFileSync(
        this.config.reportPath || "./test-results.json",
        jsonReport,
      );

      // Generate additional formats based on config
      if (this.config.outputFormat === "html") {
        await this.generateHTMLReport();
      } else if (this.config.outputFormat === "markdown") {
        await this.generateMarkdownReport();
      }

      // Generate specific output file if requested
      if (this.config.outputFile) {
        if (this.config.outputFormat === "json") {
          writeFileSync(this.config.outputFile, jsonReport);
        } else if (this.config.outputFormat === "console") {
          const consoleOutput = this.generateConsoleReport();
          writeFileSync(this.config.outputFile, consoleOutput);
        }
      }
    } catch (error) {
      console.error("⚠️  Failed to generate reports:", error);
    }
  }

  /**
   * Generate HTML report
   */
  private async generateHTMLReport(): Promise<void> {
    if (!this.result) return;

    const htmlPath =
      this.config.reportPath?.replace(/\.json$/, ".html") ||
      "./test-results.html";

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TPEG Test Results</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f0f0; padding: 20px; border-radius: 8px; }
        .grade-A { color: #28a745; }
        .grade-B { color: #6f42c1; }
        .grade-C { color: #ffc107; }
        .grade-D { color: #fd7e14; }
        .grade-F { color: #dc3545; }
        .category { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 4px; }
        .test-passed { color: #28a745; }
        .test-failed { color: #dc3545; }
        .details { margin-top: 10px; font-size: 0.9em; color: #666; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>TPEG Test Results</h1>
        <p><strong>Overall Grade:</strong> <span class="grade-${this.result.testSuiteResult.overallGrade}">${this.result.testSuiteResult.overallGrade}</span> (${this.result.testSuiteResult.overallScore.toFixed(1)}/100)</p>
        <p><strong>Success Rate:</strong> ${((this.result.testSuiteResult.passedTests / this.result.testSuiteResult.totalTests) * 100).toFixed(1)}%</p>
        <p><strong>Duration:</strong> ${(this.result.execution.duration / 1000).toFixed(2)}s</p>
        <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
    </div>

    <h2>Test Summary</h2>
    <table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Total Tests</td><td>${this.result.testSuiteResult.totalTests}</td></tr>
        <tr><td>Passed Tests</td><td class="test-passed">${this.result.testSuiteResult.passedTests}</td></tr>
        <tr><td>Failed Tests</td><td class="test-failed">${this.result.testSuiteResult.failedTests}</td></tr>
        <tr><td>Memory Usage</td><td>${(this.result.execution.memoryUsage / 1024 / 1024).toFixed(2)}MB</td></tr>
        <tr><td>Retries</td><td>${this.result.execution.retries}</td></tr>
    </table>

    <h2>Category Results</h2>
    ${Object.values(this.result.testSuiteResult.categoryResults)
      .map(
        (cat) => `
        <div class="category">
            <h3>${cat.categoryName} <span class="grade-${cat.grade}">${cat.grade}</span> (${cat.score.toFixed(1)}/100)</h3>
            <p>Tests: ${cat.passedTests}/${cat.totalTests} passed</p>
            <div class="details">
                <p><strong>Duration:</strong> ${cat.duration.toFixed(2)}ms</p>
                <p><strong>Memory:</strong> ${(cat.memoryUsage / 1024 / 1024).toFixed(2)}MB</p>
                ${cat.warnings.length > 0 ? `<p><strong>Warnings:</strong> ${cat.warnings.join(", ")}</p>` : ""}
            </div>
        </div>
    `,
      )
      .join("")}

    <h2>Environment</h2>
    <table>
        <tr><th>Property</th><th>Value</th></tr>
        <tr><td>Node.js Version</td><td>${this.result.environment.nodeVersion}</td></tr>
        <tr><td>Platform</td><td>${this.result.environment.platform}</td></tr>
        <tr><td>Architecture</td><td>${this.result.environment.architecture}</td></tr>
        <tr><td>CPU Cores</td><td>${this.result.environment.cpuCount}</td></tr>
    </table>

    <h2>Recommendations</h2>
    <ul>
        ${this.result.testSuiteResult.recommendations.map((rec) => `<li>${rec}</li>`).join("")}
    </ul>
</body>
</html>`;

    writeFileSync(htmlPath, html);
  }

  /**
   * Generate Markdown report
   */
  private async generateMarkdownReport(): Promise<void> {
    if (!this.result) return;

    const markdownPath =
      this.config.reportPath?.replace(/\.json$/, ".md") || "./test-results.md";

    const markdown = `# TPEG Test Results

## Overview

- **Overall Grade:** ${this.result.testSuiteResult.overallGrade} (${this.result.testSuiteResult.overallScore.toFixed(1)}/100)
- **Success Rate:** ${((this.result.testSuiteResult.passedTests / this.result.testSuiteResult.totalTests) * 100).toFixed(1)}%
- **Duration:** ${(this.result.execution.duration / 1000).toFixed(2)}s
- **Generated:** ${new Date().toLocaleString()}

## Test Summary

| Metric | Value |
|--------|-------|
| Total Tests | ${this.result.testSuiteResult.totalTests} |
| Passed Tests | ${this.result.testSuiteResult.passedTests} |
| Failed Tests | ${this.result.testSuiteResult.failedTests} |
| Memory Usage | ${(this.result.execution.memoryUsage / 1024 / 1024).toFixed(2)}MB |
| Retries | ${this.result.execution.retries} |

## Category Results

${Object.values(this.result.testSuiteResult.categoryResults)
  .map(
    (cat) => `
### ${cat.categoryName} - ${cat.grade} (${cat.score.toFixed(1)}/100)

- **Tests:** ${cat.passedTests}/${cat.totalTests} passed
- **Duration:** ${cat.duration.toFixed(2)}ms
- **Memory:** ${(cat.memoryUsage / 1024 / 1024).toFixed(2)}MB
${cat.warnings.length > 0 ? `- **Warnings:** ${cat.warnings.join(", ")}` : ""}
`,
  )
  .join("")}

## Environment

| Property | Value |
|----------|-------|
| Node.js Version | ${this.result.environment.nodeVersion} |
| Platform | ${this.result.environment.platform} |
| Architecture | ${this.result.environment.architecture} |
| CPU Cores | ${this.result.environment.cpuCount} |

## Recommendations

${this.result.testSuiteResult.recommendations.map((rec) => `- ${rec}`).join("\n")}

## Full Results

\`\`\`
${this.result.testSuiteResult.summary}
\`\`\`
`;

    writeFileSync(markdownPath, markdown);
  }

  /**
   * Generate console report
   */
  private generateConsoleReport(): string {
    if (!this.result) return "";

    return `TPEG Test Results
=================

Overall Grade: ${this.result.testSuiteResult.overallGrade} (${this.result.testSuiteResult.overallScore.toFixed(1)}/100)
Success Rate: ${((this.result.testSuiteResult.passedTests / this.result.testSuiteResult.totalTests) * 100).toFixed(1)}%
Duration: ${(this.result.execution.duration / 1000).toFixed(2)}s
Generated: ${new Date().toLocaleString()}

${this.result.testSuiteResult.summary}

Environment:
- Node.js: ${this.result.environment.nodeVersion}
- Platform: ${this.result.environment.platform} (${this.result.environment.architecture})
- CPU Cores: ${this.result.environment.cpuCount}
- Memory Usage: ${(this.result.execution.memoryUsage / 1024 / 1024).toFixed(2)}MB

Recommendations:
${this.result.testSuiteResult.recommendations.map((rec) => `- ${rec}`).join("\n")}
`;
  }
}

/**
 * CLI entry point
 */
export async function runTestRunner(
  args: string[] = process.argv.slice(2),
): Promise<number> {
  const config: TestRunnerConfig = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--verbose":
        config.verbose = true;
        break;
      case "--quiet":
        config.quiet = true;
        break;
      case "--stop-on-failure":
        config.stopOnFirstFailure = true;
        break;
      case "--exit-on-failure":
        config.exitOnFailure = true;
        break;
      case "--debug":
        config.debugMode = true;
        break;
      case "--no-report":
        config.generateReport = false;
        break;
      case "--timeout":
        config.timeout = Number.parseInt(args[++i] || "300000", 10);
        break;
      case "--memory-limit":
        config.memoryLimit = Number.parseInt(args[++i] || "1024", 10);
        break;
      case "--max-retries":
        config.maxRetries = Number.parseInt(args[++i] || "0", 10);
        break;
      case "--output-format": {
        const formatArg = args[++i];
        if (formatArg) {
          config.outputFormat = formatArg as
            | "console"
            | "json"
            | "html"
            | "markdown";
        }
        break;
      }
      case "--output-file": {
        const outputFileArg = args[++i];
        if (outputFileArg) {
          config.outputFile = outputFileArg;
        }
        break;
      }
      case "--report-path": {
        const reportPathArg = args[++i];
        if (reportPathArg) {
          config.reportPath = reportPathArg;
        }
        break;
      }
      case "--minimum-pass-rate":
        config.minimumPassRate = Number.parseFloat(args[++i] || "0.8");
        break;
      case "--minimum-grade": {
        const gradeArg = args[++i];
        if (gradeArg) {
          config.minimumGrade = gradeArg;
        }
        break;
      }
      case "--help":
        printHelp();
        return 0;
      default:
        if (arg?.startsWith("--")) {
          console.error(`Unknown option: ${arg}`);
          return 1;
        }
        break;
    }
  }

  const runner = new TestRunner(config);
  const result = await runner.run();

  return result.exitCode;
}

/**
 * Print help information
 */
function printHelp(): void {
  console.log(`
TPEG Test Runner

Usage: test-runner [options]

Options:
  --verbose                   Enable verbose output
  --quiet                     Suppress output except errors
  --stop-on-failure          Stop on first test failure
  --exit-on-failure          Exit with non-zero code on any failure
  --debug                    Enable debug mode
  --no-report                Skip report generation
  --timeout <ms>             Set timeout for test execution (default: 300000)
  --memory-limit <mb>        Set memory limit in MB (default: 1024)
  --max-retries <count>      Set maximum retry attempts (default: 0)
  --output-format <format>   Set output format: console, json, html, markdown (default: console)
  --output-file <path>       Write output to file
  --report-path <path>       Set report file path (default: ./test-results.json)
  --minimum-pass-rate <rate> Set minimum pass rate (default: 0.8)
  --minimum-grade <grade>    Set minimum grade: A, B, C, D, F (default: C)
  --help                     Show this help message

Examples:
  test-runner --verbose --report-path ./my-results.json
  test-runner --quiet --output-format html --output-file ./report.html
  test-runner --stop-on-failure --exit-on-failure --minimum-grade B
`);
}

// If run as main module
if (require.main === module) {
  runTestRunner()
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((error) => {
      console.error("Test runner failed:", error);
      process.exit(1);
    });
}
