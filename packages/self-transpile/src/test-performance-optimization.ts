/**
 * Performance Optimization Test Suite
 *
 * Tests the optimized self-transpilation system against the baseline
 * to measure performance improvements and validate optimization features.
 */

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  createOptimizedTranspiler,
  selfTranspileOptimized,
} from "./performance-optimization";
import { selfTranspile } from "./self-transpile";

interface PerformanceTestResult {
  testName: string;
  baselineTime: number;
  optimizedTime: number;
  improvement: number;
  baselineMemory: number;
  optimizedMemory: number;
  memoryReduction: number;
  baselineCodeLength: number;
  optimizedCodeLength: number;
  success: boolean;
}

async function testPerformanceOptimization() {
  console.log("🚀 Performance Optimization Test Suite");
  console.log("========================================");

  const overallStart = performance.now();
  const testResults: PerformanceTestResult[] = [];

  // Test 1: Basic Self-Definition Performance
  console.log("\n🔧 Test 1: Basic Self-Definition Performance");
  console.log("─".repeat(50));

  const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
  const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

  const basicResult = await compareBasicPerformance(
    "TPEG Self-Definition",
    grammarSource,
    {
      targetLanguage: "typescript",
      includeTypes: true,
      optimize: true,
      namePrefix: "test_",
      enableMemoization: true,
      includeMonitoring: false,
    },
  );

  testResults.push(basicResult);
  printTestResult(basicResult);

  // Test 2: Caching Performance
  console.log("\n🔧 Test 2: Caching Performance");
  console.log("─".repeat(50));

  const cachingResult = await testCachingPerformance(grammarSource);
  testResults.push(cachingResult);
  printTestResult(cachingResult);

  // Test 3: Memory Pooling Performance
  console.log("\n🔧 Test 3: Memory Pooling Performance");
  console.log("─".repeat(50));

  const memoryResult = await testMemoryPoolingPerformance(grammarSource);
  testResults.push(memoryResult);
  printTestResult(memoryResult);

  // Test 4: Parallel Processing Performance
  console.log("\n🔧 Test 4: Parallel Processing Performance");
  console.log("─".repeat(50));

  const largeGrammar = generateLargeGrammar(30); // 30 rules to trigger parallel processing
  const parallelResult = await testParallelProcessingPerformance(largeGrammar);
  testResults.push(parallelResult);
  printTestResult(parallelResult);

  // Test 5: Iteration Performance
  console.log("\n🔧 Test 5: Iteration Performance");
  console.log("─".repeat(50));

  const iterationResult = await testIterationPerformance(grammarSource);
  testResults.push(iterationResult);
  printTestResult(iterationResult);

  // Test 6: String Builder Optimization
  console.log("\n🔧 Test 6: String Builder Optimization");
  console.log("─".repeat(50));

  const stringBuilderResult = await testStringBuilderPerformance(grammarSource);
  testResults.push(stringBuilderResult);
  printTestResult(stringBuilderResult);

  // Test 7: Comprehensive Feature Test
  console.log("\n🔧 Test 7: All Optimizations Combined");
  console.log("─".repeat(50));

  const comprehensiveResult =
    await testComprehensiveOptimization(grammarSource);
  testResults.push(comprehensiveResult);
  printTestResult(comprehensiveResult);

  const totalTime = performance.now() - overallStart;

  // Performance Summary
  console.log("\n📊 Performance Optimization Summary");
  console.log("====================================");
  console.log(`⏱️  Total test time: ${totalTime.toFixed(2)}ms`);
  console.log(`🎯 Tests completed: ${testResults.length}`);

  const avgImprovement =
    testResults.reduce((sum, r) => sum + r.improvement, 0) / testResults.length;
  const avgMemoryReduction =
    testResults.reduce((sum, r) => sum + r.memoryReduction, 0) /
    testResults.length;
  const successRate =
    testResults.filter((r) => r.success).length / testResults.length;

  console.log(`📈 Average speed improvement: ${avgImprovement.toFixed(1)}%`);
  console.log(`💾 Average memory reduction: ${avgMemoryReduction.toFixed(1)}%`);
  console.log(`🔄 Success rate: ${(successRate * 100).toFixed(1)}%`);

  // Detailed results
  console.log("\n📋 Detailed Results:");
  testResults.forEach((result, index) => {
    console.log(`   ${index + 1}. ${result.testName}:`);
    console.log(`      Speed: ${result.improvement.toFixed(1)}% faster`);
    console.log(
      `      Memory: ${result.memoryReduction.toFixed(1)}% reduction`,
    );
    console.log(`      Status: ${result.success ? "✅ Success" : "❌ Failed"}`);
  });

  // Performance Grade
  const performanceGrade = calculateOptimizationGrade(
    avgImprovement,
    avgMemoryReduction,
    successRate,
  );
  console.log(
    `\n🏆 Optimization Grade: ${performanceGrade.grade} (${performanceGrade.score}/100)`,
  );
  console.log(`📋 Assessment: ${performanceGrade.assessment}`);

  // Recommendations
  console.log("\n💡 Performance Recommendations:");
  const recommendations = generatePerformanceRecommendations(testResults);
  recommendations.forEach((rec, i) => {
    console.log(`   ${i + 1}. ${rec}`);
  });

  return {
    testResults,
    avgImprovement,
    avgMemoryReduction,
    successRate,
    totalTime,
    performanceGrade,
  };
}

async function compareBasicPerformance(
  testName: string,
  grammarSource: string,
  config: any,
): Promise<PerformanceTestResult> {
  // Baseline test
  const baselineStart = performance.now();
  const baselineMemoryStart = process.memoryUsage().heapUsed;

  const baselineResult = await selfTranspile(grammarSource, config);

  const baselineTime = performance.now() - baselineStart;
  const baselineMemory = process.memoryUsage().heapUsed - baselineMemoryStart;

  // Optimized test
  const optimizedStart = performance.now();
  const optimizedMemoryStart = process.memoryUsage().heapUsed;

  const optimizedResult = await selfTranspileOptimized(grammarSource, config, {
    enableCaching: true,
    enableMemoryPooling: true,
    enableParallelProcessing: true,
    enableLazyEvaluation: true,
    enableStringBuilderOptimization: true,
  });

  const optimizedTime = performance.now() - optimizedStart;
  const optimizedMemory = process.memoryUsage().heapUsed - optimizedMemoryStart;

  const improvement =
    baselineTime > 0
      ? ((baselineTime - optimizedTime) / baselineTime) * 100
      : 0;
  const memoryReduction =
    baselineMemory > 0
      ? ((baselineMemory - optimizedMemory) / baselineMemory) * 100
      : 0;

  return {
    testName,
    baselineTime,
    optimizedTime,
    improvement,
    baselineMemory,
    optimizedMemory,
    memoryReduction,
    baselineCodeLength: baselineResult.code.length,
    optimizedCodeLength: optimizedResult.code.length,
    success: baselineResult.success && optimizedResult.success,
  };
}

async function testCachingPerformance(
  grammarSource: string,
): Promise<PerformanceTestResult> {
  const transpiler = createOptimizedTranspiler({
    enableCaching: true,
    enableMemoryPooling: false,
    enableParallelProcessing: false,
    enableLazyEvaluation: false,
    enableStringBuilderOptimization: false,
  });

  // First call (cache miss)
  const start1 = performance.now();
  const result1 = await transpiler.transpile(grammarSource, {
    namePrefix: "cache_test_",
  });
  const time1 = performance.now() - start1;

  // Second call (cache hit)
  const start2 = performance.now();
  const result2 = await transpiler.transpile(grammarSource, {
    namePrefix: "cache_test_",
  });
  const time2 = performance.now() - start2;

  const improvement = time1 > 0 ? ((time1 - time2) / time1) * 100 : 0;

  return {
    testName: "Caching Performance",
    baselineTime: time1,
    optimizedTime: time2,
    improvement,
    baselineMemory: 0,
    optimizedMemory: 0,
    memoryReduction: 0,
    baselineCodeLength: result1.code.length,
    optimizedCodeLength: result2.code.length,
    success: result1.success && result2.success,
  };
}

async function testMemoryPoolingPerformance(
  grammarSource: string,
): Promise<PerformanceTestResult> {
  // Without memory pooling
  const baselineStart = performance.now();
  const baselineMemoryStart = process.memoryUsage().heapUsed;

  const baselineResult = await selfTranspileOptimized(
    grammarSource,
    {},
    {
      enableCaching: false,
      enableMemoryPooling: false,
      enableParallelProcessing: false,
      enableLazyEvaluation: false,
      enableStringBuilderOptimization: false,
    },
  );

  const baselineTime = performance.now() - baselineStart;
  const baselineMemory = process.memoryUsage().heapUsed - baselineMemoryStart;

  // With memory pooling
  const optimizedStart = performance.now();
  const optimizedMemoryStart = process.memoryUsage().heapUsed;

  const optimizedResult = await selfTranspileOptimized(
    grammarSource,
    {},
    {
      enableCaching: false,
      enableMemoryPooling: true,
      enableParallelProcessing: false,
      enableLazyEvaluation: false,
      enableStringBuilderOptimization: false,
    },
  );

  const optimizedTime = performance.now() - optimizedStart;
  const optimizedMemory = process.memoryUsage().heapUsed - optimizedMemoryStart;

  const improvement =
    baselineTime > 0
      ? ((baselineTime - optimizedTime) / baselineTime) * 100
      : 0;
  const memoryReduction =
    baselineMemory > 0
      ? ((baselineMemory - optimizedMemory) / baselineMemory) * 100
      : 0;

  return {
    testName: "Memory Pooling Performance",
    baselineTime,
    optimizedTime,
    improvement,
    baselineMemory,
    optimizedMemory,
    memoryReduction,
    baselineCodeLength: baselineResult.code.length,
    optimizedCodeLength: optimizedResult.code.length,
    success: baselineResult.success && optimizedResult.success,
  };
}

async function testParallelProcessingPerformance(
  grammarSource: string,
): Promise<PerformanceTestResult> {
  // Sequential processing
  const baselineStart = performance.now();
  const baselineResult = await selfTranspileOptimized(
    grammarSource,
    {},
    {
      enableCaching: false,
      enableMemoryPooling: false,
      enableParallelProcessing: false,
      enableLazyEvaluation: false,
      enableStringBuilderOptimization: false,
    },
  );
  const baselineTime = performance.now() - baselineStart;

  // Parallel processing
  const optimizedStart = performance.now();
  const optimizedResult = await selfTranspileOptimized(
    grammarSource,
    {},
    {
      enableCaching: false,
      enableMemoryPooling: false,
      enableParallelProcessing: true,
      enableLazyEvaluation: false,
      enableStringBuilderOptimization: false,
      parallelThreshold: 5, // Lower threshold for testing
    },
  );
  const optimizedTime = performance.now() - optimizedStart;

  const improvement =
    baselineTime > 0
      ? ((baselineTime - optimizedTime) / baselineTime) * 100
      : 0;

  return {
    testName: "Parallel Processing Performance",
    baselineTime,
    optimizedTime,
    improvement,
    baselineMemory: 0,
    optimizedMemory: 0,
    memoryReduction: 0,
    baselineCodeLength: baselineResult.code.length,
    optimizedCodeLength: optimizedResult.code.length,
    success: baselineResult.success && optimizedResult.success,
  };
}

async function testIterationPerformance(
  grammarSource: string,
): Promise<PerformanceTestResult> {
  const iterations = 10;

  // Baseline iterations
  const baselineStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await selfTranspile(grammarSource, { namePrefix: `baseline_iter_${i}_` });
  }
  const baselineTime = performance.now() - baselineStart;

  // Optimized iterations
  const optimizedStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await selfTranspileOptimized(
      grammarSource,
      { namePrefix: `optimized_iter_${i}_` },
      {
        enableCaching: true,
        enableMemoryPooling: true,
        enableParallelProcessing: true,
        enableLazyEvaluation: true,
        enableStringBuilderOptimization: true,
      },
    );
  }
  const optimizedTime = performance.now() - optimizedStart;

  const improvement =
    baselineTime > 0
      ? ((baselineTime - optimizedTime) / baselineTime) * 100
      : 0;

  return {
    testName: "Iteration Performance",
    baselineTime,
    optimizedTime,
    improvement,
    baselineMemory: 0,
    optimizedMemory: 0,
    memoryReduction: 0,
    baselineCodeLength: 0,
    optimizedCodeLength: 0,
    success: true,
  };
}

async function testStringBuilderPerformance(
  grammarSource: string,
): Promise<PerformanceTestResult> {
  // Without string builder optimization
  const baselineStart = performance.now();
  const baselineResult = await selfTranspileOptimized(
    grammarSource,
    {},
    {
      enableCaching: false,
      enableMemoryPooling: false,
      enableParallelProcessing: false,
      enableLazyEvaluation: false,
      enableStringBuilderOptimization: false,
    },
  );
  const baselineTime = performance.now() - baselineStart;

  // With string builder optimization
  const optimizedStart = performance.now();
  const optimizedResult = await selfTranspileOptimized(
    grammarSource,
    {},
    {
      enableCaching: false,
      enableMemoryPooling: false,
      enableParallelProcessing: false,
      enableLazyEvaluation: false,
      enableStringBuilderOptimization: true,
    },
  );
  const optimizedTime = performance.now() - optimizedStart;

  const improvement =
    baselineTime > 0
      ? ((baselineTime - optimizedTime) / baselineTime) * 100
      : 0;

  return {
    testName: "String Builder Performance",
    baselineTime,
    optimizedTime,
    improvement,
    baselineMemory: 0,
    optimizedMemory: 0,
    memoryReduction: 0,
    baselineCodeLength: baselineResult.code.length,
    optimizedCodeLength: optimizedResult.code.length,
    success: baselineResult.success && optimizedResult.success,
  };
}

async function testComprehensiveOptimization(
  grammarSource: string,
): Promise<PerformanceTestResult> {
  // Baseline (no optimizations)
  const baselineStart = performance.now();
  const baselineMemoryStart = process.memoryUsage().heapUsed;

  const baselineResult = await selfTranspile(grammarSource, {
    targetLanguage: "typescript",
    includeTypes: true,
    optimize: false,
    namePrefix: "baseline_",
    enableMemoization: false,
    includeMonitoring: false,
  });

  const baselineTime = performance.now() - baselineStart;
  const baselineMemory = process.memoryUsage().heapUsed - baselineMemoryStart;

  // Comprehensive optimization
  const optimizedStart = performance.now();
  const optimizedMemoryStart = process.memoryUsage().heapUsed;

  const optimizedResult = await selfTranspileOptimized(
    grammarSource,
    {
      targetLanguage: "typescript",
      includeTypes: true,
      optimize: true,
      namePrefix: "optimized_",
      enableMemoization: true,
      includeMonitoring: false,
    },
    {
      enableCaching: true,
      enableMemoryPooling: true,
      enableParallelProcessing: true,
      enableLazyEvaluation: true,
      enableStringBuilderOptimization: true,
      cacheSize: 100,
      memoryPoolSize: 50,
      parallelThreshold: 10,
    },
  );

  const optimizedTime = performance.now() - optimizedStart;
  const optimizedMemory = process.memoryUsage().heapUsed - optimizedMemoryStart;

  const improvement =
    baselineTime > 0
      ? ((baselineTime - optimizedTime) / baselineTime) * 100
      : 0;
  const memoryReduction =
    baselineMemory > 0
      ? ((baselineMemory - optimizedMemory) / baselineMemory) * 100
      : 0;

  return {
    testName: "Comprehensive Optimization",
    baselineTime,
    optimizedTime,
    improvement,
    baselineMemory,
    optimizedMemory,
    memoryReduction,
    baselineCodeLength: baselineResult.code.length,
    optimizedCodeLength: optimizedResult.code.length,
    success: baselineResult.success && optimizedResult.success,
  };
}

function generateLargeGrammar(ruleCount: number): string {
  const rules = [];
  rules.push("grammar LargeGrammar {");

  for (let i = 0; i < ruleCount; i++) {
    const ruleName = `rule${i}`;
    const ruleBody = `"token${i}" [a-z${i % 10}]* ("," "token${i + 1}")?`;
    rules.push(`  ${ruleName} = ${ruleBody}`);
  }

  rules.push("}");
  return rules.join("\n");
}

function printTestResult(result: PerformanceTestResult): void {
  console.log(`📊 ${result.testName} Results:`);
  console.log(`   ⏱️  Baseline: ${result.baselineTime.toFixed(2)}ms`);
  console.log(`   ⚡ Optimized: ${result.optimizedTime.toFixed(2)}ms`);
  console.log(`   📈 Improvement: ${result.improvement.toFixed(1)}%`);

  if (result.baselineMemory > 0) {
    console.log(
      `   💾 Memory reduction: ${result.memoryReduction.toFixed(1)}%`,
    );
  }

  console.log(`   🔄 Success: ${result.success ? "Yes" : "No"}`);
}

function calculateOptimizationGrade(
  avgImprovement: number,
  avgMemoryReduction: number,
  successRate: number,
): { grade: string; score: number; assessment: string } {
  let score = 0;

  // Speed improvement scoring (40% of total)
  if (avgImprovement >= 50) score += 40;
  else if (avgImprovement >= 30) score += 32;
  else if (avgImprovement >= 20) score += 24;
  else if (avgImprovement >= 10) score += 16;
  else if (avgImprovement >= 5) score += 8;

  // Memory reduction scoring (30% of total)
  if (avgMemoryReduction >= 30) score += 30;
  else if (avgMemoryReduction >= 20) score += 24;
  else if (avgMemoryReduction >= 10) score += 18;
  else if (avgMemoryReduction >= 5) score += 12;
  else if (avgMemoryReduction >= 0) score += 6;

  // Success rate scoring (30% of total)
  score += successRate * 30;

  let grade;
  let assessment;

  if (score >= 90) {
    grade = "A+";
    assessment = "Exceptional optimization performance";
  } else if (score >= 80) {
    grade = "A";
    assessment = "Excellent optimization performance";
  } else if (score >= 70) {
    grade = "B";
    assessment = "Good optimization performance";
  } else if (score >= 60) {
    grade = "C";
    assessment = "Average optimization performance";
  } else {
    grade = "D";
    assessment = "Poor optimization performance";
  }

  return { grade, score, assessment };
}

function generatePerformanceRecommendations(
  results: PerformanceTestResult[],
): string[] {
  const recommendations = [];

  const avgImprovement =
    results.reduce((sum, r) => sum + r.improvement, 0) / results.length;
  const avgMemoryReduction =
    results.reduce((sum, r) => sum + r.memoryReduction, 0) / results.length;

  if (avgImprovement < 20) {
    recommendations.push(
      "Consider implementing more aggressive caching strategies",
    );
    recommendations.push("Investigate code generation bottlenecks");
  }

  if (avgMemoryReduction < 10) {
    recommendations.push("Optimize memory pooling parameters");
    recommendations.push("Implement garbage collection hints");
  }

  const failedTests = results.filter((r) => !r.success);
  if (failedTests.length > 0) {
    recommendations.push(
      `Fix optimization failures in: ${failedTests.map((t) => t.testName).join(", ")}`,
    );
  }

  if (avgImprovement >= 30) {
    recommendations.push(
      "Consider implementing these optimizations in production",
    );
  }

  return recommendations;
}

// Run the optimization test
testPerformanceOptimization()
  .then((result) => {
    console.log("\n🏁 Performance optimization test completed!");
    console.log(`📊 Overall improvement: ${result.avgImprovement.toFixed(1)}%`);
    console.log(`🏆 Grade: ${result.performanceGrade.grade}`);
  })
  .catch((error) => {
    console.error("💥 Performance optimization test failed:", error);
  });
