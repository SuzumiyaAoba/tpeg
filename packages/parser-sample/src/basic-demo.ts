#!/usr/bin/env bun
/**
 * TPEG Parser Basic Demo
 *
 * This demo showcases the basic parsing capabilities of the TPEG parser,
 * including string literals, character classes, identifiers, and composition operators.
 */

import type { Parser } from "tpeg-core";
import {
  basicSyntax,
  characterClass,
  identifier,
  stringLiteral,
  tpegExpression,
} from "tpeg-parser";

console.log("🎯 TPEG Parser Basic Demo\n");

// Helper function to demonstrate parsing
const demoParser = <T>(name: string, parser: Parser<T>, inputs: string[]) => {
  console.log(`=== ${name} ===`);

  for (const input of inputs) {
    const pos = { offset: 0, line: 1, column: 1 };
    const result = parser(input, pos);

    if (result.success) {
      console.log(`✅ "${input}" → ${JSON.stringify(result.val, null, 2)}`);
    } else {
      console.log(`❌ "${input}" → ${result.error?.message || "Parse failed"}`);
    }
  }
  console.log();
};

// Demo 1: String Literals
demoParser("String Literals", stringLiteral, [
  '"hello world"',
  "'single quotes'",
  '"with\\nescapes"',
  '"with\\ttab"',
  '"emoji: 🎉"',
  '"incomplete', // Error case
  "not a string", // Error case
]);

// Demo 2: Character Classes
demoParser("Character Classes", characterClass, [
  "[a-z]",
  "[A-Z0-9]",
  "[abc]",
  "[a-zA-Z_]",
  "[0-9a-f]",
  "[", // Error case
  "not-a-class", // Error case
]);

// Demo 3: Identifiers
demoParser("Identifiers", identifier, [
  "variable",
  "myVar123",
  "_private",
  "CamelCase",
  "snake_case",
  "123invalid", // Error case
  "with-dash", // Error case
]);

// Demo 4: Basic Syntax (combines all basic elements)
demoParser("Basic Syntax Elements", basicSyntax, [
  '"string literal"',
  "[0-9]",
  "identifier",
  "myVariable123",
  "'single quote'",
  "[a-zA-Z_]",
]);

// Demo 5: Expression Composition
console.log("=== Expression Composition ===");

const compositionExamples = [
  // Sequence
  '"hello" " " "world"',

  // Choice
  '"true" / "false"',

  // Group
  '("yes" / "no")',

  // Complex expressions
  '("hello" / "hi") " " [A-Z][a-z]*',
  '"start" (" " [a-z]+)* "end"',

  // Nested choices and sequences
  '("a" "b") / ("c" "d")',
];

for (const expr of compositionExamples) {
  const pos = { offset: 0, line: 1, column: 1 };
  const result = tpegExpression(expr, pos);

  if (result.success) {
    console.log(`✅ Expression: ${expr}`);
    console.log(`   Result: ${JSON.stringify(result.val, null, 2)}`);
  } else {
    console.log(`❌ Expression: ${expr}`);
    console.log(`   Error: ${result.error?.message || "Parse failed"}`);
  }
  console.log();
}

console.log("🎉 Basic demo completed!");
console.log(
  "💡 Try running: bun run demo:grammar to see grammar definition features",
);
