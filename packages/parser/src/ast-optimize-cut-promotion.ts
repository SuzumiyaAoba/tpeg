/**
 * Global cut promotion: marking a `Cut` safe for `commitAtTopLevel`.
 *
 * See the plan's Pillar 7 for the full theory. Short version: today's
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
import type { Expression, GrammarDefinition, RuleDefinition } from "./types";
import { createChoice, createSequence } from "./types";

/** Per-site structural context, accumulated while walking down from a
 * rule's own root (or from a reference site within some other rule). */
interface CutSiteContext {
  readonly underLookahead: boolean;
  readonly underZeroableRepetition: boolean;
  /** The nearest enclosing `Choice`'s alternative that contains this site,
   * and that alternative's later siblings -- or `null` if no `Choice`
   * encloses this site at all (e.g. a bare top-level rule pattern). Only
   * the NEAREST one matters (see the module doc comment above): a cut's
   * `FAIL_FATAL` is absorbed by its immediately-enclosing `choice`, so no
   * `Choice` further out within the same rule ever sees it. */
  readonly nearestChoice: {
    readonly alternative: Expression;
    readonly laterSiblings: readonly Expression[];
  } | null;
}

const ROOT_CUT_SITE_CONTEXT: CutSiteContext = {
  underLookahead: false,
  underZeroableRepetition: false,
  nearestChoice: null,
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
            nearestChoice: {
              alternative: alt,
              laterSiblings: expr.alternatives.slice(i + 1),
            },
          },
          identifiers,
        );
      });
      return;
    case "Group":
    case "LabeledExpression":
    case "ActionExpression":
      collectIdentifierSites(expr.expression, ctx, identifiers);
      return;
    case "Optional":
    case "Star":
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

/** Clause 2: is the site's nearest-enclosing `Choice` alternative (if any)
 * proven FIRST-disjoint from every later sibling at that same level? A
 * nullable later sibling is NEVER treated as excluded (mirrors
 * `computeCutCandidate`'s identical guard in `ast-optimize-cut-insertion.ts`)
 * -- it could match zero characters, so "the next character doesn't start
 * it" proves nothing. No enclosing `Choice` at all (`nearestChoice ===
 * null`) is vacuously safe -- there is no sibling to worry about. */
const nearestChoiceIsDisjoint = (
  ctx: CutSiteContext,
  analysis: GrammarFirstSetAnalysis,
): boolean => {
  if (!ctx.nearestChoice) return true;
  const { alternative, laterSiblings } = ctx.nearestChoice;
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
};

/** Clause 1 + the structural guard: no lookahead ancestor, no
 * `Optional`/`Star`/`Quantified{min: 0}` ancestor (see the module doc
 * comment's "cheap guard" section). */
const structurallyEligible = (ctx: CutSiteContext): boolean =>
  !ctx.underLookahead && !ctx.underZeroableRepetition;

/**
 * Clause 3: is every reference site of rule `ruleName`, transitively up to
 * the grammar's start rule (`grammar.rules[0]`), itself eligible (clause
 * 1 + structural guard) and FIRST-disjoint from its own ancestor `Choice`
 * siblings (clause 2)? `visiting` guards against a reference cycle (see
 * the module doc comment) -- encountering a rule already being visited
 * refuses promotion rather than looping forever.
 *
 * A rule with zero reference sites that is NOT the start rule is refused:
 * this codebase cannot prove such a rule is ever reachable from the start
 * rule at all (dead code, or reachable only through some mechanism this
 * walk doesn't model), so it cannot prove the one thing this whole
 * function exists to prove.
 */
const referenceChainIsSafe = (
  ruleName: string,
  grammar: GrammarDefinition,
  analysis: GrammarFirstSetAnalysis,
  referenceSites: ReadonlyMap<
    string,
    ReadonlyArray<{ fromRule: string; site: IdentifierSite }>
  >,
  visiting: Set<string>,
): boolean => {
  if (grammar.rules[0]?.name === ruleName) return true;
  if (visiting.has(ruleName)) return false;

  const sites = referenceSites.get(ruleName);
  if (!sites || sites.length === 0) return false;

  visiting.add(ruleName);
  try {
    return sites.every(
      ({ fromRule, site }) =>
        structurallyEligible(site) &&
        nearestChoiceIsDisjoint(site, analysis) &&
        referenceChainIsSafe(
          fromRule,
          grammar,
          analysis,
          referenceSites,
          visiting,
        ),
    );
  } finally {
    visiting.delete(ruleName);
  }
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
  grammar: GrammarDefinition,
  analysis: GrammarFirstSetAnalysis,
  referenceSites: ReadonlyMap<
    string,
    ReadonlyArray<{ fromRule: string; site: IdentifierSite }>
  >,
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
              nearestChoiceIsDisjoint(ctx, analysis) &&
              referenceChainIsSafe(
                ruleName,
                grammar,
                analysis,
                referenceSites,
                new Set(),
              );
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
            nearestChoice: {
              alternative: alt,
              laterSiblings: e.alternatives.slice(i + 1),
            },
          }),
        );
        return createChoice(alternatives);
      }
      case "Group":
      case "LabeledExpression":
      case "ActionExpression":
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
  let promotedCount = 0;
  const rules: RuleDefinition[] = grammar.rules.map((rule) => {
    const { expr, promotedCount: ruleCount } = promoteCutsInExpression(
      rule.pattern,
      rule.name,
      grammar,
      analysis,
      referenceSites,
    );
    promotedCount += ruleCount;
    return { ...rule, pattern: expr };
  });
  return { grammar: { ...grammar, rules }, promotedCount };
};
