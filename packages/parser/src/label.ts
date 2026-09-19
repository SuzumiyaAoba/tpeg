/**
 * TPEG Label Parser
 *
 * Implements parsing of labeled expressions: name:expr
 * Based on docs/peg-grammar.md specification.
 *
 * Labels enable capture of parsed expressions with meaningful names,
 * allowing structured access to parsing results.
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { literal, map, seq } from "@suzumiyaaoba/tpeg-core";
import { identifier } from "./identifier";
import type { Expression, LabeledExpression } from "./types";
import { createLabeledExpression } from "./types";
import { optionalWhitespaceOrComment } from "./whitespace-utils";

/**
 * Parses a labeled expression: name:expr
 *
 * A labeled expression consists of:
 * - An identifier (the label)
 * - A colon ":" (whitespace and comments are allowed on both sides)
 * - An expression to be labeled
 *
 * @param expressionParser - Parser for the expression part
 * @returns Parser that matches labeled expressions
 *
 * @example
 * ```typescript
 * const parser = labeledExpression(someExpressionParser);
 * const result = parser('name:"hello"', 0);
 * // result.value = { type: 'LabeledExpression', label: 'name', expression: ... }
 * ```
 */
export const labeledExpression = (
  expressionParser: () => Parser<Expression>,
): Parser<LabeledExpression> => {
  return map(
    seq(
      identifier,
      optionalWhitespaceOrComment,
      literal(":"),
      optionalWhitespaceOrComment,
      expressionParser(),
    ),
    ([label, _ws1, _, _ws2, expression]) =>
      createLabeledExpression(label.name, expression),
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
 * const result1 = parser('name:"hello"', 0);
 * // result1.value = { type: 'LabeledExpression', label: 'name', expression: ... }
 *
 * const result2 = parser('"hello"', 0);
 * // result2.value = { type: 'StringLiteral', value: 'hello', quote: '"' }
 * ```
 */
export const withOptionalLabel = <T extends Expression>(
  expressionParser: Parser<T>,
): Parser<Expression> => {
  return (input: string, pos) => {
    // First try to parse as a labeled expression
    const labelResult = identifier(input, pos);

    if (labelResult.success) {
      // Whitespace and comments may sit between the label and its colon
      // (`name : expr`) -- optionalWhitespaceOrComment always succeeds on
      // a valid offset, and `labelResult.next` is one.
      const beforeColon = optionalWhitespaceOrComment(input, labelResult.next);
      const colonPos = beforeColon.success
        ? beforeColon.next
        : labelResult.next;

      // Check if there's a colon after the label
      const colonResult = literal(":")(input, colonPos);

      if (colonResult.success) {
        // Whitespace and comments are allowed after the colon too.
        const afterColon = optionalWhitespaceOrComment(input, colonResult.next);
        const exprPos = afterColon.success ? afterColon.next : colonResult.next;

        // If we have label:, parse the following expression
        const expressionResult = expressionParser(input, exprPos);
        if (!expressionResult.success) {
          // A fatal failure inside the labeled expression (an
          // out-of-range quantifier bound, a reversed character class,
          // a resource limit) must propagate: it rejects the input
          // outright, the same way a thrown check in the self-hosted
          // grammar escapes the `labeled` alternative entirely.
          if (expressionResult.error.fatal) {
            return expressionResult;
          }
          // Otherwise the label attempt failed as a WHOLE: `name:expr`
          // is only a label when the entire `ident ":" expr` matches, so
          // a bad expression after the colon falls back to the unlabeled
          // parse -- mirroring the self-hosted grammar's
          // `labeled = label:identifierName ws ":" ws expr:prefix / prefix`.
          // `x:!` then parses as a bare `x` followed by a stray `:` --
          // `x : !` takes the same path now that whitespace around the
          // colon is skipped before the check.
          return expressionParser(input, pos);
        }

        // Create labeled expression
        const labeledExpr = createLabeledExpression(
          labelResult.val.name,
          expressionResult.val,
        );

        return {
          success: true,
          val: labeledExpr,
          current: pos,
          next: expressionResult.next,
        };
      }
    }

    // If no label found, just parse the expression normally
    return expressionParser(input, pos);
  };
};
