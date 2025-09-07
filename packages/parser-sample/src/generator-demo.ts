#!/usr/bin/env bun
/**
 * TPEG Parser Generation Demo
 *
 * Demonstrates the parser generation system by:
 * 1. Parsing a TPEG grammar from text
 * 2. Generating TypeScript parser code
 * 3. Showing the generated output
 */

import {
  generateTypeScriptParser,
  grammarDefinition,
} from "@SuzumiyaAoba/parser";

console.log("🏗️  TPEG Parser Generation Demo\n");

// Example grammar definition (single rule due to Phase 1.6 limitation)
const grammarText = `grammar Calculator {
  @version: "1.0"
  @description: "Simple arithmetic calculator"
  @author: "TPEG Demo"
  
  number = [0-9]+
}`;

console.log("📝 Input Grammar:");
console.log(grammarText);
console.log(`\n${"=".repeat(60)}\n`);

// Parse the grammar
console.log("🔍 Parsing Grammar...");
const pos = { offset: 0, line: 1, column: 1 };
const parseResult = grammarDefinition(grammarText, pos);

if (!parseResult.success) {
  console.error("❌ Failed to parse grammar:");
  console.error(`   Error: ${parseResult.error?.message}`);
  console.error(
    `   Position: line ${parseResult.error?.pos.line}, column ${parseResult.error?.pos.column}`,
  );
  process.exit(1);
}

const grammar = parseResult.val;
console.log(`✅ Successfully parsed grammar: ${grammar.name}`);
console.log(`   📊 Annotations: ${grammar.annotations.length}`);
console.log(`   📋 Rules: ${grammar.rules.length}`);

// Display parsed structure
console.log("\n📋 Parsed Grammar Structure:");
for (const annotation of grammar.annotations) {
  console.log(`   @${annotation.key}: "${annotation.value}"`);
}
for (const rule of grammar.rules) {
  console.log(`   ${rule.name} = [${rule.pattern.type}]`);
}

console.log(`\n${"=".repeat(60)}\n`);

// Generate TypeScript parser code
console.log("⚙️  Generating TypeScript Parser...");
try {
  const generated = generateTypeScriptParser(grammar, {
    namePrefix: "calc_",
    includeImports: true,
    includeTypes: true,
  });

  console.log("✅ Code generation successful!");
  console.log(`   📦 Imports: ${generated.imports.length}`);
  console.log(`   📤 Exports: ${generated.exports.length}`);

  console.log("\n🔧 Generated TypeScript Code:");
  console.log("─".repeat(80));
  console.log(generated.code);
  console.log("─".repeat(80));

  console.log("\n📤 Exported Parsers:");
  for (const exportName of generated.exports) {
    console.log(`   • calc_${exportName}`);
  }
} catch (error) {
  console.error("❌ Code generation failed:");
  console.error(
    `   Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

console.log("\n🎉 Demo completed successfully!");
console.log(
  "💡 The generated code can be saved to a .ts file and used as a parser library.",
);

// Example usage demonstration
console.log(`\n${"=".repeat(60)}\n`);
console.log("📖 Example Usage of Generated Parser:");
console.log(`
// Save the generated code to calculator-parser.ts
// Then use it like this:

import { calc_expression, calc_number } from './calculator-parser';

const pos = { offset: 0, line: 1, column: 1 };

// Parse a number
const numberResult = calc_number("123", pos);
if (numberResult.success) {
  console.log("Parsed number:", numberResult.val);
}

// Parse an expression  
const exprResult = calc_expression("1 + 2 * 3", pos);
if (exprResult.success) {
  console.log("Parsed expression:", exprResult.val);
}
`);

console.log("🚀 Ready to generate parsers from your own TPEG grammars!");
