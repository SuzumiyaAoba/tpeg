/**
 * Semantics-preserving AST -> AST rewrites, applied before codegen.
 *
 * This is a standalone utility, NOT wired into `generateTypeScriptParser`
 * or `generateOptimizedTypeScriptParser` -- call it explicitly (or via
 * `applyAstOptimizations`, which runs all three rewrites below) on a
 * `GrammarDefinition` before generating code from it. Keeping it opt-in
 * avoids repeating Phase 0's mistake (an "optimization" that silently
 * changed accepted behavior for every existing caller by default).
 *
 * Three independent rewrites live here: `leftFactorChoices` (below),
 * `mergeCharacterClasses` (`[a-z] / [A-Z]` -> `[a-zA-Z]`), and
 * `degenerateNegativeLookaheads` (`!a .` -> a negated character class) --
 * see each export's own doc comment for its specific reasoning. The
 * shape-safety discussion in this comment (rule-level action/transform
 * gate, label handling) applies to `leftFactorChoices` and
 * `degenerateNegativeLookaheads`; `mergeCharacterClasses` never changes
 * value shape and needs none of it.
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
 * alternative -- e.g. the trailing `/ product` above. That case is folded
 * into `Sequence(P, Optional(inner))` rather than `Sequence(P, inner)`:
 * `product "+" sum / product "-" sum / product` becomes
 * `product (("+" sum) / ("-" sum))?`. This is sound for the same reason
 * as the non-bare case (calling `P` twice at one position reproduces the
 * same result) -- if `inner` fails to match right after `P`, `optional`
 * succeeds having consumed nothing, so the whole sequence still stops
 * exactly where the bare `P` alternative would have, without reparsing
 * `P` a second time to get there. Its `.val` shape becomes `[Pval,
 * [Xval]]` (`inner` matched) or `[Pval, []]` (it didn't) -- a different
 * shape from the non-bare case's `[Pval, Xval]`, on top of the difference
 * from the original grammar's unfactored shapes already described above;
 * still gated by the same `isShapeSensitiveRule` check. A bare-prefix
 * alternative anywhere other than last, or more than one of them, is left
 * untouched (not factored) -- handling arbitrary interleaving isn't
 * needed by any grammar in this repo and isn't implemented.
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

const grammarHasTransformFor = (
  grammar: GrammarDefinition,
  ruleName: string,
): boolean =>
  (grammar.transforms ?? []).some((def) =>
    def.transformSet.functions.some((fn) => fn.name === ruleName),
  );

/**
 * True if `rule`'s own `.val` could be read positionally -- by an inline
 * `ActionExpression` anywhere in its pattern (`$$`), or by a `transforms`
 * function matched to it by name (`captures`). Shared by every rewrite in
 * this module that can change a rule's value *shape* (element count or
 * nesting) without changing which inputs it accepts: `leftFactorChoices`
 * and `degenerateNegativeLookaheads`. `mergeCharacterClasses` doesn't use
 * this gate because it never changes value shape (see its own doc
 * comment).
 */
const isShapeSensitiveRule = (
  grammar: GrammarDefinition,
  rule: RuleDefinition,
): boolean =>
  containsAction(rule.pattern) || grammarHasTransformFor(grammar, rule.name);

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

// ============================================================================
// Character class merging: `[a-z] / [A-Z]` -> `[a-zA-Z]`
// ============================================================================
//
// Unlike left factoring, this never changes value shape: a matching
// `CharacterClass` always returns the one matched character as its `.val`,
// whichever alternative of the original `Choice` it came from -- the
// merged class returns the exact same character for the exact same
// inputs. No rule-level safety gate is needed.
//
// Restricted to *non-negated* `CharacterClass` alternatives (plus
// single-character `StringLiteral`s, treated as a one-range class): a
// negated class already reads "any character NOT in these ranges", and
// merging two negated classes by unioning ranges would compute the wrong
// set (De Morgan's law wants an *intersection* of ranges there, not a
// union) -- rather than get that subtly wrong, negated classes are left
// untouched.

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

// ============================================================================
// Negative-lookahead degeneration: `!a .` -> a negated character class
// ============================================================================
//
// `Sequence([NegativeLookahead(a), AnyChar])` succeeds iff `a` does NOT
// match at the current position AND a character is available to consume,
// and then consumes exactly that one character -- exactly what a negated
// `CharacterClass` built from `a` does directly, provided `a` itself
// matches exactly one character based only on that character (a
// single-character `StringLiteral` or a `CharacterClass`; anything else,
// e.g. a multi-character literal or a rule reference, is left alone).
//
// This changes value shape (the `Sequence` contributes two array slots,
// `[undefined, char]`; the replacement contributes one, `char`), so it
// uses the same `isShapeSensitiveRule` gate as `leftFactorChoices`.

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
 * the module doc comment and `isShapeSensitiveRule`). */
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

/**
 * Applies every rewrite in this module, in the order that lets later
 * passes see the earlier ones' output: degenerating `!a .` first can turn
 * two alternatives' prefixes into structurally-comparable character
 * classes that left factoring can then group, so it runs before
 * `leftFactorChoices`. `mergeCharacterClasses` has no such ordering
 * dependency and is run first.
 */
export const applyAstOptimizations = (
  grammar: GrammarDefinition,
): GrammarDefinition =>
  leftFactorChoices(
    degenerateNegativeLookaheads(mergeCharacterClasses(grammar)),
  );
