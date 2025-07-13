/**
 * Performance Benchmark System for TPEG Self-Transpilation
 * 
 * Comprehensive performance analysis and optimization testing
 * to identify bottlenecks and measure improvement opportunities.
 */

import { readFileSync, writeFileSync } from "fs";
import { selfTranspile } from "./self-transpile";
import { performance } from "perf_hooks";

interface BenchmarkResult {
  testName: string;
  inputSize: number;
  executionTime: number;
  memoryUsage: number;
  codeLength: number;
  complexity: "low" | "medium" | "high";
  throughput: number; // chars per second
  success: boolean;
  warnings: number;
}

interface PerformanceMetrics {
  totalTests: number;
  successfulTests: number;
  averageTime: number;
  totalTime: number;
  memoryEfficiency: number;
  codeGenerationRate: number;
  bottlenecks: string[];
}

async function runPerformanceBenchmark() {
  console.log("🚀 TPEG Performance Benchmark System");
  console.log("======================================");
  
  const overallStart = performance.now();
  const results: BenchmarkResult[] = [];
  
  // Test 1: Basic Performance Baseline
  console.log("\n🔧 Test 1: Basic Performance Baseline");
  console.log("─".repeat(50));
  
  const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
  const baselineGrammar = readFileSync(selfDefinitionPath, "utf-8");
  
  const baselineResult = await benchmarkSingleTest(
    "Baseline TPEG Self-Definition",
    baselineGrammar,
    {
      targetLanguage: "typescript",
      includeTypes: true,
      optimize: false, // Baseline without optimization
      namePrefix: "baseline_",
      enableMemoization: false,
      includeMonitoring: false
    }
  );
  
  results.push(baselineResult);
  console.log(`📊 Baseline Result: ${baselineResult.executionTime.toFixed(2)}ms, ${baselineResult.throughput.toFixed(0)} chars/sec`);
  
  // Test 2: Optimized Performance
  console.log("\n🔧 Test 2: Optimized Performance");
  console.log("─".repeat(50));
  
  const optimizedResult = await benchmarkSingleTest(
    "Optimized TPEG Self-Definition",
    baselineGrammar,
    {
      targetLanguage: "typescript",
      includeTypes: true,
      optimize: true, // Enable optimization
      namePrefix: "optimized_",
      enableMemoization: true,
      includeMonitoring: false
    }
  );
  
  results.push(optimizedResult);
  console.log(`📊 Optimized Result: ${optimizedResult.executionTime.toFixed(2)}ms, ${optimizedResult.throughput.toFixed(0)} chars/sec`);
  
  const optimizationGain = ((baselineResult.executionTime - optimizedResult.executionTime) / baselineResult.executionTime) * 100;
  console.log(`📈 Optimization gain: ${optimizationGain.toFixed(1)}% faster`);
  
  // Test 3: Scaling Performance
  console.log("\n🔧 Test 3: Scaling Performance Analysis");
  console.log("─".repeat(50));
  
  const scalingTests = [
    { name: "Small Grammar (5 rules)", ruleCount: 5 },
    { name: "Medium Grammar (20 rules)", ruleCount: 20 },
    { name: "Large Grammar (50 rules)", ruleCount: 50 },
    { name: "Extra Large Grammar (100 rules)", ruleCount: 100 }
  ];
  
  for (const test of scalingTests) {
    const scalingGrammar = generateScalingGrammar(test.ruleCount);
    const scalingResult = await benchmarkSingleTest(
      test.name,
      scalingGrammar,
      {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: true,
        namePrefix: `scale${test.ruleCount}_`,
        enableMemoization: true,
        includeMonitoring: false
      }
    );
    
    results.push(scalingResult);
    console.log(`📊 ${test.name}: ${scalingResult.executionTime.toFixed(2)}ms, ${scalingResult.throughput.toFixed(0)} chars/sec`);
  }
  
  // Test 4: Iteration Performance
  console.log("\n🔧 Test 4: Iteration Performance");
  console.log("─".repeat(50));
  
  const iterationResults = [];
  const iterations = 20;
  
  for (let i = 0; i < iterations; i++) {
    const iterationStart = performance.now();
    const memoryBefore = process.memoryUsage().heapUsed;
    
    const result = await selfTranspile(baselineGrammar, {
      targetLanguage: "typescript",
      includeTypes: true,
      optimize: true,
      namePrefix: `iter${i}_`,
      enableMemoization: true,
      includeMonitoring: false
    });
    
    const iterationTime = performance.now() - iterationStart;
    const memoryAfter = process.memoryUsage().heapUsed;
    
    iterationResults.push({
      iteration: i + 1,
      time: iterationTime,
      memoryDelta: memoryAfter - memoryBefore,
      success: result.success,
      codeLength: result.code.length
    });
  }
  
  const avgIterationTime = iterationResults.reduce((sum, r) => sum + r.time, 0) / iterations;
  const minIterationTime = Math.min(...iterationResults.map(r => r.time));
  const maxIterationTime = Math.max(...iterationResults.map(r => r.time));
  const timeVariance = maxIterationTime - minIterationTime;
  
  console.log(`📊 Iteration Performance:`);
  console.log(`   🎯 Iterations: ${iterations}`);
  console.log(`   ⏱️  Average time: ${avgIterationTime.toFixed(2)}ms`);
  console.log(`   ⚡ Min time: ${minIterationTime.toFixed(2)}ms`);
  console.log(`   🐌 Max time: ${maxIterationTime.toFixed(2)}ms`);
  console.log(`   📊 Variance: ${timeVariance.toFixed(2)}ms`);
  console.log(`   🔄 Success rate: ${iterationResults.filter(r => r.success).length}/${iterations}`);
  
  // Test 5: Memory Usage Analysis
  console.log("\n🔧 Test 5: Memory Usage Analysis");
  console.log("─".repeat(50));
  
  const memoryTests = [
    { name: "Memory Efficient", config: { optimize: true, enableMemoization: false } },
    { name: "Performance Optimized", config: { optimize: true, enableMemoization: true } },
    { name: "Full Features", config: { optimize: true, enableMemoization: true, includeMonitoring: true } }
  ];
  
  for (const test of memoryTests) {
    const memoryResult = await benchmarkMemoryUsage(test.name, baselineGrammar, test.config);
    console.log(`📊 ${test.name}: ${memoryResult.peakMemory.toFixed(0)} bytes peak, ${memoryResult.executionTime.toFixed(2)}ms`);
  }
  
  // Test 6: Concurrent Performance
  console.log("\n🔧 Test 6: Concurrent Performance");
  console.log("─".repeat(50));
  
  const concurrentStart = performance.now();
  const concurrentPromises = [];
  
  for (let i = 0; i < 5; i++) {
    const promise = selfTranspile(baselineGrammar, {
      targetLanguage: "typescript",
      includeTypes: true,
      optimize: true,
      namePrefix: `concurrent${i}_`,
      enableMemoization: true,
      includeMonitoring: false
    });
    concurrentPromises.push(promise);
  }
  
  const concurrentResults = await Promise.all(concurrentPromises);
  const concurrentTime = performance.now() - concurrentStart;
  
  const successfulConcurrent = concurrentResults.filter(r => r.success).length;
  console.log(`📊 Concurrent Performance:`);
  console.log(`   🎯 Concurrent tasks: 5`);
  console.log(`   ⏱️  Total time: ${concurrentTime.toFixed(2)}ms`);
  console.log(`   ⚡ Average per task: ${(concurrentTime / 5).toFixed(2)}ms`);
  console.log(`   🔄 Success rate: ${successfulConcurrent}/5`);
  
  // Analysis and Recommendations
  const totalTime = performance.now() - overallStart;
  const metrics = analyzePerformanceMetrics(results, iterationResults);
  
  console.log("\n📊 Performance Analysis Summary");
  console.log("================================");
  console.log(`⏱️  Total benchmark time: ${totalTime.toFixed(2)}ms`);
  console.log(`🎯 Tests completed: ${results.length}`);
  console.log(`📈 Average execution time: ${metrics.averageTime.toFixed(2)}ms`);
  console.log(`💾 Memory efficiency: ${metrics.memoryEfficiency.toFixed(2)}%`);
  console.log(`🚀 Code generation rate: ${metrics.codeGenerationRate.toFixed(0)} chars/sec`);
  
  // Bottleneck Analysis
  console.log("\n🔍 Bottleneck Analysis");
  console.log("======================");
  metrics.bottlenecks.forEach((bottleneck, i) => {
    console.log(`   ${i + 1}. ${bottleneck}`);
  });
  
  // Optimization Recommendations
  console.log("\n💡 Optimization Recommendations");
  console.log("===============================");
  
  const recommendations = generateOptimizationRecommendations(metrics, results);
  recommendations.forEach((rec, i) => {
    console.log(`   ${i + 1}. ${rec}`);
  });
  
  // Performance Grade
  const performanceGrade = calculatePerformanceGrade(metrics);
  console.log(`\n🏆 Performance Grade: ${performanceGrade.grade} (${performanceGrade.score}/100)`);
  console.log(`📋 Assessment: ${performanceGrade.assessment}`);
  
  return {
    metrics,
    results,
    iterationResults,
    totalTime,
    performanceGrade,
    recommendations
  };
}

async function benchmarkSingleTest(
  testName: string,
  grammarSource: string,
  config: any
): Promise<BenchmarkResult> {
  const memoryBefore = process.memoryUsage().heapUsed;
  const startTime = performance.now();
  
  try {
    const result = await selfTranspile(grammarSource, config);
    const endTime = performance.now();
    const memoryAfter = process.memoryUsage().heapUsed;
    
    return {
      testName,
      inputSize: grammarSource.length,
      executionTime: endTime - startTime,
      memoryUsage: memoryAfter - memoryBefore,
      codeLength: result.code.length,
      complexity: result.performance.complexity,
      throughput: result.code.length / ((endTime - startTime) / 1000),
      success: result.success,
      warnings: result.warnings.length
    };
  } catch (error) {
    const endTime = performance.now();
    const memoryAfter = process.memoryUsage().heapUsed;
    
    return {
      testName,
      inputSize: grammarSource.length,
      executionTime: endTime - startTime,
      memoryUsage: memoryAfter - memoryBefore,
      codeLength: 0,
      complexity: "low",
      throughput: 0,
      success: false,
      warnings: 1
    };
  }
}

async function benchmarkMemoryUsage(testName: string, grammarSource: string, config: any) {
  const memoryBefore = process.memoryUsage().heapUsed;
  let peakMemory = memoryBefore;
  
  const memoryInterval = setInterval(() => {
    const current = process.memoryUsage().heapUsed;
    if (current > peakMemory) {
      peakMemory = current;
    }
  }, 10);
  
  const startTime = performance.now();
  
  try {
    await selfTranspile(grammarSource, config);
  } finally {
    clearInterval(memoryInterval);
  }
  
  const endTime = performance.now();
  const memoryAfter = process.memoryUsage().heapUsed;
  
  return {
    testName,
    peakMemory: peakMemory - memoryBefore,
    finalMemory: memoryAfter - memoryBefore,
    executionTime: endTime - startTime
  };
}

function generateScalingGrammar(ruleCount: number): string {
  const rules = [];
  rules.push(`grammar ScalingTest${ruleCount} {`);
  
  for (let i = 0; i < ruleCount; i++) {
    if (i === 0) {
      rules.push(`  rule${i} = "start" rule${i + 1}? "end"`);
    } else if (i === ruleCount - 1) {
      rules.push(`  rule${i} = "final" [a-z${i % 10}]+ "done"`);
    } else {
      rules.push(`  rule${i} = "part${i}" rule${i + 1}? ("," rule${(i + 2) % ruleCount})?`);
    }
  }
  
  rules.push(`}`);
  return rules.join('\n');
}

function analyzePerformanceMetrics(
  results: BenchmarkResult[], 
  iterationResults: any[]
): PerformanceMetrics {
  const successfulTests = results.filter(r => r.success);
  const totalTime = results.reduce((sum, r) => sum + r.executionTime, 0);
  const averageTime = successfulTests.length > 0 ? totalTime / successfulTests.length : 0;
  const totalMemory = results.reduce((sum, r) => sum + r.memoryUsage, 0);
  const totalCodeGenerated = results.reduce((sum, r) => sum + r.codeLength, 0);
  
  const memoryEfficiency = totalMemory > 0 ? (totalCodeGenerated / totalMemory) * 100 : 0;
  const codeGenerationRate = totalTime > 0 ? totalCodeGenerated / (totalTime / 1000) : 0;
  
  // Identify bottlenecks
  const bottlenecks = [];
  
  if (averageTime > 50) {
    bottlenecks.push("High average execution time (>50ms)");
  }
  
  if (memoryEfficiency < 100) {
    bottlenecks.push("Low memory efficiency (<100 chars/byte)");
  }
  
  if (codeGenerationRate < 50000) {
    bottlenecks.push("Low code generation rate (<50k chars/sec)");
  }
  
  const iterationVariance = iterationResults.length > 0 ? 
    Math.max(...iterationResults.map(r => r.time)) - Math.min(...iterationResults.map(r => r.time)) : 0;
  
  if (iterationVariance > 20) {
    bottlenecks.push("High iteration time variance (>20ms)");
  }
  
  return {
    totalTests: results.length,
    successfulTests: successfulTests.length,
    averageTime,
    totalTime,
    memoryEfficiency,
    codeGenerationRate,
    bottlenecks
  };
}

function generateOptimizationRecommendations(
  metrics: PerformanceMetrics,
  results: BenchmarkResult[]
): string[] {
  const recommendations = [];
  
  if (metrics.averageTime > 30) {
    recommendations.push("Enable code generation caching for repeated operations");
    recommendations.push("Implement lazy evaluation for unused grammar rules");
  }
  
  if (metrics.memoryEfficiency < 200) {
    recommendations.push("Optimize memory usage with object pooling");
    recommendations.push("Implement garbage collection hints");
  }
  
  if (metrics.codeGenerationRate < 100000) {
    recommendations.push("Implement template pre-compilation");
    recommendations.push("Use string builders for code generation");
  }
  
  if (metrics.bottlenecks.length > 2) {
    recommendations.push("Profile code execution to identify hot paths");
    recommendations.push("Consider implementing JIT compilation");
  }
  
  const hasLargeGrammarSlowdown = results.some(r => r.inputSize > 1000 && r.executionTime > 100);
  if (hasLargeGrammarSlowdown) {
    recommendations.push("Implement grammar preprocessing for large inputs");
    recommendations.push("Add parallel processing for independent rules");
  }
  
  return recommendations;
}

function calculatePerformanceGrade(metrics: PerformanceMetrics): {
  grade: string;
  score: number;
  assessment: string;
} {
  let score = 100;
  
  // Deduct points for performance issues
  if (metrics.averageTime > 50) score -= 20;
  else if (metrics.averageTime > 30) score -= 10;
  
  if (metrics.memoryEfficiency < 100) score -= 15;
  else if (metrics.memoryEfficiency < 200) score -= 8;
  
  if (metrics.codeGenerationRate < 50000) score -= 15;
  else if (metrics.codeGenerationRate < 100000) score -= 8;
  
  score -= Math.min(metrics.bottlenecks.length * 5, 25);
  
  const successRate = metrics.successfulTests / metrics.totalTests;
  if (successRate < 0.9) score -= 20;
  else if (successRate < 0.95) score -= 10;
  
  let grade;
  let assessment;
  
  if (score >= 90) {
    grade = "A";
    assessment = "Excellent performance, production-ready";
  } else if (score >= 80) {
    grade = "B";
    assessment = "Good performance, minor optimizations recommended";
  } else if (score >= 70) {
    grade = "C";
    assessment = "Average performance, optimization needed";
  } else if (score >= 60) {
    grade = "D";
    assessment = "Below average performance, significant optimization required";
  } else {
    grade = "F";
    assessment = "Poor performance, major optimization required";
  }
  
  return { grade, score: Math.max(0, score), assessment };
}

// Run the benchmark
runPerformanceBenchmark()
  .then(result => {
    console.log("\n🏁 Performance benchmark completed successfully!");
    console.log("📊 Ready for optimization implementation");
  })
  .catch(error => {
    console.error("💥 Performance benchmark failed:", error);
  }); 