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
 * This module is a barrel re-exporting five independently-implemented
 * rewrite passes, one per file (each documented in its own module doc
 * comment for the specifics; this comment covers the shared reasoning
 * that spans more than one of them):
 * - `ast-optimize-left-factor.ts`: `leftFactorChoices`
 * - `ast-optimize-char-class.ts`: `mergeCharacterClasses`
 *   (`[a-z] / [A-Z]` -> `[a-zA-Z]`)
 * - `ast-optimize-negative-lookahead.ts`: `degenerateNegativeLookaheads`
 *   (`!a .` -> a negated character class)
 * - `ast-optimize-cut-insertion.ts`: `insertAutomaticCuts`
 * - `ast-optimize-cut-promotion.ts`: `promoteGlobalCuts`
 * Helpers shared by more than one pass (`containsLabel`,
 * `isShapeSensitiveRule`) live in `ast-optimize-shared.ts`.
 *
 * The shape-safety discussion below (rule-level action/transform gate,
 * label handling) applies to `leftFactorChoices` and
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
 * into `Sequence(P, Choice(inner-alternatives..., Sequence([])))` --
 * an explicit empty-`Sequence` alternative appended to `inner`, NOT
 * `Sequence(P, Optional(inner))` (an earlier version of this rewrite used
 * `Optional`, and it was unsound: `choice`/`captureChoice`
 * (`packages/core/src/combinators.ts`) absorb a `Cut`-driven fatal failure
 * at THEIR OWN boundary before it ever reaches an enclosing `optional`
 * (`packages/core/src/repetition.ts`), so wrapping `inner` in `Optional`
 * let a `Cut` inside one of its branches get silently swallowed as "zero
 * matches" instead of failing the whole rule -- see
 * `ast-optimize-left-factor.ts`'s `tryLeftFactorChoice` for the worked
 * counterexample this closes). `product "+" sum / product "-" sum /
 * product` becomes `product (("+" sum) / ("-" sum) / ())`. This is sound
 * for the same reason as the non-bare case (calling `P` twice at one
 * position reproduces the same result) -- if no non-bare alternative
 * matches right after `P`, the empty-`Sequence` alternative always
 * succeeds having consumed nothing, so the whole sequence still stops
 * exactly where the bare `P` alternative would have, without reparsing
 * `P` a second time to get there, AND without introducing any new
 * `optional` boundary a `Cut` inside `inner` could be absorbed by. Its
 * `.val` shape becomes `[Pval, [Xval]]` (`inner` matched) or `[Pval, []]`
 * (the empty alternative matched instead) -- a different shape from the
 * non-bare case's `[Pval, Xval]`, on top of the difference from the
 * original grammar's unfactored shapes already described above; still
 * gated by the same `isShapeSensitiveRule` check. A bare-prefix
 * alternative anywhere other than last, or more than one of them, is left
 * untouched (not factored) -- handling arbitrary interleaving isn't
 * needed by any grammar in this repo and isn't implemented.
 *
 * ## Automatic cut insertion
 *
 * `insertAutomaticCuts` (`ast-optimize-cut-insertion.ts`, separate from
 * the three rewrites above and NOT included in `applyAstOptimizations`'s
 * default chain -- see its own doc comment for why) inserts a `Cut` (`~`)
 * into a `Choice` alternative wherever one or more of its immediately-
 * following siblings are *provably* unreachable once the current one has
 * matched a certain prefix.
 *
 * The naive framing -- "search for the longest prefix that still lets
 * later alternatives be ruled out" -- turns out to collapse to a single
 * check: a non-nullable-terminated prefix's FIRST set never changes as
 * more elements are appended after it (`firstSetOfExpression`'s
 * `Sequence` handling breaks at the first non-nullable element
 * regardless of how many more elements follow), so there is exactly one
 * candidate cut *position* per alternative -- right after its first
 * non-nullable element -- not a range of positions to search over.
 *
 * This provides essentially zero benefit against expensive
 * re-computation (that's what `leftFactorChoices` and memoization are
 * for) -- a FIRST-disjoint sibling was already going to be rejected on
 * its very first character comparison, cut or not. The actual saving is
 * that a rejection is not free in this runtime: every failing
 * alternative -- even one that fails on its first character -- builds an
 * error object and an interpolated message string before `choice`
 * discards it (see `packages/core/src/combinators.ts`'s failure path).
 * Skipping N-1 of those constructions per backtrack is a measurable
 * constant-factor win despite each one being an O(1) check.
 *
 * See `ast-optimize-cut-insertion.ts`'s own doc comment for the "Partial
 * exclusion via ordered-choice associativity" design (`computeCutCandidate`/
 * `buildCutGroups`) and its labeled-`Choice` fallback (`findCutPosition`).
 *
 * See `ast-optimize-cut-promotion.ts`'s own doc comment for `promoteGlobalCuts`
 * (global cut promotion), a separate, more involved rewrite built
 * on top of whatever cuts already exist in the grammar.
 */

import { mergeCharacterClasses } from "./ast-optimize-char-class";
import { insertAutomaticCuts } from "./ast-optimize-cut-insertion";
import { promoteGlobalCuts } from "./ast-optimize-cut-promotion";
import { leftFactorChoices } from "./ast-optimize-left-factor";
import { degenerateNegativeLookaheads } from "./ast-optimize-negative-lookahead";
import type { GrammarDefinition } from "./types";

export {
  leftFactorChoices,
  mergeCharacterClasses,
  degenerateNegativeLookaheads,
  insertAutomaticCuts,
  promoteGlobalCuts,
};

/**
 * Applies every default rewrite pass, in the order that lets later passes
 * see the earlier ones' output: degenerating `!a .` first can turn two
 * alternatives' prefixes into structurally-comparable character classes
 * that left factoring can then group, so it runs before
 * `leftFactorChoices`. `mergeCharacterClasses` has no such ordering
 * dependency and is run first.
 *
 * `insertAutomaticCuts`/`promoteGlobalCuts` are deliberately NOT included
 * here -- see their own doc comments (`ast-optimize-cut-insertion.ts`,
 * `ast-optimize-cut-promotion.ts`) for why each is a separate, more
 * cautious opt-in than the three rewrites above.
 */
export const applyAstOptimizations = (
  grammar: GrammarDefinition,
): GrammarDefinition =>
  leftFactorChoices(
    degenerateNegativeLookaheads(mergeCharacterClasses(grammar)),
  );
