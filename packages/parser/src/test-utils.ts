/**
 * Shared test utilities for TPEG parser tests
 *
 * This module provides common test setup, helpers, and assertions
 * to reduce duplication across test files and ensure consistent testing patterns.
 */

import { expect } from "bun:test";
import type { ParseResult, Parser, Pos as Position } from "tpeg-core";
import { parse } from "tpeg-core";
import type { Expression } from "./types";

/**
 * Create a standard test position at the beginning of input
 * @returns Position object at offset 0, line 1, column 1
 */
export const createTestPosition = (): Position => ({
  offset: 0,
  line: 1,
  column: 1,
});

/**
 * Create a test position at a specific offset
 * @param offset Character offset in input
 * @param line Line number (defaults to 1)
 * @param column Column number (defaults to offset + 1)
 * @returns Position object
 */
export const createPositionAt = (
  offset: number,
  line = 1,
  column = offset + 1,
): Position => ({
  offset,
  line,
  column,
});

/**
 * Parse input with the given parser - simplified test interface
 * @param parser Parser to use
 * @param input Input string to parse
 * @returns Parse result
 */
export const testParse = <T>(
  parser: Parser<T>,
  input: string,
): ParseResult<T> => parse(parser)(input);

/**
 * Type guard and assertion helper for successful parse results
 * @param result Parse result to check
 * @returns Success result with proper typing
 * @throws Test assertion error if result is not successful
 */
export const expectSuccess = <T>(result: ParseResult<T>) => {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error(
      `Expected success but got failure: ${result.error.message}`,
    );
  }
  return result;
};

/**
 * Type guard and assertion helper for failed parse results
 * @param result Parse result to check
 * @returns Failure result with proper typing
 * @throws Test assertion error if result is not a failure
 */
export const expectFailure = <T>(result: ParseResult<T>) => {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error(
      `Expected failure but got success: ${JSON.stringify(result.val)}`,
    );
  }
  return result;
};

/**
 * Parse and assert success in one step
 * @param parser Parser to use
 * @param input Input string to parse
 * @returns Success result value
 */
export const parseAndExpectSuccess = <T>(
  parser: Parser<T>,
  input: string,
): T => {
  const result = testParse(parser, input);
  const success = expectSuccess(result);
  return success.val;
};

/**
 * Parse and assert failure in one step
 * @param parser Parser to use
 * @param input Input string to parse
 * @returns Failure error message
 */
export const parseAndExpectFailure = <T>(
  parser: Parser<T>,
  input: string,
): string => {
  const result = testParse(parser, input);
  const failure = expectFailure(result);
  return failure.error.message;
};

/**
 * Assert that a parsed expression has the expected type
 * @param expression Parsed expression
 * @param expectedType Expected AST node type
 */
export const expectExpressionType = (
  expression: Expression,
  expectedType: Expression["type"],
): void => {
  expect(expression.type).toBe(expectedType);
};

/**
 * Create test cases for parser success scenarios
 * @param parser Parser to test
 * @param testCases Array of [input, expected] pairs
 * @returns Test function that can be called in test suites
 */
export const createSuccessTestCases = <T>(
  parser: Parser<T>,
  testCases: Array<[string, T]>,
) => {
  return testCases.map(([input, expected]) => ({
    input,
    expected,
    test: () => {
      const result = parseAndExpectSuccess(parser, input);
      expect(result).toEqual(expected);
    },
  }));
};

/**
 * Create test cases for parser failure scenarios
 * @param parser Parser to test
 * @param testCases Array of [input, expectedErrorPattern] pairs
 * @returns Test function that can be called in test suites
 */
export const createFailureTestCases = <T>(
  parser: Parser<T>,
  testCases: Array<[string, string | RegExp]>,
) => {
  return testCases.map(([input, expectedErrorPattern]) => ({
    input,
    expectedErrorPattern,
    test: () => {
      const errorMessage = parseAndExpectFailure(parser, input);
      if (typeof expectedErrorPattern === "string") {
        expect(errorMessage).toContain(expectedErrorPattern);
      } else {
        expect(errorMessage).toMatch(expectedErrorPattern);
      }
    },
  }));
};

/**
 * Test helper for verifying AST node structure
 * @param node AST node to check
 * @param expectedType Expected node type
 * @param additionalChecks Additional property checks as an object
 */
export const expectASTNode = <T extends Expression>(
  node: T,
  expectedType: T["type"],
  additionalChecks: Partial<T> = {},
): void => {
  expect(node.type).toBe(expectedType);

  for (const [key, value] of Object.entries(additionalChecks)) {
    expect((node as unknown as Record<string, unknown>)[key]).toEqual(value);
  }
};

/**
 * Helper for testing position information in parse results
 * @param result Parse result to check
 * @param expectedNext Expected next position
 */
export const expectPosition = <T>(
  result: ParseResult<T>,
  expectedNext: Partial<Position>,
): void => {
  if (result.success) {
    if (expectedNext.offset !== undefined) {
      expect(result.next.offset).toBe(expectedNext.offset);
    }
    if (expectedNext.line !== undefined) {
      expect(result.next.line).toBe(expectedNext.line);
    }
    if (expectedNext.column !== undefined) {
      expect(result.next.column).toBe(expectedNext.column);
    }
  } else {
    throw new Error("Cannot check position on failed parse result");
  }
};

/**
 * Common test input strings for various scenarios
 */
export const TEST_INPUTS = {
  EMPTY: "",
  WHITESPACE_ONLY: "   \t\n  ",
  SIMPLE_STRING: '"hello"',
  COMPLEX_STRING: '"hello \\"world\\""',
  SIMPLE_IDENTIFIER: "test_var",
  COMPLEX_IDENTIFIER: "_test123",
  CHARACTER_CLASS: "[a-zA-Z0-9]",
  NEGATED_CHAR_CLASS: "[^0-9]",
  ANY_CHAR: ".",
  SEQUENCE: '"a" "b" "c"',
  CHOICE: '"a" / "b" / "c"',
  GROUPED: '("a" / "b")',
  REPETITION_STAR: '"a"*',
  REPETITION_PLUS: '"a"+',
  REPETITION_OPTIONAL: '"a"?',
  REPETITION_QUANTIFIED: '"a"{3,5}',
  LOOKAHEAD_POSITIVE: '&"test"',
  LOOKAHEAD_NEGATIVE: '!"test"',
  LABELED: 'name:"value"',
} as const;
