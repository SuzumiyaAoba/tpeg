/**
 * TPEG Repetition Operators Parser
 *
 * Implements parsing of repetition operators: *, +, ?, {n,m}
 * Based on docs/peg-grammar.md specification.
 *
 * Repetition operators are postfix operators with high precedence:
 * - expr* (zero or more)
 * - expr+ (one or more)
 * - expr? (zero or one)
 * - expr{n} (exactly n times)
 * - expr{n,m} (n to m times)
 * - expr{n,} (n or more times)
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  charClass,
  choice,
  literal,
  map,
  oneOrMore,
  optional,
  seq,
} from "@suzumiyaaoba/tpeg-core";
import type { Expression, Optional, Plus, Quantified, Star } from "./types";
import {
  createOptional,
  createPlus,
  createQuantified,
  createStar,
} from "./types";

/**
 * Parses a star repetition operator: expr*
 * Zero or more repetitions of the given expression.
 */
export const starOperator: Parser<string> = literal("*");

/**
 * Parses a plus repetition operator: expr+
 * One or more repetitions of the given expression.
 */
export const plusOperator: Parser<string> = literal("+");

/**
 * Parses an optional operator: expr?
 * Zero or one occurrence of the given expression.
 */
export const optionalOperator: Parser<string> = literal("?");

/**
 * Parses a quantified repetition operator: expr{n}, expr{n,m}, expr{n,}
 * Supports exact count, range, and minimum repetitions.
 */
export const quantifiedOperator: Parser<{ min: number; max?: number }> =
  (() => {
    // Parse a positive integer
    const positiveInt: Parser<number> = map(
      oneOrMore(charClass(["0", "9"])),
      (digits) => Number.parseInt(digits.join(""), 10),
    );

    // Parse {n} - exactly n times
    const exactCount: Parser<{ min: number; max?: number }> = map(
      seq(literal("{"), positiveInt, literal("}")),
      ([_, count, __]) => ({ min: count, max: count }),
    );

    // Parse {n,} - n or more times
    const minCount: Parser<{ min: number; max?: number }> = map(
      seq(literal("{"), positiveInt, literal(","), literal("}")),
      ([_, min, __, ___]) => ({ min }),
    );

    // Parse {n,m} - n to m times
    const rangeCount: Parser<{ min: number; max?: number }> = map(
      seq(literal("{"), positiveInt, literal(","), positiveInt, literal("}")),
      ([_, min, __, max, ___]) => ({ min, max }),
    );

    return choice(rangeCount, minCount, exactCount);
  })();

/**
 * Applies a repetition operator to a base expression.
 * Creates the appropriate AST node based on the operator type.
 */
export const applyRepetition = (
  expression: Expression,
  operator: string | { min: number; max?: number },
): Expression => {
  if (typeof operator === "string") {
    switch (operator) {
      case "*":
        return createStar(expression);
      case "+":
        return createPlus(expression);
      case "?":
        return createOptional(expression);
      default:
        return expression;
    }
  }
  // Quantified repetition
  return createQuantified(expression, operator.min, operator.max);
};

/**
 * Parses any repetition operator.
 * Returns the operator information for later application.
 */
export const repetitionOperator: Parser<
  string | { min: number; max?: number }
> = choice(starOperator, plusOperator, optionalOperator, quantifiedOperator);

/**
 * The "optional repetition operator" parser used by {@link withRepetition},
 * built once at module scope instead of per call (see below).
 */
const optionalRepetitionOperator = optional(repetitionOperator);

/**
 * Creates a parser that handles repetition for any base expression parser.
 * This is a higher-order function that wraps any expression parser with repetition support.
 *
 * Every postfix expression in a grammar (identifiers, groups, char classes, ...)
 * is wrapped with this, so it reuses a module-level operator parser built once
 * rather than constructing a fresh combinator tree on every invocation.
 */
export const withRepetition = <T extends Expression>(
  expressionParser: Parser<T>,
): Parser<Expression> => {
  return (input: string, pos) => {
    // First parse the base expression
    const baseResult = expressionParser(input, pos);
    if (!baseResult.success) {
      return baseResult;
    }

    // Then try to parse repetition operators (never fails: optional() always succeeds)
    const opResult = optionalRepetitionOperator(input, baseResult.next);
    if (!opResult.success) {
      return opResult;
    }
    const [repetitionOp] = opResult.val;

    return {
      success: true,
      val:
        repetitionOp !== undefined
          ? applyRepetition(baseResult.val, repetitionOp)
          : baseResult.val,
      current: baseResult.next,
      next: opResult.next,
    };
  };
};

/**
 * Parses a star repetition expression specifically.
 * Exported for direct use when star parsing is needed.
 */
export const starExpression = (baseExpression: Expression): Star =>
  createStar(baseExpression);

/**
 * Parses a plus repetition expression specifically.
 * Exported for direct use when plus parsing is needed.
 */
export const plusExpression = (baseExpression: Expression): Plus =>
  createPlus(baseExpression);

/**
 * Parses an optional expression specifically.
 * Exported for direct use when optional parsing is needed.
 */
export const optionalExpression = (baseExpression: Expression): Optional =>
  createOptional(baseExpression);

/**
 * Parses a quantified expression specifically.
 * Exported for direct use when quantified parsing is needed.
 */
export const quantifiedExpression = (
  baseExpression: Expression,
  min: number,
  max?: number,
): Quantified => createQuantified(baseExpression, min, max);
