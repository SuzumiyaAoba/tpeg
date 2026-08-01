/**
 * Semantics-preserving AST -> AST rewrites, applied before codegen.
 *
 * This is a standalone utility, NOT wired into `generateTypeScriptParser`
 * or `generateOptimizedTypeScriptParser` -- call it explicitly on a
 * `GrammarDefinition` before generating code from it. Keeping it opt-in
 * avoids repeating Phase 0's mistake (an "optimization" that silently
 * changed accepted behavior for every existing caller by default).
 *
 * ## Left factoring
 *
 * `leftFactorChoices` targets exactly one PEG backtracking pattern: a
 * `Choice` whose alternatives all start with the same element, e.g.
 *
 *   sum = product "+" sum / product "-" sum / product
 *
 * A naive backtracking PEG implementation reparses `product` from
 * scratch for every alternative that's tried after the first fails --
 * `packages/parser/bench/grammars.ts`'s `BENCH_UNFACTORED_ARITHMETIC_GRAMMAR`
 * exists specifically to make this cost measurable (see
 * `packages/parser/bench/run.ts`). Rewriting the choice as
 *
 *   sum = product (("+" sum) / ("-" sum) / ())
 *
 * parses the shared prefix once. This is sound because every parser this
 * codebase generates is a pure, deterministic function of (input,
 * position) -- calling `product` twice at the same position is
 * guaranteed to reproduce the same result, so replacing "parse it twice"
 * with "parse it once and reuse the result" cannot change which inputs
 * are accepted or where a resulting parse stops.
 *
 * ## Soundness restrictions (deliberately conservative)
 *
 * Rewriting a `Choice(Sequence(P, X1, X2), Sequence(P, Y1))` into
 * `Sequence(P, Choice(Sequence(X1, X2), Y1))` preserves *language
 * accepted* and *stop position*, but changes the shape of `.val`: the
 * original produces a flat `[Pval, X1val, X2val]` for the first
 * alternative, the factored form produces `[Pval, [X1val, X2val]]` (an
 * extra nesting level from the inner choice). Nothing in this codebase's
 * runtime normalizes that away.
 *
 * That's harmless for a rule nobody reads `.val`/`$$` from, but codegen
 * (`packages/parser/src/codegen.ts`) exposes the raw value shape to two
 * things: an inline `expr { code }` action's `$$`, and a rule-name-matched
 * `transforms` function's `captures`. Both would silently start reading a
 * differently-shaped value after this rewrite. Rather than trying to
 * prove no ancestor action depends on a specific rule's shape (which
 * would require whole-grammar reachability analysis), this function
 * simply refuses to touch any rule that could plausibly be shape-
 * sensitive:
 *
 * - A rule is skipped entirely (no choice inside it is factored) if its
 *   pattern contains an `ActionExpression` anywhere, or if `grammar`
 *   attaches a `transforms` function with a matching name -- both read
 *   that rule's own `.val` as `$$`/`captures`.
 * - A `Choice` is skipped if it (or any of its alternatives, at any
 *   depth) contains a `LabeledExpression`, independent of the rule-level
 *   check above: `codegen.ts`'s `collectTopLevelLabels` looks for labels
 *   as *immediate* children of a `Sequence`, so demoting a label from
 *   top-level to nested-inside-a-newly-introduced-wrapper would silently
 *   break codegen's own label detection, regardless of whether any
 *   action or transform ever reads the result.
 *
 * The remaining, uncovered risk: a rule with no action/transform/label of
 * its own could still be referenced via `Identifier` from an ancestor
 * rule whose *own* action reads deep into a nested structure it expects
 * a specific shape from. This is not checked. Given that, treat this as
 * a narrowly-scoped, explicitly opt-in optimization for shape-insensitive
 * (recognizer-only, or known action/transform-free) grammars -- not a
 * general-purpose optimizer safe to wire into default codegen output.
 *
 * ## Alternative shapes handled
 *
 * Only a `Choice` where the shared prefix is one of `StringLiteral`,
 * `CharacterClass`, `AnyChar`, `Identifier`, or `QualifiedIdentifier` is
 * factored -- these are the terminal/reference node types that cannot
 * themselves embed an `ActionExpression`, so checking the prefix's own
 * type is enough without a subtree walk. `Sequence`/`Choice`/`Group`/
 * quantifiers etc. are never treated as a factorable prefix, even if two
 * alternatives happen to start with structurally identical ones.
 *
 * At most one alternative may be the bare shared prefix with nothing
 * following it (remainder length 0), and it must be the *last*
 * alternative -- e.g. the trailing `/ product` above. That alternative's
 * value (just `Pval`, not sequence-wrapped) cannot be reproduced through
 * the same `Sequence(P, inner)` wrapper as the others, so it is left
 * as a second, un-grouped top-level alternative instead of being folded
 * into the inner choice; this preserves both its exact `.val` shape and
 * its relative try-order. A bare-prefix alternative anywhere other than
 * last, or more than one of them, is left untouched (not factored) --
 * handling arbitrary interleaving isn't needed by any grammar in this
 * repo and isn't implemented.
 */

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
import { createChoice, createSequence } from "./types";

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

/** Does `expr` contain a `LabeledExpression` anywhere in its subtree? */
const containsLabel = (expr: Expression): boolean => {
  switch (expr.type) {
    case "LabeledExpression":
      return true;
    case "Sequence":
      return expr.elements.some(containsLabel);
    case "Choice":
      return expr.alternatives.some(containsLabel);
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "Quantified":
      return containsLabel(expr.expression);
    case "ActionExpression":
      return containsLabel(expr.expression);
    default:
      return false;
  }
};

/** Does `expr` contain an `ActionExpression` anywhere in its subtree? */
const containsAction = (expr: Expression): boolean => {
  switch (expr.type) {
    case "ActionExpression":
      return true;
    case "Sequence":
      return expr.elements.some(containsAction);
    case "Choice":
      return expr.alternatives.some(containsAction);
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "Quantified":
    case "LabeledExpression":
      return containsAction(expr.expression);
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
  const groupedExpr = createSequence([
    prefix,
    innerAlternatives.length === 1
      ? (innerAlternatives[0] as Expression)
      : createChoice(innerAlternatives),
  ]);

  if (bareIndices.length === 0) {
    return groupedExpr;
  }
  // Trailing bare-prefix alternative: kept as its own top-level
  // alternative (see doc comment for why it can't be folded in).
  return createChoice([groupedExpr, prefix]);
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

const grammarHasTransformFor = (
  grammar: GrammarDefinition,
  ruleName: string,
): boolean =>
  (grammar.transforms ?? []).some((def) =>
    def.transformSet.functions.some((fn) => fn.name === ruleName),
  );

/**
 * Returns a new `GrammarDefinition` with left factoring applied to every
 * rule that isn't shape-sensitive (see the module doc comment). Rules
 * that are skipped are returned unchanged (same object reference).
 */
export const leftFactorChoices = (
  grammar: GrammarDefinition,
): GrammarDefinition => {
  const rules: RuleDefinition[] = grammar.rules.map((rule) => {
    if (
      containsAction(rule.pattern) ||
      grammarHasTransformFor(grammar, rule.name)
    ) {
      return rule;
    }
    return { ...rule, pattern: leftFactorExpression(rule.pattern) };
  });

  return { ...grammar, rules };
};
