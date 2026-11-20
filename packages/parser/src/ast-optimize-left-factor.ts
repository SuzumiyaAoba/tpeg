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
 *
 * ## Fatal failures and hoisted prefixes
 *
 * Hoisting the shared prefix `P` OUT of the `Choice` does not merely
 * change value shape (the concern the rest of this module's doc comment
 * and `ast-optimize.ts`'s cover) -- it also removes a failure-absorption
 * boundary. In the original grammar, every occurrence of `P` sits INSIDE
 * one alternative of the enclosing `Choice`; if `P` fails FATALLY (it
 * reaches a `Cut`/`~`, directly or through a referenced rule), the
 * enclosing `choice`/`captureChoice` (`packages/core/src/combinators.ts`,
 * `tryOrderedCandidates`) absorbs that fatal failure at ITS OWN boundary
 * and returns an ordinary (non-fatal) failure to whatever encloses the
 * `Choice`. After factoring, `P` is hoisted to the front of an ordinary
 * `Sequence` (`Sequence(P, Choice(inner...))`) with no `Choice` wrapping
 * it any more -- so a fatal failure from `P` now propagates straight out
 * of the rule unabsorbed, changing observable behavior for anything
 * enclosing this rule (an `Optional`/`Star`/`Plus` around a reference to
 * it, in particular, treats a fatal failure differently from an ordinary
 * one -- see `commit`'s doc comment). Concretely: `sub "a" / sub "d" /
 * sub` with `sub = "b" ~ "c"`, on input `"b"`, fails ordinarily before
 * factoring (the enclosing `choice` absorbed `sub`'s fatal failure) and
 * fails FATALLY after -- a real behavior change, not just a shape change,
 * found via `codegen-differential.spec.ts`'s fuzzing harness.
 *
 * Rule failure modes are computed once. They identify both a prefix whose
 * cut could escape and a suffix that would shadow the next alternative
 * after factoring. A committing skip rule can also escape a moved boundary.
 */

import { mapChildExpressions } from "@suzumiyaaoba/tpeg-core";
import { containsLabel, isShapeSensitiveRule } from "./ast-optimize-shared";
import type {
  CharacterClass,
  Choice,
  Expression,
  GrammarDefinition,
  RuleDefinition,
} from "./types";
import { createChoice, createIdentifier, createSequence } from "./types";
import { analyzeFailureModes } from "./grammar-failure-modes";
import { resolveSkipRuleName } from "./skip-desugar";

type FailureModesFor = ReturnType<typeof analyzeFailureModes>;

const charRangesEqual = (
  a: CharacterClass["ranges"],
  b: CharacterClass["ranges"],
): boolean =>
  a.length === b.length &&
  a.every((r, i) => r.start === b[i]?.start && r.end === b[i]?.end);

/** Structural equality for two factorable-prefix nodes of possibly
 * different types (returns false on a type mismatch). */
const prefixesEqual = (a: Expression, b: Expression): boolean => {
  switch (a.type) {
    case "StringLiteral":
      return b.type === "StringLiteral" && a.value === b.value;
    case "AnyChar":
      return b.type === "AnyChar";
    case "Identifier":
      return b.type === "Identifier" && a.name === b.name;
    case "CharacterClass":
      return (
        b.type === "CharacterClass" &&
        a.negated === b.negated &&
        charRangesEqual(a.ranges, b.ranges)
      );
    default:
      return false;
  }
};

const partsOf = (expr: Expression): Expression[] =>
  expr.type === "Sequence" ? expr.elements : [expr];

const toSingleExpression = (parts: Expression[]): Expression =>
  parts.length === 1 ? (parts[0] as Expression) : createSequence(parts);

/**
 * Attempts to left-factor a single `Choice` node. Returns the original
 * node unchanged if the safety/shape conditions above aren't met.
 */
const tryLeftFactorChoice = (
  choice: Choice,
  failureModes: FailureModesFor,
): Expression => {
  const { alternatives } = choice;
  if (alternatives.length < 2 || containsLabel(choice)) return choice;
  const branches = alternatives.map(partsOf);
  const prefix = branches[0]?.[0];
  if (!prefix || (prefix.type === "Identifier" && failureModes(prefix).fatal))
    return choice;

  // Keep at least two nonempty suffixes. A bare prefix is eligible only
  // as the last branch, where the empty sequence preserves its success.
  if (branches.length === 2 && branches[1]?.length === 1) return choice;
  const suffixes: Expression[] = [];
  for (const [i, branch] of branches.entries()) {
    const head = branch[0];
    if (!head || !prefixesEqual(prefix, head)) return choice;
    const rest = branch.slice(1);
    if (rest.length > 0 && rest.every((el) => el.type === "Cut")) return choice;
    const suffix = toSingleExpression(rest);
    if (i + 1 < branches.length && !failureModes(suffix).nonFatal)
      return choice;
    suffixes.push(suffix);
  }
  return createSequence([prefix, createChoice(suffixes)]);
};

/** Recursively applies `tryLeftFactorChoice` to every `Choice` reachable
 * from `expr`, bottom-up (children first, so a factored inner choice is
 * itself eligible to be the target of an outer factoring). */
const leftFactorExpression = (
  expr: Expression,
  failureModes: FailureModesFor,
): Expression => {
  switch (expr.type) {
    case "Sequence":
      return createSequence(
        expr.elements.map((el) => leftFactorExpression(el, failureModes)),
      );
    case "Choice": {
      const factoredAlternatives = expr.alternatives.map((alt) =>
        leftFactorExpression(alt, failureModes),
      );
      return tryLeftFactorChoice(
        createChoice(factoredAlternatives),
        failureModes,
      );
    }
    default:
      return mapChildExpressions(expr, (el) =>
        leftFactorExpression(el, failureModes),
      );
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
  const failureModes = analyzeFailureModes(grammar);
  const skip = resolveSkipRuleName(grammar);
  if (skip && failureModes(createIdentifier(skip)).fatal) return grammar;
  const rules: RuleDefinition[] = grammar.rules.map((rule) =>
    isShapeSensitiveRule(grammar, rule)
      ? rule
      : { ...rule, pattern: leftFactorExpression(rule.pattern, failureModes) },
  );

  return { ...grammar, rules };
};
