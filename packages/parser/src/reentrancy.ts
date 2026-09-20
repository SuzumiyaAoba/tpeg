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
 * with zero characters consumed between them. The shapes that produces
 * in a PEG:
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
 * 4. **A prefix element's end-invocation meeting the next element's
 *    start** -- `("x" r?) r` or `("x" &R) R`: the group's last
 *    zero-width element invokes `R` at the offset where the group ends,
 *    which is exactly where the following element runs.
 * 5. **A bounded `e{n,m}` over a nullable body** -- `quantified`'s
 *    required/bounded-optional loops (`packages/core/repetition.ts`)
 *    have no zero-progress guard, so `a{2}` invokes `a` twice at the
 *    same offset when `a` can match empty.
 *
 * None of these is offset-specific to a rule's own start: a `Sequence`
 * can open a NEW same-offset window after every non-nullable element
 * (`"x" a? a` double-invokes `a` at offset 1, not 0), so `walkSequence`
 * tracks a fresh overlap window per segment plus each boundary's
 * `invocableAtEnd` (source 4), rather than stopping at the first
 * non-nullable element.
 *
 * The first three reduce to the same shape once phrased as "which rule
 * names can this expression invoke without consuming a character first,
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

import {
  analyzeFirstSets,
  collectZeroOffsetRuleRefs,
  isNullable,
} from "./first-sets";
import { collectRuleDependencies } from "./performance-utils";
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
  /** Converged per-rule `invocableAtEnd` sets -- the rules a rule's own
   * body can invoke at the position where the rule's match ENDS (the
   * mirror image of `invocableAtZero`; see `computeRuleInvocableAtEnd`
   * and `endWalk`). Used by `walkSequence` to detect a rule invoked at
   * the boundary between two elements by both sides of the boundary
   * (e.g. `("x" &r) r`: `&r` invokes `r` at the group's end offset,
   * which is exactly where the bare `r` element then runs). */
  readonly ruleInvocableAtEnd: ReadonlyMap<string, ReadonlySet<string>>;
  readonly nullableRules: ReadonlyMap<string, boolean>;
}

const walkSequence = (expr: Sequence, ctx: WalkContext): InvocationResult => {
  const total = new Set<string>();
  const reentrant = new Set<string>();
  // `window` accumulates the rule names invocable at the CURRENT shared
  // offset -- it aliases `total` while still in the sequence's own
  // nullable prefix (that first window is exactly `invocableAtZero`,
  // the value callers expect back), then restarts fresh after every
  // non-nullable element: each such element consumed >= 1 character on
  // success, so the elements after it run at a strictly greater offset
  // -- a new window, where an overlap is every bit as reentrant as one
  // at offset 0 (`"x" a? a` invokes `a` twice at offset 1). The earlier
  // version simply `break`ed at the first non-nullable element: correct
  // for `total` but it also stopped looking for reentrancy entirely,
  // missing every overlap past that point (`"x" (r / r)`, `"x" a? a`).
  let window: Set<string> = total;
  // `endReach` accumulates names invocable at the position where the
  // already-walked prefix can END (see `endWalk`): for the element just
  // before a non-nullable consumer that's the consumer's own
  // end-invocations, and each nullable element adds its own
  // end-invocations on top (on a path where it consumed but everything
  // after it matched empty). Any single `endReach` source co-occurs
  // with a later element's start-invocation, while two `endReach`
  // sources can never co-occur at one boundary (each needs a different
  // "last consuming element") -- so merging them into one set is exact,
  // not an approximation.
  let endReach = new Set<string>();
  for (const element of expr.elements) {
    const elResult = walk(element, ctx);
    const elEnd = endWalk(element, ctx);
    for (const r of elResult.reentrant) reentrant.add(r);
    for (const r of elResult.total) {
      // `element`'s own start-invocations (offset 0 relative to itself)
      // land at the current boundary -- flag anything an earlier
      // same-offset sibling start (`window`) or an earlier element's
      // end-invocation (`endReach`) already claimed.
      if (window.has(r) || endReach.has(r)) reentrant.add(r);
      window.add(r);
    }
    if (isNullable(element, ctx.nullableRules)) {
      // Nullable: stays in the current offset window (its start-
      // invocation can also land at later boundaries on the all-empty
      // path -- that's what `window` carrying `elResult.total` forward
      // means) AND contributes its end-invocations as a new possible
      // source at the boundary after it.
      for (const r of elEnd) endReach.add(r);
    } else {
      // Non-nullable: guaranteed to consume, so every element after it
      // starts strictly later -- a new offset window whose only
      // prefix-end source is THIS element's end-invocations (everything
      // before it can no longer reach the new boundary).
      window = new Set<string>();
      endReach = new Set(elEnd);
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
    case "WordBoundary":
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
    case "Quantified": {
      const inner = walk(expr.expression, ctx);
      // A bounded `e{n,m}` invokes its body up to `max` times with NO
      // zero-progress guard between iterations (`quantified` in
      // `packages/core/src/repetition.ts`: the required `for` loop and
      // the bounded-optional loop are plain counters), so a nullable
      // body is genuinely re-invoked at the same offset -- the same
      // self-overlap `a a` in a plain Sequence produces, folded into
      // one node. (`e{n,}` unbounded over a nullable body is rejected
      // by `assertNoNullableRepetition` at generation time and the
      // `{0,}`/`{1,}` spellings lower to `zeroOrMore`/`oneOrMore`,
      // whose guards fire on the first zero-width match; flagging
      // those too is harmless -- that shape never reaches codegen.)
      if (
        (expr.max === undefined || expr.max >= 2) &&
        isNullable(expr.expression, ctx.nullableRules)
      ) {
        const reentrant = new Set<string>(inner.reentrant);
        for (const r of inner.total) reentrant.add(r);
        return { total: inner.total, reentrant };
      }
      return inner;
    }
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
    case "LabeledExpression":
    case "ActionExpression":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "Skip":
    case "Span":
      // `ignore(optional(<rule>))` invokes the skip rule at the current
      // position exactly like `Optional` does -- transparent for the
      // zero-offset-invocation graph this analysis builds.
      return walk(expr.expression, ctx);
    default:
      return EMPTY_RESULT;
  }
};

/**
 * `invocableAtEnd(expr)`: the mirror image of `walk`'s `.total` -- the
 * set of rule names `expr` can invoke AT the position where its own
 * match ends (rather than where it starts). `walkSequence` uses it to
 * detect a rule invoked at an element boundary by both sides:
 * `("x" r?) r` invokes `r` at the end of the group (inside `r?`'s
 * failed attempt) and again at the bare `r` element's start -- both at
 * the same input offset.
 *
 * Node-for-node, relative to `walk`:
 *
 * - `Identifier(R)` resolves to `ruleInvocableAtEnd[R]` (rules R's own
 *   body invokes at R's end), plus `R` itself when R is nullable: a
 *   call to R sits at R's start, and only an empty match puts that
 *   call site at R's end position too.
 * - `Sequence` scans elements RIGHT-to-left through its nullable
 *   suffix: each suffix element contributes both its start-invocations
 *   (`walk(...).total` -- its start coincides with the sequence's end
 *   when everything after it matched empty) and its own end-invocations
 *   (`endWalk`), and the first non-nullable element contributes only
 *   its end-invocations before the scan stops (its start is strictly
 *   earlier than its end, so its start-invocations can never land at
 *   the sequence's end offset).
 * - Repetition wrappers contribute `walk(inner).total` (a repetition
 *   always makes one final zero-width/failed attempt at its own end
 *   position) plus `endWalk(inner)` (the last successful iteration's
 *   end-invocations land there too).
 * - Lookaheads contribute `walk(inner).total`: a lookahead ends where
 *   it started, so the invocations it makes at its end position are
 *   exactly its zero-offset ones.
 * - Everything else is transparent or empty exactly as in `walk`.
 */
const endWalk = (expr: Expression, ctx: WalkContext): ReadonlySet<string> => {
  switch (expr.type) {
    case "Identifier": {
      const known = ctx.ruleInvocableAtEnd.get(expr.name);
      if (!known) return EMPTY_RESULT.total;
      if (isNullable(expr, ctx.nullableRules)) {
        const withSelf = new Set<string>(known);
        withSelf.add(expr.name);
        return withSelf;
      }
      return known;
    }
    case "Sequence": {
      const acc = new Set<string>();
      for (let i = expr.elements.length - 1; i >= 0; i--) {
        const element = expr.elements[i] as Expression;
        for (const r of endWalk(element, ctx)) acc.add(r);
        if (!isNullable(element, ctx.nullableRules)) break;
        for (const r of walk(element, ctx).total) acc.add(r);
      }
      return acc;
    }
    case "Choice": {
      const acc = new Set<string>();
      for (const alternative of expr.alternatives) {
        for (const r of endWalk(alternative, ctx)) acc.add(r);
      }
      return acc;
    }
    case "Optional":
    case "Star":
    case "Plus":
    case "Quantified":
    case "Skip": {
      const acc = new Set<string>(endWalk(expr.expression, ctx));
      for (const r of walk(expr.expression, ctx).total) acc.add(r);
      return acc;
    }
    case "PositiveLookahead":
    case "NegativeLookahead":
      return walk(expr.expression, ctx).total;
    case "Group":
    case "Span":
    case "LabeledExpression":
    case "ActionExpression":
      return endWalk(expr.expression, ctx);
    default:
      return EMPTY_RESULT.total;
  }
};

/**
 * Computes, for every rule, the full transitive set of rule names
 * invocable at offset 0 from that rule's own start -- always including
 * the rule's own name, since `Identifier` resolution needs "does this
 * name eventually reach itself or another shared rule," not just "what
 * does this rule call directly." Terminates because each rule's set is
 * monotonically growing and bounded by the total number of rules in the
 * grammar.
 *
 * Worklist propagation over the zero-offset dependency graph
 * (`first-sets.ts`'s shared `collectZeroOffsetRuleRefs` -- `walk`'s
 * traversal restricted to collecting the referenced names themselves
 * rather than looking up their (in-progress) fixpoint sets; since
 * `walk(Identifier).total` is exactly `ruleInvocableAtZero.get(name)`,
 * `walk(expr).total` always equals the union of `table[d]` over every
 * `d` it collects -- which is what lets this propagate along those
 * edges incrementally instead of re-walking every rule's whole pattern
 * each pass), the same shape `first-sets.ts`'s
 * `analyzeFirstSets` now uses: when a rule's set grows, only rules that
 * directly depend on it are revisited. The full-rescan fixpoint this
 * replaced re-walked every rule's whole pattern once per propagation
 * hop, so a chain `r0 -> r1 -> ... -> rN` took O(rules^2) walks.
 */
const computeRuleInvocableAtZero = (
  grammar: GrammarDefinition,
  nullableRules: ReadonlyMap<string, boolean>,
): Map<string, Set<string>> => {
  const table = new Map<string, Set<string>>(
    grammar.rules.map((r) => [r.name, new Set([r.name])]),
  );

  // dependents.get(d) = every rule whose zero-offset traversal reaches
  // `d`, i.e. whose `total` must absorb `table[d]` whenever it grows.
  // A name that isn't a declared rule (an external parser reference --
  // `walk`'s `Identifier` case returns `EMPTY_RESULT` for it) has no
  // table entry, so depending on it can never add anything.
  const dependents = new Map<string, Set<string>>();
  const directDeps = new Map<string, ReadonlySet<string>>();
  for (const rule of grammar.rules) {
    const deps = new Set<string>();
    collectZeroOffsetRuleRefs(rule.pattern, nullableRules, deps);
    deps.delete(rule.name); // self-edge is subsumed by the seed below
    directDeps.set(rule.name, deps);
    for (const dep of deps) {
      let set = dependents.get(dep);
      if (!set) {
        set = new Set();
        dependents.set(dep, set);
      }
      set.add(rule.name);
    }
  }

  // Delta propagation: `pending.get(r)` holds exactly the names added to
  // `table[r]` since `r` was last dequeued, so each (edge, name) pair is
  // merged once -- re-merging a dependency's WHOLE set on every growth
  // would make a single edge cost O(rules^2) on a long chain.
  const pending = new Map<string, string[]>();
  const inQueue = new Set<string>();
  const queue: string[] = [];
  const absorb = (rule: string, names: Iterable<string>): void => {
    const target = table.get(rule) as Set<string>;
    let delta = pending.get(rule);
    if (!delta) {
      delta = [];
      pending.set(rule, delta);
    }
    for (const name of names) {
      if (!target.has(name)) {
        target.add(name);
        delta.push(name);
      }
    }
    if (delta.length > 0 && !inQueue.has(rule)) {
      queue.push(rule);
      inQueue.add(rule);
    }
  };

  // Seed: each rule's set starts as {own name} plus each direct
  // dependency's own name (every declared dep's seed) -- equivalent to
  // one pass of the old full-rescan loop.
  for (const rule of grammar.rules) {
    absorb(rule.name, [rule.name]);
    for (const dep of directDeps.get(rule.name) as ReadonlySet<string>) {
      if (table.has(dep)) absorb(rule.name, [dep]);
    }
  }

  while (queue.length > 0) {
    const dep = queue.pop() as string;
    inQueue.delete(dep);
    const delta = pending.get(dep) as string[];
    pending.set(dep, []);
    for (const dependent of dependents.get(dep) ?? []) {
      absorb(dependent, delta);
    }
  }

  return table;
};

/**
 * The rule names `expr` references in positions that contribute to
 * `endWalk(expr)` -- the dual of `collectZeroOffsetRuleRefs`
 * (`./first-sets.ts`) for `computeRuleInvocableAtEnd`, mirroring
 * `endWalk`'s own traversal exactly:
 *
 * - `zero` receives every `Identifier` reached through a *zero-offset*
 *   position inside an end-position context (a nullable `Sequence`
 *   suffix element, the inner of a repetition/lookahead) -- those
 *   contribute `ruleInvocableAtZero[name]` (an already-converged
 *   constant) to the owner's `invocableAtEnd`.
 * - `end` receives every `Identifier` reached through a *genuinely
 *   end-position* context (the first non-nullable element of the
 *   suffix scan, the `Identifier` case itself) -- those contribute
 *   `ruleInvocableAtEnd[name]`, propagated through the fixpoint, plus
 *   `name` itself when the referenced rule is nullable (the empty-match
 *   call site; see `endWalk`'s `Identifier` case).
 */
const collectEndRuleRefs = (
  expr: Expression,
  nullableRules: ReadonlyMap<string, boolean>,
  zero: Set<string>,
  end: Set<string>,
): void => {
  switch (expr.type) {
    case "Identifier":
      end.add(expr.name);
      return;
    case "Sequence":
      for (let i = expr.elements.length - 1; i >= 0; i--) {
        const element = expr.elements[i] as Expression;
        collectEndRuleRefs(element, nullableRules, zero, end);
        if (!isNullable(element, nullableRules)) break;
        collectZeroOffsetRuleRefs(element, nullableRules, zero);
      }
      return;
    case "Choice":
      for (const alternative of expr.alternatives) {
        collectEndRuleRefs(alternative, nullableRules, zero, end);
      }
      return;
    case "Optional":
    case "Star":
    case "Plus":
    case "Quantified":
    case "Skip":
      collectEndRuleRefs(expr.expression, nullableRules, zero, end);
      collectZeroOffsetRuleRefs(expr.expression, nullableRules, zero);
      return;
    case "PositiveLookahead":
    case "NegativeLookahead":
      collectZeroOffsetRuleRefs(expr.expression, nullableRules, zero);
      return;
    case "Group":
    case "Span":
    case "LabeledExpression":
    case "ActionExpression":
      collectEndRuleRefs(expr.expression, nullableRules, zero, end);
      return;
    default:
      return;
  }
};

/**
 * Computes, for every rule, the transitive set of rule names its body
 * can invoke at the position where the rule's match ends -- the
 * fixpoint feeding `endWalk`'s `Identifier` case, exactly the way
 * `computeRuleInvocableAtZero` feeds `walk`'s.
 *
 * Unlike the zero table there is NO self-seed: a rule's own name is
 * not invoked at its body's end merely by being invoked at its start.
 * A rule's name enters its own end set only if its body can invoke it
 * again at the end position AND it is nullable (so that recursive call
 * site can sit at the body's end offset) -- the same conditional
 * `endWalk`'s `Identifier` case applies.
 *
 * Edge structure: `end` deps (see `collectEndRuleRefs`) propagate
 * `ruleInvocableAtEnd` deltas through the worklist; `zero` deps
 * contribute whole `ruleInvocableAtZero` sets, which are already
 * converged constants by the time this runs, so they fold into the
 * seed and need no edges of their own.
 */
const computeRuleInvocableAtEnd = (
  grammar: GrammarDefinition,
  nullableRules: ReadonlyMap<string, boolean>,
  ruleInvocableAtZero: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, Set<string>> => {
  const table = new Map<string, Set<string>>(
    grammar.rules.map((r) => [r.name, new Set<string>()]),
  );

  // dependents.get(d) = every rule whose end traversal reaches `d`,
  // i.e. whose `invocableAtEnd` must absorb `table[d]` whenever it grows.
  const dependents = new Map<string, Set<string>>();
  const seeds = new Map<string, string[]>();
  for (const rule of grammar.rules) {
    const zero = new Set<string>();
    const end = new Set<string>();
    collectEndRuleRefs(rule.pattern, nullableRules, zero, end);
    const seed: string[] = [];
    for (const dep of zero) {
      const depZero = ruleInvocableAtZero.get(dep);
      if (depZero) {
        for (const name of depZero) seed.push(name);
      }
    }
    for (const dep of end) {
      if (!table.has(dep)) continue;
      // A nullable dep's own name is an end-position call site (its
      // empty match makes call offset == end offset); a self-edge needs
      // no propagation entry -- absorbing `table[R]` into itself is a
      // no-op -- but the conditional own-name contribution still counts.
      if (nullableRules.get(dep)) seed.push(dep);
      if (dep !== rule.name) {
        let set = dependents.get(dep);
        if (!set) {
          set = new Set();
          dependents.set(dep, set);
        }
        set.add(rule.name);
      }
    }
    seeds.set(rule.name, seed);
  }

  const pending = new Map<string, string[]>();
  const inQueue = new Set<string>();
  const queue: string[] = [];
  const absorb = (rule: string, names: Iterable<string>): void => {
    const target = table.get(rule) as Set<string>;
    let delta = pending.get(rule);
    if (!delta) {
      delta = [];
      pending.set(rule, delta);
    }
    for (const name of names) {
      if (!target.has(name)) {
        target.add(name);
        delta.push(name);
      }
    }
    if (delta.length > 0 && !inQueue.has(rule)) {
      queue.push(rule);
      inQueue.add(rule);
    }
  };

  // Seed each rule's set (zero-dep constants + nullable end-dep names);
  // the worklist then propagates `table[dep]` growth along the end-dep
  // edges exactly like `computeRuleInvocableAtZero`.
  for (const rule of grammar.rules) {
    absorb(rule.name, seeds.get(rule.name) as string[]);
  }

  while (queue.length > 0) {
    const dep = queue.pop() as string;
    inQueue.delete(dep);
    const delta = pending.get(dep) as string[];
    pending.set(dep, []);
    for (const dependent of dependents.get(dep) ?? []) {
      absorb(dependent, delta);
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
    // `collectRuleDependencies` (`./performance-utils.ts`) gathers every
    // `Identifier` ANYWHERE in the pattern -- not just at offset zero
    // like `walk`/`invocableAtZero` above -- because bounding "how many
    // times can R be invoked from one execution of S's body" needs every
    // reference to R in that body.
    collectRuleDependencies(rule.pattern, referenced);
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
  // ancestor reachable via a run of unique-caller edges. `soleCaller` is
  // a function (each node has at most one successor), so every node on a
  // chain shares its outcome: memoizing the whole walked path turns the
  // per-rule walks from O(chain^2) on a long caller chain into O(chain)
  // total. A cycle guard (soleCaller edges always point to a DIFFERENT
  // rule, but a chain could still loop back through several of them)
  // returns `null` rather than ever looping forever; a cycle simply
  // means nothing here dominates any rule on it -- and every node that
  // reaches the same cycle is likewise undominated, so `null` is safe
  // to memoize too.
  const rootMemo = new Map<string, string | null>();
  const rootOf = (start: string): string | null => {
    const memoized = rootMemo.get(start);
    if (memoized !== undefined) return memoized;
    const path: string[] = [start];
    const onPath = new Set<string>([start]);
    let current = start;
    let result: string | null;
    while (true) {
      const next = soleCaller.get(current);
      if (next === undefined || onPath.has(next)) {
        // Chain end, or a loop back onto this walk's own path (a cycle:
        // nothing on it is dominated).
        result = next === undefined ? current : null;
        break;
      }
      const memo = rootMemo.get(next);
      if (memo !== undefined) {
        result = memo;
        break;
      }
      onPath.add(next);
      path.push(next);
      current = next;
    }
    for (const name of path) rootMemo.set(name, result);
    return result;
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
  const ruleInvocableAtEnd = computeRuleInvocableAtEnd(
    grammar,
    nullableRules,
    ruleInvocableAtZero,
  );
  const ctx: WalkContext = {
    ruleInvocableAtZero,
    ruleInvocableAtEnd,
    nullableRules,
  };

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
