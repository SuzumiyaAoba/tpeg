/**
 * TPEG Prefix Operators Parser
 *
 * Implements parsing of the prefix operators: &expr, !expr, @expr
 * Based on docs/peg-grammar.md specification.
 *
 * The lookahead operators are prefix operators that do not consume input:
 * - &expr (positive lookahead) - succeeds if expr matches
 * - !expr (negative lookahead) - succeeds if expr does not match
 *
 * `@expr` (span / source-text extraction) shares the same prefix slot --
 * it DOES consume input exactly like its operand, but replaces the
 * match's value with the raw source text consumed. Only ONE prefix
 * operator is allowed per expression (`&!e` and `&@e` are both parse
 * errors), matching the single-`(&|!)?` slot standard PEG gives the
 * prefix position.
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { choice, literal } from "@suzumiyaaoba/tpeg-core";
import type { Expression, NegativeLookahead, PositiveLookahead } from "./types";
import {
  createNegativeLookahead,
  createPositiveLookahead,
  createSpan,
} from "./types";

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
 * Parses a span (source-text extraction) operator: @
 * Used in expressions like @expr
 */
export const spanOperator: Parser<string> = literal("@");

/**
 * Parses any prefix operator (`&`, `!`, or `@`).
 * Returns the operator string for later application.
 */
export const lookaheadOperator: Parser<string> = choice(
  positiveLookaheadOperator,
  negativeLookaheadOperator,
  spanOperator,
);

/**
 * Applies a prefix operator to a base expression.
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
    case "@":
      return createSpan(expression);
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
