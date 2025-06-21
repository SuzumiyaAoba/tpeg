#!/usr/bin/env bun
/**
 * TPEG Parser Complete Demo
 *
 * This is the main demo that showcases all implemented TPEG parser features.
 * It combines basic parsing capabilities with advanced grammar definition features.
 */

import {
  basicSyntax,
  grammarDefinition,
  stringLiteral,
  tpegExpression,
} from "tpeg-parser";

console.log("🚀 TPEG Parser Complete Demo");
console.log("============================\n");

console.log("This demo showcases the comprehensive TPEG parsing capabilities:");
console.log("• Basic syntax parsing (strings, identifiers, character classes)");
console.log("• Expression composition (sequences, choices, groups)");
console.log("• Grammar definition blocks with annotations and rules");
console.log("• Advanced parsing features from Phase 1.6");
console.log();

// Demo section 1: Quick syntax overview
console.log("📖 Quick Syntax Overview");
console.log("========================");

const syntaxExamples = [
  { name: "String Literal", input: '"hello world"', parser: stringLiteral },
  {
    name: "Expression Sequence",
    input: '"start" " " [a-z]+ "end"',
    parser: tpegExpression,
  },
  {
    name: "Expression Choice",
    input: '"yes" / "no" / "maybe"',
    parser: tpegExpression,
  },
  { name: "Basic Syntax", input: "myIdentifier", parser: basicSyntax },
];

for (const example of syntaxExamples) {
  const pos = { offset: 0, line: 1, column: 1 };
  const result = example.parser(example.input, pos);
  const status = result.success ? "✅" : "❌";
  console.log(`${status} ${example.name}: ${example.input}`);

  if (result.success) {
    console.log(
      `   → ${JSON.stringify(result.val.type || result.val, null, 0)}`,
    );
  } else {
    console.log(`   → Error: ${result.error?.message || "Parse failed"}`);
  }
}

console.log();

// Demo section 2: Real-world grammar example
console.log("🏗️  Real-World Grammar Example");
console.log("==============================");

const calculatorGrammar = `grammar Calculator {
  @version: "1.2.0"
  @description: "A simple arithmetic calculator grammar"
  @author: "TPEG Parser Demo"
  
  // Main expression rule with operator precedence
  expression = term (("+" / "-") term)*
  term = factor (("*" / "/") factor)*
  factor = number / "(" expression ")"
  
  // Number parsing with optional decimal point
  number = [0-9]+ ("." [0-9]+)?
  
  // Whitespace handling
  whitespace = [ \\t\\n\\r]*
}`;

console.log("Grammar Definition:");
console.log(calculatorGrammar);
console.log();

const pos = { offset: 0, line: 1, column: 1 };
const grammarResult = grammarDefinition(calculatorGrammar, pos);

if (grammarResult.success) {
  const grammar = grammarResult.val;

  console.log("✅ Successfully parsed grammar!");
  console.log(`📝 Grammar Name: ${grammar.name}`);
  console.log(`📊 Annotations: ${grammar.annotations.length}`);
  console.log(`📋 Rules: ${grammar.rules.length}`);
  console.log();

  console.log("📝 Annotations:");
  for (const annotation of grammar.annotations) {
    console.log(`   @${annotation.key}: "${annotation.value}"`);
  }
  console.log();

  console.log("📋 Rules:");
  for (const rule of grammar.rules) {
    console.log(`   ${rule.name} = [${rule.pattern.type}]`);
  }
  console.log();
} else {
  console.log("❌ Failed to parse grammar");
  console.log(`Error: ${grammarResult.error?.message || "Parse failed"}`);
  console.log();
}

// Demo section 3: Feature highlights
console.log("🌟 Feature Highlights");
console.log("====================");

console.log("✅ Implemented Features:");
console.log("   • String literals with escape sequences");
console.log("   • Character classes and ranges [a-z], [0-9A-F]");
console.log("   • Identifiers with underscore support");
console.log("   • Expression composition (sequence, choice, grouping)");
console.log("   • Grammar annotations (@version, @description, etc.)");
console.log("   • Rule definitions with complex expressions");
console.log("   • Complete grammar blocks");
console.log("   • Comment parsing (// and ///)");
console.log("   • Unicode support throughout");
console.log("   • Comprehensive error reporting");
console.log();

console.log("🚧 Architecture Benefits:");
console.log("   • Monorepo with multiple focused packages");
console.log("   • TypeScript strict mode compliance");
console.log("   • 683 tests with comprehensive coverage");
console.log("   • Functional parser combinators");
console.log("   • Performant const-based parser declarations");
console.log("   • AST generation with Unist compatibility");
console.log();

console.log("📚 Usage Instructions:");
console.log("   • Run 'bun run demo:basic' for basic parsing features");
console.log("   • Run 'bun run demo:grammar' for grammar definition features");
console.log("   • Run 'bun run demo' for this complete overview");
console.log(
  "   • See packages/samples/ for JSON, CSV, and arithmetic examples",
);
console.log();

console.log("🎉 TPEG Parser Demo Complete!");
console.log("Thank you for exploring TPEG parsing capabilities!");
