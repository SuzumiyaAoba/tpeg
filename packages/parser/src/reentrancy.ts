/**
 * Reentrancy analysis: which rules can be invoked more than once at the
 * *same input offset* during a single parse, and therefore actually
 * benefit from memoization.
 *
 * ## Why this exists
 *
 * `codegen-optimized.ts` used to decide whether to wrap a rule in
 * `memoize(...)` using `analyzeExpressionComplexity`
 * (`performance-utils.ts`): `hasRecursion || maxDepth > 10 || nodeCount >
 * 50`. That is a proxy, not the actual condition packrat memoization
 * depends on. Ford's O(n·|G|) packrat guarantee comes from memoizing
 * every rule that could otherwise be *re-parsed at a position it was
 * already parsed at* -- which has nothing to do with whether the rule's
 * own definition happens to be recursive or large.
 *
 * Two concrete counterexamples (see `packages/parser/bench/grammars.ts`,
 * `BENCH_ACYCLIC_CHAIN_GRAMMAR`, and `packages/parser/bench/run.ts`'s
 * "Acyclic chain grammar" section for a runnable one):
 *
 * - A 10-level chain of unfactored 3-way choices, none of which
 *   reference themselves or an ancestor (so `hasRecursion` is `false`
 *   everywhere) and none of which are individually complex (so the
 *   depth/node-count thresholds never fire either), is still
 *   exponential: 3^9 redundant reparses of the innermost rule for a
 *   single top-level call. The old heuristic memoizes none of it.
 * - Conversely, a rule that *is* recursive but whose choice alternatives
 *   are FIRST-disjoint (e.g. JSON's `value = string / number / boolean /
 *   ... `) never actually gets re-invoked at the same offset -- the
 *   first character always picks the right alternative on the first
 *   try. Memoizing it wastes a `Map` write per call for a 0% hit rate.
 *
 * This module replaces the proxy with the actual condition: a rule name
 * `R` is flagged reentrant iff there is some point in the grammar where
 * two different control-flow paths can both reach an invocation of `R`
 * with zero characters consumed between them. There are exactly three
 * ways that happens in a PEG:
 *
 * 1. **Ordered-choice backtracking** -- two alternatives of a `Choice`
 *    both invoke `R` at their own start.
 * 2. **Falling through a failed/empty optional element** -- an
 *    `Optional`/`Star`/`Plus`/`Quantified{min:0}` element that yields no
 *    match leaves the parse position unchanged, so whatever comes next
 *    in the same `Sequence` runs at the same offset the optional/starred
 *    element started at.
 * 3. **A lookahead immediately followed by the same expression** --
 *    `&R R` or `!R R'` where `R'` can also reach `R`: the lookahead
 *    itself invokes `R` (even though it consumes nothing), and then the
 *    next sequence element does too.
 *
 * All three reduce to the same shape once phrased as "which rule names
 * can this expression invoke without consuming a character first,
 * relative to its own start" -- call that `invocableAtZero`. A `Choice`
 * or a nullable-prefix run of `Sequence` elements is reentrant on `R`
 * exactly when `R` shows up in `invocableAtZero` for more than one of
 * its children in a way that overlaps. That's a structural mirror of
 * `first-sets.ts`'s `sequenceFirstSet`/`Choice` handling (see below),
 * with rule names standing in for characters.
 *
 * ## What this deliberately does NOT try to minimize
 *
 * `invocableAtZero` follows `Identifier` references transitively (rule
 * `R`'s set includes everything reachable from `R`'s own body at offset
 * 0, not just `R` itself) via the same iterative-fixpoint pattern
 * `first-sets.ts` uses for FIRST sets. That means a rule several levels
 * below an actually-shared rule can also get flagged: e.g. for
 * `sum = product "+" sum / product "-" sum / product`, `product = atom
 * "*" product / atom "/" product / atom`, `atom = "(" sum ")" / number`,
 * this analysis flags `product`, `atom`, *and* `number` -- even though
 * memoizing `product` alone would already prevent `atom` (and therefore
 * `number`) from ever being re-invoked at a shared offset, since a cache
 * hit on `product` short-circuits before its body (and therefore `atom`)
 * ever runs again.
 *
 * Excluding "dominated" rules like `number` from the result would need a
 * second pass reasoning about which reentrant rule's cache actually
 * shields which other one, and getting that wrong would silently
 * under-memoize -- the exact failure mode this module exists to fix.
 * Flagging a few extra rules whose redundancy is already absorbed by an
 * outer memoized rule costs one small, mostly-empty-after-first-hit
 * `Map` per rule; that's a strictly safer trade than the alternative.
 * `chars`/`ranges`-style "always safe to over-approximate, never safe to
 * guess smaller" reasoning applies here exactly as it does in
 * `first-sets.ts`.
 *
 * ## What this does NOT (yet) account for: `Cut`
 *
 * A `Cut` (`~`) inside a sequence can make an enclosing `Choice`'s later
 * alternatives provably unreachable after the cut fires, which would
 * make some reentrancy findings across that choice unnecessary too (see
 * the plan's Phase 2/3 for cut-aware analysis). This module treats `Cut`
 * as contributing nothing to `invocableAtZero` (it invokes no rule) and
 * as nullable (it never itself blocks a nullable-prefix walk), but does
 * NOT suppress reentrancy findings across alternatives separated by a
 * cut. That's a conservative (safe, not unsound) simplification: it may
 * flag a rule as reentrant in a case a full cut-aware analysis would
 * later prove unnecessary, never the other way around.
 */

import { analyzeFirstSets, isNullable } from "./first-sets";
import type { Choice, Expression, GrammarDefinition, Sequence } from "./types";

/** The set of (in-grammar) rule names an expression can invoke with zero
 * characters consumed first, together with the rule names already found
 * to be reentrant *within* that expression's own structure. */
interface InvocationResult {
  readonly total: ReadonlySet<string>;
  readonly reentrant: ReadonlySet<string>;
}

const EMPTY_RESULT: InvocationResult = {
  total: new Set(),
  reentrant: new Set(),
};

interface WalkContext {
  /** Converged (or, during fixpoint iteration, in-progress) per-rule
   * `invocableAtZero` sets, each seeded with its own rule name -- see
   * `computeRuleInvocableAtZero`. */
  readonly ruleInvocableAtZero: ReadonlyMap<string, ReadonlySet<string>>;
  readonly nullableRules: ReadonlyMap<string, boolean>;
}

/**
 * Unions `elResult`'s `total` into `total`, flagging anything already
 * present as newly reentrant. Shared by `walkSequence` (nullable-prefix
 * elements) and `walkChoice` (all alternatives) -- see the module doc
 * comment for why these are the same computation with a different
 * "which children are simultaneously reachable at offset 0" rule.
 */
const foldChild = (
  total: Set<string>,
  reentrant: Set<string>,
  elResult: InvocationResult,
): void => {
  for (const r of elResult.reentrant) reentrant.add(r);
  for (const r of elResult.total) {
    if (total.has(r)) reentrant.add(r);
  }
  for (const r of elResult.total) total.add(r);
};

const walkSequence = (expr: Sequence, ctx: WalkContext): InvocationResult => {
  const total = new Set<string>();
  const reentrant = new Set<string>();
  for (const element of expr.elements) {
    foldChild(total, reentrant, walk(element, ctx));
    if (!isNullable(element, ctx.nullableRules)) {
      // Non-nullable: this element is guaranteed to consume at least one
      // character on success, so nothing after it in the sequence can
      // still be at offset 0 relative to the sequence's start. Matches
      // `sequenceFirstSet`'s identical early-break in `first-sets.ts`.
      break;
    }
  }
  return { total, reentrant };
};

const walkChoice = (expr: Choice, ctx: WalkContext): InvocationResult => {
  const total = new Set<string>();
  const reentrant = new Set<string>();
  for (const alternative of expr.alternatives) {
    // Every alternative starts at the same offset as the Choice itself
    // (ordered choice tries them one after another on failure), unlike a
    // Sequence's nullable-prefix cutoff -- so unlike `walkSequence`,
    // every alternative is folded in regardless of its own nullability.
    foldChild(total, reentrant, walk(alternative, ctx));
  }
  return { total, reentrant };
};

/**
 * Computes `invocableAtZero(expr)` (as `.total`) plus any reentrant rule
 * names discovered strictly within `expr`'s own structure (as
 * `.reentrant`). Mirrors `firstSetOfExpression` in `first-sets.ts`
 * node-for-node, with two deliberate differences:
 *
 * - `PositiveLookahead`/`NegativeLookahead` propagate their inner
 *   expression's result instead of returning empty. `firstSetOfExpression`
 *   returns `EMPTY_FIRST_SET` for lookaheads because they never *consume*
 *   a character, so they contribute nothing to what a sequence might
 *   start with -- but they still *invoke* their inner parser at the
 *   current offset, which is exactly what this analysis needs to track
 *   (reentrancy source 3 in the module doc comment).
 * - `Sequence`/`Choice` additionally detect and propagate reentrancy
 *   findings (`.reentrant`), which FIRST sets have no equivalent of.
 */
const walk = (expr: Expression, ctx: WalkContext): InvocationResult => {
  switch (expr.type) {
    case "StringLiteral":
    case "CharacterClass":
    case "AnyChar":
    case "QualifiedIdentifier":
    case "Cut":
      return EMPTY_RESULT;
    case "Identifier": {
      // A name absent from the map isn't a rule of this grammar (an
      // externally-supplied parser reference) -- it can't be reasoned
      // about here, so it contributes nothing, mirroring
      // `firstSetOfExpression`'s handling of the same case (except that
      // module's safe direction is `unknown`/"assume anything", where
      // here the safe direction for *this* analysis is simply "don't
      // claim a specific rule name is invoked" -- omitting it from
      // `total` can only under-detect sharing *of that external
      // reference itself*, which isn't a rule this module could memoize
      // in the first place).
      const known = ctx.ruleInvocableAtZero.get(expr.name);
      return known ? { total: known, reentrant: new Set() } : EMPTY_RESULT;
    }
    case "Sequence":
      return walkSequence(expr, ctx);
    case "Choice":
      return walkChoice(expr, ctx);
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
    case "Quantified":
    case "LabeledExpression":
    case "ActionExpression":
    case "PositiveLookahead":
    case "NegativeLookahead":
      return walk(expr.expression, ctx);
    default:
      return EMPTY_RESULT;
  }
};

/**
 * Iterative fixpoint (same shape as `first-sets.ts`'s `analyzeFirstSets`)
 * computing, for every rule, the full transitive set of rule names
 * invocable at offset 0 from that rule's own start -- always including
 * the rule's own name, since `Identifier` resolution needs "does this
 * name eventually reach itself or another shared rule," not just "what
 * does this rule call directly." Terminates because each rule's set is
 * monotonically growing and bounded by the total number of rules in the
 * grammar.
 */
const computeRuleInvocableAtZero = (
  grammar: GrammarDefinition,
  nullableRules: ReadonlyMap<string, boolean>,
): Map<string, Set<string>> => {
  const table = new Map<string, Set<string>>(
    grammar.rules.map((r) => [r.name, new Set([r.name])]),
  );

  let changed = true;
  while (changed) {
    changed = false;
    const ctx: WalkContext = { ruleInvocableAtZero: table, nullableRules };
    for (const rule of grammar.rules) {
      const result = walk(rule.pattern, ctx).total;
      const existing = table.get(rule.name) as Set<string>;
      for (const name of result) {
        if (!existing.has(name)) {
          existing.add(name);
          changed = true;
        }
      }
    }
  }

  return table;
};

export interface ReentrancyAnalysis {
  /** Rule names that can be invoked more than once at the same input
   * offset during a single parse -- i.e. rules where memoization can
   * actually produce a cache hit. See the module doc comment for the
   * three ways this happens and what "reentrant" deliberately does not
   * try to minimize away. */
  readonly reentrantRules: ReadonlySet<string>;
}

/**
 * Computes which rules in `grammar` are reentrant (see module doc
 * comment), replacing `codegen-optimized.ts`'s previous
 * `hasRecursion`/complexity-threshold heuristic as the memoization
 * trigger.
 */
export const analyzeReentrancy = (
  grammar: GrammarDefinition,
): ReentrancyAnalysis => {
  const { nullableRules } = analyzeFirstSets(grammar);
  const ruleInvocableAtZero = computeRuleInvocableAtZero(
    grammar,
    nullableRules,
  );
  const ctx: WalkContext = { ruleInvocableAtZero, nullableRules };

  const reentrantRules = new Set<string>();
  for (const rule of grammar.rules) {
    for (const name of walk(rule.pattern, ctx).reentrant) {
      reentrantRules.add(name);
    }
  }

  return { reentrantRules };
};
