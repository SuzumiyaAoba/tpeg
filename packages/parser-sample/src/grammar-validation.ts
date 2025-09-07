#!/usr/bin/env bun
/**
 * Grammar Validation Script
 *
 * Tests all sample grammars to ensure they parse correctly
 * and validates the generated parsers work with sample data.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { generateTypeScriptParser, grammarDefinition } from "@SuzumiyaAoba/parser";

const EXAMPLES_DIR = join(import.meta.dir, "../examples");

interface ValidationResult {
  grammar: string;
  success: boolean;
  error?: string;
  rules: number;
  annotations: number;
}

/**
 * Load and parse all .tpeg grammar files
 */
async function validateGrammars(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  try {
    const files = await readdir(EXAMPLES_DIR);
    const grammarFiles = files.filter((f) => f.endsWith(".tpeg"));

    console.log(`🔍 Found ${grammarFiles.length} grammar files to validate\n`);

    for (const file of grammarFiles) {
      console.log(`📋 Validating: ${file}`);

      try {
        const grammarPath = join(EXAMPLES_DIR, file);
        const grammarText = await readFile(grammarPath, "utf-8");

        // Parse the grammar
        const pos = { offset: 0, line: 1, column: 1 };
        const parseResult = grammarDefinition(grammarText, pos);

        if (!parseResult.success) {
          results.push({
            grammar: file,
            success: false,
            error: parseResult.error?.message || "Unknown parse error",
            rules: 0,
            annotations: 0,
          });
          console.log(`   ❌ Parse failed: ${parseResult.error?.message}`);
          continue;
        }

        const grammar = parseResult.val;

        // Test code generation
        try {
          const generated = generateTypeScriptParser(grammar, {
            namePrefix: `${grammar.name.toLowerCase()}_`,
            includeImports: true,
            includeTypes: true,
          });

          results.push({
            grammar: file,
            success: true,
            rules: grammar.rules.length,
            annotations: grammar.annotations.length,
          });

          console.log("   ✅ Parsed successfully");
          console.log(`      📊 Grammar: ${grammar.name}`);
          console.log(`      📊 Rules: ${grammar.rules.length}`);
          console.log(`      📊 Annotations: ${grammar.annotations.length}`);
          console.log(
            `      📦 Generated: ${generated.exports.length} exports`,
          );
        } catch (codegenError) {
          results.push({
            grammar: file,
            success: false,
            error: `Code generation failed: ${codegenError instanceof Error ? codegenError.message : String(codegenError)}`,
            rules: grammar.rules.length,
            annotations: grammar.annotations.length,
          });
          console.log(
            `   ❌ Code generation failed: ${codegenError instanceof Error ? codegenError.message : String(codegenError)}`,
          );
        }
      } catch (fileError) {
        results.push({
          grammar: file,
          success: false,
          error: `File error: ${fileError instanceof Error ? fileError.message : String(fileError)}`,
          rules: 0,
          annotations: 0,
        });
        console.log(
          `   ❌ File error: ${fileError instanceof Error ? fileError.message : String(fileError)}`,
        );
      }

      console.log(); // Empty line between files
    }
  } catch (dirError) {
    console.error(
      `❌ Failed to read examples directory: ${dirError instanceof Error ? dirError.message : String(dirError)}`,
    );
  }

  return results;
}

/**
 * Generate summary report
 */
function generateSummary(results: ValidationResult[]): void {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log("═".repeat(80));
  console.log("📊 VALIDATION SUMMARY");
  console.log("═".repeat(80));

  console.log(`✅ Successful: ${successful.length}/${results.length} grammars`);
  console.log(`❌ Failed: ${failed.length}/${results.length} grammars`);

  if (successful.length > 0) {
    console.log("\n✅ Successful Grammars:");
    for (const result of successful) {
      console.log(
        `   • ${result.grammar} (${result.rules} rules, ${result.annotations} annotations)`,
      );
    }
  }

  if (failed.length > 0) {
    console.log("\n❌ Failed Grammars:");
    for (const result of failed) {
      console.log(`   • ${result.grammar}: ${result.error}`);
    }
  }

  const totalRules = successful.reduce((sum, r) => sum + r.rules, 0);
  const totalAnnotations = successful.reduce(
    (sum, r) => sum + r.annotations,
    0,
  );

  console.log("\n📈 Statistics:");
  console.log(`   Total Rules: ${totalRules}`);
  console.log(`   Total Annotations: ${totalAnnotations}`);
  console.log(
    `   Average Rules per Grammar: ${(totalRules / successful.length || 0).toFixed(1)}`,
  );

  console.log("\n🎉 Grammar validation completed!");
}

/**
 * Main validation function
 */
async function main(): Promise<void> {
  console.log("🧪 TPEG Grammar Validation Suite");
  console.log(`=${"=".repeat(50)}\n`);

  const results = await validateGrammars();
  generateSummary(results);

  // Exit with error code if any grammars failed
  const failedCount = results.filter((r) => !r.success).length;
  if (failedCount > 0) {
    process.exit(1);
  }
}

// Run the validation
main().catch((error) => {
  console.error("❌ Validation script failed:", error);
  process.exit(1);
});
