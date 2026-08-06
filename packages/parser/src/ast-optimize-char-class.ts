/**
 * Character class merging: `[a-z] / [A-Z]` -> `[a-zA-Z]`.
 *
 * Unlike left factoring, this never changes value shape: a matching
 * `CharacterClass` always returns the one matched character as its `.val`,
 * whichever alternative of the original `Choice` it came from -- the
 * merged class returns the exact same character for the exact same
 * inputs. No rule-level safety gate is needed.
 *
 * Restricted to *non-negated* `CharacterClass` alternatives (plus
 * single-character `StringLiteral`s, treated as a one-range class): a
 * negated class already reads "any character NOT in these ranges", and
 * merging two negated classes by unioning ranges would compute the wrong
 * set (De Morgan's law wants an *intersection* of ranges there, not a
 * union) -- rather than get that subtly wrong, negated classes are left
 * untouched.
 */

import type { CharacterClass, Expression, GrammarDefinition } from "./types";
import { createChoice, createSequence } from "./types";

/** A `CharacterClass`-equivalent view of `expr`, or `null` if `expr`
 * isn't safely mergeable (negated classes excluded -- see doc above). */
const charClassView = (expr: Expression): CharacterClass | null => {
  if (expr.type === "CharacterClass" && !expr.negated) return expr;
  if (expr.type === "StringLiteral" && expr.value.length === 1) {
    return {
      type: "CharacterClass",
      ranges: [{ start: expr.value }],
      negated: false,
    };
  }
  return null;
};

const mergeCharacterClassRanges = (
  classes: CharacterClass[],
): CharacterClass => ({
  type: "CharacterClass",
  ranges: classes.flatMap((c) => c.ranges),
  negated: false,
});

/** Merges each maximal run of >=2 consecutive mergeable alternatives into
 * one `CharacterClass`; a lone mergeable alternative (no adjacent partner)
 * and any non-mergeable alternative are returned unchanged, in place. */
const mergeAdjacentCharacterClasses = (
  alternatives: Expression[],
): Expression[] => {
  const result: Expression[] = [];
  let i = 0;
  while (i < alternatives.length) {
    const view = charClassView(alternatives[i] as Expression);
    if (!view) {
      result.push(alternatives[i] as Expression);
      i++;
      continue;
    }
    const run: CharacterClass[] = [view];
    let j = i + 1;
    while (j < alternatives.length) {
      const nextView = charClassView(alternatives[j] as Expression);
      if (!nextView) break;
      run.push(nextView);
      j++;
    }
    result.push(
      run.length >= 2
        ? mergeCharacterClassRanges(run)
        : (alternatives[i] as Expression),
    );
    i = j;
  }
  return result;
};

const mergeCharacterClassesInExpression = (expr: Expression): Expression => {
  switch (expr.type) {
    case "Sequence":
      return createSequence(
        expr.elements.map(mergeCharacterClassesInExpression),
      );
    case "Choice": {
      const mergedAlternatives = mergeAdjacentCharacterClasses(
        expr.alternatives.map(mergeCharacterClassesInExpression),
      );
      return mergedAlternatives.length === 1
        ? (mergedAlternatives[0] as Expression)
        : createChoice(mergedAlternatives);
    }
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
        expression: mergeCharacterClassesInExpression(expr.expression),
      };
    default:
      return expr;
  }
};

/** Returns a new `GrammarDefinition` with adjacent mergeable
 * `CharacterClass`/single-character `StringLiteral` alternatives in every
 * `Choice` merged into one `CharacterClass`, throughout every rule. */
export const mergeCharacterClasses = (
  grammar: GrammarDefinition,
): GrammarDefinition => ({
  ...grammar,
  rules: grammar.rules.map((rule) => ({
    ...rule,
    pattern: mergeCharacterClassesInExpression(rule.pattern),
  })),
});
