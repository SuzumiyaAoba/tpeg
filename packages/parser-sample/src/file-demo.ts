#!/usr/bin/env bun
/**
 * TPEG Parser File-Based Demo
 *
 * This demo reads grammar definitions and input samples from files,
 * providing a more realistic demonstration of TPEG parser usage.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  characterClass,
  grammarDefinition,
  identifier,
  stringLiteral,
  tpegExpression,
} from "tpeg-parser";

console.log("📁 TPEG Parser File-Based Demo\n");

// Helper function to read file contents
const readExampleFile = (filename: string): string => {
  const examplesDir = join(import.meta.dir, "..", "examples");
  const filePath = join(examplesDir, filename);
  try {
    return readFileSync(filePath, "utf-8");
  } catch (error) {
    console.error(`❌ Failed to read ${filename}:`, error);
    return "";
  }
};

// Helper function to parse sample inputs from text file
const parseInputs = (content: string): string[] => {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
    .filter((line) => !line.startsWith("## "));
};

// Helper function to demonstrate grammar parsing
const demoGrammarFile = (filename: string) => {
  console.log(`=== Grammar File: ${filename} ===`);

  const grammarContent = readExampleFile(filename);
  if (!grammarContent) return;

  console.log("📄 Grammar Content:");
  console.log(grammarContent);
  console.log();

  const pos = { offset: 0, line: 1, column: 1 };
  const result = grammarDefinition(grammarContent, pos);

  if (result.success) {
    const grammar = result.val;
    console.log(`✅ Successfully parsed grammar: ${grammar.name}`);
    console.log(`   📊 Annotations: ${grammar.annotations.length}`);
    console.log(`   📋 Rules: ${grammar.rules.length}`);

    // Show annotations
    if (grammar.annotations.length > 0) {
      console.log("   📝 Annotations:");
      for (const annotation of grammar.annotations) {
        console.log(`      @${annotation.key}: "${annotation.value}"`);
      }
    }

    // Show rules
    if (grammar.rules.length > 0) {
      console.log("   📋 Rules:");
      for (const rule of grammar.rules) {
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
};

// Helper function to demonstrate basic syntax parsing from file
const demoBasicSyntaxFile = (filename: string) => {
  console.log(`=== Basic Syntax from File: ${filename} ===`);

  const content = readExampleFile(filename);
  if (!content) return;

  const inputs = parseInputs(content);

  for (const input of inputs) {
    console.log(`Testing: ${input}`);

    // Try different parsers to see which one matches
    const parsers = [
      { name: "String Literal", parser: stringLiteral },
      { name: "Character Class", parser: characterClass },
      { name: "Identifier", parser: identifier },
      { name: "Expression", parser: tpegExpression },
    ];

    let matched = false;
    const pos = { offset: 0, line: 1, column: 1 };

    for (const { name, parser } of parsers) {
      const result = parser(input, pos);
      if (result.success) {
        console.log(`  ✅ ${name}: ${result.val.type || typeof result.val}`);
        matched = true;
        break;
      }
    }

    if (!matched) {
      console.log("  ❌ No parser matched");
    }

    console.log();
  }

  console.log("---");
  console.log();
};

// Helper function to parse structured input file sections
const parseStructuredInputs = (content: string): Record<string, string[]> => {
  const sections: Record<string, string[]> = {};
  let currentSection: string | undefined;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("## ")) {
      currentSection = trimmed.substring(3);
      sections[currentSection] = [];
    } else if (trimmed && !trimmed.startsWith("#") && currentSection) {
      const sectionArray = sections[currentSection];
      if (sectionArray) {
        sectionArray.push(trimmed);
      }
    }
  }

  return sections;
};

// Helper function to demonstrate parsing with structured inputs
const demoStructuredInputFile = (filename: string) => {
  console.log(`=== Structured Input Demo: ${filename} ===`);

  const content = readExampleFile(filename);
  if (!content) return;

  const sections = parseStructuredInputs(content);

  for (const [sectionName, inputs] of Object.entries(sections)) {
    console.log(`📋 ${sectionName}:`);

    for (const input of inputs.slice(0, 3)) {
      // Show first 3 examples from each section
      const pos = { offset: 0, line: 1, column: 1 };
      const result = tpegExpression(input, pos);

      if (result.success) {
        console.log(`  ✅ "${input}" → ${result.val.type}`);
      } else {
        console.log(`  ❌ "${input}" → Parse failed`);
      }
    }

    if (inputs.length > 3) {
      console.log(`  ... and ${inputs.length - 3} more examples`);
    }

    console.log();
  }

  console.log("---");
  console.log();
};

// Demo execution
console.log("🎯 Demonstrating TPEG Parser with File-Based Examples\n");

// Demo 1: Grammar definition files
console.log("📚 Grammar Definition Files:");
demoGrammarFile("minimal.tpeg");
console.log(
  "📝 Note: Complex grammar parsing with rules is a limitation of current parser implementation",
);
console.log("Basic syntax elements work correctly as shown below:\n");

// Demo 2: Basic syntax parsing from file
console.log("🔤 Basic Syntax Parsing:");
demoBasicSyntaxFile("basic-samples.txt");

// Demo 3: Expression parsing
console.log("🚀 Expression Parsing:");
demoStructuredInputFile("expression-samples.txt");

console.log("🎉 File-based demo completed!");
console.log("💡 All examples loaded from external files:");
console.log("   • Grammar definitions: examples/*.tpeg");
console.log("   • Input samples: examples/*.txt");
console.log("   • Demonstrates real-world file-based parsing workflows");
