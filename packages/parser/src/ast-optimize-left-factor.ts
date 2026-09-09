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
 * `isFactorablePrefixType` below restricts a factorable prefix to
 * `StringLiteral`/`CharacterClass`/`AnyChar`/`Identifier`/
 * `QualifiedIdentifier`. The first three are terminal leaf nodes that can
 * never contain a `Cut`, so they're always safe on this axis. Only
 * `Identifier` (a same-grammar rule reference, which can transitively
 * reach a `Cut` through the rules it references) and `QualifiedIdentifier`
 * (a cross-module reference, entirely unresolvable here) need an
 * additional check, consulted by `tryLeftFactorChoice` before accepting
 * either as a factoring prefix. A `QualifiedIdentifier` prefix is always
 * refused (the same conservative "unresolvable -> assume the worst"
 * direction `first-sets.ts` takes for FIRST sets), and an `Identifier`
 * prefix is refused whenever `computeFatalReachability` below says the
 * referenced rule can reach a `Cut`.
 *
 * `computeFatalReachability` is a whole-grammar iterative fixpoint --
 * the same shape `first-sets.ts`'s `computeNullableRules` uses -- rather
 * than a per-call recursive walk with a "cycle -> refuse" guard. A naive
 * DFS guard would mark every rule in a `Cut`-free MUTUALLY RECURSIVE
 * cycle (e.g. a typical `sum`/`product`/`atom` expression-grammar
 * hierarchy, exactly `ast-optimize.ts`'s own motivating example) as "can
 * fail fatally" the instant the walk revisits any rule already on its own
 * call stack, even though nothing in the cycle ever reaches a `Cut` --
 * which would make this rewrite refuse to factor virtually every
 * recursive-descent-shaped grammar, the primary case it exists for. A
 * fixpoint instead only marks a rule `true` once something it can
 * actually reach is independently known to reach a `Cut` (or is
 * unresolvable), converging to `false` for every rule in a genuinely
 * `Cut`-free cycle.
 *
 * This does NOT contradict this file's claim (echoed in
 * `ast-optimize.ts`'s module doc comment) that factoring "preserves the
 * language accepted and the stop position" for a prefix that can only
 * fail ordinarily -- that claim was never true for a prefix that can fail
 * fatally, and is now enforced by construction rather than merely
 * asserted.
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
import { createChoice, createSequence } from "./types";

/**
 * Structural, single-rule-body walk (does NOT follow `Identifier`
 * references) that reports whether `expr` directly contains a `Cut` or a
 * `QualifiedIdentifier` (cross-module, unresolvable here -- treated the
 * same as a `Cut` for this purpose, since this module can't prove it
 * DOESN'T reach one), while collecting every `Identifier` name referenced
 * anywhere in `expr` into `refs`. The two are computed together so
 * `computeFatalReachability`'s fixpoint below only needs one walk per
 * rule. Every element/alternative is walked regardless of what an earlier
 * one already found, so every `Identifier` reference is collected --
 * not just the ones before the first `Cut`/`QualifiedIdentifier`.
 */
const collectOwnFatalSignal = (
  expr: Expression,
  refs: Set<string>,
): boolean => {
  switch (expr.type) {
    case "Cut":
    case "QualifiedIdentifier":
      return true;
    case "Identifier":
      refs.add(expr.name);
      return false;
    case "Sequence":
      return expr.elements.reduce(
        (acc, el) => collectOwnFatalSignal(el, refs) || acc,
        false,
      );
    case "Choice":
      return expr.alternatives.reduce(
        (acc, alt) => collectOwnFatalSignal(alt, refs) || acc,
        false,
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
      return collectOwnFatalSignal(expr.expression, refs);
    default:
      return false;
  }
};

/**
 * For every rule in `grammar`, `true` if that rule's pattern can, directly
 * or by following `Identifier` references (transitively, to whatever
 * depth, including through a mutual-recursion cycle), reach a `Cut` or an
 * unresolvable `QualifiedIdentifier` -- i.e. is a rule this module must
 * never treat as safe to hoist OUT of a `Choice`'s fatal-absorption
 * boundary (see the module doc comment's "Fatal failures and hoisted
 * prefixes" section). See the module doc comment for why this is a
 * fixpoint rather than a per-call recursive walk.
 */
const computeFatalReachability = (
  grammar: GrammarDefinition,
): ReadonlyMap<string, boolean> => {
  const referencedBy = new Map<string, ReadonlySet<string>>();
  const result = new Map<string, boolean>();
  for (const rule of grammar.rules) {
    const refs = new Set<string>();
    result.set(rule.name, collectOwnFatalSignal(rule.pattern, refs));
    referencedBy.set(rule.name, refs);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of grammar.rules) {
      if (result.get(rule.name)) continue;
      const refs = referencedBy.get(rule.name);
      // An `Identifier` this grammar has no rule for (`?? true`) is an
      // externally-supplied parser reference -- unresolvable here, so
      // conservatively assume it could fail fatally, the same direction
      // `first-sets.ts`'s `isNullable` takes for an unresolved reference.
      if (refs && [...refs].some((name) => result.get(name) ?? true)) {
        result.set(rule.name, true);
        changed = true;
      }
    }
  }
  return result;
};

/** Shared, per-`leftFactorChoices`-call state threaded through the
 * recursive rewrite so every `Choice` in the grammar consults the same,
 * once-computed `fatalReachability` map instead of recomputing it per
 * rule or per candidate prefix. */
interface FactorContext {
  readonly fatalReachability: ReadonlyMap<string, boolean>;
}

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
const tryLeftFactorChoice = (
  choice: Choice,
  ctx: FactorContext,
): Expression => {
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
  // A prefix that can fail FATALLY must never be hoisted out of this
  // `Choice` -- see the module doc comment's "Fatal failures and hoisted
  // prefixes" section. `StringLiteral`/`CharacterClass`/`AnyChar` are leaf
  // nodes and can never reach a `Cut`, so only `Identifier`/
  // `QualifiedIdentifier` need the check.
  if (prefix.type === "QualifiedIdentifier") return choice;
  if (
    prefix.type === "Identifier" &&
    (ctx.fatalReachability.get(prefix.name) ?? true)
  ) {
    return choice;
  }
  if (
    !groupedParts.every((parts) =>
      prefixesEqual(parts[0] as Expression, prefix),
    )
  ) {
    return choice;
  }

  // The trailing bare alternative (if any) must itself BE the shared
  // prefix -- the fold below (see "Trailing bare-prefix alternative"
  // just under this function) replaces it with an empty `Sequence([])`
  // alternative, on the assumption that reaching that empty alternative
  // is equivalent to the bare alternative having matched. That's only
  // true when the bare alternative's one element IS `prefix`: without
  // this check, `"a" "b" / "a" "c" / "x"` silently became
  // `"a" ("b" / "c" / ())`, dropping the `"x"` alternative entirely
  // (found via `ast-optimize.spec.ts`-style differential testing) --
  // `()` only stands in for a bare `"a"`, never for an unrelated
  // trailing alternative like `"x"`.
  if (bareIndices.length === 1) {
    const bareParts = partsList[bareIndices[0] as number] as Expression[];
    if (!prefixesEqual(bareParts[0] as Expression, prefix)) return choice;
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
  // Trailing bare-prefix alternative: fold into `prefix (inner / ())`
  // (an explicit empty-`Sequence` alternative), NOT `prefix (inner)?` --
  // rather than reparsing `prefix` a second time for a separate bare
  // alternative, see the module doc comment's "Alternative shapes
  // handled" section. `Optional` was tried first and rejected: `optional`
  // (`packages/core/src/repetition.ts`) treats a *fatal* (cut/commit)
  // failure specially and re-raises it, but `choice`/`captureChoice`
  // (`packages/core/src/combinators.ts`) already absorb a fatal failure
  // at THEIR OWN boundary before it ever reaches an enclosing `optional`
  // -- so wrapping `inner` (itself a `Choice` whenever `groupedCount > 1`)
  // in `Optional` let a `Cut` inside one of its branches get silently
  // swallowed as "zero matches" instead of failing the whole rule, e.g.
  // `"a" "b" ~ "c" / "a" "d" / "a"` on `"ab"` must fail (the cut commits
  // once "b" matches, "c" doesn't follow, and PEG must not fall through to
  // the bare "a") but used to wrongly succeed. Keeping the bare
  // alternative as an ordinary `Choice` member (an empty `Sequence`)
  // instead means any `Cut` inside `inner` is absorbed by the SAME
  // `Choice` node the bare alternative itself is a sibling of, exactly
  // matching the original (unfactored) grammar's absorption boundary.
  const alternativesWithBare =
    innerAlternatives.length === 1
      ? [innerAlternatives[0] as Expression, createSequence([])]
      : [...innerAlternatives, createSequence([])];
  return createSequence([prefix, createChoice(alternativesWithBare)]);
};

/** Recursively applies `tryLeftFactorChoice` to every `Choice` reachable
 * from `expr`, bottom-up (children first, so a factored inner choice is
 * itself eligible to be the target of an outer factoring). */
const leftFactorExpression = (
  expr: Expression,
  ctx: FactorContext,
): Expression => {
  switch (expr.type) {
    case "Sequence":
      return createSequence(
        expr.elements.map((el) => leftFactorExpression(el, ctx)),
      );
    case "Choice": {
      const factoredAlternatives = expr.alternatives.map((alt) =>
        leftFactorExpression(alt, ctx),
      );
      return tryLeftFactorChoice(createChoice(factoredAlternatives), ctx);
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
        expression: leftFactorExpression(expr.expression, ctx),
      };
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
  // Computed once, from the ORIGINAL (pre-rewrite) grammar, and reused for
  // every rule's rewrite -- "can this rule ever fail fatally, considering
  // every rule it can reach" is a fixed, whole-grammar fact, independent
  // of which alternative asks (see `FactorContext`'s doc comment).
  const ctx: FactorContext = {
    fatalReachability: computeFatalReachability(grammar),
  };
  const rules: RuleDefinition[] = grammar.rules.map((rule) =>
    isShapeSensitiveRule(grammar, rule)
      ? rule
      : { ...rule, pattern: leftFactorExpression(rule.pattern, ctx) },
  );

  return { ...grammar, rules };
};
