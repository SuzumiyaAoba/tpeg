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
  parseGrammarFile,
  identifier,
  stringLiteral,
  tpegExpression,
} from "@suzumiyaaoba/tpeg-parser";
import { parseExample } from "./parse-example";

console.log("📁 TPEG Parser File-Based Demo\n");

const examplesDir = join(import.meta.dir, "..", "examples");
const readExampleFile = (filename: string): string =>
  readFileSync(join(examplesDir, filename), "utf8");

// Helper function to parse sample inputs from text file
const parseInputs = (content: string): string[] => {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));
};

// Helper function to demonstrate grammar parsing
const demoGrammarFile = (filename: string) => {
  console.log(`=== Grammar File: ${filename} ===`);

  const grammarContent = readExampleFile(filename);

  console.log("📄 Grammar Content:");
  console.log(grammarContent);
  console.log();

  const result = parseGrammarFile(filename, grammarContent);

  if (!result.success) {
    throw new Error(
      `${filename}:${result.line}:${result.column} ${result.error.message}`,
    );
  }
  const [grammar] = result.val.grammars;
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

  console.log();
  console.log("---");
  console.log();
};

// Helper function to demonstrate basic syntax parsing from file
const demoBasicSyntaxFile = (filename: string) => {
  console.log(`=== Basic Syntax from File: ${filename} ===`);

  const content = readExampleFile(filename);

  const inputs = parseInputs(content);
  const parsers = [
    { name: "String Literal", parser: stringLiteral },
    { name: "Character Class", parser: characterClass },
    { name: "Identifier", parser: identifier },
    { name: "Expression", parser: tpegExpression },
  ];

  for (const input of inputs) {
    console.log(`Testing: ${input}`);

    let matched = false;

    for (const { name, parser } of parsers) {
      const result = parseExample(parser, input);
      if (result.success) {
        console.log(`  ✅ ${name}: ${result.val.type}`);
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
const parseStructuredInputs = (content: string): Map<string, string[]> => {
  const sections = new Map<string, string[]>();
  let inputs: string[] | undefined;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      inputs = [];
      sections.set(trimmed.slice(3), inputs);
    } else if (trimmed && !trimmed.startsWith("#")) {
      inputs?.push(trimmed);
    }
  }
  return sections;
};

// Helper function to demonstrate parsing with structured inputs
const demoStructuredInputFile = (filename: string) => {
  console.log(`=== Structured Input Demo: ${filename} ===`);

  const content = readExampleFile(filename);

  const sections = parseStructuredInputs(content);

  for (const [sectionName, inputs] of sections) {
    console.log(`📋 ${sectionName}:`);

    for (const input of inputs.slice(0, 3)) {
      // Show first 3 examples from each section
      const result = parseExample(tpegExpression, input);

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
demoGrammarFile("working-example.tpeg");

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
