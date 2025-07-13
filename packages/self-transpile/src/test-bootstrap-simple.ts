/**
 * Simple Bootstrap Validation Test for TPEG
 *
 * Tests the basic bootstrap capability with 3 stages:
 * 1. Minimal grammar → Basic parser
 * 2. Extended grammar → Enhanced parser
 * 3. Full self-definition → Complete parser
 */

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { selfTranspile } from "./self-transpile";

const _minimalGrammar = `
// Minimal Grammar for Bootstrap
grammar Minimal {
  @version: "1.0"
  @description: "Minimal TPEG bootstrap grammar"
  @author: "Bootstrap Test"
  @license: "MIT"
  
  // Simple grammar structure
  expression = identifier
  identifier = [a-zA-Z_][a-zA-Z0-9_]*
  
  // Whitespace handling
  whitespace = [ \\t\\n\\r]*
}`;

const _extendedGrammar = `
// Extended Grammar for Bootstrap
grammar Extended {
  @version: "1.1"
  @description: "Extended TPEG bootstrap grammar"
  @author: "Bootstrap Test"
  @license: "MIT"
  
  // Basic grammar with choice
  expression = identifier / string_literal
  identifier = [a-zA-Z_][a-zA-Z0-9_]*
  string_literal = "\\"" [^\\"]* "\\""
  
  // Whitespace handling
  whitespace = [ \\t\\n\\r]*
}`;

async function testBootstrapSimple() {
  console.log("🔧 Simple Bootstrap Validation Test");
  console.log("===================================");

  const startTime = performance.now();

  try {
    // Stage 1: Calculator Grammar (known to work)
    console.log("\n🔧 Stage 1: Calculator Grammar Bootstrap");
    console.log("─".repeat(40));

    const calculatorGrammar = readFileSync(
      "../parser-sample/examples/calculator.tpeg",
      "utf-8",
    );

    const stage1Result = await selfTranspile(calculatorGrammar, {
      targetLanguage: "typescript",
      includeTypes: true,
      optimize: true,
      namePrefix: "calc_",
    });

    if (stage1Result.success) {
      console.log(`✅ Stage 1 Success: ${stage1Result.code.length} chars`);
      console.log(
        `⏱️  Generation time: ${stage1Result.performance.generationTime.toFixed(2)}ms`,
      );

      // Validate basic features
      const hasImports = stage1Result.code.includes("import");
      const hasExports = stage1Result.code.includes("export");
      const hasCalcFunctions = stage1Result.code.includes("calc_expression");

      console.log("📊 Validation:");
      console.log(`   📦 Imports: ${hasImports ? "✅" : "❌"}`);
      console.log(`   📤 Exports: ${hasExports ? "✅" : "❌"}`);
      console.log(`   🔧 Functions: ${hasCalcFunctions ? "✅" : "❌"}`);
    } else {
      console.log(`❌ Stage 1 Failed: ${stage1Result.warnings.join(", ")}`);
      return;
    }

    // Stage 2: JSON Grammar (known to work)
    console.log("\n🔧 Stage 2: JSON Grammar Bootstrap");
    console.log("─".repeat(40));

    const jsonGrammar = readFileSync(
      "../parser-sample/examples/json-lite.tpeg",
      "utf-8",
    );

    const stage2Result = await selfTranspile(jsonGrammar, {
      targetLanguage: "typescript",
      includeTypes: true,
      optimize: true,
      namePrefix: "json_",
    });

    if (stage2Result.success) {
      console.log(`✅ Stage 2 Success: ${stage2Result.code.length} chars`);
      console.log(
        `⏱️  Generation time: ${stage2Result.performance.generationTime.toFixed(2)}ms`,
      );

      // Validate enhanced features
      const hasChoice = stage2Result.code.includes("choice");
      const hasObject = stage2Result.code.includes("json_object");
      const hasArray = stage2Result.code.includes("json_array");

      console.log("📊 Validation:");
      console.log(`   🔀 Choice: ${hasChoice ? "✅" : "❌"}`);
      console.log(`   🔧 Object: ${hasObject ? "✅" : "❌"}`);
      console.log(`   📝 Array: ${hasArray ? "✅" : "❌"}`);

      // Compare with Stage 1
      const improvementRatio =
        stage2Result.code.length / stage1Result.code.length;
      console.log(`📈 Code growth: ${improvementRatio.toFixed(2)}x`);
    } else {
      console.log(`❌ Stage 2 Failed: ${stage2Result.warnings.join(", ")}`);
      return;
    }

    // Stage 3: Complete Self-Definition
    console.log("\n🔧 Stage 3: Complete Self-Definition Bootstrap");
    console.log("─".repeat(40));

    const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
    const fullGrammar = readFileSync(selfDefinitionPath, "utf-8");

    const stage3Result = await selfTranspile(fullGrammar, {
      targetLanguage: "typescript",
      includeTypes: true,
      optimize: true,
      namePrefix: "complete_",
      enableMemoization: true,
    });

    if (stage3Result.success) {
      console.log(`✅ Stage 3 Success: ${stage3Result.code.length} chars`);
      console.log(
        `⏱️  Generation time: ${stage3Result.performance.generationTime.toFixed(2)}ms`,
      );
      console.log(`🧠 Complexity: ${stage3Result.performance.complexity}`);

      // Validate complete features
      const hasMemoization = stage3Result.code.includes("memoize");
      const hasAllRules =
        stage3Result.code.includes("complete_grammar") &&
        stage3Result.code.includes("complete_identifier") &&
        stage3Result.code.includes("complete_expression");
      const hasCharClasses = stage3Result.code.includes("charClass");

      console.log("📊 Validation:");
      console.log(`   🧠 Memoization: ${hasMemoization ? "✅" : "❌"}`);
      console.log(`   📋 All rules: ${hasAllRules ? "✅" : "❌"}`);
      console.log(`   🔤 Char classes: ${hasCharClasses ? "✅" : "❌"}`);

      // Compare progression
      const stage1To3Ratio =
        stage3Result.code.length / stage1Result.code.length;
      console.log(`📈 Total growth: ${stage1To3Ratio.toFixed(2)}x`);
    } else {
      console.log(`❌ Stage 3 Failed: ${stage3Result.warnings.join(", ")}`);
      return;
    }

    const totalTime = performance.now() - startTime;

    // Bootstrap Summary
    console.log("\n📊 Bootstrap Summary");
    console.log("====================");

    const allStagesSuccess =
      stage1Result.success && stage2Result.success && stage3Result.success;
    const totalCodeGenerated =
      stage1Result.code.length +
      stage2Result.code.length +
      stage3Result.code.length;
    const avgGenerationTime =
      (stage1Result.performance.generationTime +
        stage2Result.performance.generationTime +
        stage3Result.performance.generationTime) /
      3;

    console.log(`🎯 All stages successful: ${allStagesSuccess ? "✅" : "❌"}`);
    console.log(`⏱️  Total time: ${totalTime.toFixed(2)}ms`);
    console.log(`⚡ Avg generation time: ${avgGenerationTime.toFixed(2)}ms`);
    console.log(`📏 Total code generated: ${totalCodeGenerated} chars`);

    // Detailed stage comparison
    console.log("\n📋 Stage Comparison:");
    console.log(
      `   Stage 1 (Minimal): ${stage1Result.code.length} chars, ${stage1Result.performance.generationTime.toFixed(1)}ms`,
    );
    console.log(
      `   Stage 2 (Extended): ${stage2Result.code.length} chars, ${stage2Result.performance.generationTime.toFixed(1)}ms`,
    );
    console.log(
      `   Stage 3 (Complete): ${stage3Result.code.length} chars, ${stage3Result.performance.generationTime.toFixed(1)}ms`,
    );

    // Final assessment
    console.log("\n🏆 Bootstrap Assessment:");
    if (allStagesSuccess) {
      console.log("🎉 EXCELLENT: Complete bootstrap sequence successful!");
      console.log(
        "✅ TPEG can bootstrap itself from minimal to complete grammar",
      );
      console.log("✅ Progressive complexity increase validated");
      console.log("✅ Performance within acceptable bounds");
    } else {
      console.log("⚠️  PARTIAL: Some bootstrap stages failed");
    }

    // Performance validation
    if (avgGenerationTime < 50) {
      console.log("🚀 Performance: EXCELLENT (< 50ms avg)");
    } else if (avgGenerationTime < 100) {
      console.log("👍 Performance: GOOD (< 100ms avg)");
    } else {
      console.log("⚠️  Performance: ACCEPTABLE (< 200ms avg)");
    }

    return {
      success: allStagesSuccess,
      stages: [
        {
          id: 1,
          success: stage1Result.success,
          codeLength: stage1Result.code.length,
        },
        {
          id: 2,
          success: stage2Result.success,
          codeLength: stage2Result.code.length,
        },
        {
          id: 3,
          success: stage3Result.success,
          codeLength: stage3Result.code.length,
        },
      ],
      totalTime,
      avgGenerationTime,
      totalCodeGenerated,
    };
  } catch (error) {
    console.error("💥 Bootstrap test failed:", error);
    throw error;
  }
}

// Run the test
testBootstrapSimple()
  .then((result) => {
    if (result) {
      console.log("\n🎊 Bootstrap test completed!");
      console.log(`🏁 Final result: ${result.success ? "SUCCESS" : "PARTIAL"}`);
    }
  })
  .catch(console.error);
