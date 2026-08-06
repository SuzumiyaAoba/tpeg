/**
 * Negative-lookahead degeneration: `!a .` -> a negated character class.
 *
 * `Sequence([NegativeLookahead(a), AnyChar])` succeeds iff `a` does NOT
 * match at the current position AND a character is available to consume,
 * and then consumes exactly that one character -- exactly what a negated
 * `CharacterClass` built from `a` does directly, provided `a` itself
 * matches exactly one character based only on that character (a
 * single-character `StringLiteral` or a `CharacterClass`; anything else,
 * e.g. a multi-character literal or a rule reference, is left alone).
 *
 * This changes value shape (the `Sequence` contributes two array slots,
 * `[undefined, char]`; the replacement contributes one, `char`), so it
 * uses the same `isShapeSensitiveRule` gate as `leftFactorChoices` (see
 * `ast-optimize.ts`'s module doc comment).
 */

import { isShapeSensitiveRule } from "./ast-optimize-shared";
import type {
  CharacterClass,
  Expression,
  GrammarDefinition,
  RuleDefinition,
} from "./types";
import { createChoice, createSequence } from "./types";

/** A negated-`CharacterClass` view of "not `expr`" for a single-character
 * `expr`, or `null` if `expr` doesn't match exactly one character based
 * only on that character's identity. */
const negatedCharClassView = (expr: Expression): CharacterClass | null => {
  if (expr.type === "CharacterClass") {
    return {
      type: "CharacterClass",
      ranges: expr.ranges,
      negated: !expr.negated,
    };
  }
  if (expr.type === "StringLiteral" && expr.value.length === 1) {
    return {
      type: "CharacterClass",
      ranges: [{ start: expr.value }],
      negated: true,
    };
  }
  return null;
};

const degenerateSequenceElements = (elements: Expression[]): Expression[] => {
  const result: Expression[] = [];
  let i = 0;
  while (i < elements.length) {
    const el = elements[i] as Expression;
    const next = elements[i + 1];
    if (el.type === "NegativeLookahead" && next?.type === "AnyChar") {
      const view = negatedCharClassView(el.expression);
      if (view) {
        result.push(view);
        i += 2;
        continue;
      }
    }
    result.push(el);
    i++;
  }
  return result;
};

const degenerateNegativeLookaheadsInExpression = (
  expr: Expression,
): Expression => {
  switch (expr.type) {
    case "Sequence": {
      const elements = degenerateSequenceElements(
        expr.elements.map(degenerateNegativeLookaheadsInExpression),
      );
      // A `[NegativeLookahead, AnyChar]` pair degenerating out of a
      // 2-element Sequence leaves exactly 1 element -- unwrap to that
      // bare element rather than emitting a needless `Sequence([x])`
      // wrapper (whose own `.val` would be `[xval]`, a 1-tuple, instead
      // of `xval` directly). Safe under the same rule-level shape gate
      // that already covers this transform.
      return elements.length === 1
        ? (elements[0] as Expression)
        : createSequence(elements);
    }
    case "Choice":
      return createChoice(
        expr.alternatives.map(degenerateNegativeLookaheadsInExpression),
      );
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
    case "Quantified":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "LabeledExpression":
    case "ActionExpression":
      return {
        ...expr,
        expression: degenerateNegativeLookaheadsInExpression(expr.expression),
      };
    default:
      return expr;
  }
};

/** Returns a new `GrammarDefinition` with `!a .` degenerated to a negated
 * character class throughout every rule that isn't shape-sensitive (see
 * `ast-optimize.ts`'s module doc comment and `isShapeSensitiveRule`). */
export const degenerateNegativeLookaheads = (
  grammar: GrammarDefinition,
): GrammarDefinition => {
  const rules: RuleDefinition[] = grammar.rules.map((rule) =>
    isShapeSensitiveRule(grammar, rule)
      ? rule
      : {
          ...rule,
          pattern: degenerateNegativeLookaheadsInExpression(rule.pattern),
        },
  );

  return { ...grammar, rules };
};
