/**
 * Automatic cut insertion.
 *
 * See `ast-optimize.ts`'s module doc comment's "Automatic cut insertion"
 * section for the theory (why this collapses to checking exactly one
 * candidate position per alternative, and why the benefit is avoided
 * failure-path allocation, not avoided re-computation).
 *
 * Soundness constraint, matching the danger `codegen-optimized.ts`
 * documents around alternative reordering (`"==" / "="` reordered to
 * `"=" / "=="` makes `==` permanently unmatchable), this rewrite must
 * NEVER insert a cut based on a false claim of disjointness. Two guards
 * enforce that:
 * - `firstSetsDisjoint` treats `unknown` on either side as "not proven
 *   disjoint" (see its own doc comment) -- it only returns `true` when
 *   every character in one set is provably absent from the other.
 * - A later alternative that is itself (possibly) nullable is NEVER
 *   treated as excluded, however disjoint its FIRST set looks: a
 *   nullable alternative can succeed by consuming nothing, and "the
 *   input's next character doesn't start it" says nothing about whether
 *   it could still match zero characters right here.
 *
 * Unlike `leftFactorChoices`/`degenerateNegativeLookaheads`, this needs
 * no `isShapeSensitiveRule` gate: a `Cut` node occupies no tuple slot
 * (`docs/peg-grammar.md`) and `codegen.ts`/`codegen-optimized.ts` already
 * drop it from the emitted arguments, wrapping only the elements after it
 * in `commit(...)` -- inserting one changes failure behavior, never
 * `.val` shape.
 *
 * ## Partial exclusion via ordered-choice associativity
 *
 * An alternative's *position* is unique, but which siblings it can
 * exclude is not all-or-nothing: it can only exclude a *contiguous run*
 * of siblings starting immediately after it (once a sibling fails the
 * disjointness/nullability check, nothing past it can be skipped either,
 * since skipping it would require proving IT can never match here too).
 * If that run doesn't reach all the way to the end of the `Choice`, a
 * bare `Cut` spliced into the alternative's own position can't be used
 * as-is: `choice`'s fatal-short-circuit (`packages/core/src/combinators.ts`)
 * stops trying literally everything after the committed alternative, not
 * just the ones proven excluded -- inserting a cut there would silently
 * reject input a genuinely-reachable later sibling could have matched.
 *
 * The fix is ordered choice's associativity: `choice(A,B,C,D)` behaves
 * identically to `choice(choice(A,B,C), D)` for any grouping of a
 * contiguous run (the two are literally the same accepted language and
 * stop position, by construction -- grouping changes nothing about which
 * alternative is tried when). So when `A` can prove `B` and `C` excluded
 * but not `D`, this regroups the `Choice`'s alternative list into
 * `choice(choice(A-with-cut, B, C), D)`: `A`'s cut can now fire freely
 * (fatal-stopping only the *inner* choice's remaining alternatives, `B`
 * and `C`), while the *inner* choice absorbs that `fatal` flag at its own
 * boundary (the same absorption `choice`/`captureChoice` always do for
 * any nested cut, per `commit`'s doc comment) before it ever reaches the
 * *outer* choice -- so `D` is unaffected and still tried normally. See
 * `computeCutCandidate`/`buildCutGroups` below for the implementation;
 * when a run happens to cover every remaining alternative (the case the
 * original all-or-nothing check already handled), the result
 * collapses back to the same flat, unnested `Choice` shape as before --
 * this is a strict generalization, not a replacement, of the original
 * behavior.
 *
 * `buildCutGroups` is a greedy left-to-right grouping, not a globally
 * optimal one: once an alternative's excludable run is grouped, the
 * members INSIDE that run still get their own chance at excluding a
 * further sub-run of siblings within it (recursively), but the algorithm
 * never backtracks to ask whether a *different* starting alternative
 * would have excluded strictly more overall. This can't produce an
 * unsound result -- each individual (alternative, run) grouping is sound
 * on its own, by the associativity argument above, so any grouping this
 * function picks is sound regardless of which one it picks -- it can only
 * under-deliver relative to some other valid grouping, never over-deliver
 * incorrectly.
 *
 * A `Choice` containing a `LabeledExpression` anywhere in any alternative
 * (`containsLabel`, same helper `leftFactorChoices` uses) is NOT
 * regrouped at all: it falls back to the original
 * all-or-nothing check (`findCutPosition`, which never restructures the
 * `Choice`'s own shape, only splices a bare `Cut` into an alternative's
 * existing `Sequence`). Regrouping changes which `Choice` node a labeled
 * alternative sits as an immediate child of, and this module hasn't
 * proven that's safe for however codegen locates/merges labels within a
 * `Choice` -- the same conservative reasoning `leftFactorChoices` already
 * applies to a labeled `Choice`, reused here rather than re-derived.
 */

import { containsLabel } from "./ast-optimize-shared";
import type { GrammarFirstSetAnalysis } from "./first-sets";
import {
  analyzeFirstSets,
  firstSetOfExpression,
  firstSetsDisjoint,
  isNullable,
} from "./first-sets";
import type { Expression, GrammarDefinition } from "./types";
import { createChoice, createCut, createSequence } from "./types";

/**
 * Finds the number of leading elements of `alternative` after which a
 * `Cut` is provably safe to insert, or `null` if there is no such
 * position, WITHOUT restructuring the enclosing `Choice` -- the original
 * all-or-nothing check, kept as the fallback for a `Choice`
 * containing a `LabeledExpression` (see the module doc comment's
 * "Partial exclusion via ordered-choice associativity" section for why
 * that case doesn't use `computeCutCandidate`/`buildCutGroups` below).
 * Only considers a `Sequence` of >= 2 elements: a single-element
 * alternative either fully succeeds or fully fails atomically, so it has
 * no interior position to protect a later partial failure at, and a cut
 * as the very last element is a documented no-op.
 */
const findCutPosition = (
  alternative: Expression,
  laterAlternatives: readonly Expression[],
  analysis: GrammarFirstSetAnalysis,
): number | null => {
  if (alternative.type !== "Sequence") return null;
  const { elements } = alternative;
  if (elements.length < 2) return null;

  // The one candidate position: right after the first non-nullable
  // element (1-based count of elements up to and including it). Elements
  // before it are all nullable, so nothing is guaranteed consumed until
  // this one; elements after it can't change the prefix's FIRST set (see
  // module doc comment), so there is nothing to gain by looking further.
  let k = 0;
  while (
    k < elements.length &&
    isNullable(elements[k] as Expression, analysis.nullableRules)
  ) {
    k++;
  }
  k++;
  if (k >= elements.length) return null; // no-op-as-last, or fully nullable

  const prefix = createSequence(elements.slice(0, k));
  const prefixFirst = firstSetOfExpression(
    prefix,
    analysis.firstSets,
    analysis.nullableRules,
  );
  if (prefixFirst.unknown) return null;

  // For the LAST alternative of a Choice, `laterAlternatives` is empty,
  // and `[].every(...)` is vacuously `true` -- so this also inserts a cut
  // into the last alternative, where there is nothing left to exclude.
  // That's intentional, not an oversight: it changes nothing about which
  // alternatives get tried (there were none left either way), and it's
  // safe against leaking `fatal` to whatever encloses this `Choice`
  // because `choice`/`captureChoice` (`packages/core/src/combinators.ts`,
  // `packages/core/src/capture.ts`) absorb `fatal` at their own boundary
  // regardless of which alternative it came from. The only effect is a
  // more specific error message on failure (the committed alternative's
  // own error, via `choice`'s early-return path) instead of the usual
  // aggregated "none of the parsers matched."
  const allLaterExcluded = laterAlternatives.every((later) => {
    if (isNullable(later, analysis.nullableRules)) return false;
    const laterFirst = firstSetOfExpression(
      later,
      analysis.firstSets,
      analysis.nullableRules,
    );
    return firstSetsDisjoint(prefixFirst, laterFirst);
  });

  return allLaterExcluded ? k : null;
};

/**
 * Finds the cut position AND the length of the contiguous run of
 * immediately-following alternatives it can prove excluded, or `null` if
 * `alternative` has no valid cut position at all. `runLength` can be `0`
 * only when `laterAlternatives` is itself empty (the vacuous last-
 * alternative case `findCutPosition`'s doc comment describes) -- if there
 * ARE later alternatives but none of them survive the run (the first one
 * already breaks disjointness or is nullable), this returns `null`
 * entirely rather than `{ k, runLength: 0 }`: with nothing to group it
 * with, a cut inserted at this position would sit at the `Choice`'s own
 * top level (see `buildCutGroups`) and incorrectly fatal-stop every
 * alternative after it, not just the zero actually proven excluded.
 */
const computeCutCandidate = (
  alternative: Expression,
  laterAlternatives: readonly Expression[],
  analysis: GrammarFirstSetAnalysis,
): { k: number; runLength: number } | null => {
  if (alternative.type !== "Sequence") return null;
  const { elements } = alternative;
  if (elements.length < 2) return null;

  let k = 0;
  while (
    k < elements.length &&
    isNullable(elements[k] as Expression, analysis.nullableRules)
  ) {
    k++;
  }
  k++;
  if (k >= elements.length) return null;

  const prefix = createSequence(elements.slice(0, k));
  const prefixFirst = firstSetOfExpression(
    prefix,
    analysis.firstSets,
    analysis.nullableRules,
  );
  if (prefixFirst.unknown) return null;

  // Maximal CONTIGUOUS prefix run of `laterAlternatives` that's provably
  // excluded, stopping at the first one that isn't -- see the module doc
  // comment's associativity argument for why only a contiguous run
  // (never a run with a gap) can be grouped under this alternative's cut.
  let runLength = 0;
  for (const later of laterAlternatives) {
    if (isNullable(later, analysis.nullableRules)) break;
    const laterFirst = firstSetOfExpression(
      later,
      analysis.firstSets,
      analysis.nullableRules,
    );
    if (!firstSetsDisjoint(prefixFirst, laterFirst)) break;
    runLength++;
  }

  if (runLength === 0 && laterAlternatives.length > 0) return null;
  return { k, runLength };
};

/**
 * Greedily regroups `alts` (one `Choice`'s alternatives, already
 * recursively processed by `insertCutsInExpression`) into cut-protected
 * runs, using `computeCutCandidate` and ordered-choice associativity (see
 * the module doc comment). Scans left to right; whenever an alternative
 * has a positive-or-vacuous cut candidate, its excluded run is recursed
 * into (so members of the run still get their OWN chance at excluding a
 * further sub-run -- being reachable only via "this alternative failed
 * outright, fall through normally" doesn't make a member's own cut
 * pointless, see the module doc comment), and the result is either
 * flattened back into `result` directly (when the run happens to cover
 * every remaining alternative at this level -- the same flat shape the
 * original all-or-nothing check already produced) or wrapped in its
 * own nested `Choice` (when it doesn't, so a sibling further out is left
 * reachable per the associativity argument).
 */
const buildCutGroups = (
  alts: readonly Expression[],
  analysis: GrammarFirstSetAnalysis,
): Expression[] => {
  const result: Expression[] = [];
  let i = 0;
  while (i < alts.length) {
    const alt = alts[i] as Expression;
    const laterAlternatives = alts.slice(i + 1);
    const candidate = computeCutCandidate(alt, laterAlternatives, analysis);
    if (candidate === null || alt.type !== "Sequence") {
      result.push(alt);
      i += 1;
      continue;
    }

    const { k, runLength } = candidate;
    const cutAlt = createSequence([
      ...alt.elements.slice(0, k),
      createCut(),
      ...alt.elements.slice(k),
    ]);
    const tail = buildCutGroups(alts.slice(i + 1, i + 1 + runLength), analysis);
    const group = [cutAlt, ...tail];

    if (group.length === 1) {
      // `runLength` was `0` (the vacuous last-alternative case) -- no
      // group to form, just the one cut-spliced alternative.
      result.push(cutAlt);
    } else if (i === 0 && runLength === alts.length - 1) {
      // This run covers every alternative at this level: there is no
      // sibling left outside it for a nested `Choice` boundary to
      // protect, so wrapping one here would be pure overhead -- push the
      // group's members directly, reproducing the exact flat shape the
      // original all-or-nothing check already produced in this case.
      result.push(...group);
    } else {
      result.push(createChoice(group));
    }
    i += 1 + runLength;
  }
  return result;
};

const insertCutsInExpression = (
  expr: Expression,
  analysis: GrammarFirstSetAnalysis,
): Expression => {
  switch (expr.type) {
    case "Sequence":
      return createSequence(
        expr.elements.map((el) => insertCutsInExpression(el, analysis)),
      );
    case "Choice": {
      // Children first (bottom-up, matching the other rewrites in this
      // file) -- a `Cut` contributes nothing to FIRST/nullability (see
      // `first-sets.ts`), so processing order can't change any of this
      // level's own disjointness checks either way.
      const processed = expr.alternatives.map((alt) =>
        insertCutsInExpression(alt, analysis),
      );
      if (containsLabel(expr)) {
        // Labeled Choice: fall back to the original all-or-nothing,
        // no-restructuring cut insertion (see the module doc comment's
        // "Partial exclusion via ordered-choice associativity" section).
        const withCuts = processed.map((alt, i) => {
          const laterAlternatives = processed.slice(i + 1);
          const k = findCutPosition(alt, laterAlternatives, analysis);
          if (k === null || alt.type !== "Sequence") return alt;
          return createSequence([
            ...alt.elements.slice(0, k),
            createCut(),
            ...alt.elements.slice(k),
          ]);
        });
        return createChoice(withCuts);
      }
      return createChoice(buildCutGroups(processed, analysis));
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
        expression: insertCutsInExpression(expr.expression, analysis),
      };
    default:
      return expr;
  }
};

/**
 * Returns a new `GrammarDefinition` with a `Cut` inserted into every
 * `Choice` alternative where a later sibling is provably unreachable past
 * some prefix (see the module doc comment). FIRST sets and nullability
 * are computed once, from the original (pre-rewrite) grammar -- a `Cut`
 * never changes either, so there is no need to recompute per rule or per
 * nesting level.
 *
 * Deliberately NOT part of `applyAstOptimizations`'s default chain and
 * not gated by `isShapeSensitiveRule` (see the "Automatic cut insertion"
 * section of the module doc comment for both).
 */
export const insertAutomaticCuts = (
  grammar: GrammarDefinition,
): GrammarDefinition => {
  const analysis = analyzeFirstSets(grammar);
  return {
    ...grammar,
    rules: grammar.rules.map((rule) => ({
      ...rule,
      pattern: insertCutsInExpression(rule.pattern, analysis),
    })),
  };
};
