#!/usr/bin/env bun
/**
 * TPEG Performance Comparison Demo
 *
 * Demonstrates the performance improvements between the standard
 * and optimized code generation systems.
 */

import {
  analyzeGrammarPerformance,
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
  globalPerformanceMonitor,
  grammarDefinition,
} from "tpeg-parser";

console.log("🚀 TPEG Performance Comparison Demo\n");

// Sample grammar for testing
const testGrammar = `grammar PerformanceTest {
  @version: "1.0"
  @description: "Grammar for performance testing"
  @author: "TPEG Performance Demo"
  
  expression = term ("+" term / "-" term)*
  term = factor ("*" factor / "/" factor)*
  factor = number / "(" expression ")"
  number = [0-9]+
  identifier = [a-z]+
  string = '"' [a-z]* '"'
}`;

console.log("📝 Test Grammar:");
console.log(testGrammar);
console.log(`\n${"=".repeat(60)}\n`);

// Parse the grammar
console.log("🔍 Parsing Grammar...");
const pos = { offset: 0, line: 1, column: 1 };
const parseResult = grammarDefinition(testGrammar, pos);

if (!parseResult.success) {
  console.error("❌ Failed to parse grammar:", parseResult.error?.message);
  process.exit(1);
}

const grammar = parseResult.val;
console.log(`✅ Successfully parsed grammar: ${grammar.name}`);
console.log(`   📊 Rules: ${grammar.rules.length}`);
console.log(`   📋 Annotations: ${grammar.annotations.length}`);

// Analyze grammar performance characteristics
console.log("\n📊 Analyzing Grammar Performance...");
const analysis = analyzeGrammarPerformance(grammar);
console.log(`   🎯 Estimated Complexity: ${analysis.estimatedParseComplexity}`);
console.log(
  `   💡 Optimization Suggestions: ${analysis.optimizationSuggestions.length}`,
);

if (analysis.optimizationSuggestions.length > 0) {
  console.log("   📝 Suggestions:");
  for (const suggestion of analysis.optimizationSuggestions) {
    console.log(`      • ${suggestion}`);
  }
}

console.log(`\n${"=".repeat(60)}\n`);

// Performance comparison function
function benchmark(
  name: string,
  operation: () => void,
  iterations = 1000,
): {
  name: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  operationsPerSecond: number;
} {
  // Warm-up
  for (let i = 0; i < Math.min(10, iterations / 10); i++) {
    operation();
  }

  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    operation();
  }

  const endTime = performance.now();
  const totalTime = endTime - startTime;
  const averageTime = totalTime / iterations;
  const operationsPerSecond = 1000 / averageTime;

  return {
    name,
    iterations,
    totalTime,
    averageTime,
    operationsPerSecond,
  };
}

// Benchmark standard code generation
console.log("⚙️  Benchmarking Standard Code Generation...");
const standardBenchmark = benchmark(
  "Standard Code Generation",
  () => {
    generateTypeScriptParser(grammar, {
      namePrefix: "std_",
      includeImports: true,
      includeTypes: true,
    });
  },
  500,
);

console.log(
  `   📈 ${standardBenchmark.operationsPerSecond.toFixed(0)} operations/second`,
);
console.log(`   ⏱️  ${standardBenchmark.averageTime.toFixed(2)}ms average time`);

// Benchmark optimized code generation
console.log("\n⚡ Benchmarking Optimized Code Generation...");
const optimizedBenchmark = benchmark(
  "Optimized Code Generation",
  () => {
    generateOptimizedTypeScriptParser(grammar, {
      namePrefix: "opt_",
      includeImports: true,
      includeTypes: true,
      optimize: true,
      enableMemoization: true,
    });
  },
  500,
);

console.log(
  `   📈 ${optimizedBenchmark.operationsPerSecond.toFixed(0)} operations/second`,
);
console.log(
  `   ⏱️  ${optimizedBenchmark.averageTime.toFixed(2)}ms average time`,
);

// Calculate performance improvement
const speedup =
  optimizedBenchmark.operationsPerSecond /
  standardBenchmark.operationsPerSecond;
console.log(`\n🎉 Performance Improvement: ${speedup.toFixed(2)}x faster!`);

console.log(`\n${"=".repeat(60)}\n`);

// Compare generated code size and quality
console.log("📋 Comparing Generated Code Quality...");

const standardGenerated = generateTypeScriptParser(grammar, {
  namePrefix: "std_",
  includeImports: true,
  includeTypes: true,
});

const optimizedGenerated = generateOptimizedTypeScriptParser(grammar, {
  namePrefix: "opt_",
  includeImports: true,
  includeTypes: true,
  optimize: true,
  enableMemoization: true,
});

console.log("📊 Code Generation Comparison:");
console.log(
  `   Standard Code Size: ${standardGenerated.code.length} characters`,
);
console.log(
  `   Optimized Code Size: ${optimizedGenerated.code.length} characters`,
);
console.log(`   Standard Imports: ${standardGenerated.imports.length}`);
console.log(`   Optimized Imports: ${optimizedGenerated.imports.length}`);
console.log(`   Standard Exports: ${standardGenerated.exports.length}`);
console.log(`   Optimized Exports: ${optimizedGenerated.exports.length}`);

if (optimizedGenerated.performance) {
  console.log(
    `   Generation Time: ${optimizedGenerated.performance.generationTime.toFixed(2)}ms`,
  );
  console.log(
    `   Estimated Complexity: ${optimizedGenerated.performance.estimatedComplexity}`,
  );
  if (optimizedGenerated.performance.optimizationSuggestions.length > 0) {
    console.log("   📝 Code Optimizations Applied:");
    for (const suggestion of optimizedGenerated.performance.optimizationSuggestions.slice(
      0,
      3,
    )) {
      console.log(`      • ${suggestion}`);
    }
  }
}

console.log(`\n${"=".repeat(60)}\n`);

// Memory usage comparison
console.log("💾 Memory Usage Analysis...");

function measureMemory(operation: () => void, iterations = 100): number {
  if (global.gc) global.gc();

  const before = process.memoryUsage().heapUsed;

  for (let i = 0; i < iterations; i++) {
    operation();
  }

  const after = process.memoryUsage().heapUsed;
  return after - before;
}

const standardMemory = measureMemory(() => {
  generateTypeScriptParser(grammar, {
    namePrefix: "std_",
    includeImports: true,
    includeTypes: true,
  });
}, 50);

const optimizedMemory = measureMemory(() => {
  generateOptimizedTypeScriptParser(grammar, {
    namePrefix: "opt_",
    includeImports: true,
    includeTypes: true,
    optimize: true,
  });
}, 50);

console.log(
  `   Standard Memory Usage: ${(standardMemory / 1024).toFixed(2)} KB`,
);
console.log(
  `   Optimized Memory Usage: ${(optimizedMemory / 1024).toFixed(2)} KB`,
);

if (optimizedMemory < standardMemory) {
  const memorySaving =
    ((standardMemory - optimizedMemory) / standardMemory) * 100;
  console.log(`   💡 Memory Savings: ${memorySaving.toFixed(1)}%`);
} else if (optimizedMemory > standardMemory) {
  const memoryIncrease =
    ((optimizedMemory - standardMemory) / standardMemory) * 100;
  console.log(`   ⚠️  Memory Increase: ${memoryIncrease.toFixed(1)}%`);
}

// Performance monitoring report
console.log(`\n${"=".repeat(60)}\n`);
console.log("📊 Global Performance Monitoring Report:");
console.log(globalPerformanceMonitor.report());

console.log(`\n${"=".repeat(60)}\n`);

// Sample generated code comparison
console.log("🔧 Sample Generated Code (first rule only):");
console.log("\n📄 Standard Generation:");
console.log("─".repeat(40));
const standardLines = standardGenerated.code.split("\n");
const firstStandardRule = standardLines
  .find((line) => line.includes("export const std_"))
  ?.trim();
console.log(firstStandardRule || "No rule found");

console.log("\n📄 Optimized Generation:");
console.log("─".repeat(40));
const optimizedLines = optimizedGenerated.code.split("\n");
const firstOptimizedRule = optimizedLines
  .find((line) => line.includes("export const opt_"))
  ?.trim();
console.log(firstOptimizedRule || "No rule found");

console.log(`\n${"=".repeat(60)}\n`);

console.log("🎯 Performance Summary:");
console.log(`   ⚡ Speed Improvement: ${speedup.toFixed(2)}x faster`);
console.log(
  `   📈 Standard Performance: ${standardBenchmark.operationsPerSecond.toFixed(0)} ops/sec`,
);
console.log(
  `   🚀 Optimized Performance: ${optimizedBenchmark.operationsPerSecond.toFixed(0)} ops/sec`,
);

if (optimizedGenerated.performance.estimatedComplexity === "high") {
  console.log("   💡 This grammar benefits significantly from optimization!");
} else if (optimizedGenerated.performance.estimatedComplexity === "medium") {
  console.log("   ✅ This grammar shows moderate performance improvements");
} else {
  console.log(
    "   ℹ️  This grammar is simple - less optimization benefit expected",
  );
}

console.log("\n🎉 Performance comparison completed!");
console.log(
  "💡 Use optimized generation for production workloads with complex grammars.",
);
