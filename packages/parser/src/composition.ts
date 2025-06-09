/**
 * TPEG Composition Operators Parser
 * 
 * Implements parsing of composition operators: sequence, choice, group
 * Based on docs/peg-grammar.md specification.
 * 
 * Operator precedence (highest to lowest):
 * 1. Group: (expr)
 * 2. Sequence: expr1 expr2 expr3
 * 3. Choice: expr1 / expr2 / expr3
 */

import type { Parser } from 'tpeg-core';
import type { Expression, Sequence, Choice, Group, BasicSyntaxNode } from './types';
import { literal, choice, seq, map, oneOrMore, zeroOrMore, charClass } from 'tpeg-core';
import { recursive } from 'tpeg-combinator';
import { stringLiteral } from './string-literal';
import { characterClass } from './character-class';
import { identifier } from './identifier';

/**
 * Parses whitespace and returns nothing.
 * Used for optional whitespace in composition operators.
 */
const whitespace = (): Parser<void> => {
  return map(
    zeroOrMore(charClass(' ', '\t', '\n', '\r')),
    () => undefined
  );
};

/**
 * Parses any basic syntax element (string literal, character class, identifier, any char).
 * This is a local version to avoid circular imports.
 */
const basicSyntax = (): Parser<BasicSyntaxNode> => {
  return choice(
    stringLiteral(),
    characterClass(),
    identifier()
  );
};

// Create recursive parser for expressions
const [expressionParser, setExpressionParser] = recursive<Expression>();

/**
 * Parses a primary expression (basic syntax or grouped expression).
 * This handles the highest precedence level.
 */
const primary = (): Parser<Expression> => {
  return choice(
    groupExpression(),
    map(basicSyntax(), (node): Expression => node)
  );
};

/**
 * Parses a group expression: (expression)
 * Groups have the highest precedence and can contain any expression.
 */
const groupExpression = (): Parser<Group> => {
  return map(
    seq(
      literal('('),
      seq(
        whitespace(),
        expressionParser,
        whitespace()
      ),
      literal(')')
    ),
    ([_, [__, expr, ___], ____]) => ({
      type: 'Group' as const,
      expression: expr
    })
  );
};

/**
 * Parses a sequence of primary expressions separated by whitespace.
 * Returns a single expression if only one element, otherwise a Sequence.
 */
const sequenceExpression = (): Parser<Expression> => {
  return map(
    seq(
      primary(),
      zeroOrMore(
        seq(
          oneOrMore(charClass(' ', '\t', '\n', '\r')), // Require at least one whitespace
          primary()
        )
      )
    ),
    ([first, rest]) => {
      if (rest.length === 0) {
        return first;
      }
      const elements = [first, ...rest.map(([_, expr]) => expr)];
      return {
        type: 'Sequence' as const,
        elements
      } as Sequence;
    }
  );
};

/**
 * Parses a choice expression: expr1 / expr2 / expr3
 * Choices have the lowest precedence.
 */
const choiceExpression = (): Parser<Expression> => {
  return map(
    seq(
      sequenceExpression(),
      zeroOrMore(
        seq(
          whitespace(),
          literal('/'),
          whitespace(),
          sequenceExpression()
        )
      )
    ),
    ([first, rest]) => {
      if (rest.length === 0) {
        return first;
      }
      const alternatives = [first, ...rest.map(([_, __, ___, expr]) => expr)];
      return {
        type: 'Choice' as const,
        alternatives
      } as Choice;
    }
  );
};

// Set up the recursive parser
setExpressionParser(choiceExpression());

/**
 * Parses any TPEG expression.
 * This is the main entry point for parsing composition operators.
 * 
 * @returns Parser<Expression> Parser that matches any TPEG expression
 * 
 * @example
 * ```typescript
 * // Parse a simple sequence
 * const result1 = expression()('"hello" " " "world"', { offset: 0, line: 1, column: 1 });
 * 
 * // Parse a choice
 * const result2 = expression()('"true" / "false"', { offset: 0, line: 1, column: 1 });
 * 
 * // Parse a grouped expression
 * const result3 = expression()('("a" / "b") "c"', { offset: 0, line: 1, column: 1 });
 * ```
 */
export const expression = (): Parser<Expression> => {
  return expressionParser;
};

/**
 * Parses a sequence operator specifically.
 * Exported for direct use when sequence parsing is needed.
 */
export const sequenceOperator = (): Parser<Sequence> => {
  const result = sequenceExpression();
  return map(
    result,
    (expr) => {
      if (expr.type === 'Sequence') {
        return expr;
      }
      // If it's not a sequence, wrap it in a sequence with one element
      return {
        type: 'Sequence' as const,
        elements: [expr]
      };
    }
  );
};

/**
 * Parses a choice operator specifically.
 * Exported for direct use when choice parsing is needed.
 */
export const choiceOperator = (): Parser<Choice> => {
  const result = choiceExpression();
  return map(
    result,
    (expr) => {
      if (expr.type === 'Choice') {
        return expr;
      }
      // If it's not a choice, wrap it in a choice with one alternative
      return {
        type: 'Choice' as const,
        alternatives: [expr]
      };
    }
  );
};

/**
 * Parses a group operator specifically.
 * Exported for direct use when group parsing is needed.
 */
export const groupOperator = (): Parser<Group> => {
  return groupExpression();
};