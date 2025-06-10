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

import type { Parser } from 'tpeg-core';
import type { Expression, Star, Plus, Optional, Quantified } from './types';
import { literal, choice, seq, map, optional, charClass, oneOrMore } from 'tpeg-core';

/**
 * Parses a star repetition operator: expr*
 * Zero or more repetitions of the given expression.
 */
export const starOperator = (): Parser<string> => {
  return literal('*');
};

/**
 * Parses a plus repetition operator: expr+
 * One or more repetitions of the given expression.
 */
export const plusOperator = (): Parser<string> => {
  return literal('+');
};

/**
 * Parses an optional operator: expr?
 * Zero or one occurrence of the given expression.
 */
export const optionalOperator = (): Parser<string> => {
  return literal('?');
};

/**
 * Parses a quantified repetition operator: expr{n}, expr{n,m}, expr{n,}
 * Supports exact count, range, and minimum repetitions.
 */
export const quantifiedOperator = (): Parser<{ min: number; max?: number }> => {
  // Parse a positive integer
  const positiveInt = (): Parser<number> => {
    return map(
      oneOrMore(charClass(['0', '9'])),
      (digits) => Number.parseInt(digits.join(''), 10)
    );
  };

  // Parse {n} - exactly n times
  const exactCount = (): Parser<{ min: number; max?: number }> => {
    return map(
      seq(
        literal('{'),
        positiveInt(),
        literal('}')
      ),
      ([_, count, __]) => ({ min: count, max: count })
    );
  };

  // Parse {n,} - n or more times
  const minCount = (): Parser<{ min: number; max?: number }> => {
    return map(
      seq(
        literal('{'),
        positiveInt(),
        literal(','),
        literal('}')
      ),
      ([_, min, __, ___]) => ({ min, max: undefined })
    );
  };

  // Parse {n,m} - n to m times
  const rangeCount = (): Parser<{ min: number; max?: number }> => {
    return map(
      seq(
        literal('{'),
        positiveInt(),
        literal(','),
        positiveInt(),
        literal('}')
      ),
      ([_, min, __, max, ___]) => ({ min, max })
    );
  };

  return choice(
    rangeCount(),
    minCount(),
    exactCount()
  );
};

/**
 * Applies a repetition operator to a base expression.
 * Creates the appropriate AST node based on the operator type.
 */
export const applyRepetition = (
  expression: Expression,
  operator: string | { min: number; max?: number }
): Expression => {
  if (typeof operator === 'string') {
    switch (operator) {
      case '*':
        return {
          type: 'Star' as const,
          expression
        } as Star;
      case '+':
        return {
          type: 'Plus' as const,
          expression
        } as Plus;
      case '?':
        return {
          type: 'Optional' as const,
          expression
        } as Optional;
      default:
        return expression;
    }
  }
  // Quantified repetition
  return {
    type: 'Quantified' as const,
    expression,
    min: operator.min,
    max: operator.max
  } as Quantified;
};

/**
 * Parses any repetition operator.
 * Returns the operator information for later application.
 */
export const repetitionOperator = (): Parser<string | { min: number; max?: number }> => {
  return choice(
    starOperator(),
    plusOperator(),
    optionalOperator(),
    quantifiedOperator()
  );
};

/**
 * Parses a postfix expression with optional repetition operators.
 * Handles multiple consecutive repetition operators like: expr*+?
 */
export const parseRepetition = (baseExpression: Expression): Parser<Expression> => {
  return map(
    seq(
      // The base expression is already parsed
      // Just parse any following repetition operators
      optional(repetitionOperator())
    ),
    ([repetitionOp]) => {
      // repetitionOp is either [operator] or [] from optional parser
      if (repetitionOp.length > 0) {
        return applyRepetition(baseExpression, repetitionOp[0]);
      }
      return baseExpression;
    }
  );
};

/**
 * Creates a parser that handles repetition for any base expression parser.
 * This is a higher-order function that wraps any expression parser with repetition support.
 */
export const withRepetition = <T extends Expression>(
  expressionParser: Parser<T>
): Parser<Expression> => {
  return (input: string, pos) => {
    // First parse the base expression
    const baseResult = expressionParser(input, pos);
    if (!baseResult.success) {
      return baseResult;
    }

    // Then try to parse repetition operators
    const repetitionParser = parseRepetition(baseResult.val);
    return repetitionParser(input, baseResult.next);
  };
};

/**
 * Parses a star repetition expression specifically.
 * Exported for direct use when star parsing is needed.
 */
export const starExpression = (baseExpression: Expression): Star => {
  return {
    type: 'Star' as const,
    expression: baseExpression
  };
};

/**
 * Parses a plus repetition expression specifically.
 * Exported for direct use when plus parsing is needed.
 */
export const plusExpression = (baseExpression: Expression): Plus => {
  return {
    type: 'Plus' as const,
    expression: baseExpression
  };
};

/**
 * Parses an optional expression specifically.
 * Exported for direct use when optional parsing is needed.
 */
export const optionalExpression = (baseExpression: Expression): Optional => {
  return {
    type: 'Optional' as const,
    expression: baseExpression
  };
};

/**
 * Parses a quantified expression specifically.
 * Exported for direct use when quantified parsing is needed.
 */
export const quantifiedExpression = (
  baseExpression: Expression,
  min: number,
  max?: number
): Quantified => {
  return {
    type: 'Quantified' as const,
    expression: baseExpression,
    min,
    max
  };
};