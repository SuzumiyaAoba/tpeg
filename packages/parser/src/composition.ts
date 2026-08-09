/**
 * TPEG Composition Operators Parser
 *
 * Implements parsing of composition operators: sequence, choice, group
 * Based on docs/peg-grammar.md specification.
 *
 * Operator precedence (highest to lowest):
 * 1. Primary: Basic syntax and Groups (expr)
 * 2. Postfix operators: Repetition (expr*, expr+, expr?, expr{n,m})
 * 3. Prefix operators: Lookahead (&expr, !expr)
 * 4. Labels: Label expressions (name:expr)
 * 5. Sequence: expr1 expr2 expr3
 * 6. Choice: expr1 / expr2 / expr3
 *
 * Repetition binds TIGHTER than lookahead -- `!e*` parses as `!(e*)`, not
 * `(!e)*` -- matching standard PEG (Ford, POPL 2004: `Prefix <- (AND /
 * NOT)? Suffix`) and every mainstream PEG implementation (PEG.js, LPeg,
 * Pest). An explicit group is always available for the other reading
 * (`(!e)*`) when that's actually intended.
 */

import { recursive } from "@suzumiyaaoba/tpeg-combinator";
import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  charClass,
  choice,
  createFailure,
  literal,
  map,
  optional,
  seq,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import { scanBalancedBraces } from "./brace-scanner";
import { characterClass } from "./character-class";
import { identifier } from "./identifier";
import { withOptionalLabel } from "./label";
import { withLookahead } from "./lookahead";
import { qualifiedIdentifier } from "./module";
import { withRepetition } from "./repetition";
import { stringLiteral } from "./string-literal";
import type {
  ActionExpression,
  BasicSyntaxNode,
  Choice,
  Expression,
  Group,
  Sequence,
} from "./types";

/**
 * Parses whitespace and returns nothing.
 * Used for optional whitespace in composition operators.
 */
const whitespace: Parser<void> = map(
  zeroOrMore(charClass(" ", "\t", "\n", "\r")),
  () => undefined,
);

/**
 * Parses any basic syntax element (string literal, character class,
 * qualified identifier, identifier, any char). This is a local version to
 * avoid circular imports.
 *
 * qualifiedIdentifier is tried before identifier: `identifier` alone would
 * otherwise greedily match just the module alias in `module.rule` (e.g.
 * `lit` in `lit.identifier`) and never backtrack to try the qualified form,
 * leaving `.rule` to fall through elsewhere (`.` parses as AnyChar) instead
 * of forming one cross-module reference.
 */
const basicSyntax: Parser<BasicSyntaxNode> = choice(
  stringLiteral,
  characterClass,
  qualifiedIdentifier,
  identifier,
);

// Create recursive parser for expressions using the recursive combinator
const [expressionParser, setExpressionParser] = recursive<Expression>();

/**
 * Parses a primary expression (basic syntax or grouped expression).
 * This handles the highest precedence level.
 */
const primary = (): Parser<Expression> => {
  return choice(
    groupExpression(),
    map(basicSyntax, (node): Expression => node),
  );
};

/**
 * Parses a postfix expression (primary with optional repetition
 * operators). Repetition operators have higher precedence than lookahead
 * -- `!e*` parses as `!(e*)`, matching standard PEG (see this module's
 * doc comment).
 */
const postfix = (): Parser<Expression> => {
  return withRepetition(primary());
};

/**
 * Parses a prefix expression (postfix with optional lookahead operators).
 * Lookahead operators have lower precedence than repetition operators.
 */
const prefix = (): Parser<Expression> => {
  return withLookahead(postfix());
};

/**
 * Parses a labeled expression (prefix with optional labels).
 * Labels have lower precedence than lookahead/repetition operators.
 */
const labeled = (): Parser<Expression> => {
  return withOptionalLabel(prefix());
};

/**
 * Parses a group expression: (expression)
 * Groups have the highest precedence and can contain any expression.
 */
const groupExpression = (): Parser<Group> => {
  return map(
    seq(
      literal("("),
      seq(whitespace, (input, pos) => expressionParser(input, pos), whitespace),
      literal(")"),
    ),
    ([_, [__, expr, ___], ____]) => ({
      type: "Group" as const,
      expression: expr,
    }),
  );
};

/**
 * Matches a semantic action block only when `{` is the very next character
 * (`scanBalancedBraces` alone searches forward for the next `{` anywhere in
 * the remaining input, which is fine for the mandatory `{ ... }` in a
 * transform function but unsafe here: since this is tried speculatively
 * inside `optional()`, that forward search could otherwise skip past
 * unrelated content - e.g. the rest of the rule, or even the grammar's own
 * closing `}` - and misparse a much later brace pair as this alternative's
 * action).
 */
const actionBlock: Parser<string> = (input, pos) => {
  if (input[pos] !== "{") {
    return createFailure("Expected opening brace '{'", pos, {
      expected: ["{"],
      found: input[pos] ?? "",
      parserName: "actionBlock",
    });
  }
  return scanBalancedBraces(input, pos);
};

/**
 * Parses an optional trailing semantic action attached to an alternative:
 * `{ ... }` immediately (modulo whitespace) after the expression, e.g.
 * `digits:[0-9]+ { return parseInt(digits.join("")); }`. Brace matching is
 * string/comment-aware (see `brace-scanner.ts`), since the action's code can
 * itself contain `}` inside string literals or comments.
 */
const withOptionalAction = (parser: Parser<Expression>): Parser<Expression> => {
  return map(
    seq(parser, optional(seq(whitespace, actionBlock))),
    ([expr, action]): Expression => {
      if (action.length === 0) {
        return expr;
      }
      const [, code] = action[0];
      return {
        type: "ActionExpression",
        expression: expr,
        code,
      } as ActionExpression;
    },
  );
};

/**
 * Parses the `~` cut/commit marker: a bare token that may appear as one of
 * a sequence's elements (`"if" ~ condition "then" body`), marking that once
 * everything before it has matched, a failure in anything after it must not
 * let the enclosing choice try a sibling alternative. See `Cut` in
 * grammar-types.ts for the full semantics and `generateSequence` in
 * codegen.ts for how a `Sequence` containing one compiles to `commit(...)`.
 */
const cutMarker: Parser<Expression> = map(
  literal("~"),
  (): Expression => ({ type: "Cut" }),
);

/**
 * Parses a single sequence element: either the `~` cut marker or an
 * ordinary labeled expression. `cutMarker` is tried first since `~` isn't a
 * valid start character for `labeled()` (primary/prefix/postfix/label all
 * begin with a string literal, character class, identifier, "(", "&", or
 * "!"), so there's no ambiguity to backtrack out of.
 */
const sequenceElement = (): Parser<Expression> => choice(cutMarker, labeled());

/**
 * Parses a sequence of labeled expressions (or `~` cut markers), optionally
 * separated by whitespace. Whitespace between elements is optional (not
 * required): PEG juxtaposition doesn't require a separator, so
 * `[a-z][0-9]*` must parse as a two-element sequence exactly like
 * `[a-z] [0-9]*` does. Each `labeled()` element itself always consumes at
 * least one character when it matches (primary() can't match zero-width),
 * and `cutMarker` always consumes exactly one ("~"), so relaxing this to
 * zeroOrMore can't introduce a zero-progress loop iteration.
 *
 * An alternative may be followed by a semantic action block (see
 * `withOptionalAction`), which wraps the whole sequence (or, for a
 * single-element alternative, that one expression) in an `ActionExpression`.
 */
const sequenceExpression = (): Parser<Expression> => {
  return withOptionalAction(
    map(
      seq(
        sequenceElement(),
        zeroOrMore(
          seq(zeroOrMore(charClass(" ", "\t", "\n", "\r")), sequenceElement()),
        ),
      ),
      ([first, rest]) => {
        if (rest.length === 0) {
          return first;
        }
        const elements = [first, ...rest.map(([_, expr]) => expr)];
        return {
          type: "Sequence" as const,
          elements,
        } as Sequence;
      },
    ),
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
        seq(whitespace, literal("/"), whitespace, sequenceExpression()),
      ),
    ),
    ([first, rest]) => {
      if (rest.length === 0) {
        return first;
      }
      const alternatives = [first, ...rest.map(([_, __, ___, expr]) => expr)];
      return {
        type: "Choice" as const,
        alternatives,
      } as Choice;
    },
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
 * const result1 = expression()('"hello" " " "world"', 0);
 *
 * // Parse a choice
 * const result2 = expression()('"true" / "false"', 0);
 *
 * // Parse a grouped expression
 * const result3 = expression()('("a" / "b") "c"', 0);
 * ```
 */
export const expression = (): Parser<Expression> => {
  return expressionParser;
};

/**
 * Parses a postfix expression specifically: a primary expression with
 * optional repetition operators (`expr*`, `expr+`, `expr?`, `expr{n,m}`),
 * but WITHOUT a leading lookahead operator -- `&`/`!` bind at the `prefix`
 * level, one level up (see this module's doc comment on precedence).
 * Exported for direct use when postfix parsing is needed.
 */
export const postfixOperator = (): Parser<Expression> => {
  return postfix();
};

/**
 * Parses a labeled expression specifically: a prefix expression (postfix
 * plus optional lookahead) with an optional leading `name:` label.
 * Exported for direct use when labeled parsing is needed.
 */
export const labeledOperator = (): Parser<Expression> => {
  return labeled();
};

/**
 * Parses a sequence operator specifically.
 * Exported for direct use when sequence parsing is needed.
 */
export const sequenceOperator = (): Parser<Sequence> => {
  const result = sequenceExpression();
  return map(result, (expr) => {
    if (expr.type === "Sequence") {
      return expr;
    }
    // If it's not a sequence, wrap it in a sequence with one element
    return {
      type: "Sequence" as const,
      elements: [expr],
    };
  });
};

/**
 * Parses a choice operator specifically.
 * Exported for direct use when choice parsing is needed.
 */
export const choiceOperator = (): Parser<Choice> => {
  const result = choiceExpression();
  return map(result, (expr) => {
    if (expr.type === "Choice") {
      return expr;
    }
    // If it's not a choice, wrap it in a choice with one alternative
    return {
      type: "Choice" as const,
      alternatives: [expr],
    };
  });
};

/**
 * Parses a group operator specifically.
 * Exported for direct use when group parsing is needed.
 */
export const groupOperator = (): Parser<Group> => {
  return groupExpression();
};
