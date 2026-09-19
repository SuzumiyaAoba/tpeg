#!/usr/bin/env bun

import { parseSExpr, parseSExprs, printSExp } from "./sexpr";

/**
 * S-expression Parser Demo
 *
 * Demonstrates recursive parsing with TPEG:
 * - Nested lists of arbitrary depth
 * - Atoms: symbols, numbers, quoted strings
 * - `'x` quote sugar desugared to `(quote x)`
 * - `;` line comments and flexible whitespace
 */

const demoBasicForms = () => {
  console.log("=== Basic Forms ===");

  const source = `(define (square x) (* x x))`;

  console.log("Input:");
  console.log(source);
  console.log();
  console.log("Parsed:");
  console.log(JSON.stringify(parseSExpr(source), null, 2));
  console.log();
};

const demoAtomKinds = () => {
  console.log("=== Atom Kinds: symbols, numbers, strings ===");

  const source = `(print "hello, world" 42 -3.14 + -5abc)`;

  console.log("Input:");
  console.log(source);
  console.log();
  console.log("Parsed:");
  console.log(JSON.stringify(parseSExpr(source), null, 2));
  console.log();
};

const demoQuoteAndComments = () => {
  console.log("=== Quote Sugar and Comments ===");

  const source = `; a tiny program
'(1 2 3)          ; quoted list -> (quote (1 2 3))
(+ 1 2) ; trailing comment`;

  console.log("Input:");
  console.log(source);
  console.log();
  console.log("Parsed forms:");
  for (const form of parseSExprs(source)) {
    console.log(" ", printSExp(form));
  }
  console.log();
};

const demoRoundTrip = () => {
  console.log("=== Round Trip: parse -> print -> parse ===");

  const source = `(a (b "c d" 'e) -12.5)`;

  const first = printSExp(parseSExpr(source));
  console.log("Original: ", source);
  console.log("Printed:  ", first);
  const second = parseSExpr(first);
  console.log(
    "Stable:   ",
    JSON.stringify(second) === JSON.stringify(parseSExpr(source)),
  );
  console.log();
};

const demoErrors = () => {
  console.log("=== Error Handling ===");

  for (const source of ["(a b", "a b", ")"]) {
    try {
      parseSExpr(source);
      console.log(`  ${JSON.stringify(source)} -> parsed (unexpected)`);
    } catch (error) {
      console.log(`  ${JSON.stringify(source)} -> ${(error as Error).message}`);
    }
  }
  console.log();
};

const main = () => {
  console.log("🎯 TPEG S-expression Parser Demo\n");

  try {
    demoBasicForms();
    demoAtomKinds();
    demoQuoteAndComments();
    demoRoundTrip();
    demoErrors();

    console.log("✅ All demos completed successfully!");
  } catch (error) {
    console.error("❌ Demo failed:", error);
    process.exit(1);
  }
};

if (import.meta.main) {
  main();
}
