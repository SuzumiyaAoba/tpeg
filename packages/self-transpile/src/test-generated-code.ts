/**
 * Test script for analyzing generated TPEG parser code
 *
 * Analyzes the complete generated TypeScript parser code
 * to verify correctness and completeness.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { selfTranspile } from "./self-transpile";

async function testGeneratedCode() {
  console.log("📊 TPEG Generated Code Analysis");
  console.log("================================");

  try {
    // Read the TPEG self-definition file
    const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
    const grammarSource = readFileSync(selfDefinitionPath, "utf-8");

    console.log("🚀 Generating TypeScript parser code...");

    // Generate code with detailed options
    const result = await selfTranspile(grammarSource, {
      targetLanguage: "typescript",
      includeTypes: true,
      optimize: true,
      namePrefix: "self_",
      enableMemoization: true,
      includeMonitoring: false,
    });

    if (result.success) {
      console.log("✅ Code generation successful!");
      console.log(`📏 Generated code length: ${result.code.length} characters`);
      console.log(
        `⏱️  Generation time: ${result.performance.generationTime.toFixed(2)}ms`,
      );
      console.log(`🧠 Complexity: ${result.performance.complexity}`);

      // Analyze generated code structure
      const lines = result.code.split("\n");
      console.log(`📄 Total lines: ${lines.length}`);

      // Count different types of generated elements
      const imports = lines.filter((line) => line.startsWith("import")).length;
      const exports = lines.filter((line) => line.startsWith("export")).length;
      const functions = lines.filter((line) =>
        line.includes("const self_"),
      ).length;
      const comments = lines.filter((line) =>
        line.trim().startsWith("//"),
      ).length;

      console.log("\n📈 Code Analysis:");
      console.log(`   📦 Import statements: ${imports}`);
      console.log(`   📤 Export statements: ${exports}`);
      console.log(`   🔧 Parser functions: ${functions}`);
      console.log(`   💬 Comment lines: ${comments}`);

      // Check for specific parser functions
      const expectedParsers = [
        "self_grammar",
        "self_rule_list",
        "self_rule_definition",
        "self_expression",
        "self_choice_expr",
        "self_sequence_expr",
        "self_primary_expr",
        "self_string_literal",
        "self_character_class",
        "self_identifier",
        "self_number",
      ];

      console.log("\n🔍 Expected Parser Functions:");
      for (const parser of expectedParsers) {
        const found = result.code.includes(parser);
        console.log(`   ${found ? "✅" : "❌"} ${parser}`);
      }

      // Check for memoization
      const hasMemoization = result.code.includes("memoize");
      console.log(
        `\n🧠 Memoization: ${hasMemoization ? "✅ Enabled" : "❌ Not found"}`,
      );

      // Check for recursion handling
      const hasRecursion = result.code.includes("recursion");
      console.log(
        `🔄 Recursion handling: ${hasRecursion ? "✅ Detected" : "❌ Not found"}`,
      );

      // Save generated code to file for inspection
      const outputPath = "./generated-self-parser.ts";
      writeFileSync(outputPath, result.code);
      console.log(`\n💾 Generated code saved to: ${outputPath}`);

      // Show code structure sections
      console.log("\n📋 Code Structure Preview:");
      console.log("─".repeat(60));
      console.log(`${result.code.substring(0, 1000)}\n...\n`);
      console.log("─".repeat(60));

      // Extract and show the end of the file
      const endSection = result.code.substring(
        Math.max(0, result.code.length - 500),
      );
      console.log(endSection);
      console.log("─".repeat(60));
    } else {
      console.log("❌ Code generation failed!");
      console.log(`🚨 Warnings: ${result.warnings.join(", ")}`);
    }
  } catch (error) {
    console.error("💥 Test failed with exception:", error);
  }
}

// Run the test
testGeneratedCode().catch(console.error);
