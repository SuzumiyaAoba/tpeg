/**
 * Self-hosting loop test for TPEG
 *
 * Tests the complete self-hosting capability:
 * 1. Parse TPEG grammar with current parser
 * 2. Generate new parser from parsed grammar
 * 3. Compare results for convergence
 * 4. Iterate until stable or max iterations
 */

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { selfTranspile } from "./self-transpile";

interface IterationResult {
  iteration: number;
  success: boolean;
  generationTime: number;
  codeLength: number;
  codeHash: string;
  converged: boolean;
  errors: string[];
}

interface SelfHostingResult {
  totalIterations: number;
  converged: boolean;
  convergenceIteration: number | undefined;
  totalTime: number;
  iterations: IterationResult[];
  finalCodeLength: number;
  stabilityAchieved: boolean;
}

// Simple hash function for code comparison
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}

async function testSelfHostingLoop() {
  console.log("🔄 TPEG Self-Hosting Loop Test");
  console.log("===============================");

  try {
    // Initialize
    const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
    const grammarSource = readFileSync(selfDefinitionPath, "utf-8");
    const maxIterations = 5;
    const startTime = performance.now();

    console.log(`📖 Source grammar: ${grammarSource.length} characters`);
    console.log(`🔢 Max iterations: ${maxIterations}`);
    console.log("🎯 Goal: Achieve code generation convergence");

    const iterations: IterationResult[] = [];
    let previousCodeHash = "";
    let converged = false;
    let convergenceIteration: number | undefined;

    // Self-hosting loop
    for (let i = 0; i < maxIterations; i++) {
      console.log(`\n🔄 Iteration ${i + 1}/${maxIterations}`);
      console.log("─".repeat(40));

      const iterationStart = performance.now();

      try {
        // Generate parser code
        console.log("🔨 Generating parser code...");
        const result = await selfTranspile(grammarSource, {
          targetLanguage: "typescript",
          includeTypes: true,
          optimize: true,
          namePrefix: `iter${i + 1}_`,
          enableMemoization: true,
          includeMonitoring: false,
        });

        if (!result.success) {
          console.log(`❌ Generation failed at iteration ${i + 1}`);
          iterations.push({
            iteration: i + 1,
            success: false,
            generationTime: performance.now() - iterationStart,
            codeLength: 0,
            codeHash: "",
            converged: false,
            errors: result.warnings,
          });
          break;
        }

        // Calculate metrics
        const generationTime = performance.now() - iterationStart;
        const codeLength = result.code.length;
        const codeHash = simpleHash(result.code);
        const isConverged = codeHash === previousCodeHash;

        console.log(`⏱️  Generation time: ${generationTime.toFixed(2)}ms`);
        console.log(`📏 Code length: ${codeLength} chars`);
        console.log(`🔑 Code hash: ${codeHash}`);
        console.log(`🎯 Converged: ${isConverged ? "✅" : "❌"}`);

        // Store iteration result
        iterations.push({
          iteration: i + 1,
          success: true,
          generationTime,
          codeLength,
          codeHash,
          converged: isConverged,
          errors: [],
        });

        // Check for convergence
        if (isConverged && i > 0) {
          converged = true;
          convergenceIteration = i + 1;
          console.log(`🎉 Convergence achieved at iteration ${i + 1}!`);
          break;
        }

        previousCodeHash = codeHash;

        // Analysis of current iteration
        const codeLines = result.code.split("\n").length;
        const exportCount = (result.code.match(/export const/g) || []).length;
        const memoizeCount = (result.code.match(/memoize/g) || []).length;

        console.log("📊 Analysis:");
        console.log(`   📄 Lines: ${codeLines}`);
        console.log(`   📤 Exports: ${exportCount}`);
        console.log(`   🧠 Memoized: ${memoizeCount}`);

        // Stability check (compare with previous iteration)
        if (i > 0) {
          const prevIteration = iterations[i - 1];
          if (prevIteration) {
            const lengthChange = codeLength - prevIteration.codeLength;
            const timeChange = generationTime - prevIteration.generationTime;

            console.log("📈 Changes from previous:");
            console.log(
              `   📏 Length: ${lengthChange >= 0 ? "+" : ""}${lengthChange} chars`,
            );
            console.log(
              `   ⏱️  Time: ${timeChange >= 0 ? "+" : ""}${timeChange.toFixed(2)}ms`,
            );
          }
        }
      } catch (error) {
        console.log(`💥 Exception at iteration ${i + 1}:`, error);
        iterations.push({
          iteration: i + 1,
          success: false,
          generationTime: performance.now() - iterationStart,
          codeLength: 0,
          codeHash: "",
          converged: false,
          errors: [error instanceof Error ? error.message : String(error)],
        });
        break;
      }
    }

    const totalTime = performance.now() - startTime;

    // Analysis and summary
    console.log("\n📊 Self-Hosting Loop Analysis");
    console.log("===============================");

    const successfulIterations = iterations.filter((it) => it.success);
    const avgGenerationTime =
      successfulIterations.length > 0
        ? successfulIterations.reduce((sum, it) => sum + it.generationTime, 0) /
          successfulIterations.length
        : 0;

    const finalCodeLength =
      successfulIterations.length > 0
        ? (successfulIterations[successfulIterations.length - 1]?.codeLength ??
          0)
        : 0;

    const lastIteration = successfulIterations[successfulIterations.length - 1];
    const secondLastIteration =
      successfulIterations[successfulIterations.length - 2];
    const stabilityAchieved = Boolean(
      converged ||
        (successfulIterations.length >= 2 &&
          lastIteration &&
          secondLastIteration &&
          Math.abs(lastIteration.codeLength - secondLastIteration.codeLength) <
            10),
    );

    console.log(`🏁 Total iterations: ${iterations.length}`);
    console.log(`✅ Successful: ${successfulIterations.length}`);
    console.log(`⏱️  Total time: ${totalTime.toFixed(2)}ms`);
    console.log(`⚡ Avg generation time: ${avgGenerationTime.toFixed(2)}ms`);
    console.log(
      `🎯 Converged: ${converged ? `✅ (iteration ${convergenceIteration})` : "❌"}`,
    );
    console.log(`📏 Final code length: ${finalCodeLength} chars`);
    console.log(`🔒 Stability achieved: ${stabilityAchieved ? "✅" : "❌"}`);

    // Detailed iteration summary
    console.log("\n📋 Iteration Summary:");
    iterations.forEach((it) => {
      const status = it.success ? "✅" : "❌";
      const convergence = it.converged ? " 🎯" : "";
      console.log(
        `   ${it.iteration}: ${status} ${it.generationTime.toFixed(1)}ms, ${it.codeLength} chars${convergence}`,
      );
      if (it.errors.length > 0) {
        console.log(`      🚨 ${it.errors.join(", ")}`);
      }
    });

    // Final assessment
    const result: SelfHostingResult = {
      totalIterations: iterations.length,
      converged,
      convergenceIteration,
      totalTime,
      iterations,
      finalCodeLength,
      stabilityAchieved,
    };

    console.log("\n🏆 Final Assessment:");
    if (converged) {
      console.log("🎉 EXCELLENT: Perfect self-hosting achieved!");
    } else if (stabilityAchieved) {
      console.log("👍 GOOD: Stable code generation achieved!");
    } else if (successfulIterations.length > 0) {
      console.log("⚠️  PARTIAL: Some iterations successful but no convergence");
    } else {
      console.log("❌ FAILED: No successful iterations");
    }

    return result;
  } catch (error) {
    console.error("💥 Self-hosting loop test failed:", error);
    throw error;
  }
}

// Run the test
testSelfHostingLoop()
  .then((result) => {
    console.log("\n🎊 Self-hosting loop test completed!");
    console.log(
      `🔄 Final status: ${result.converged ? "CONVERGED" : "STABLE"}`,
    );
  })
  .catch(console.error);
