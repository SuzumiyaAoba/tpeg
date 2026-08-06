/**
 * Left factoring: a `Choice` whose alternatives all start with the same
 * element, e.g.
 *
 *   sum = product "+" sum / product "-" sum / product
 *
 * gets rewritten to
 *
 *   sum = product (("+" sum) / ("-" sum) / ())
 *
 * so the shared prefix is parsed once instead of once per attempted
 * alternative. See `ast-optimize.ts`'s module doc comment (its "Left
 * factoring", "Soundness restrictions", and "Alternative shapes handled"
 * sections) for the full soundness argument and shape-sensitivity caveats
 * this rewrite is gated on.
 */

import { containsLabel, isShapeSensitiveRule } from "./ast-optimize-shared";
import type {
  CharacterClass,
  Choice,
  Expression,
  GrammarDefinition,
  Identifier,
  QualifiedIdentifier,
  RuleDefinition,
  Sequence,
  StringLiteral,
} from "./types";
import { createChoice, createOptional, createSequence } from "./types";

/** Node types that cannot themselves embed an `ActionExpression` or
 * `LabeledExpression`, so a single-type check on the node itself
 * (no subtree walk) is enough to know it's a safe factoring prefix. */
type FactorablePrefix =
  | StringLiteral
  | CharacterClass
  | { type: "AnyChar" }
  | Identifier
  | QualifiedIdentifier;

const isFactorablePrefixType = (expr: Expression): expr is FactorablePrefix =>
  expr.type === "StringLiteral" ||
  expr.type === "CharacterClass" ||
  expr.type === "AnyChar" ||
  expr.type === "Identifier" ||
  expr.type === "QualifiedIdentifier";

const charRangesEqual = (
  a: CharacterClass["ranges"],
  b: CharacterClass["ranges"],
): boolean =>
  a.length === b.length &&
  a.every((r, i) => r.start === b[i]?.start && r.end === b[i]?.end);

/** Structural equality for two factorable-prefix nodes of possibly
 * different types (returns false on a type mismatch). */
const prefixesEqual = (a: Expression, b: Expression): boolean => {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "StringLiteral":
      return a.value === (b as StringLiteral).value;
    case "AnyChar":
      return true;
    case "Identifier":
      return a.name === (b as Identifier).name;
    case "QualifiedIdentifier":
      return (
        a.module === (b as QualifiedIdentifier).module &&
        a.name === (b as QualifiedIdentifier).name
      );
    case "CharacterClass": {
      const other = b as CharacterClass;
      return (
        a.negated === other.negated && charRangesEqual(a.ranges, other.ranges)
      );
    }
    default:
      return false;
  }
};

const partsOf = (expr: Expression): Expression[] =>
  expr.type === "Sequence" ? (expr as Sequence).elements : [expr];

const toSingleExpression = (parts: Expression[]): Expression =>
  parts.length === 1 ? (parts[0] as Expression) : createSequence(parts);

/**
 * Attempts to left-factor a single `Choice` node. Returns the original
 * node unchanged if the safety/shape conditions above aren't met.
 */
const tryLeftFactorChoice = (choice: Choice): Expression => {
  const { alternatives } = choice;
  if (alternatives.length < 2) return choice;
  if (containsLabel(choice)) return choice;

  const partsList = alternatives.map(partsOf);
  if (partsList.some((parts) => parts.length === 0)) return choice;

  // At most one bare-prefix (remainder length 0) alternative, and only
  // as the last one -- see the "Alternative shapes handled" doc above.
  const bareIndices = partsList
    .map((parts, i) => (parts.length === 1 ? i : -1))
    .filter((i) => i >= 0);
  if (bareIndices.length > 1) return choice;
  if (bareIndices.length === 1 && bareIndices[0] !== partsList.length - 1) {
    return choice;
  }

  const groupedCount =
    bareIndices.length === 1 ? partsList.length - 1 : partsList.length;
  if (groupedCount < 2) return choice;

  const groupedParts = partsList.slice(0, groupedCount);
  const prefix = groupedParts[0]?.[0];
  if (!prefix || !isFactorablePrefixType(prefix)) return choice;
  if (
    !groupedParts.every((parts) =>
      prefixesEqual(parts[0] as Expression, prefix),
    )
  ) {
    return choice;
  }

  const innerAlternatives = groupedParts.map((parts) =>
    toSingleExpression(parts.slice(1)),
  );
  const innerExpr =
    innerAlternatives.length === 1
      ? (innerAlternatives[0] as Expression)
      : createChoice(innerAlternatives);

  if (bareIndices.length === 0) {
    return createSequence([prefix, innerExpr]);
  }
  // Trailing bare-prefix alternative: fold into `prefix (inner)?` rather
  // than reparsing `prefix` a second time for a separate bare alternative
  // -- see the module doc comment's "Alternative shapes handled" section.
  return createSequence([prefix, createOptional(innerExpr)]);
};

/** Recursively applies `tryLeftFactorChoice` to every `Choice` reachable
 * from `expr`, bottom-up (children first, so a factored inner choice is
 * itself eligible to be the target of an outer factoring). */
const leftFactorExpression = (expr: Expression): Expression => {
  switch (expr.type) {
    case "Sequence":
      return createSequence(expr.elements.map(leftFactorExpression));
    case "Choice": {
      const factoredAlternatives = expr.alternatives.map(leftFactorExpression);
      return tryLeftFactorChoice(createChoice(factoredAlternatives));
    }
    case "Group":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "Star":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "Plus":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "Optional":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "Quantified":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "PositiveLookahead":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "NegativeLookahead":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "LabeledExpression":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    case "ActionExpression":
      return { ...expr, expression: leftFactorExpression(expr.expression) };
    default:
      return expr;
  }
};

/**
 * Returns a new `GrammarDefinition` with left factoring applied to every
 * rule that isn't shape-sensitive (see the module doc comment). Rules
 * that are skipped are returned unchanged (same object reference).
 */
export const leftFactorChoices = (
  grammar: GrammarDefinition,
): GrammarDefinition => {
  const rules: RuleDefinition[] = grammar.rules.map((rule) =>
    isShapeSensitiveRule(grammar, rule)
      ? rule
      : { ...rule, pattern: leftFactorExpression(rule.pattern) },
  );

  return { ...grammar, rules };
};
