/**
 * Global cut promotion: marking a `Cut` safe for `commitAtTopLevel`.
 *
 * Today's
 * codegen (`codegen.ts`/`codegen-optimized.ts`) only ever emits
 * `commitAtTopLevel` (which lets `memoize`, `packages/combinator/src/
 * logic.ts`, discard now-unreachable cache entries) for a `Cut` that is a
 * *direct element of the start rule's own top-level `Sequence`* -- every
 * other cut, however provably safe, compiles to the ordinary, purely-local
 * `commit`. That condition is sufficient but far from necessary. This
 * module marks additional `Cut` nodes `global: true` when a strictly
 * broader -- but still narrow and deliberately under-approximate --
 * condition holds, letting codegen extend `commitAtTopLevel` to them too.
 *
 * An earlier design for this drew on Mizushima et al.'s FOLLOW-set result
 * directly (a new `follow-sets.ts` fixpoint, gating promotion through a
 * repetition on "the repeated non-terminal's FOLLOW set is concrete and
 * non-`unknown`"). Building that against this codebase's two target
 * grammars (`BENCH_CUTTABLE_CONFIG_GRAMMAR`'s `entry+`, promotable;
 * `BENCH_UNFACTORED_ARITHMETIC_GRAMMAR`'s `atom`, not) showed FOLLOW is
 * never actually consulted by the predicate that gets the right answer on
 * either: the promotion decision reduces entirely to (1) no lookahead
 * ancestor and (2) FIRST-set disjointness against ancestor `Choice`
 * siblings -- exactly `computeCutCandidate`'s existing check (see
 * `ast-optimize-cut-insertion.ts`) -- applied not just within the cut's
 * own rule but transitively at every reference site of that rule, all the
 * way up to the grammar's start rule. FOLLOW was dropped; no
 * `follow-sets.ts` module exists.
 *
 * ## Why FIRST-disjointness at every reference site is enough
 *
 * A promoted cut's watermark advance is sound exactly when nothing above
 * it can still need a position before it re-parsed. The one way that could
 * happen is an ancestor `Choice` (anywhere from the cut's own rule up to
 * the start rule) trying a sibling alternative after the branch containing
 * the cut fails overall -- `choice`/`captureChoice` (`packages/core/src/
 * combinators.ts`) always launder a *local* cut's `FAIL_FATAL` back to an
 * ordinary `FAIL` at their own boundary (that's what "cut is scoped to its
 * own enclosing choice" means, see `commitAtTopLevel`'s doc comment in
 * `packages/combinator/src/logic.ts`), so this can occur one enclosing
 * `Choice` at a time, all the way out to the start rule, regardless of how
 * deep the cut sits.
 *
 * But if that sibling's FIRST set is provably disjoint from the branch
 * containing the cut, trying it costs exactly one failed leaf-parser
 * comparison: the very first character it checks cannot match (by
 * disjointness), so it fails before recursing into anything, and in
 * particular before looking up any `memoize` entry in the truncated range.
 * A "wrongly" re-tried sibling that can never actually touch pruned memory
 * is harmless -- which is why checking disjointness at *every* ancestor
 * `Choice`, one level at a time, all the way to the start rule (rather
 * than requiring *no* ancestor `Choice` exists at all) is enough, without
 * needing FOLLOW or any other machinery.
 *
 * A repetition (`Star`/`Plus`/`Quantified`) wrapping a reference to the
 * cut's rule needs no special-casing either: `zeroOrMore`/`oneOrMore`/
 * `quantified` (`packages/core/src/repetition.ts`) all check
 * `isFatalFailure` and *propagate* a fatal child failure rather than
 * silently ending the loop -- verified by reading their implementations,
 * not assumed -- so a promoted cut's `FAIL_FATAL` never gets absorbed by a
 * repetition into "the loop just stops here, one iteration short of where
 * the watermark already advanced to." Whether the repetition's own
 * reference site sits under an ancestor `Choice` is still checked, same as
 * any other reference site.
 *
 * ## The one place this can still go wrong, and why the guard is cheap
 *
 * The disjointness argument depends on the sibling being tried from the
 * SAME starting position the cut's branch was tried from. An `Optional`,
 * `Star`, or `Quantified{min: 0}` wrapping a `Cut` (directly, in the same
 * rule, not through a reference) can complete zero iterations and report
 * ordinary success having consumed nothing -- a fundamentally different
 * shape of "recovery" than an ancestor `Choice` retrying a sibling, and
 * this module has not carried out the same disjointness-based argument for
 * it. Rather than reason it through, `Cut`s under such a construct are
 * refused promotion outright: this is a stated conservatism (the
 * zero-iteration case is simply not covered by the argument above), not a
 * demonstrated unsoundness -- `Plus`/`Quantified{min >= 1}` are
 * deliberately NOT included in this guard, since a required repetition's
 * fatal-propagation (previous paragraph) already covers it.
 *
 * ## Cycle guard
 *
 * A reference-site walk that follows mutually-recursive rules forever
 * would hang. Rules currently being visited are tracked and any cycle
 * refuses promotion outright -- conservative, not a soundness argument
 * (a cyclic reference graph may well be safe in specific cases), but cheap
 * and this codebase's target grammars don't need it.
 */

import type { GrammarFirstSetAnalysis } from "./first-sets";
import {
  firstSetOfExpression,
  firstSetsDisjoint,
  isNullable,
} from "./first-sets";
import { resolveStartRule } from "./grammar-validation";
import type { Expression, GrammarDefinition, RuleDefinition } from "./types";
import { createChoice, createSequence } from "./types";

/** Per-site structural context, accumulated while walking down from a
 * rule's own root (or from a reference site within some other rule). */
interface CutSiteContext {
  readonly underLookahead: boolean;
  readonly underZeroableRepetition: boolean;
  /** Every `Choice` enclosing this site, outermost first, each recorded
   * with the alternative that contains the site and that alternative's
   * later siblings. ALL of them matter (see the module doc comment
   * above): a cut's `FAIL_FATAL` is absorbed by its immediately-enclosing
   * `choice` into an ordinary `FAIL`, which then propagates outward --
   * and every `Choice` further up sees that ordinary failure and may
   * retry a later sibling from its own start position, below the
   * watermark the promoted cut already advanced. Checking only the
   * nearest `Choice` would miss those outer retries entirely. */
  readonly enclosingChoices: readonly {
    readonly alternative: Expression;
    readonly laterSiblings: readonly Expression[];
  }[];
}

const ROOT_CUT_SITE_CONTEXT: CutSiteContext = {
  underLookahead: false,
  underZeroableRepetition: false,
  enclosingChoices: [],
};

interface IdentifierSite extends CutSiteContext {
  readonly name: string;
}

/** Walks `expr` (a rule's pattern, or a subtree of one), collecting every
 * `Identifier` reachable, each with the structural context (nearest
 * enclosing `Choice`, lookahead/zeroable-repetition ancestry) the
 * reference-site walk below needs. Bottom-up recursion order doesn't
 * matter here (unlike the rewrites above) -- this only reads the tree, it
 * never restructures it. */
const collectIdentifierSites = (
  expr: Expression,
  ctx: CutSiteContext,
  identifiers: IdentifierSite[],
): void => {
  switch (expr.type) {
    case "Identifier":
      identifiers.push({ ...ctx, name: expr.name });
      return;
    case "Sequence":
      for (const el of expr.elements) {
        collectIdentifierSites(el, ctx, identifiers);
      }
      return;
    case "Choice":
      expr.alternatives.forEach((alt, i) => {
        collectIdentifierSites(
          alt,
          {
            ...ctx,
            enclosingChoices: [
              ...ctx.enclosingChoices,
              {
                alternative: alt,
                laterSiblings: expr.alternatives.slice(i + 1),
              },
            ],
          },
          identifiers,
        );
      });
      return;
    case "Group":
    case "LabeledExpression":
    case "ActionExpression":
    case "Span":
      // `span` invokes its child at the current position exactly like a
      // `Group` does -- transparent to the cut-site walk.
      collectIdentifierSites(expr.expression, ctx, identifiers);
      return;
    case "Optional":
    case "Star":
    case "Skip":
      // `ignore(optional(<rule>))` can match zero-width, exactly like
      // `Optional`/`Star` -- the skip rule it invokes is just as
      // "under a zeroable repetition" for the cut-safety argument.
      collectIdentifierSites(
        expr.expression,
        { ...ctx, underZeroableRepetition: true },
        identifiers,
      );
      return;
    case "Plus":
      // Deliberately NOT marked zeroable -- see the module doc comment's
      // "cheap guard" section.
      collectIdentifierSites(expr.expression, ctx, identifiers);
      return;
    case "Quantified":
      collectIdentifierSites(
        expr.expression,
        {
          ...ctx,
          underZeroableRepetition:
            ctx.underZeroableRepetition || expr.min === 0,
        },
        identifiers,
      );
      return;
    case "PositiveLookahead":
    case "NegativeLookahead":
      collectIdentifierSites(
        expr.expression,
        { ...ctx, underLookahead: true },
        identifiers,
      );
      return;
    default:
      return;
  }
};

/** Clause 2: at EVERY enclosing `Choice` level (see `enclosingChoices` on
 * `CutSiteContext` for why the outer levels matter too), is the
 * alternative containing the site proven FIRST-disjoint from every later
 * sibling at that same level? A nullable later sibling is NEVER treated
 * as excluded (mirrors `computeCutCandidate`'s identical guard in
 * `ast-optimize-cut-insertion.ts`) -- it could match zero characters, so
 * "the next character doesn't start it" proves nothing. No enclosing
 * `Choice` at all is vacuously safe -- there is no sibling to worry
 * about. */
const enclosingChoicesDisjoint = (
  ctx: CutSiteContext,
  analysis: GrammarFirstSetAnalysis,
): boolean =>
  ctx.enclosingChoices.every(({ alternative, laterSiblings }) => {
    const ownFirst = firstSetOfExpression(
      alternative,
      analysis.firstSets,
      analysis.nullableRules,
    );
    if (ownFirst.unknown) return false;
    return laterSiblings.every((later) => {
      if (isNullable(later, analysis.nullableRules)) return false;
      const laterFirst = firstSetOfExpression(
        later,
        analysis.firstSets,
        analysis.nullableRules,
      );
      return firstSetsDisjoint(ownFirst, laterFirst);
    });
  });

/** Clause 1 + the structural guard: no lookahead ancestor, no
 * `Optional`/`Star`/`Quantified{min: 0}` ancestor (see the module doc
 * comment's "cheap guard" section). */
const structurallyEligible = (ctx: CutSiteContext): boolean =>
  !ctx.underLookahead && !ctx.underZeroableRepetition;

/**
 * Clause 3, computed for EVERY rule at once: the set of rule names whose
 * every reference site is itself eligible (clause 1 + structural guard)
 * and FIRST-disjoint from its own ancestor `Choice` siblings (clause 2),
 * transitively up to the grammar's start rule (the `@start`-resolved
 * entry rule, `resolveStartRule` in `grammar-validation.ts`).
 *
 * This is the least fixpoint of `safe(r) = (r == startRule) || (sites(r)
 * nonempty && every site s of r: siteOk(s) && safe(s.fromRule))`, where
 * `siteOk` bundles the two per-site checks. A worklist propagates `true`
 * only along reference edges, so each site is examined O(1) times total
 * rather than once per *path* through the reference graph -- the earlier
 * per-cut recursive formulation rechecked shared subgraphs once per
 * incoming path, which is `2^n` on a diamond-shaped reference DAG of n
 * levels (and carried a `visiting` set purely to terminate on cycles --
 * the fixpoint needs neither, since a cyclic component with no safe
 * entry simply never reaches `true`).
 *
 * A rule with zero reference sites that is NOT the start rule is never
 * in the result: this codebase cannot prove such a rule is ever
 * reachable from the start rule at all (dead code, or reachable only
 * through some mechanism this walk doesn't model), so it cannot prove
 * the one thing this check exists to prove.
 */
const computeSafeReferenceChains = (
  grammar: GrammarDefinition,
  analysis: GrammarFirstSetAnalysis,
  referenceSites: ReadonlyMap<
    string,
    ReadonlyArray<{ fromRule: string; site: IdentifierSite }>
  >,
): ReadonlySet<string> => {
  const safe = new Set<string>();
  // `dependents[f]` = the rules that f references (the rules whose
  // safety depends on f's): the reverse edges of the reference graph,
  // restricted to rules that have sites at all.
  const dependents = new Map<string, string[]>();
  // `pending[r]` = how many of r's reference sites are still waiting on
  // their `fromRule` to become safe. Rules with ANY site failing its own
  // per-site check can never be safe and stay out of `pending` entirely
  // (their count would never reach zero anyway, since that site's
  // `fromRule` flipping can't fix the site itself).
  const pending = new Map<string, number>();
  // `siteCount[r][f]` = how many of r's sites have `fromRule === f` --
  // the amount to decrement `pending[r]` by when f becomes safe.
  const siteCount = new Map<string, Map<string, number>>();

  for (const [ruleName, sites] of referenceSites) {
    if (sites.length === 0) continue;
    if (
      sites.some(
        ({ site }) =>
          !structurallyEligible(site) ||
          !enclosingChoicesDisjoint(site, analysis),
      )
    ) {
      continue; // a site failing its own check: r can never be safe
    }
    pending.set(ruleName, sites.length);
    const counts = new Map<string, number>();
    for (const { fromRule } of sites) {
      counts.set(fromRule, (counts.get(fromRule) ?? 0) + 1);
    }
    // One `dependents` entry per DISTINCT fromRule -- a rule appearing
    // once per shared site would otherwise decrement `pending` once per
    // loop visit, double-counting past `siteCount`.
    for (const fromRule of counts.keys()) {
      const list = dependents.get(fromRule);
      if (list) {
        list.push(ruleName);
      } else {
        dependents.set(fromRule, [ruleName]);
      }
    }
    siteCount.set(ruleName, counts);
  }

  const queue: string[] = [];
  const markSafe = (name: string): void => {
    safe.add(name);
    queue.push(name);
  };
  // The chain's root must be the rule parses actually ENTER through --
  // the `@start`-named rule when the annotation is present, not blindly
  // `rules[0]` (`resolveStartRule`, `grammar-validation.ts`). With
  // `@start: x` naming a later rule, `rules[0]` is an ordinary rule that
  // can itself be invoked mid-parse UNDER another rule's enclosing
  // `Choice`, so treating it as "nothing above this" could promote a cut
  // whose `commitAtTopLevel` watermark advance is reachable from a live
  // backtrack point -- the exact unsoundness the chain exists to prevent.
  const startName = resolveStartRule(grammar)?.rule.name;
  if (startName !== undefined) markSafe(startName);

  while (queue.length > 0) {
    const fromRule = queue.pop() as string;
    for (const dependent of dependents.get(fromRule) ?? []) {
      if (safe.has(dependent)) continue;
      const left =
        (pending.get(dependent) ?? 0) -
        (siteCount.get(dependent)?.get(fromRule) ?? 0);
      pending.set(dependent, left);
      if (left === 0) markSafe(dependent);
    }
  }
  return safe;
};

/** Builds a map from rule name to every site (across the whole grammar)
 * that references it by `Identifier`, tagged with which rule the reference
 * appears in. Computed once per `promoteGlobalCuts` call and reused for
 * every candidate `Cut`, rather than re-walking the grammar per cut. */
const buildReferenceSiteMap = (
  grammar: GrammarDefinition,
): Map<string, Array<{ fromRule: string; site: IdentifierSite }>> => {
  const map = new Map<
    string,
    Array<{ fromRule: string; site: IdentifierSite }>
  >();
  for (const rule of grammar.rules) {
    const identifiers: IdentifierSite[] = [];
    collectIdentifierSites(rule.pattern, ROOT_CUT_SITE_CONTEXT, identifiers);
    for (const site of identifiers) {
      const existing = map.get(site.name);
      const entry = { fromRule: rule.name, site };
      if (existing) {
        existing.push(entry);
      } else {
        map.set(site.name, [entry]);
      }
    }
  }
  return map;
};

const promoteCutsInExpression = (
  expr: Expression,
  ruleName: string,
  analysis: GrammarFirstSetAnalysis,
  safeRules: ReadonlySet<string>,
): { expr: Expression; promotedCount: number } => {
  let promotedCount = 0;
  const visit = (e: Expression, ctx: CutSiteContext): Expression => {
    switch (e.type) {
      case "Cut":
        // A `Cut` reached here (rather than via the `Sequence` case below,
        // which is the only place that can prove `hasRealProgressBeforeCut`)
        // has no sibling to have made progress against -- never eligible.
        return e;
      case "Sequence": {
        let sawNonNullable = false;
        const elements = e.elements.map((el) => {
          if (el.type === "Cut") {
            const eligible =
              sawNonNullable &&
              structurallyEligible(ctx) &&
              enclosingChoicesDisjoint(ctx, analysis) &&
              safeRules.has(ruleName);
            if (eligible) promotedCount++;
            return eligible ? { ...el, global: true } : el;
          }
          const rewritten = visit(el, ctx);
          if (!isNullable(el, analysis.nullableRules)) sawNonNullable = true;
          return rewritten;
        });
        return createSequence(elements);
      }
      case "Choice": {
        const alternatives = e.alternatives.map((alt, i) =>
          visit(alt, {
            ...ctx,
            enclosingChoices: [
              ...ctx.enclosingChoices,
              {
                alternative: alt,
                laterSiblings: e.alternatives.slice(i + 1),
              },
            ],
          }),
        );
        return createChoice(alternatives);
      }
      case "Group":
      case "LabeledExpression":
      case "ActionExpression":
      case "Span":
        return { ...e, expression: visit(e.expression, ctx) };
      case "Optional":
      case "Star":
        return {
          ...e,
          expression: visit(e.expression, {
            ...ctx,
            underZeroableRepetition: true,
          }),
        };
      case "Skip": {
        // Same zeroable treatment as `Optional`/`Star`
        // (`ignore(optional(<rule>))` matches empty), but `e.expression`
        // is typed `Identifier` -- the resolved skip-rule reference --
        // so the generic `{ ...e, expression: visit(...) }` arm can't
        // cover it. `visit` only ever returns the `Identifier` itself
        // here (a leaf falls through to the `default: return e` arm);
        // the check keeps that a runtime fact instead of an unchecked
        // cast.
        const visited = visit(e.expression, {
          ...ctx,
          underZeroableRepetition: true,
        });
        if (visited.type !== "Identifier") {
          throw new Error(
            `promoteGlobalCuts: rewriting a Skip's rule reference produced ${visited.type} -- a Skip must keep referencing a rule by name`,
          );
        }
        return { ...e, expression: visited };
      }
      case "Plus":
        return { ...e, expression: visit(e.expression, ctx) };
      case "Quantified":
        return {
          ...e,
          expression: visit(e.expression, {
            ...ctx,
            underZeroableRepetition: ctx.underZeroableRepetition || e.min === 0,
          }),
        };
      case "PositiveLookahead":
      case "NegativeLookahead":
        return {
          ...e,
          expression: visit(e.expression, { ...ctx, underLookahead: true }),
        };
      default:
        return e;
    }
  };
  const result = visit(expr, ROOT_CUT_SITE_CONTEXT);
  return { expr: result, promotedCount };
};

/**
 * Returns a new `GrammarDefinition` with every provably-safe `Cut` marked
 * `global: true` (see the module doc comment for the full soundness
 * argument), and the total number of cuts promoted. Does not insert,
 * remove, or move any `Cut` -- run `insertAutomaticCuts` first if the
 * grammar doesn't already have the cuts you want considered for promotion.
 * `analysis` must come from `analyzeFirstSets(grammar)` run on the SAME
 * grammar (same rule set) `promoteGlobalCuts` is called with.
 */
export const promoteGlobalCuts = (
  grammar: GrammarDefinition,
  analysis: GrammarFirstSetAnalysis,
): { grammar: GrammarDefinition; promotedCount: number } => {
  const referenceSites = buildReferenceSiteMap(grammar);
  // Clause 3's transitive reference-chain check is a fixed, whole-grammar
  // fact per rule name -- computed once here (worklist fixpoint, see
  // `computeSafeReferenceChains`) rather than re-walked per `Cut`.
  const safeRules = computeSafeReferenceChains(
    grammar,
    analysis,
    referenceSites,
  );
  let promotedCount = 0;
  const rules: RuleDefinition[] = grammar.rules.map((rule) => {
    const { expr, promotedCount: ruleCount } = promoteCutsInExpression(
      rule.pattern,
      rule.name,
      analysis,
      safeRules,
    );
    promotedCount += ruleCount;
    return { ...rule, pattern: expr };
  });
  return { grammar: { ...grammar, rules }, promotedCount };
};
