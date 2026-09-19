/**
 * Helpers shared by more than one of `ast-optimize.ts`'s rewrite passes.
 * See that module's doc comment for the overall design (soundness
 * restrictions, shape-sensitivity gating).
 */

import { forEachExpression, someExpression } from "@suzumiyaaoba/tpeg-core";
import type { Expression, GrammarDefinition, RuleDefinition } from "./types";

/** Does `expr` contain a `LabeledExpression` anywhere in its subtree?
 * Used by `ast-optimize-left-factor.ts`'s `leftFactorChoices` and
 * `ast-optimize-cut-insertion.ts`'s `insertAutomaticCuts` -- both need to
 * detect a labeled `Choice` to fall back to a more conservative rewrite. */
export const containsLabel = (expr: Expression): boolean =>
  someExpression(expr, (node) => node.type === "LabeledExpression");

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
  let found = false;
  forEachExpression(expr, (node) => {
    if (node.type === "Cut" || node.type === "QualifiedIdentifier") {
      found = true;
    } else if (node.type === "Identifier") {
      refs.add(node.name);
    }
  });
  return found;
};

/**
 * For every rule in `grammar`, `true` if that rule's pattern can, directly
 * or by following `Identifier` references (transitively, to whatever
 * depth, including through a mutual-recursion cycle), reach a `Cut` or an
 * unresolvable `QualifiedIdentifier` -- i.e. is a rule the rewrites must
 * never treat as safe to hoist OUT of a `Choice`'s fatal-absorption
 * boundary (see `ast-optimize-left-factor.ts`'s module doc comment,
 * "Fatal failures and hoisted prefixes" section) or to regroup under a
 * newly nested `Choice` (`ast-optimize-cut-insertion.ts`'s module doc
 * comment, "Pre-existing `Cut`s must never be regrouped either").
 *
 * This is a whole-grammar iterative worklist fixpoint rather than a
 * per-call recursive walk with a "cycle -> refuse" guard. A naive DFS
 * guard would mark every rule in a `Cut`-free MUTUALLY RECURSIVE cycle
 * (e.g. a typical `sum`/`product`/`atom` expression-grammar hierarchy) as
 * "can fail fatally" the instant the walk revisits any rule already on
 * its own call stack, even though nothing in the cycle ever reaches a
 * `Cut` -- which would make the rewrites refuse virtually every
 * recursive-descent-shaped grammar, the primary case they exist for. A
 * fixpoint instead only marks a rule `true` once something it can
 * actually reach is independently known to reach a `Cut` (or is
 * unresolvable), converging to `false` for every rule in a genuinely
 * `Cut`-free cycle.
 */
export const computeFatalReachability = (
  grammar: GrammarDefinition,
): ReadonlyMap<string, boolean> => {
  // `dependents[name]` = the rules that reference `name` -- the reverse
  // edges of the reference graph, so `true` can be pushed from a rule to
  // everything that references it instead of re-scanning every rule's
  // reference list once per propagation step. The naive fixpoint this
  // replaces was O(rules^2) on a reference chain (one full pass per
  // propagation step -- `r0 -> r1 -> ... -> rN -> <cut>` needed N passes);
  // the worklist propagates each `true` along each edge exactly once.
  const dependents = new Map<string, string[]>();
  const refsOf = new Map<string, ReadonlySet<string>>();
  const result = new Map<string, boolean>();
  const queue: string[] = [];

  for (const rule of grammar.rules) {
    const refs = new Set<string>();
    const own = collectOwnFatalSignal(rule.pattern, refs);
    result.set(rule.name, own);
    refsOf.set(rule.name, refs);
    for (const ref of refs) {
      const list = dependents.get(ref);
      if (list) {
        list.push(rule.name);
      } else {
        dependents.set(ref, [rule.name]);
      }
    }
  }

  // Seed the queue with every rule already known to reach a `Cut`:
  // an own `Cut`/`QualifiedIdentifier`, or a reference to a name this
  // grammar has no rule for (unresolvable here -- conservatively assumed
  // to be able to fail fatally, the same direction `first-sets.ts`'s
  // `isNullable` takes for an unresolved reference).
  for (const rule of grammar.rules) {
    if (result.get(rule.name)) {
      queue.push(rule.name);
      continue;
    }
    const refs = refsOf.get(rule.name);
    if (refs && [...refs].some((name) => !result.has(name))) {
      result.set(rule.name, true);
      queue.push(rule.name);
    }
  }

  while (queue.length > 0) {
    const name = queue.pop() as string;
    for (const dependent of dependents.get(name) ?? []) {
      if (result.get(dependent)) continue;
      result.set(dependent, true);
      queue.push(dependent);
    }
  }
  return result;
};

/**
 * `true` when `expr` can produce a `fatal` failure that escapes the
 * expression's own boundary -- a `Cut` anywhere in its subtree, an
 * `Identifier` whose referenced rule is `fatalReachability`-marked (see
 * `computeFatalReachability`), or any `QualifiedIdentifier` (cross-module,
 * unresolvable here -- conservatively treated as fatal-capable, the same
 * direction `computeFatalReachability` itself takes for what it can't
 * resolve; an `Identifier` naming no rule of this grammar -- the
 * documented external-parser escape hatch -- is likewise `?? true`).
 *
 * Deliberately over-approximate on two axes, both in the safe direction
 * for the callers' "must never renarrow a fatal-absorption boundary"
 * use: a `Cut` shielded inside an inner `Choice` or lookahead is already
 * absorbed there and can never actually escape `expr`, and
 * `computeFatalReachability` likewise marks a rule for ANY `Cut` in its
 * body, shielded or not. Flagging either merely declines a rewrite
 * opportunity, never produces an unsound one.
 *
 * Used by `ast-optimize-cut-insertion.ts`'s `buildCutGroups`/
 * `computeCutCandidate` to refuse regrouping a `Choice` alternative that
 * can fail fatally (a hand-written `~`, a `Cut` from an earlier pass, or
 * one reachable only through a REFERENCED rule -- the gap a purely local
 * `containsCut`-style check left open) into a newly nested `Choice` --
 * doing so would renarrow that fatal failure's absorption boundary from
 * the enclosing (flat) `Choice` to the new inner one, changing which
 * sibling alternatives it suppresses.
 */
export const canFailFatally = (
  expr: Expression,
  fatalReachability: ReadonlyMap<string, boolean>,
): boolean =>
  someExpression(
    expr,
    (node) =>
      node.type === "Cut" ||
      node.type === "QualifiedIdentifier" ||
      (node.type === "Identifier" &&
        (fatalReachability.get(node.name) ?? true)),
  );

/** Does `expr` contain an `ActionExpression` anywhere in its subtree? */
const containsAction = (expr: Expression): boolean =>
  someExpression(expr, (node) => node.type === "ActionExpression");

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
 * function matched to it by name (`captures`). Shared by every rewrite that
 * can change a rule's value *shape* (element count or nesting) without
 * changing which inputs it accepts: `leftFactorChoices` and
 * `degenerateNegativeLookaheads`. `mergeCharacterClasses` doesn't use this
 * gate because it never changes value shape (see its own doc comment).
 */
export const isShapeSensitiveRule = (
  grammar: GrammarDefinition,
  rule: RuleDefinition,
): boolean =>
  containsAction(rule.pattern) || grammarHasTransformFor(grammar, rule.name);
