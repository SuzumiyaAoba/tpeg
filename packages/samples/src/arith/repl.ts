#!/usr/bin/env bun

import {
  astToString,
  calculate,
  calculateDirect,
  examples,
  parseToAST,
} from "./calculator";

// Simple REPL implementation
function printWelcome() {
  console.log("=== TPEG Arithmetic Calculator - REPL ===");
  console.log("Enter arithmetic expressions to calculate.");
  console.log("Commands:");
  console.log("  :ast <expression>  - Display AST structure for expression");
  console.log("  :help              - Show this help");
  console.log("  :examples          - Show example expressions");
  console.log("  exit               - Exit the calculator");
  console.log();
}

function printHelp() {
  console.log("\nSupported operations:");
  console.log("  Addition: +        (e.g., 1 + 2)");
  console.log("  Subtraction: -     (e.g., 5 - 3)");
  console.log("  Multiplication: *  (e.g., 2 * 3)");
  console.log("  Division: /        (e.g., 8 / 2)");
  console.log("  Modulo: %          (e.g., 7 % 3)");
  console.log("  Parentheses: ()    (e.g., (1 + 2) * 3)");
  console.log("  Signed numbers:    (e.g., -5, +3)");
  console.log("  Floating point:    (e.g., 3.14)");
  console.log();
}

function printExamples() {
  console.log("\nExample expressions:");
  for (const [category, exprs] of Object.entries(examples)) {
    console.log(`\n${category}:`);
    for (const expr of exprs) {
      try {
        const result = calculate(expr);
        console.log(`  ${expr.padEnd(20)} => ${result}`);
      } catch (error) {
        console.log(`  ${expr.padEnd(20)} => Error: ${error}`);
      }
    }
  }
  console.log();
}

function handleCommand(input: string) {
  const trimmed = input.trim();

  if (trimmed === "exit") {
    return true;
  }

  if (trimmed === ":help") {
    printHelp();
    return false;
  }

  if (trimmed === ":examples") {
    printExamples();
    return false;
  }

  if (trimmed.startsWith(":ast ")) {
    const expression = trimmed.slice(5);
    try {
      const ast = parseToAST(expression);
      const result = calculate(expression);
      console.log("AST Structure:");
      console.log(astToString(ast));
      console.log(`Result: ${result}`);
    } catch (error) {
      console.error(`Error: ${error}`);
    }
    return false;
  }

  // Regular expression calculation
  try {
    const result = calculate(trimmed);
    console.log(`=> ${result}`);
  } catch (error) {
    console.error(`Error: ${error}`);
  }

  return false;
}

async function repl() {
  printWelcome();

  const readline = require("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "calc> ",
  });

  rl.prompt();

  rl.on("line", (input: string) => {
    const shouldExit = handleCommand(input);
    if (shouldExit) {
      console.log("Goodbye!");
      rl.close();
    } else {
      rl.prompt();
    }
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

// Start REPL if this file is run directly
if (import.meta.main) {
  repl();
}
