import { spaces, whitespace } from "@suzumiyaaoba/tpeg-combinator";
import type { ParseResult } from "@suzumiyaaoba/tpeg-core";
import {
  charClass,
  choice,
  formatParseError,
  lit,
  oneOrMore,
  parse,
  seq,
} from "@suzumiyaaoba/tpeg-core";

/**
 * Define a simple arithmetic expression parser
 */

// Numbers
const digit = charClass(["0", "9"]);
const integer = oneOrMore(digit);

// Operators
const operator = choice(lit("+"), lit("-"), lit("*"), lit("/"));

// Terms
const term = seq(spaces, integer, spaces);

// Expressions
const expression = seq(term, operator, term);

/**
 * Function to display parse results
 */
function displayParseResult<T>(result: ParseResult<T>, input: string): void {
  if (result.success) {
    console.log("Parsing successful!");
    console.log("Result:", result.val);
    console.log("Consumed input:", input.substring(0, result.next));
    console.log("Remaining input:", input.substring(result.next));
  } else {
    console.log("Parsing failed...");
    console.log(formatParseError(result.error, input, { colorize: false }));
  }
}

/**
 * Error message demonstration
 */
function runDemo(): void {
  console.log("=== Enhanced Error Message Demo ===");

  // Successful case
  const validInput = "123 + 456";
  console.log("\nValid input:", validInput);
  const validResult = parse(expression)(validInput);
  displayParseResult(validResult, validInput);

  // Various error cases
  const errorCases = [
    { name: "Letters instead of numbers", input: "123 + abc" },
    { name: "Missing operator", input: "123 456" },
    { name: "Invalid operator", input: "123 & 456" },
    { name: "Empty input", input: "" },
  ];

  for (const { name, input } of errorCases) {
    console.log(`\n${name}:`, input);
    const result = parse(expression)(input);
    displayParseResult(result, input);
  }
}

// Run the demo -- `import.meta.main`, same entry-point guard every other
// demo in this package uses. (`require.main === module` relied on Bun's
// CJS-compat globals; `module` isn't defined under a plain ESM loader.)
if (import.meta.main) {
  runDemo();
}

export {
  digit,
  integer,
  whitespace,
  operator,
  term,
  expression,
  displayParseResult,
  runDemo,
};
