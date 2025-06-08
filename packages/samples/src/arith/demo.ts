#!/usr/bin/env bun

import {
  calculate,
  calculateDirect,
  parseToAST,
  astToString,
  examples,
  runExamples,
} from "./calculator";

// Process command line arguments
const args = process.argv.slice(2);

function printUsage() {
  console.log(`
Usage:
  bun demo.ts [expression]        - Calculate the specified expression
  bun demo.ts --examples          - Run all examples
  bun demo.ts --ast "expression"  - Display AST structure
  bun demo.ts --help              - Show this help

Examples:
  bun demo.ts "1 + 2 * 3"
  bun demo.ts --ast "(1 + 2) * 3"
  bun demo.ts --examples
`);
}

function calculateExpression(expr: string) {
  try {
    console.log(`\nExpression: ${expr}`);
    console.log("─".repeat(40));
    
    // Direct calculation
    const directResult = calculateDirect(expr);
    console.log(`Direct calc: ${directResult}`);
    
    // AST-based calculation
    const astResult = calculate(expr);
    console.log(`AST calc:    ${astResult}`);
    
    // Verify results
    if (directResult === astResult) {
      console.log("✓ Both calculation methods produced the same result");
    } else {
      console.log("⚠ Calculation results differ");
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error}`);
  }
}

function showAST(expr: string) {
  try {
    console.log(`\nExpression: ${expr}`);
    console.log("─".repeat(40));
    
    const ast = parseToAST(expr);
    const result = calculate(expr);
    
    console.log("AST Structure:");
    console.log(astToString(ast));
    console.log(`\nResult: ${result}`);
    
  } catch (error) {
    console.error(`❌ Error: ${error}`);
  }
}

function runInteractiveDemo() {
  console.log("=== TPEG Arithmetic Parser - Interactive Demo ===\n");
  
  const testExpressions = [
    "1 + 2",
    "1 + 2 * 3", 
    "(1 + 2) * 3",
    "3.14 * 2",
    "((1 + 2) * 3 - 4) / 2",
    "-5 + 3",
    "+5 - 3"
  ];
  
  console.log("Basic calculation examples:");
  for (const expr of testExpressions) {
    calculateExpression(expr);
  }
  
  console.log(`\n${"=".repeat(50)}`);
  console.log("For more detailed examples, use --examples");
}

// Main processing
if (args.length === 0) {
  runInteractiveDemo();
} else if (args[0] === "--help" || args[0] === "-h") {
  printUsage();
} else if (args[0] === "--examples") {
  runExamples();
} else if (args[0] === "--ast") {
  if (args[1]) {
    showAST(args[1]);
  } else {
    console.error("❌ --ast option requires an expression to be specified");
    printUsage();
  }
} else {
  // Treat as expression
  const expr = args.join(" ");
  calculateExpression(expr);
} 