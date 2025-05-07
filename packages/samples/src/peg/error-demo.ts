import type { ParseResult, Parser } from "tpeg-core";
import {
  any,
  choice,
  lit,
  map,
  oneOrMore,
  parse,
  seq,
  zeroOrMore,
} from "tpeg-core";

// formatParseError functions from core package
// Normally these would be available directly from the core package
// but this is just for demo purposes - assume they're imported
const formatParseError = (error: any, input: string): string => {
  return `
Error at line ${error.pos.line}, column ${error.pos.column}:
Message: ${error.message}
Expected: ${error.expected || "unknown"}
Found: ${error.found || "unknown"}
Parser: ${error.parserName || "unknown"}
Context: ${
    error.context
      ? Array.isArray(error.context)
        ? error.context.join(" > ")
        : error.context
      : "unknown"
  }

Source:
${input.split("\n")[error.pos.line - 1] || ""}
${" ".repeat(error.pos.column)}^
`;
};

/**
 * Define a simple arithmetic expression parser
 */

// Numbers
const digit = () =>
  choice(
    lit("0"),
    lit("1"),
    lit("2"),
    lit("3"),
    lit("4"),
    lit("5"),
    lit("6"),
    lit("7"),
    lit("8"),
    lit("9")
  );
const integer = () => oneOrMore(digit());

// Whitespace
const whitespace = () => choice(lit(" "), lit("\t"), lit("\n"), lit("\r"));
const spaces = () => zeroOrMore(whitespace());

// Operators
const operator = () => choice(lit("+"), lit("-"), lit("*"), lit("/"));

// Terms
const term = (): Parser<string> => {
  const parser = seq(spaces(), integer(), spaces());

  return map(parser, ([spaces1, digits, spaces2]) => {
    return digits.join("");
  });
};

// Expressions
const expression = (): Parser<string> => {
  const parser = seq(term(), operator(), term());

  return map(parser, ([left, op, right]) => {
    return `${left} ${op} ${right}`;
  });
};

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
    console.log(formatParseError(result.error, input));
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
  const validResult = parse(expression())(validInput);
  displayParseResult(validResult, validInput);

  // Various error cases
  const errorCases = [
    { name: "Letters instead of numbers", input: "123 + abc" },
    { name: "Missing operator", input: "123 456" },
    { name: "Invalid operator", input: "123 & 456" },
    { name: "Empty input", input: "" },
  ];

  errorCases.forEach(({ name, input }) => {
    console.log(`\n${name}:`, input);
    const result = parse(expression())(input);
    displayParseResult(result, input);
  });
}

// Run the demo
if (typeof require !== "undefined" && require.main === module) {
  runDemo();
}

export {
  digit,
  integer,
  whitespace,
  spaces,
  operator,
  term,
  expression,
  displayParseResult,
  runDemo,
};
