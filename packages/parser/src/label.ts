/**
 * TPEG Label Parser
 * 
 * Implements parsing of labeled expressions: name:expr
 * Based on docs/peg-grammar.md specification.
 * 
 * Labels enable capture of parsed expressions with meaningful names,
 * allowing structured access to parsing results.
 */

import type { Parser } from 'tpeg-core';
import type { Expression, LabeledExpression } from './types';
import { literal, choice, seq, map, optional } from 'tpeg-core';
import { identifier } from './identifier';

/**
 * Creates a labeled expression AST node.
 * 
 * @param label - The label identifier
 * @param expression - The expression being labeled
 * @returns LabeledExpression AST node
 */
export const createLabeledExpression = (
  label: string,
  expression: Expression
): LabeledExpression => ({
  type: 'LabeledExpression',
  label,
  expression
});

/**
 * Parses a labeled expression: name:expr
 * 
 * A labeled expression consists of:
 * - An identifier (the label)
 * - A colon ":"
 * - An expression to be labeled
 * 
 * @param expressionParser - Parser for the expression part
 * @returns Parser that matches labeled expressions
 * 
 * @example
 * ```typescript
 * const parser = labeledExpression(someExpressionParser);
 * const result = parser('name:"hello"', { offset: 0, line: 1, column: 1 });
 * // result.value = { type: 'LabeledExpression', label: 'name', expression: ... }
 * ```
 */
export const labeledExpression = (
  expressionParser: () => Parser<Expression>
): Parser<LabeledExpression> => {
  return map(
    seq(
      identifier(),
      literal(':'),
      expressionParser()
    ),
    ([label, _, expression]) => createLabeledExpression(label.name, expression)
  );
};

/**
 * Creates a parser that can handle both labeled and unlabeled expressions.
 * 
 * This parser tries to match a labeled expression first, and if that fails,
 * falls back to parsing the expression without a label.
 * 
 * @param expressionParser - Parser for the expression part
 * @returns Parser that matches either labeled or unlabeled expressions
 * 
 * @example
 * ```typescript
 * const parser = withOptionalLabel(basicSyntaxParser);
 * const result1 = parser('name:"hello"', { offset: 0, line: 1, column: 1 });
 * // result1.value = { type: 'LabeledExpression', label: 'name', expression: ... }
 * 
 * const result2 = parser('"hello"', { offset: 0, line: 1, column: 1 });
 * // result2.value = { type: 'StringLiteral', value: 'hello', quote: '"' }
 * ```
 */
export const withOptionalLabel = <T extends Expression>(
  expressionParser: Parser<T>
): Parser<Expression> => {
  return (input: string, pos) => {
    // First try to parse as a labeled expression
    const labelResult = identifier()(input, pos);
    
    if (labelResult.success) {
      // Check if there's a colon after the label
      const colonResult = literal(':')(input, labelResult.next);
      
      if (colonResult.success) {
        // If we have label:, parse the following expression
        const expressionResult = expressionParser(input, colonResult.next);
        if (!expressionResult.success) {
          return expressionResult;
        }
        
        // Create labeled expression
        const labeledExpr = createLabeledExpression(labelResult.val.name, expressionResult.val);
        
        return {
          success: true,
          val: labeledExpr,
          current: pos,
          next: expressionResult.next
        };
      }
    }
    
    // If no label found, just parse the expression normally
    return expressionParser(input, pos);
  };
};