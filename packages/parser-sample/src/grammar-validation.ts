#!/usr/bin/env bun
/**
 * Grammar Validation Script
 *
 * Parse each sample grammar and generate its TypeScript parser.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  generateTypeScriptParser,
  parseGrammarFile,
  toGrammarDefinition,
} from "@suzumiyaaoba/tpeg-parser";

const EXAMPLES_DIR = join(import.meta.dir, "../examples");

type ValidationResult =
  | { grammar: string; success: true; rules: number; annotations: number }
  | { grammar: string; success: false; error: string };

function failure(grammar: string, description: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return {
    grammar,
    success: false as const,
    error: `${description}: ${message}`,
  };
}

function validateSource(
  file: string,
  path: string,
  text: string,
): ValidationResult {
  const parsed = parseGrammarFile(path, text);
  if (!parsed.success) {
    return failure(
      file,
      `Parse failed at line ${parsed.line}, column ${parsed.column}`,
      parsed.error.message,
    );
  }
  const grammar = toGrammarDefinition(parsed.val.grammars[0]);
  try {
    const generated = generateTypeScriptParser(grammar, {
      namePrefix: `${grammar.name.toLowerCase()}_`,
      includeImports: true,
      includeTypes: true,
    });
    console.log("   ✅ Parsed successfully");
    console.log(`      📊 Grammar: ${grammar.name}`);
    console.log(`      📊 Rules: ${grammar.rules.length}`);
    console.log(`      📊 Annotations: ${grammar.annotations.length}`);
    console.log(`      📦 Generated: ${generated.exports.length} exports`);
    return {
      grammar: file,
      success: true,
      rules: grammar.rules.length,
      annotations: grammar.annotations.length,
    };
  } catch (error) {
    return failure(file, "Code generation failed", error);
  }
}

async function validateGrammars(): Promise<ValidationResult[]> {
  let files: string[];
  try {
    files = (await readdir(EXAMPLES_DIR))
      .filter((name) => name.endsWith(".tpeg"))
      .sort();
  } catch (error) {
    const result = failure(
      EXAMPLES_DIR,
      "Failed to read examples directory",
      error,
    );
    console.error(`❌ ${result.error}`);
    return [result];
  }

  console.log(`🔍 Found ${files.length} grammar files to validate\n`);
  const results: ValidationResult[] = [];
  for (const file of files) {
    console.log(`📋 Validating: ${file}`);
    const path = join(EXAMPLES_DIR, file);
    let result: ValidationResult;
    try {
      result = validateSource(file, path, await readFile(path, "utf8"));
    } catch (error) {
      result = failure(file, "File error", error);
    }
    if (!result.success) console.log(`   ❌ ${result.error}`);
    results.push(result);
    console.log();
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
  console.log("=".repeat(51) + "\n");

  const results = await validateGrammars();
  generateSummary(results);

  if (results.some((result) => !result.success)) process.exitCode = 1;
}

// Run the validation
main().catch((error) => {
  console.error("❌ Validation script failed:", error);
  process.exitCode = 1;
});
