#!/usr/bin/env bun

import {
  astToString,
  calculate,
  calculateDirect,
  examples,
  parseToAST,
} from "./calculator";

/**
 * Simple REPL implementation for the TPEG Arithmetic Calculator.
 * 
 * This module provides an interactive command-line interface for evaluating
 * arithmetic expressions using the TPEG parser.
 */

/**
 * Prints the welcome message and available commands.
 * 
 * Displays information about the calculator and lists all available commands
 * that users can use in the REPL.
 */
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

/**
 * Prints help information about supported operations.
 * 
 * Displays all supported arithmetic operations and provides examples
 * for each operation type.
 */
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

/**
 * Prints example expressions with their calculated results.
 * 
 * Displays all example expressions from the examples object,
 * showing both the expression and its calculated result.
 */
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

/**
 * Handles user input and executes appropriate commands.
 * 
 * This function processes user input and determines whether to:
 * - Exit the REPL
 * - Show help information
 * - Display examples
 * - Show AST structure for an expression
 * - Calculate an arithmetic expression
 * 
 * @param input - The user's input string
 * @returns True if the REPL should exit, false otherwise
 */
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

/**
 * Starts the interactive REPL.
 * 
 * This function sets up the readline interface and starts the main
 * REPL loop, handling user input and displaying results.
 */
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
