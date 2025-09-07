import { spaces, whitespace } from "@SuzumiyaAoba/combinator";
import type { ParseResult } from "@SuzumiyaAoba/core";
import { choice, lit, oneOrMore, parse, seq } from "@SuzumiyaAoba/core";

// Define a custom ParseError interface
interface DemoParseError {
  message: string;
  pos: {
    line: number;
    column: number;
  };
  expected?: string | string[];
  found?: string;
  parserName?: string;
  context?: string | string[];
}

// formatParseError functions from core package
// Normally these would be available directly from the core package
// but this is just for demo purposes - assume they're imported
const formatParseError = (error: DemoParseError, input: string): string => {
  const expected = error.expected || "unknown";
  const found = error.found || "unknown";
  const parserName = error.parserName || "unknown";
  let contextStr = "unknown";

  if (error.context) {
    if (Array.isArray(error.context)) {
      contextStr = error.context.join(" > ");
    } else {
      contextStr = error.context;
    }
  }

  return `
Error at line ${error.pos.line}, column ${error.pos.column}:
Message: ${error.message}
Expected: ${expected}
Found: ${found}
Parser: ${parserName}
Context: ${contextStr}

Source:
${input.split("\n")[error.pos.line - 1] || ""}
${" ".repeat(error.pos.column)}^
`;
};

/**
 * Define a simple arithmetic expression parser
 */

// Numbers
const digit = choice(
  lit("0"),
  lit("1"),
  lit("2"),
  lit("3"),
  lit("4"),
  lit("5"),
  lit("6"),
  lit("7"),
  lit("8"),
  lit("9"),
);
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
    console.log("Consumed input:", input.substring(0, result.next.offset));
    console.log("Remaining input:", input.substring(result.next.offset));
  } else {
    console.log("Parsing failed...");
    console.log(
      formatParseError(result.error as unknown as DemoParseError, input),
    );
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

// Run the demo
if (typeof require !== "undefined" && require.main === module) {
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
