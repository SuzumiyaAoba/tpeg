#!/usr/bin/env bun
/**
 * TPEG Grammar Definition Demo (Phase 1.6)
 *
 * This demo showcases the grammar definition features implemented in Phase 1.6,
 * including annotations, rule definitions, and complete grammar blocks.
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  documentationComment,
  grammarAnnotation,
  grammarDefinition,
  quotedString,
  ruleDefinition,
  singleLineComment,
} from "@suzumiyaaoba/tpeg-parser";

console.log("📚 TPEG Grammar Definition Demo (Phase 1.6)\n");

// Helper function to demonstrate parsing
const demoParser = <T>(name: string, parser: Parser<T>, inputs: string[]) => {
  console.log(`=== ${name} ===`);

  for (const input of inputs) {
    const pos = { offset: 0, line: 1, column: 1 };
    const result = parser(input, pos);

    if (result.success) {
      console.log(`✅ Input: ${input}`);
      console.log(`   Result: ${JSON.stringify(result.val, null, 2)}`);
    } else {
      console.log(`❌ Input: ${input}`);
      console.log(`   Error: ${result.error?.message || "Parse failed"}`);
    }
    console.log();
  }
};

// Demo 1: Comments
demoParser("Single Line Comments", singleLineComment, [
  "// This is a comment",
  "// Another comment with symbols @#$%",
  "//No space after slashes",
  "// Comment with 日本語 unicode",
]);

demoParser("Documentation Comments", documentationComment, [
  "/// This is documentation",
  "/// Multi-word documentation comment",
  "/// Documentation with @annotations and symbols",
]);

// Demo 2: Quoted Strings (for annotations)
demoParser("Quoted Strings", quotedString, [
  '"1.0.0"',
  "'Simple value'",
  '"Complex value with spaces and symbols: @#$%"',
  '"Unicode: 日本語 🎉"',
]);

// Demo 3: Grammar Annotations
demoParser("Grammar Annotations", grammarAnnotation, [
  '@version: "1.0.0"',
  '@description: "Simple arithmetic grammar"',
  '@author: "TPEG Parser"',
  '  @indented: "whitespace handling"',
  '@unicode: "日本語対応"',
]);

// Demo 4: Rule Definitions
demoParser("Rule Definitions", ruleDefinition, [
  "number = [0-9]+",
  "identifier = [a-zA-Z_][a-zA-Z0-9_]*",
  'expression = term ("+" term)*',
  '  indented_rule = "value"',
  'string_literal = "\\"" [^\\"]* "\\""',
  'choice_rule = "true" / "false"',
]);

// Demo 5: Complete Grammar Definition
console.log("=== Complete Grammar Definitions ===");

const grammarExamples = [
  // Simple grammar
  `grammar Arithmetic {
    @version: "1.0"
    @description: "Simple arithmetic parser"
    
    number = [0-9]+
    expression = number ("+" number)*
  }`,

  // More complex grammar
  `grammar JsonLite {
    @version: "2.0"
    @author: "TPEG Team"
    @description: "Lightweight JSON parser"
    
    value = string / number / boolean / null
    string = "\\"" [^\\"]* "\\""
    number = [0-9]+ ("." [0-9]+)?
    boolean = "true" / "false"
    null = "null"
  }`,

  // Grammar with various annotation types
  `grammar Advanced {
    @version: "3.1.4"
    @description: "Advanced parsing features"
    @license: "MIT"
    @maintainer: "Parser Team"
    
    document = header body footer?
    header = "@" identifier ":" quoted_string
    body = statement*
    statement = assignment / expression
    assignment = identifier "=" expression
    expression = term (operator term)*
    term = identifier / number / string
    operator = "+" / "-" / "*" / "/"
    identifier = [a-zA-Z_][a-zA-Z0-9_]*
    number = [0-9]+ ("." [0-9]+)?
    string = "\\"" [^\\"]* "\\""
    quoted_string = "\\"" [^\\"]* "\\""
    footer = "---" .*
  }`,
];

for (const grammar of grammarExamples) {
  console.log("📖 Grammar Input:");
  console.log(grammar);
  console.log();

  const pos = { offset: 0, line: 1, column: 1 };
  const result = grammarDefinition(grammar, pos);

  if (result.success) {
    console.log(`✅ Successfully parsed grammar: ${result.val.name}`);
    console.log(`   Annotations: ${result.val.annotations.length}`);
    console.log(`   Rules: ${result.val.rules.length}`);

    // Show annotations
    if (result.val.annotations.length > 0) {
      console.log("   📝 Annotations:");
      for (const annotation of result.val.annotations) {
        console.log(`      @${annotation.key}: "${annotation.value}"`);
      }
    }

    // Show rules
    if (result.val.rules.length > 0) {
      console.log("   📋 Rules:");
      for (const rule of result.val.rules) {
        console.log(`      ${rule.name} = [${rule.pattern.type}]`);
      }
    }
  } else {
    console.log("❌ Failed to parse grammar");
    console.log(`   Error: ${result.error?.message || "Parse failed"}`);
    if (result.error?.pos) {
      console.log(
        `   Position: line ${result.error.pos.line}, column ${result.error.pos.column}`,
      );
    }
  }

  console.log();
  console.log("---");
  console.log();
}

console.log("🎉 Grammar definition demo completed!");
console.log("💡 All Phase 1.6 features demonstrated:");
console.log("   ✅ Grammar annotations (@version, @description, etc.)");
console.log("   ✅ Rule definitions with complex expressions");
console.log("   ✅ Complete grammar blocks with metadata");
console.log("   ✅ Comment parsing (// and ///)");
console.log("   ✅ Whitespace handling and formatting");
