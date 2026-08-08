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
 * ## Dominance-based minimization
 *
 * `invocableAtZero` follows `Identifier` references transitively (rule
 * `R`'s set includes everything reachable from `R`'s own body at offset
 * 0, not just `R` itself) via the same iterative-fixpoint pattern
 * `first-sets.ts` uses for FIRST sets. That means a rule several levels
 * below an actually-shared rule can also get flagged: e.g. for
 * `sum = product "+" sum / product "-" sum / product`, `product = atom
 * "*" product / atom "/" product / atom`, `atom = "(" sum ")" / number`,
 * the raw analysis above flags `product`, `atom`, *and* `number` -- even
 * though memoizing `product` alone already prevents `atom` (and
 * therefore `number`) from ever being re-invoked at a shared offset: a
 * cache hit on `product` short-circuits before its body -- and
 * therefore every invocation of `atom` (and `number`) inside that body
 * -- ever runs again. `atom` is invoked some fixed, grammar-determined
 * number of times per FRESH (cache-miss) execution of `product`'s body
 * (three, textually, in this grammar) regardless of memoization; what
 * memoizing `product` eliminates is the outer redundancy -- `sum`'s
 * three alternatives each re-invoking `product` (and therefore each of
 * those fixed `atom` calls) at the SAME offset -- which is exactly what
 * made `atom`/`number` unboundedly (not just a fixed few times)
 * reentrant in the first place. Verified empirically (see the commit
 * that added this section): memoizing `product` alone, with `atom`/
 * `number` left unmemoized entirely, produces the SAME
 * `leafInvocationsPerParse` as memoizing all three on
 * `BENCH_UNFACTORED_ARITHMETIC_GRAMMAR`.
 *
 * `minimizeByDominance` below removes exactly this kind of dominated
 * rule from the flagged set, via a criterion narrow enough to stay
 * strictly safe (see its own doc comment for the soundness argument and
 * why it's conservative rather than complete -- some real dominance
 * relationships in more tangled grammars won't be found, and that's
 * fine: a rule that's dominated but not provably so just keeps its own
 * small, mostly-empty-after-first-hit `Map`, the same safe fallback the
 * raw over-approximation above already relies on). `chars`/`ranges`-
 * style "always safe to over-approximate, never safe to guess smaller"
 * reasoning still governs every case this minimization declines to
 * resolve.
 *
 * ## Cut-aware suppression
 *
 * A `Cut` (`~`) inside a `Sequence` makes its ENCLOSING `Choice`'s later
 * alternatives provably unreachable once the cut fires: ordered choice
 * never reconsiders an earlier alternative after it has committed. That
 * has a direct consequence for reentrancy: if a rule `R` is invoked only
 * AFTER a cut in alternative `K` of some `Choice`, and `R` is also
 * invoked by a LATER alternative `K+1..N`, those two invocations can
 * never both happen in the same parse attempt at that offset -- either
 * the cut fires (so `K+1..N` never run) or it doesn't (so `K`'s
 * post-cut invocation of `R` never happens either, and `K+1` is tried
 * fresh). Either way `R` runs at most once. `walkChoice` below (via
 * `preCutOnlyTotal`) excludes exactly that pairing from detection --
 * while still flagging `R` normally against any EARLIER alternative
 * (`1..K-1`, which already ran and failed before `K` was even
 * attempted, so their invocations of `R` are unaffected by a cut that
 * only fires later) and against overlaps entirely within one
 * alternative's own structure (unaffected either way).
 *
 * `Cut` itself still contributes nothing to `invocableAtZero` (it
 * invokes no rule) and is still treated as nullable (`isNullable` in
 * `first-sets.ts`; it never itself blocks a nullable-prefix walk) -- see
 * `walkSequence`'s unchanged handling.
 *
 * This is intentionally narrow, not a general cut-position analyzer:
 * `preCutOnlyTotal` only recognizes a `Cut` as a DIRECT element of the
 * alternative's own top-level `Sequence` (unwrapping one transparent
 * `Group`). Anything else -- a cut nested inside a further Group's own
 * Sequence, behind a nested Choice, etc. -- falls back to treating the
 * WHOLE alternative as pre-cut (i.e. exactly today's behavior, no
 * suppression). That fallback is always safe: it can only under-exploit
 * this optimization, never over-apply it, so an unusual cut placement
 * this analysis doesn't recognize costs at most one extra `Map`, not a
 * correctness bug. It's also often a no-op even for a recognized cut:
 * `walkSequence`'s existing non-nullable early-break already stops
 * before reaching a cut preceded by any non-nullable element (the common
 * case, e.g. `"if" ~ condition` -- the keyword itself already makes
 * everything after it, cut included, unreachable at offset zero from
 * that alternative's own start). Suppression only has something to do
 * when everything before the cut in the same sequence is nullable.
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

/**
 * The subset of `full.total` (`alt`'s own already-computed
 * `invocableAtZero`) reachable WITHOUT needing a `Cut` inside `alt` to
 * have fired -- i.e. names invocable from the portion of `alt`'s
 * top-level `Sequence` up to (not including) a direct `Cut` element.
 * Falls back to `full.total` unchanged (no suppression -- see the module
 * doc comment's "Cut-aware suppression" section for why that fallback is
 * always safe) whenever `alt` isn't recognizably "a Sequence with a
 * direct Cut element" after unwrapping one transparent `Group`.
 */
const preCutOnlyTotal = (
  alt: Expression,
  ctx: WalkContext,
  full: InvocationResult,
): ReadonlySet<string> => {
  const unwrapped = alt.type === "Group" ? alt.expression : alt;
  if (unwrapped.type !== "Sequence") return full.total;
  const cutIndex = unwrapped.elements.findIndex((el) => el.type === "Cut");
  if (cutIndex === -1) return full.total;

  // Mirrors `walkSequence`'s own nullable-prefix loop, just bounded to
  // stop at the cut regardless of what (if anything) would have
  // followed it.
  const total = new Set<string>();
  for (let i = 0; i < cutIndex; i++) {
    const element = unwrapped.elements[i] as Expression;
    for (const name of walk(element, ctx).total) total.add(name);
    if (!isNullable(element, ctx.nullableRules)) break;
  }
  return total;
};

const walkChoice = (expr: Choice, ctx: WalkContext): InvocationResult => {
  // `total`: returned to this Choice's own caller -- the union of EVERY
  // alternative's full invocableAtZero, cuts notwithstanding. From
  // outside this Choice, any alternative might be the one that runs, so
  // nothing internal to it should narrow what's externally reachable.
  const total = new Set<string>();
  // `visibleForFolding`: what's checked against/added to when
  // processing each successive alternative, in order -- populated only
  // from the PRE-CUT-safe portion of each alternative (see
  // `preCutOnlyTotal`), so a later alternative is never flagged
  // reentrant against something an earlier alternative could only reach
  // by way of its own cut having already fired (which would mean this
  // later alternative could never have been reached to begin with).
  const visibleForFolding = new Set<string>();
  const reentrant = new Set<string>();
  for (const alternative of expr.alternatives) {
    // Every alternative starts at the same offset as the Choice itself
    // (ordered choice tries them one after another on failure), unlike a
    // Sequence's nullable-prefix cutoff -- so unlike `walkSequence`,
    // every alternative is folded in regardless of its own nullability.
    const full = walk(alternative, ctx);
    for (const r of full.reentrant) reentrant.add(r);
    for (const r of full.total) {
      if (visibleForFolding.has(r)) reentrant.add(r);
      total.add(r);
    }
    for (const name of preCutOnlyTotal(alternative, ctx, full)) {
      visibleForFolding.add(name);
    }
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
   * three ways this happens, and its "Dominance-based minimization"
   * section for what's excluded from this set despite being flagged by
   * the raw overlap analysis, and why that's still safe. */
  readonly reentrantRules: ReadonlySet<string>;
}

/**
 * Collects every rule name referenced ANYWHERE in `expr`'s tree into
 * `into` -- every `Identifier`, regardless of whether it sits at offset
 * zero relative to `expr`'s own start (unlike `walk`/`invocableAtZero`
 * above, which stops at the first non-nullable `Sequence` element). The
 * basis for `minimizeByDominance`'s caller-counting: bounding "how many
 * times can rule R be invoked from within one execution of rule S's
 * body" needs every reference to R in S's pattern, not just the ones
 * reachable without consuming a character first.
 */
const collectAllIdentifiers = (expr: Expression, into: Set<string>): void => {
  switch (expr.type) {
    case "Identifier":
      into.add(expr.name);
      return;
    case "Sequence":
      for (const el of expr.elements) collectAllIdentifiers(el, into);
      return;
    case "Choice":
      for (const alt of expr.alternatives) collectAllIdentifiers(alt, into);
      return;
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
    case "Quantified":
    case "LabeledExpression":
    case "ActionExpression":
    case "PositiveLookahead":
    case "NegativeLookahead":
      collectAllIdentifiers(expr.expression, into);
      return;
    default:
      return;
  }
};

/**
 * Removes rules from `rawReentrantRules` that are DOMINATED by another
 * rule in that same set -- i.e. every possible invocation of `R` flows
 * through a single ancestor `S` whose own memoization already bounds how
 * often `R` can run at a given offset, making `R`'s own memo table
 * redundant. See the module doc comment's "Dominance-based minimization"
 * section for the motivating example and an empirical validation.
 *
 * ## The criterion, and why it's sound
 *
 * `R` is dominated by `S` when `R` has EXACTLY ONE distinct caller in
 * the entire grammar (a rule, other than `R` itself, whose pattern
 * contains at least one `Identifier(R)` reference -- anywhere in the
 * pattern, not just at offset zero), and walking that "sole caller"
 * chain upward (`R`'s sole caller, THAT rule's own sole caller, and so
 * on) terminates at `S`, a rule that is itself in `rawReentrantRules`.
 *
 * Soundness, by induction up the chain: if `S`'s ONLY caller (other than
 * itself) in the whole grammar is nonexistent or ambiguous (that's
 * exactly why the walk stops at `S` -- it has no sole caller of its
 * own), `S` is not itself dominated by anything found here, so it stays
 * in the final memoized set. Every rule immediately below `S` in the
 * chain is, by construction, invoked ONLY as part of executing `S`'s
 * body -- some fixed, grammar-determined number of times per fresh
 * (non-cache-hit) execution of that body, since `S`'s own source text
 * only contains so many references to it. Memoizing `S` bounds how many
 * times `S`'s body runs fresh at any given offset to one, which
 * transitively bounds every rule reachable ONLY through that one path to
 * that same fixed multiple -- i.e. bounded, not unbounded, invocation
 * counts at a single offset, which is precisely "not reentrant." This
 * repeats down the whole chain to `R`.
 *
 * ## Why "exactly one caller" (not "reachable from some memoized rule")
 *
 * A rule reachable from `S` through more than one distinct calling path
 * -- even if `S` itself is memoized -- could still be independently
 * re-invoked via whichever path does NOT go through `S`'s own cache
 * boundary; `S` being memoized says nothing about that other path.
 * Requiring a UNIQUE caller at every step of the chain is what rules
 * that out: there is no other path, by construction. This is
 * deliberately conservative, not complete -- a rule with two callers
 * that both happen to be fully dominated by the same higher ancestor
 * would still stay in the final set here, costing one extra `Map` it
 * didn't strictly need. That's the same safe direction the module doc
 * comment's "always safe to over-approximate" reasoning already commits
 * to elsewhere.
 *
 * Verified against `BENCH_ACYCLIC_CHAIN_GRAMMAR` (`bench/grammars.ts`):
 * `a1`..`a9` each have exactly one caller (`a(N-1)`), but the chain from
 * any of them resolves to `a0` -- which is NOT itself reentrant (it's
 * the grammar's sole entry point, invoked exactly once). Since the
 * terminal rule isn't in `rawReentrantRules`, none of `a1`..`a9` are
 * dominated; all nine keep their own memo table, exactly as before this
 * minimization existed. This is the deliberate negative-control case:
 * the guarantee this whole module was built around must not regress.
 */
const minimizeByDominance = (
  grammar: GrammarDefinition,
  rawReentrantRules: ReadonlySet<string>,
): ReadonlySet<string> => {
  const callersOf = new Map<string, Set<string>>();
  for (const rule of grammar.rules) {
    const referenced = new Set<string>();
    collectAllIdentifiers(rule.pattern, referenced);
    for (const name of referenced) {
      let callers = callersOf.get(name);
      if (!callers) {
        callers = new Set();
        callersOf.set(name, callers);
      }
      callers.add(rule.name);
    }
  }

  // soleCaller.get(R) = the one rule (other than R) that references R,
  // when exactly one such distinct rule exists in the whole grammar.
  // Undefined when R has zero or 2+ distinct callers, or when its only
  // reference is a self-reference.
  const soleCaller = new Map<string, string>();
  for (const [name, callers] of callersOf) {
    if (callers.size === 1) {
      const [only] = callers;
      if (only !== undefined && only !== name) soleCaller.set(name, only);
    }
  }

  // Walks the sole-caller chain from `start` to its end -- the highest
  // ancestor reachable via a run of unique-caller edges. A cycle guard
  // (soleCaller edges always point to a DIFFERENT rule, but a chain
  // could still loop back through several of them) returns `null`
  // rather than ever looping forever; a cycle simply means nothing here
  // dominates any rule on it.
  const rootOf = (start: string): string | null => {
    const visited = new Set<string>([start]);
    let current = start;
    while (true) {
      const next = soleCaller.get(current);
      if (next === undefined) return current;
      if (visited.has(next)) return null;
      visited.add(next);
      current = next;
    }
  };

  const minimized = new Set<string>();
  for (const name of rawReentrantRules) {
    const root = rootOf(name);
    const dominated =
      root !== null && root !== name && rawReentrantRules.has(root);
    if (!dominated) minimized.add(name);
  }
  return minimized;
};

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

  const rawReentrantRules = new Set<string>();
  for (const rule of grammar.rules) {
    for (const name of walk(rule.pattern, ctx).reentrant) {
      rawReentrantRules.add(name);
    }
  }

  return {
    reentrantRules: minimizeByDominance(grammar, rawReentrantRules),
  };
};
