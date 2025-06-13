/**
 * TPEG Lookahead Operators Parser
 *
 * Implements parsing of lookahead operators: &expr, !expr
 * Based on docs/peg-grammar.md specification.
 *
 * Lookahead operators are prefix operators that do not consume input:
 * - &expr (positive lookahead) - succeeds if expr matches
 * - !expr (negative lookahead) - succeeds if expr does not match
 */

import type { Parser } from "tpeg-core";
import { choice, literal } from "tpeg-core";
import type { Expression, NegativeLookahead, PositiveLookahead } from "./types";

/**
 * Parses a positive lookahead operator: &
 * Used in expressions like &expr
 */
export const positiveLookaheadOperator: Parser<string> = literal("&");

/**
 * Parses a negative lookahead operator: !
 * Used in expressions like !expr
 */
export const negativeLookaheadOperator: Parser<string> = literal("!");

/**
 * Creates a positive lookahead AST node.
 * Represents &expr in the grammar.
 */
export const createPositiveLookahead = (
  expression: Expression,
): PositiveLookahead => {
  return {
    type: "PositiveLookahead" as const,
    expression,
  };
};

/**
 * Creates a negative lookahead AST node.
 * Represents !expr in the grammar.
 */
export const createNegativeLookahead = (
  expression: Expression,
): NegativeLookahead => {
  return {
    type: "NegativeLookahead" as const,
    expression,
  };
};

/**
 * Parses any lookahead operator.
 * Returns the operator string for later application.
 */
export const lookaheadOperator: Parser<string> = choice(
  positiveLookaheadOperator,
  negativeLookaheadOperator,
);

/**
 * Applies a lookahead operator to a base expression.
 * Creates the appropriate AST node based on the operator type.
 */
export const applyLookahead = (
  operator: string,
  expression: Expression,
): Expression => {
  switch (operator) {
    case "&":
      return createPositiveLookahead(expression);
    case "!":
      return createNegativeLookahead(expression);
    default:
      // If no lookahead operator, return the expression as-is
      return expression;
  }
};

/**
 * Creates a parser that handles lookahead for any base expression parser.
 * This is a higher-order function that wraps any expression parser with lookahead support.
 *
 * Lookahead operators are prefix operators, so we parse the operator first,
 * then the expression it applies to.
 */
export const withLookahead = <T extends Expression>(
  expressionParser: Parser<T>,
): Parser<Expression> => {
  return (input: string, pos) => {
    // First try to parse a lookahead operator
    const operatorResult = lookaheadOperator(input, pos);

    if (operatorResult.success) {
      // If we found a lookahead operator, parse the following expression
      const expressionResult = expressionParser(input, operatorResult.next);
      if (!expressionResult.success) {
        return expressionResult;
      }

      // Apply the lookahead operator to the expression
      const lookaheadExpression = applyLookahead(
        operatorResult.val,
        expressionResult.val,
      );

      return {
        success: true,
        val: lookaheadExpression,
        current: pos,
        next: expressionResult.next,
      };
    }

    // If no lookahead operator, just parse the expression normally
    return expressionParser(input, pos);
  };
};

/**
 * Parses a positive lookahead expression specifically.
 * Exported for direct use when positive lookahead parsing is needed.
 */
export const positiveLookaheadExpression = (
  expression: Expression,
): PositiveLookahead => {
  return createPositiveLookahead(expression);
};

/**
 * Parses a negative lookahead expression specifically.
 * Exported for direct use when negative lookahead parsing is needed.
 */
export const negativeLookaheadExpression = (
  expression: Expression,
): NegativeLookahead => {
  return createNegativeLookahead(expression);
};
