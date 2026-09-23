/**
 * Grammar-level structural validation, run before any FIRST-set analysis
 * or code generation: several classes of malformed grammar that have no
 * PEG semantics at all (duplicate rule names, a `QualifiedIdentifier`
 * whose `module` part collides with a locally-declared rule name, left
 * recursion, a cut-only pattern), as opposed to `assertNoNullableRepetition`
 * (`first-sets.ts`), which rejects a narrower shape (an unbounded
 * repetition over a nullable body) that only becomes well-defined or not
 * once FIRST-set analysis has already run.
 *
 * Deliberately does NOT reject a bare `Identifier` referencing something
 * outside this grammar's own rules -- see
 * `collectQualifiedIdentifierCollisions`'s doc comment for why that's an
 * intentional escape hatch, not a defect.
 *
 * ## Why this must run BEFORE `analyzeFirstSets`
 *
 * `analyzeFirstSets`'s FIRST-set fixpoint (`first-sets.ts`) is keyed by
 * rule NAME, one map entry per name -- a grammar with two rules sharing a
 * name makes every pass overwrite that one shared entry from two
 * different `RuleDefinition`s, which can oscillate between their two
 * computed FIRST sets forever rather than converge. `analyzeFirstSets`
 * itself now also defensively de-duplicates its own working set (see that
 * module) so it can never hang even if called directly, but
 * `validateGrammar` is the PRIMARY defense: reject a duplicate rule name
 * with a clear diagnostic before either `codegen.ts` or
 * `codegen-optimized.ts` ever reaches that analysis, rather than relying
 * on a silent last-declaration-wins fallback deep inside an unrelated
 * pass.
 *
 * ## Left recursion
 *
 * A PEG parser has no way to recognize left recursion at runtime the way
 * a bottom-up (e.g. LALR) parser would: `rule = rule "x" / "y"` makes
 * evaluating `rule` at some position immediately re-invoke `rule` at that
 * SAME position, before anything has been consumed -- and again, and
 * again, until the call stack overflows
 * (`RangeError: Maximum call stack size exceeded`, confirmed at runtime
 * for every shape below). This is just as true through an indirect chain
 * (`start = x; x = start`) or "hidden" behind a prefix that can itself
 * match zero characters (`e = "a"? e "b" / "c"`, or `start = "a"* start /
 * "b"`) -- neither of the latter two was previously caught anywhere:
 * `analyzeGrammarPerformance`'s left-recursion diagnostic only walked a
 * rule's UNCONDITIONAL leading reference, missing anything behind a
 * nullable prefix, and even where it did fire, generation proceeded
 * anyway (a warning, not a rejection) -- asymmetric with
 * `assertNoNullableRepetition`, which has always been a hard error. This
 * function makes left recursion a hard error too, checked BEFORE
 * generation the same way.
 */

import { forEachExpression } from "@suzumiyaaoba/tpeg-core";
import { ERROR_MESSAGES } from "./constants";
import { collectZeroOffsetRuleRefs, computeNullableRules } from "./first-sets";
import { findRecursiveRuleNames } from "./performance-utils";
import type { Expression, GrammarDefinition, RuleDefinition } from "./types";

/** Whole-string JavaScript identifier shape -- what every emitted
 * `const`/`function` name (and so every `namePrefix`) must satisfy. */
const JS_IDENTIFIER_FULL = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Every rule name directly reachable from the very START of matching
 * `expr` -- i.e. a rule whose parser could be invoked at the SAME input
 * position `expr` itself is tried at, before `expr` has consumed
 * anything. Used to build the left-recursion call graph: an edge
 * `R -> S` means matching `R` can invoke `S` at zero offset into `R`'s
 * own attempt, so a cycle back to `R` in this graph (including a direct
 * self-edge) is exactly a left-recursive rule.
 *
 * Deliberately OVER-approximates through constructs that don't consume
 * input themselves but DO invoke their wrapped expression at the current
 * position -- `Star`/`Plus`/`Optional`/`Quantified` (at least one attempt
 * is always made, even if it may go on to match zero times) and
 * `PositiveLookahead`/`NegativeLookahead` (the probe itself is a real
 * invocation at this position, even though its outcome is inverted or
 * discarded, e.g. `!rule "x"`) -- because a genuinely left-recursive
 * grammar recurses infinitely through any of these exactly like it would
 * through a plain `Sequence`/`Choice`; the runtime doesn't get a free
 * pass just because the recursion happens to be wrapped in `!`/`?`/`*`.
 *
 * An `Identifier` naming something that isn't a rule of this grammar (an
 * externally-supplied parser reference -- see `first-sets.ts`'s identical
 * treatment and `codegen.ts`'s `generateIdentifierCode`) is still added
 * to the result: nothing is known about whether it consumes input, so
 * treating it as an opaque reachable node (with no outgoing edges of its
 * own, since it isn't a rule this analysis can see into) is the safe
 * direction -- it can only make this function more conservative, never
 * miss a real cycle.
 */
const zeroOffsetRuleRefs = (
  expr: Expression,
  nullableRules: ReadonlyMap<string, boolean>,
): ReadonlySet<string> => {
  const refs = new Set<string>();
  collectZeroOffsetRuleRefs(expr, nullableRules, refs);
  return refs;
};

/**
 * Rule names that participate in a left-recursive cycle -- directly,
 * indirectly through another rule, or "hidden" behind a nullable prefix.
 * See this module's doc comment and `zeroOffsetRuleRefs` for the
 * algorithm.
 */
const findLeftRecursiveRules = (grammar: GrammarDefinition): string[] => {
  const nullableRules = computeNullableRules(grammar);
  const graph = new Map<string, ReadonlySet<string>>();
  for (const rule of grammar.rules) {
    graph.set(rule.name, zeroOffsetRuleRefs(rule.pattern, nullableRules));
  }

  // A rule is left-recursive iff it can reach itself again through
  // zero-offset edges -- i.e. iff it sits on a cycle in this graph.
  // `findRecursiveRuleNames` computes exactly that (SCC size > 1 or a
  // self-loop) in one O(rules + edges) Tarjan pass; the per-rule "can I
  // reach myself" DFS this replaced was O(rules x edges), quadratic on a
  // long reference chain, and `validateGrammar` runs unconditionally in
  // both code generators. References to names that aren't rules of this
  // grammar are harmless either way -- they have no out-edges in `graph`,
  // so they can never complete a cycle.
  return [...findRecursiveRuleNames(graph)].sort();
};

/** Rule names declared more than once in `grammar`. */
const findDuplicateRuleNames = (grammar: GrammarDefinition): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const rule of grammar.rules) {
    if (seen.has(rule.name)) duplicates.add(rule.name);
    seen.add(rule.name);
  }
  return [...duplicates].sort();
};

/**
 * True where `expr` is a `~` that matches nothing on its own: either a
 * bare `Cut` node, or a `Sequence` whose elements are all `Cut`. Both
 * shapes are reachable from ordinary `.tpeg` surface syntax (`start = ~`,
 * `start = ~ ~`, `(~) "b"`, `(~ ~) "b"`, `~ / "a"`, ...) because
 * `composition.ts` unwraps a single-element `Sequence` down to its bare
 * element -- a rule (or group, or choice alternative, or quantifier body,
 * ...) whose only content is one `~` reduces to a standalone `Cut` node
 * with no enclosing `Sequence` at all.
 *
 * `~` only has meaning as one of SEVERAL elements of a `Sequence`
 * (`codegen.ts`/`codegen-optimized.ts`'s `generateSequence` is the only
 * place that understands it): everywhere else, a `Cut` node makes code
 * generation throw `Unsupported expression type: Cut` outright, and an
 * all-`Cut` `Sequence` would (after `generateSequence` drops every `Cut`)
 * silently generate an always-succeeding empty match -- neither is a
 * useful reading of what the grammar author wrote, so both are rejected
 * here as a grammar-authoring error rather than left to surface as an
 * exception or a silently wrong parser.
 */
const isCutOnlyPattern = (expr: Expression): boolean =>
  expr.type === "Cut" ||
  (expr.type === "Sequence" &&
    expr.elements.length > 0 &&
    expr.elements.every((el) => el.type === "Cut"));

/**
 * Recursively walks `expr` looking for a cut-only pattern (see
 * `isCutOnlyPattern`) in any sub-expression position. `context` tracks
 * whether `expr` itself is being visited AS one element of its immediate
 * parent `Sequence` -- the one position where a bare `Cut` is legitimate
 * -- so a normal `"a" ~ "b"` is never flagged for the very `Cut` it's
 * built from, while `(~) "b"` (a `Cut` reached through a `Group`, which
 * does NOT understand `Cut`) still is.
 */
const containsCutOnlyPattern = (
  expr: Expression,
  context: "sequenceElement" | "other",
): boolean => {
  if (expr.type === "Cut") {
    return context !== "sequenceElement";
  }
  if (expr.type === "Sequence") {
    if (isCutOnlyPattern(expr)) return true;
    return expr.elements.some((el) =>
      containsCutOnlyPattern(el, "sequenceElement"),
    );
  }
  if (expr.type === "Choice") {
    return expr.alternatives.some((alt) =>
      containsCutOnlyPattern(alt, "other"),
    );
  }
  if (
    expr.type === "Group" ||
    expr.type === "Star" ||
    expr.type === "Plus" ||
    expr.type === "Optional" ||
    expr.type === "Quantified" ||
    expr.type === "PositiveLookahead" ||
    expr.type === "NegativeLookahead" ||
    expr.type === "LabeledExpression" ||
    expr.type === "ActionExpression"
  ) {
    return containsCutOnlyPattern(expr.expression, "other");
  }
  return false;
};

/** Rule names whose pattern contains a cut-only sub-expression anywhere. */
const findCutOnlyRules = (grammar: GrammarDefinition): string[] => {
  const flagged: string[] = [];
  for (const rule of grammar.rules) {
    if (containsCutOnlyPattern(rule.pattern, "other")) {
      flagged.push(rule.name);
    }
  }
  return flagged;
};

// ============================================================================
// Unreachable ordered-choice alternatives
// ============================================================================

/**
 * The failure modes an expression can exhibit, as observed by the
 * `choice`/`captureChoice` enclosing it -- the ONLY thing that decides
 * whether a later alternative can ever run. `nonFatal` means the
 * expression can fail in a way that lets the enclosing choice backtrack
 * into its next alternative; `fatal` means it can fail in a way that
 * aborts the choice outright (`commit`'s `fatal` flag, see
 * `packages/core/src/combinators.ts`). Both can be true -- different
 * inputs can take the same expression down different failure modes.
 *
 * An alternative that has NO `nonFatal` mode either always succeeds or
 * fails only fatally; either way the choice never reaches the next
 * alternative, so everything after it is dead code -- the shape this
 * section reports.
 */
interface FailureModes {
  readonly nonFatal: boolean;
  readonly fatal: boolean;
}

const NO_FAILURE: FailureModes = { nonFatal: false, fatal: false };
const NONFATAL_FAILURE: FailureModes = { nonFatal: true, fatal: false };

/**
 * The modes an `Identifier` whose name is NOT a rule of this grammar is
 * assumed to have -- an externally-supplied parser reference (the same
 * escape hatch `codegen.ts`'s `generateIdentifierCode` supports) is
 * opaque to this analysis, and an opaque parser can certainly fail in
 * the ordinary, backtrackable way. Assuming `nonFatal` can only ever
 * make this analysis report FEWER unreachable alternatives (never
 * wrongly flag reachable ones) -- the safe direction.
 */
const EXTERNAL_RULE_MODES: FailureModes = NONFATAL_FAILURE;

const unionFailureModes = (a: FailureModes, b: FailureModes): FailureModes => ({
  nonFatal: a.nonFatal || b.nonFatal,
  fatal: a.fatal || b.fatal,
});

/** `m` with every mode forced through a `commit(...)` boundary. */
const committed = (m: FailureModes): FailureModes => ({
  nonFatal: false,
  fatal: m.nonFatal || m.fatal,
});

/**
 * `m` with its `nonFatal` mode dropped: a `Star`/`Optional`/
 * `Quantified{0,..}` turns a child's ordinary failure into "stop
 * repeating"/"no match" -- a SUCCESS -- while re-raising a `fatal` one
 * (`repetition.ts`'s doc comment), so only the child's `fatal` mode
 * survives as a failure mode of the wrapper itself.
 */
const fatalOnly = (m: FailureModes): FailureModes => ({
  nonFatal: false,
  fatal: m.fatal,
});

/**
 * Computes `expr`'s possible {@link FailureModes}, bottom-up, mirroring
 * the runtime wrappers each node compiles to. `ruleModes` maps each
 * declared rule name to its own (converged) modes so `Identifier`
 * references resolve to what the referenced rule's body can actually
 * do -- `computeRuleFailureModes` builds that map by fixpoint, since
 * rules reference each other cyclically.
 *
 * - `Sequence`: a `~` element splits it into `sequence(before...,
 *   commit(after...))` (`codegen.ts`'s `generateSequence`/
 *   `forEachSequenceElement`), so failures from elements after the
 *   first `~` can only arrive `fatal`. Elements before it keep their
 *   own modes. (Every element is treated as possibly-succeeding -- this
 *   analysis does not track always-failing expressions, which can only
 *   ever make it report FEWER unreachable alternatives, never wrongly
 *   flag reachable ones.)
 * - `Choice`: can never itself fail fatally --
 *   `tryOrderedCandidates` (`packages/core/src/combinators.ts`) stops
 *   trying alternatives at the first `fatal` failure but ABSORBS the
 *   flag, reporting an ordinary failure to whatever encloses the
 *   choice (a `~` cut is scoped to the choice whose alternative
 *   contains it -- `commit`'s doc comment). A non-fatal failure is
 *   therefore possible when every alternative can fail non-fatally
 *   (all fail, so the choice fails) OR when some alternative can fail
 *   fatally (its absorbed failure IS the choice's own non-fatal
 *   failure). Only an alternative that cannot fail at all makes the
 *   choice infallible.
 * - `Star`/`Optional`/`Quantified{0,..}`: see `fatalOnly` above.
 * - `Plus`/`Quantified{1..,..}`: the first iteration's failure arrives
 *   with its own mode; later iterations behave like `Star` -- which
 *   adds nothing the first iteration couldn't already produce, so the
 *   child's modes pass through unchanged.
 * - `PositiveLookahead` (`&e`): absorbs `fatal` at its own boundary and
 *   re-emits an ordinary failure (`andPredicate`'s doc comment,
 *   `lookahead.ts`), so any child failure at all means a non-fatal one.
 * - `NegativeLookahead` (`!e`): inverts -- a child failure is a success,
 *   a child success its own ordinary failure -- so it can only ever
 *   fail non-fatally.
 * - `Group`/`LabeledExpression`/`ActionExpression`/`Span` are
 *   transparent: they transform success values and pass failures --
 *   `fatal` flag included (`transform.ts`'s `map`, `capture.ts`) --
 *   through untouched. An action's code runs only on success, so it
 *   adds no failure mode of its own.
 *
 * Every case is MONOTONE in `ruleModes` -- a rule's modes only ever
 * grow during the fixpoint, so each derived mode grows too -- which is
 * what makes the least fixpoint `computeRuleFailureModes` computes
 * sound (see `computeNullableRules` in `first-sets.ts` for the same
 * argument over nullability).
 */
const expressionFailureModes = (
  expr: Expression,
  ruleModes: ReadonlyMap<string, FailureModes>,
): FailureModes => {
  switch (expr.type) {
    case "StringLiteral":
      return expr.value === "" ? NO_FAILURE : NONFATAL_FAILURE;
    case "CharacterClass":
    case "AnyChar":
    case "QualifiedIdentifier":
    case "WordBoundary":
    case "NegativeLookahead":
      return NONFATAL_FAILURE;
    case "Identifier":
      return ruleModes.get(expr.name) ?? EXTERNAL_RULE_MODES;
    case "Cut":
      return NO_FAILURE;
    case "Skip":
      // Emitted as `ignore(optional(<skipRuleRef>))` (`codegen.ts`'s
      // `Skip` case): the skip rule's ordinary failure becomes
      // "matched nothing" -- a SUCCESS -- while `optional` re-raises a
      // `fatal` one (`repetition.ts`). Exactly `fatalOnly` of the
      // referenced rule's modes, the same wrapper semantics as
      // `Optional` below -- NOT `NO_FAILURE`: a skip rule that can fail
      // fatally (it contains a `~` that escapes its own top level)
      // makes this node fatal-capable too.
      return fatalOnly(expressionFailureModes(expr.expression, ruleModes));
    case "PositiveLookahead": {
      const inner = expressionFailureModes(expr.expression, ruleModes);
      return inner.nonFatal || inner.fatal ? NONFATAL_FAILURE : NO_FAILURE;
    }
    case "Optional":
    case "Star":
      return fatalOnly(expressionFailureModes(expr.expression, ruleModes));
    case "Plus":
      return expressionFailureModes(expr.expression, ruleModes);
    case "Quantified":
      return expr.min === 0
        ? fatalOnly(expressionFailureModes(expr.expression, ruleModes))
        : expressionFailureModes(expr.expression, ruleModes);
    case "Group":
    case "LabeledExpression":
    case "ActionExpression":
    case "Span":
      return expressionFailureModes(expr.expression, ruleModes);
    case "Sequence": {
      let modes = NO_FAILURE;
      let pastCut = false;
      for (const el of expr.elements) {
        if (el.type === "Cut") {
          pastCut = true;
          continue;
        }
        const elModes = expressionFailureModes(el, ruleModes);
        modes = unionFailureModes(
          modes,
          pastCut ? committed(elModes) : elModes,
        );
      }
      return modes;
    }
    case "Choice": {
      const altModes = expr.alternatives.map((alt) =>
        expressionFailureModes(alt, ruleModes),
      );
      // Only alternatives up to and including the FIRST one that cannot
      // fail non-fatally can ever run -- everything after it is dead code
      // (`findUnreachableAlternatives` reports exactly that boundary). The
      // choice is infallible only when a reachable alternative is
      // infallible AND no reachable alternative can fail `fatal`: a
      // `fatal` failure is absorbed at this choice's own boundary
      // (`tryOrderedCandidates`) into an ordinary one, but it still IS a
      // failure -- on that input control never reaches the infallible
      // alternative at all. Checking `altModes.some(...)` unconditionally
      // missed both halves of that: it counted an infallible alternative
      // sitting AFTER a fatal-only boundary (dead code that can never
      // run), and it ignored a fatal-capable alternative sitting BEFORE
      // an infallible boundary -- e.g. `("a" ~ "b") / "c"?`, which CAN
      // fail (on "ax" the committed "b" failure is absorbed and the
      // choice fails ordinarily) but was reported `NO_FAILURE`, letting
      // an enclosing `Choice` like `(("a" ~ "b") / "c"?) / "d"` wrongly
      // flag the still-reachable "d" as dead code.
      const boundary = altModes.findIndex((m) => !m.nonFatal);
      const reachable =
        boundary === -1 ? altModes : altModes.slice(0, boundary + 1);
      const anyFatal = reachable.some((m) => m.fatal);
      const anyInfallible = reachable.some((m) => !m.nonFatal && !m.fatal);
      if (anyInfallible && !anyFatal) return NO_FAILURE;
      return {
        // A `fatal` alternative's failure is ABSORBED at this choice's
        // own boundary (`tryOrderedCandidates`) and re-emitted as an
        // ordinary one, so it counts toward `nonFatal`, not `fatal` --
        // a `Choice` node can never produce a cut-fatal failure for
        // whatever encloses it.
        nonFatal: reachable.every((m) => m.nonFatal) || anyFatal,
        fatal: false,
      };
    }
    default: {
      const exhaustiveCheck: never = expr;
      throw new Error(
        `Unhandled expression type: ${(exhaustiveCheck as { type: string }).type}`,
      );
    }
  }
};

/**
 * Least fixpoint of `expressionFailureModes` over every rule in
 * `grammar` -- the same worklist-driven iteration
 * `computeNullableRules` (`first-sets.ts`) uses for nullability, over
 * the same `name -> dependents` reverse edges (rebuilt here since that
 * module keeps its copy private). Each rule's two mode bits only ever
 * move `false -> true` and a rule is re-evaluated only when a rule it
 * references actually changed, so the loop terminates in O(rules +
 * edges) evaluations rather than one full pass per propagation step.
 *
 * Two rules sharing a name still share one map entry; storing the UNION
 * of what each duplicate's body yields keeps the entry monotone (an
 * overwrite could oscillate `true -> false -> true` forever) and is the
 * conservative direction anyway -- `validateGrammar` rejects duplicates
 * before this ever runs from codegen.
 */
const computeRuleFailureModes = (
  grammar: GrammarDefinition,
): ReadonlyMap<string, FailureModes> => {
  const modes = new Map<string, FailureModes>(
    grammar.rules.map((r) => [r.name, NO_FAILURE]),
  );
  const dependents = new Map<string, number[]>();
  for (let i = 0; i < grammar.rules.length; i++) {
    const refs = new Set<string>();
    forEachExpression(
      (grammar.rules[i] as (typeof grammar.rules)[number]).pattern,
      (node) => {
        if (node.type === "Identifier") refs.add(node.name);
      },
    );
    for (const name of refs) {
      const list = dependents.get(name);
      if (list) {
        list.push(i);
      } else {
        dependents.set(name, [i]);
      }
    }
  }

  const queue: number[] = grammar.rules.map((_, i) => i);
  const inQueue = new Set<number>(queue);
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++] as number;
    inQueue.delete(i);
    const rule = grammar.rules[i] as (typeof grammar.rules)[number];
    const prev = modes.get(rule.name) as FailureModes;
    const next = unionFailureModes(
      prev,
      expressionFailureModes(rule.pattern, modes),
    );
    if (
      next === prev ||
      (next.nonFatal === prev.nonFatal && next.fatal === prev.fatal)
    ) {
      continue;
    }
    modes.set(rule.name, next);
    for (const dependent of dependents.get(rule.name) ?? []) {
      if (!inQueue.has(dependent)) {
        inQueue.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return modes;
};

/** One `Choice` node with alternatives that can never be reached. */
export interface UnreachableAlternativesIssue {
  /** The rule whose pattern contains the offending `Choice`. */
  readonly ruleName: string;
  /**
   * 1-based positions of the dead alternatives (everything after the
   * first alternative that can never fail non-fatally).
   */
  readonly deadAlternatives: readonly number[];
  /** 1-based position of the alternative shadowing them. */
  readonly causeAlternative: number;
  /**
   * Why the cause alternative can never fail non-fatally:
   * `"infallible"` -- it always succeeds; `"committed"` -- it can fail,
   * but only past a `~`, so every failure it can produce is fatal.
   */
  readonly causeKind: "infallible" | "committed";
}

/**
 * Finds `Choice` nodes -- anywhere in any rule's pattern, nested
 * included -- whose later alternatives can never run because an earlier
 * one cannot fail non-fatally (see {@link expressionFailureModes}).
 *
 * In a PEG, alternatives are tried strictly in order and the first
 * success wins. An earlier alternative that always succeeds
 * (`"a"? / "b"`, `"" / "b"`, `x* / y`) leaves the later ones
 * unmatchable on every input; so does one that commits before it can
 * produce an ordinary failure (`("a" ~ "b") / "c"` -- once `~` is
 * reached, a failure is `fatal` and the choice cannot fall through).
 * Both are almost always an authoring mistake -- a misplaced `?`, a
 * catch-all written too early, alternatives pasted in the wrong order
 * -- and the dead alternatives read exactly like live grammar, making
 * the mistake invisible until an input mysteriously fails to match.
 * Reported at generation time like left recursion, rather than left to
 * silently produce a parser that can never match what was written.
 */
export const findUnreachableAlternatives = (
  grammar: GrammarDefinition,
): UnreachableAlternativesIssue[] => {
  const ruleModes = computeRuleFailureModes(grammar);
  const issues: UnreachableAlternativesIssue[] = [];
  for (const rule of grammar.rules) {
    forEachExpression(rule.pattern, (node) => {
      if (node.type !== "Choice") return;
      const causeIndex = node.alternatives.findIndex(
        (alt) => !expressionFailureModes(alt, ruleModes).nonFatal,
      );
      const causeAlt = node.alternatives[causeIndex];
      if (
        causeIndex === -1 ||
        causeIndex === node.alternatives.length - 1 ||
        causeAlt === undefined
      ) {
        return;
      }
      const cause = expressionFailureModes(causeAlt, ruleModes);
      issues.push({
        ruleName: rule.name,
        deadAlternatives: node.alternatives
          .map((_alt, i) => i + 1)
          .slice(causeIndex + 1),
        causeAlternative: causeIndex + 1,
        causeKind: cause.nonFatal || cause.fatal ? "committed" : "infallible",
      });
    });
  }
  return issues;
};

// ============================================================================
// Transform-function name checks
// ============================================================================

/**
 * A transform function binds to a rule BY NAME (docs/peg-grammar.md's
 * `rule_name(captures: ...) -> ...` convention): code generation looks the
 * function up under a rule's own name (`codegen.ts`'s
 * `collectTransformFunctions` builds `ruleName -> TransformFunction` and
 * `wrapWithTransform` only ever queries it with a declared rule's name).
 * Two consequences:
 *
 * - A function whose name matches NO declared rule is dead code that
 *   silently never runs -- the generated parser compiles fine and simply
 *   never applies it. Almost always a typo in the function name (or a
 *   renamed rule whose transform wasn't renamed with it), so it's
 *   rejected here the same way a duplicate rule name is: a
 *   grammar-authoring error reported at generation time.
 * - Two functions sharing one name in the SAME transform set silently
 *   overwrite each other in that `byName` map (last declaration wins),
 *   so the earlier one is dropped exactly like a duplicate rule name is
 *   dropped by rule-name-keyed analysis. Checked per transform set --
 *   two different-language sets legitimately reuse the same name (each
 *   binds to the same rule for its own target).
 */
interface TransformNameIssue {
  /** The transform set (`transforms <name>@<language> { ... }`). */
  readonly setName: string;
  readonly targetLanguage: string;
  readonly functionName: string;
}

/** Transform functions whose name matches no declared rule of `grammar`. */
const findUnmatchedTransformFunctions = (
  grammar: GrammarDefinition,
): TransformNameIssue[] => {
  const ruleNames = new Set(grammar.rules.map((rule) => rule.name));
  const unmatched: TransformNameIssue[] = [];
  for (const transformDef of grammar.transforms ?? []) {
    const { transformSet } = transformDef;
    for (const fn of transformSet.functions) {
      if (!ruleNames.has(fn.name)) {
        unmatched.push({
          setName: transformSet.name,
          targetLanguage: transformSet.targetLanguage,
          functionName: fn.name,
        });
      }
    }
  }
  return unmatched;
};

/** Transform functions declared more than once within the SAME transform
 * set (a name reused across two different sets is fine -- each set is a
 * separate target binding). */
const findDuplicateTransformFunctions = (
  grammar: GrammarDefinition,
): TransformNameIssue[] => {
  const duplicates: TransformNameIssue[] = [];
  for (const transformDef of grammar.transforms ?? []) {
    const { transformSet } = transformDef;
    const seen = new Set<string>();
    const reported = new Set<string>();
    for (const fn of transformSet.functions) {
      if (seen.has(fn.name) && !reported.has(fn.name)) {
        reported.add(fn.name);
        duplicates.push({
          setName: transformSet.name,
          targetLanguage: transformSet.targetLanguage,
          functionName: fn.name,
        });
      }
      seen.add(fn.name);
    }
  }
  return duplicates;
};

/**
 * Throws on a transform function that matches no declared rule, or on a
 * duplicate function name within one transform set -- see the doc comment
 * above {@link TransformNameIssue} for why both are grammar-authoring
 * errors reported at generation time rather than silently dropped.
 * Exported so `@suzumiyaaoba/tpeg-generator`'s separate validator
 * (`packages/generator/src/grammar-validation.ts`) can run the identical
 * check with the identical message rather than keeping a second copy that
 * would drift -- the same reason `validateGeneratedIdentifiers` below is
 * imported there directly.
 *
 * @throws {Error} naming the offending function and its transform set.
 */
export const assertValidTransformFunctionNames = (
  grammar: GrammarDefinition,
): void => {
  const unmatchedTransforms = findUnmatchedTransformFunctions(grammar);
  if (unmatchedTransforms.length > 0) {
    const details = unmatchedTransforms
      .map(
        (issue) =>
          `"${issue.functionName}" in transforms ${issue.setName}@${issue.targetLanguage}`,
      )
      .join("; ");
    throw new Error(
      `Transform function(s) matching no declared rule: ${details} -- a transform function binds to a rule by name, so these are dead code that would silently never run (the generated parser compiles fine and simply never applies them). Check for a typo, or a renamed rule whose transform wasn't renamed with it.`,
    );
  }

  const duplicateTransforms = findDuplicateTransformFunctions(grammar);
  if (duplicateTransforms.length > 0) {
    const details = duplicateTransforms
      .map(
        (issue) =>
          `"${issue.functionName}" in transforms ${issue.setName}@${issue.targetLanguage}`,
      )
      .join("; ");
    throw new Error(
      `Duplicate transform function(s) within one transform set: ${details} -- the later declaration silently overwrites the earlier one when the set is collected by name, the same authoring mistake a duplicate rule name is already rejected for.`,
    );
  }

  // A transform signature's parameter LIST (`f(a: T, b: T)`) parses fine,
  // but codegen has exactly one value to pass the function -- the rule's
  // own parse result (`__result.val`, bound to `parameters[0]`). There is
  // no second runtime value a second parameter could mean: emitting it
  // would bind `undefined`, silently. Before this check, parameters 2+
  // were simply dropped from the emitted arrow's parameter list, so a
  // body referencing one compiled cleanly and then threw a
  // `ReferenceError` the first time the transform ran (#108). Rejected
  // here (not in `wrapWithTransform`) so all three generators get the
  // identical failure -- this function is the shared transform validator
  // both `validateGrammar` (codegen.ts/codegen-optimized.ts) and the Eta
  // generator's `validateGrammarForEtaGenerator` already call.
  for (const transformDef of grammar.transforms ?? []) {
    const { transformSet } = transformDef;
    for (const fn of transformSet.functions) {
      if (fn.parameters.length > 1) {
        throw new Error(
          `Transform function "${fn.name}" in transforms ${transformSet.name}@${transformSet.targetLanguage} declares ${fn.parameters.length} parameters, but a transform is only ever invoked with the rule's parse result (bound to its first parameter, "${fn.parameters[0]?.name ?? ""}") -- parameters 2+ have no value to bind. Declare a single parameter, or destructure the captures object inside the body.`,
        );
      }
    }
  }
};

/**
 * One `QualifiedIdentifier` (e.g. `word.suffix`) found by
 * {@link findQualifiedIdentifierCollisions} whose `module` part collides
 * with a rule name actually declared in THIS grammar.
 */
interface QualifiedIdentifierCollision {
  readonly ruleName: string;
  readonly refersTo: string;
}

/**
 * Walks every sub-expression of `expr` looking for a `QualifiedIdentifier`
 * whose `module` part happens to name a rule declared in THIS SAME
 * grammar -- not any `Identifier` (a bare, unresolved `Identifier` is a
 * DELIBERATE escape hatch for binding a hand-written parser into
 * generated code, e.g. `packages/parser/src/codegen.ts`'s
 * `generateIdentifierCode`: `if (!ctx.ruleNames.has(name)) return name;`
 * -- see that function's own tests, and this module's "does not reject a
 * rule referencing an externally-supplied parser" test, for why an
 * unresolved bare `Identifier` must never be flagged here), and not every
 * `QualifiedIdentifier` either, since a genuine cross-module reference (a
 * namespace this single-grammar validator has no visibility into --
 * `module-resolver.ts`'s import resolution is a separate, later step) is
 * legitimate and this function has no way to tell the two apart in
 * general.
 *
 * The narrower check below still catches the concrete, unambiguous
 * mistake: `start = word.suffix` with both `word` and `suffix` declared
 * as ordinary LOCAL rules can never have been intended as a cross-module
 * reference to a module named `word`, since `word` already means
 * something else in this exact grammar -- unlike a bare `Identifier`,
 * `QualifiedIdentifier` is never used for the external-parser-binding
 * escape hatch (see its own doc comment, `codegen.ts`), so there is no
 * legitimate use this check could break.
 */
const collectQualifiedIdentifierCollisions = (
  expr: Expression,
  ruleName: string,
  ruleNames: ReadonlySet<string>,
  out: QualifiedIdentifierCollision[],
): void => {
  // A bare `Identifier` is deliberately never checked -- see this
  // function's own doc comment.
  forEachExpression(expr, (node) => {
    if (node.type === "QualifiedIdentifier" && ruleNames.has(node.module)) {
      out.push({
        ruleName,
        refersTo: `${node.module}.${node.name}`,
      });
    }
  });
};

/** Every `QualifiedIdentifier`/local-rule-name collision across all of
 * `grammar`'s rules -- see {@link collectQualifiedIdentifierCollisions}. */
const findQualifiedIdentifierCollisions = (
  grammar: GrammarDefinition,
): QualifiedIdentifierCollision[] => {
  const ruleNames = new Set(grammar.rules.map((rule) => rule.name));
  const found: QualifiedIdentifierCollision[] = [];
  for (const rule of grammar.rules) {
    collectQualifiedIdentifierCollisions(
      rule.pattern,
      rule.name,
      ruleNames,
      found,
    );
  }
  return found;
};

/** One `QualifiedIdentifier` reference found while walking a rule's
 * pattern -- see {@link findQualifiedIdentifierReferences}. */
export interface QualifiedIdentifierReference {
  ruleName: string;
  module: string;
  name: string;
}

/** Walks `expr`'s subtree collecting every `QualifiedIdentifier` node
 * (module and name unchanged, no collision filtering -- that's
 * {@link collectQualifiedIdentifierCollisions}'s job). Kept as a
 * separate walk rather than folded into it because the two have
 * different outputs (a filtered collision list vs. every reference
 * unconditionally) and different callers (`validateGrammar`, thrown on,
 * vs. codegen's non-fatal warning collection); both share
 * `forEachExpression` for the traversal itself. */
const collectQualifiedIdentifierReferences = (
  expr: Expression,
  ruleName: string,
  out: QualifiedIdentifierReference[],
): void => {
  forEachExpression(expr, (node) => {
    if (node.type === "QualifiedIdentifier") {
      out.push({ ruleName, module: node.module, name: node.name });
    }
  });
};

/**
 * Every `QualifiedIdentifier` reference (e.g. `math.expr`) anywhere in
 * `grammar`, regardless of whether its `module` part collides with a
 * local rule name. Used by `codegen.ts`/`codegen-optimized.ts` to emit a
 * non-fatal generation warning: a `QualifiedIdentifier` is always emitted
 * verbatim with no accompanying `import` (see `generateQualifiedIdentifierCode`'s
 * doc comment for why this is an intentional escape hatch, not rejected
 * outright), so the caller of the generated code must supply a binding
 * for each `module` named here themselves -- otherwise the generated
 * code throws an unhelpful `ReferenceError` at load time with no
 * indication of which name is missing or why.
 */
export const findQualifiedIdentifierReferences = (
  grammar: GrammarDefinition,
): QualifiedIdentifierReference[] => {
  const found: QualifiedIdentifierReference[] = [];
  for (const rule of grammar.rules) {
    collectQualifiedIdentifierReferences(rule.pattern, rule.name, found);
  }
  return found;
};

/** One bare `Identifier` reference naming no rule of the grammar -- see
 * {@link findExternalIdentifierReferences}. */
export interface ExternalIdentifierReference {
  readonly ruleName: string;
  readonly name: string;
}

/**
 * Every bare `Identifier` reference in `grammar` that names none of its
 * own rules. Deliberately NOT rejected (see this module's doc comment:
 * binding a hand-written parser in by name is an intentional escape
 * hatch), but -- exactly like a `QualifiedIdentifier` (see
 * {@link findQualifiedIdentifierReferences}) -- the generated code then
 * references a binding nothing declares, so `codegen.ts`'s
 * `buildExternalIdentifierWarnings` surfaces each one as a non-fatal
 * warning. Without it a misspelled rule name (`start = "a" exprr`)
 * generated silently and only failed at load time with a bare
 * `ReferenceError`.
 */
export const findExternalIdentifierReferences = (
  grammar: GrammarDefinition,
): ExternalIdentifierReference[] => {
  const declared = new Set(grammar.rules.map((rule) => rule.name));
  const found: ExternalIdentifierReference[] = [];
  for (const rule of grammar.rules) {
    forEachExpression(rule.pattern, (node) => {
      if (node.type === "Identifier" && !declared.has(node.name)) {
        found.push({ ruleName: rule.name, name: node.name });
      }
    });
  }
  return found;
};

/**
 * Shared validation for the block annotations that take `key: ruleName`
 * -- `@start` (the entry rule) and `@skip` (the automatic-whitespace
 * rule `applySkipDesugar` inserts at sequence boundaries). Both are
 * validated like the rule reference they are: at most one annotation,
 * a non-empty rule name, and a name this grammar actually declares.
 * Without this, a typo (`@start: expresion`, `@skip: whitesapce`) would
 * silently fall back to the annotation-free behavior -- the exact
 * "looks meaningful, does nothing" failure mode these annotations exist
 * to remove.
 */
const assertSingleNamedRuleAnnotation = (
  grammar: GrammarDefinition,
  key: "start" | "skip",
  duplicateReason: string,
  unknownFix: string,
): void => {
  // `annotations` is declared required but hand-built grammar literals
  // omit it in practice -- `?? []` keeps this check (and
  // `resolveStartRule` below) total over those fixtures too.
  const annotations = (grammar.annotations ?? []).filter((a) => a.key === key);
  if (annotations.length > 1) {
    throw new Error(`Duplicate @${key} annotation -- ${duplicateReason}.`);
  }
  const annotation = annotations[0];
  if (annotation === undefined) {
    return;
  }
  if (annotation.value === "") {
    throw new Error(
      `@${key} requires a rule name (write "@${key}: <ruleName>") -- a bare "@${key}" flag names nothing.`,
    );
  }
  if (!grammar.rules.some((rule) => rule.name === annotation.value)) {
    throw new Error(
      `@${key} names rule "${annotation.value}", which this grammar does not declare -- ${unknownFix}`,
    );
  }
};

/**
 * The rule `grammar` is entered through: the one named by its `@start`
 * annotation (`@start: ruleName`, docs/peg-grammar.md), or `rules[0]`
 * when no `@start` is present -- the historical default.
 *
 * `index` is the rule's position in `grammar.rules`, so index-keyed
 * bookkeeping (`collectUsedCombinators`'s `isStartRuleTopLevel`
 * argument, codegen's declaration-order table) can key off the
 * RESOLVED rule rather than blindly assuming position 0. `explicit`
 * records whether the resolution came from a `@start` annotation at
 * all -- codegen only emits the `export { X as start }` alias for an
 * explicitly-named entry, leaving output for annotation-free grammars
 * byte-for-byte unchanged.
 *
 * Returns `null` for a grammar with no rules, and for a `@start`
 * naming a rule that doesn't exist -- `validateGrammar` is the layer
 * that turns that authoring mistake into a hard error, and every
 * caller here runs it first; the `null` keeps a direct call total
 * instead of throwing a differently-worded error for the same
 * mistake.
 */
export const resolveStartRule = (
  grammar: GrammarDefinition,
): { rule: RuleDefinition; index: number; explicit: boolean } | null => {
  const startAnnotation = (grammar.annotations ?? []).find(
    (a) => a.key === "start",
  );
  const index =
    startAnnotation === undefined
      ? 0
      : grammar.rules.findIndex((rule) => rule.name === startAnnotation.value);
  const rule = grammar.rules[index];
  return rule === undefined
    ? null
    : { rule, index, explicit: startAnnotation !== undefined };
};

/**
 * Validates `grammar` for structural problems that have no well-defined
 * PEG semantics at all, throwing on the first category found. Must run
 * before `analyzeFirstSets`/`assertNoNullableRepetition` -- see this
 * module's doc comment for why. Called by both `codegen.ts` and
 * `codegen-optimized.ts` before generating any code, matching
 * `assertNoNullableRepetition`'s existing "grammar-authoring error,
 * reported at generation time" contract.
 *
 * Duplicate rule names are checked (and thrown on) BEFORE left recursion
 * and the `QualifiedIdentifier` collision check: with a duplicate name
 * present, "which rule's pattern does this name refer to" is itself
 * ambiguous, so a report built on top of that would be unreliable.
 *
 * The `QualifiedIdentifier` collision check (see
 * `collectQualifiedIdentifierCollisions`/`findQualifiedIdentifierCollisions`
 * -- deliberately NOT a general undefined-reference check; see that
 * function's own doc comment for why a bare `Identifier` is never flagged)
 * runs right after duplicates, before left recursion: a rule name that's
 * also used as a `QualifiedIdentifier`'s `module` part is treated by
 * `zeroOffsetRuleRefs` as an opaque leaf either way, so left-recursion
 * analysis doesn't depend on this check having already run -- but
 * reporting the collision before a left-recursion report keeps the more
 * directly actionable message first.
 *
 * The cut-only-pattern check (see `isCutOnlyPattern`/`findCutOnlyRules`)
 * and the unreachable-alternative check (see
 * `findUnreachableAlternatives`/`expressionFailureModes`) run next:
 * neither interacts with any of the checks above -- the failure-mode
 * analysis never resolves `Identifier` references, so it is unaffected
 * by left recursion -- so their ordering relative to them is not
 * load-bearing.
 *
 * @throws {Error} if any rule name is declared more than once, or (once
 *   no duplicates remain) if any rule contains a `QualifiedIdentifier`
 *   whose `module` part collides with a locally-declared rule name, or if
 *   any rule is left-recursive, or if any rule's pattern reduces to `~`
 *   matching nothing on its own, or if any `Choice` has alternatives
 *   that can never run (see `findUnreachableAlternatives`).
 *   Deliberately does NOT reject a bare
 *   `Identifier` naming something outside this grammar's own rules --
 *   that's an intentional escape hatch for binding a hand-written parser
 *   into generated code (`codegen.ts`'s `generateIdentifierCode`), not a
 *   grammar-authoring mistake.
 */
/**
 * Metadata keys whose `@key: ""` (empty-string) value is a legitimate,
 * if unusual, piece of documentation rather than a stray flag -- the
 * AST can't distinguish `@description: ""` from a bare `@description`,
 * so these keys are exempt from {@link assertNoInertFlagAnnotations}.
 */
const METADATA_ANNOTATION_KEYS: ReadonlySet<string> = new Set([
  "version",
  "language_version",
  "description",
  "author",
  "license",
]);

/**
 * Rejects grammar-level annotations that carry no value (the bare
 * `@key` flag form) -- see the call site in {@link validateGrammar}.
 *
 * @throws {Error} naming every offending annotation.
 */
export const assertNoInertFlagAnnotations = (
  grammar: GrammarDefinition,
): void => {
  const inert = (grammar.annotations ?? []).filter(
    (a) => a.value === "" && !METADATA_ANNOTATION_KEYS.has(a.key),
  );
  if (inert.length === 0) return;
  const names = inert.map((a) => `@${a.key}`).join(", ");
  throw new Error(
    `Unknown or misplaced flag annotation(s): ${names} -- a bare \`@name\` at grammar level has no effect. Rule annotations are \`@memoize\`/\`@memoize: N\` and \`@noskip\`, written directly above the rule they apply to; if \`@name\` was meant as a source-span of rule \`name\` at the end of the previous rule's body, write \`@(name)\` (a bare \`@name\` directly before a rule header is read as an annotation).`,
  );
};

export const validateGrammar = (grammar: GrammarDefinition): void => {
  const duplicates = findDuplicateRuleNames(grammar);
  if (duplicates.length > 0) {
    throw new Error(
      `${ERROR_MESSAGES.DUPLICATE_RULE}: ${duplicates.join(", ")} -- each rule name must be declared exactly once.`,
    );
  }

  const collisions = findQualifiedIdentifierCollisions(grammar);
  if (collisions.length > 0) {
    const details = collisions
      .map(
        ({ ruleName, refersTo }) =>
          `${ruleName} -> ${refersTo} (the part before "." is itself a local rule name in this grammar -- likely two separate tokens mis-parsed as one qualified reference, not an intentional cross-module reference)`,
      )
      .join("; ");
    throw new Error(`${ERROR_MESSAGES.UNDEFINED_RULE_REFERENCE}: ${details}`);
  }

  const leftRecursive = findLeftRecursiveRules(grammar);
  if (leftRecursive.length > 0) {
    throw new Error(
      `Left-recursive rule(s): ${leftRecursive.join(", ")} -- a PEG parser cannot recognize left recursion at runtime; it re-invokes the same rule at the same position without consuming any input first, until the call stack overflows. Rewrite using repetition instead of left-recursive self-reference (e.g. "expr = expr op term / term" becomes "expr = term (op term)*").`,
    );
  }

  const cutOnly = findCutOnlyRules(grammar);
  if (cutOnly.length > 0) {
    throw new Error(
      `${ERROR_MESSAGES.CUT_ONLY_PATTERN} (rule(s): ${cutOnly.join(", ")}) -- \`~\` only has meaning as one of several elements of a sequence (e.g. "a" ~ "b"); a rule, group, choice alternative, or repetition/lookahead body made up of nothing but \`~\` doesn't match anything.`,
    );
  }

  const unreachable = findUnreachableAlternatives(grammar);
  if (unreachable.length > 0) {
    const details = unreachable
      .map(
        (issue) =>
          `rule "${issue.ruleName}": alternative(s) ${issue.deadAlternatives.join(", ")} unreachable because alternative ${issue.causeAlternative} ${
            issue.causeKind === "infallible"
              ? "always succeeds"
              : "commits via `~` before it can produce an ordinary failure"
          }`,
      )
      .join("; ");
    throw new Error(
      `Unreachable ordered-choice alternative(s): ${details} -- PEG alternatives are tried in order, so an earlier alternative that cannot fail non-fatally makes every later one dead code. Reorder the alternatives, make the earlier one able to fail, or remove the dead ones.`,
    );
  }

  // `@start` names the grammar's entry rule (see `resolveStartRule`) --
  // without this, a typo (`@start: expresion`) would silently keep the
  // historical rules[0] entry -- the exact "looks meaningful, does
  // nothing" failure mode the annotation exists to remove.
  assertSingleNamedRuleAnnotation(
    grammar,
    "start",
    "a grammar's entry rule can only be named once",
    "fix the name, or remove the annotation to keep the default entry point (the first rule).",
  );

  // `@skip` names the grammar's automatic-whitespace rule (see
  // `skip-desugar.ts`'s `applySkipDesugar`) -- the same rule-reference
  // validation `@start` gets: a typo'd name would otherwise degrade
  // silently to "no skipping at all".
  assertSingleNamedRuleAnnotation(
    grammar,
    "skip",
    "a grammar can only name one skip rule",
    "fix the name, or remove the annotation to disable automatic whitespace skipping.",
  );

  // A grammar-level annotation with no value is a bare flag (`@foo`):
  // no grammar-level flag has any meaning (`@start`/`@skip` require a
  // rule name, `@memoize`/`@noskip` only attach to the rule directly
  // after them and are parsed as part of it). One reaching here is
  // therefore always a mistake that would otherwise be silently inert:
  // a typo'd rule annotation (`@memoise`, `@noSkip` -- the rule then
  // simply isn't memoized/exempted), or a trailing `@x` span at the end
  // of a rule body that the rule-body scanner reads as an annotation
  // because the next line starts a rule header (docs/peg-grammar.md's
  // "Source-Span Operator" section) -- which silently drops `@x` from
  // that rule's pattern.
  assertNoInertFlagAnnotations(grammar);

  // Transform-function checks run last: they don't interact with any of
  // the rule-level analyses above (a transform binds to a rule by name --
  // see TransformNameIssue's doc comment).
  assertValidTransformFunctionNames(grammar);
};

// ============================================================================
// Generated-identifier safety (reserved words / import collisions)
// ============================================================================

/**
 * Every word that `tsc` rejects (or otherwise mis-parses) as a `const`
 * binding name in an ES module, verified empirically rather than typed
 * from memory: for each candidate, a file
 * `import type { Parser } from "./core"; import { literal } from "./core";
 * export const <candidate>: Parser<any> = literal("x");` was compiled with
 * `tsc --noEmit --target es2022 --module esnext`. This matters in both
 * directions -- a false entry here would reject an otherwise-fine grammar,
 * a missing one would let broken code generate silently -- so the
 * boundary is deliberately NOT "keywords I can recall" (that gets `let`,
 * `static`, `yield`, `await`, `implements`, `interface`, `package`,
 * `private`, `protected`, `public`, `arguments`, `eval` wrong in one
 * direction or the other: they're all rejected by `tsc` in a module
 * despite not being reserved words in a plain script). Confirmed NOT
 * rejected, and therefore deliberately absent from this list: `as`,
 * `async`, `from`, `get`, `of`, `set`, `type`, `undefined`, `NaN`,
 * `Infinity`.
 *
 * TPEG's own identifier grammar (`identifier.ts`) is `[a-zA-Z_][a-zA-Z0-9_]*`
 * -- a superset of every one of these words is syntactically reachable
 * from `.tpeg` source as a rule name, a label, or (via
 * `transforms ... { name(param) -> ... }`) a transform parameter name.
 */
const JS_RESERVED_WORDS: ReadonlySet<string> = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "let",
  "static",
  "yield",
  "await",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "arguments",
  "eval",
]);

/**
 * Names every code generator (`codegen.ts`, `codegen-optimized.ts`,
 * `@suzumiyaaoba/tpeg-generator`'s Eta templates) declares as a `const`
 * INSIDE a rule's own generated function body when that rule carries a
 * semantic action, a transform, or monitoring instrumentation (see
 * `wrapWithAction`/`wrapWithTransform`/`wrapWithMonitoring` in
 * `codegen.ts`). A rule whose pattern is a bare reference to
 * ANOTHER rule sharing one of these names generates that reference as the
 * plain identifier `__base` (or `lazy(() => __base)`, or `__result`, or
 * `__val`, or `__transformed`, or `__monitored`) -- which, once emitted
 * inside
 * `const __base = (${that reference});` in the SAME block as the sibling
 * `const __base = ...`/`const __result = ...`/`const __val = ...`/
 * `const __transformed = ...` declarations these wrappers emit, resolves
 * to that sibling's own not-yet-initialized binding instead of the outer
 * top-level rule, a temporal-dead-zone `ReferenceError` at the first
 * call (confirmed: rule `__base = "a"`, `m = __base { return $$; }`
 * generates `const __base = (__base);`; and rule `__transformed = "a"`,
 * `m = __transformed` under a transforms block generates
 * `const __base = (__transformed);` before `const __transformed = ...`).
 *
 * `input` and `pos` belong to this same set for a related but distinct
 * reason: those same three wrapper functions also declare the OUTER
 * function's own PARAMETERS as `(input, pos) => { ... }` -- not a
 * `const`, so there is no TDZ, but the collision is just as fatal. A
 * rule named `input` (or `pos`) referenced from inside an action/
 * transform/monitoring-wrapped rule generates `lazy(() => input)` sitting
 * textually inside that very `(input, pos) => { ... }` closure, so it
 * resolves to the wrapper's own string/number parameter instead of the
 * top-level `export const input = ...` -- silently, since both are
 * already-initialized bindings and nothing throws a ReferenceError.
 * Confirmed: `start = input "z" { return 1; }`, `input = "a"` generates
 * `const start = (input, pos) => { const __base = (sequence(lazy(() =>
 * input), literal("z"))); const __result = __base(input, pos); ... }`,
 * where the `input` inside `lazy(() => input)` is the wrapper's own
 * `input` parameter -- a `TypeError` the first time `start` actually
 * runs, not a compile-time error.
 *
 * Rejected unconditionally as a RULE name regardless of whether any
 * particular occurrence is provably reachable from an action/transform --
 * working out exact reachability across the whole grammar (a rule
 * referenced only through further identifiers, forward references via
 * `lazy`, etc.) is not worth it for names nobody has a legitimate reason
 * to choose. Not applied to labels or transform-parameter names: those
 * are only ever destructured/bound INSIDE that same nested function
 * scope, so at worst they shadow the outer binding (legal, unlike a
 * duplicate top-level `const`, and legal for `input`/`pos` too -- a
 * label or transform parameter named `input` is bound strictly inside
 * the wrapper's own IIFE/inner-function scope, an ordinary, harmless
 * shadow of the outer parameter) rather than colliding with it.
 */
const RESERVED_INTERNAL_RULE_NAMES: ReadonlySet<string> = new Set([
  "__base",
  "__monitored",
  "__result",
  "__transformed",
  "__val",
  "input",
  "pos",
]);

/**
 * Every `LabeledExpression.label` reachable anywhere in `expr`'s tree,
 * including inside nested `ActionExpression`s, `Group`s, and repetition/
 * lookahead bodies. Deliberately over-approximates relative to what
 * `codegen.ts`'s `wrapWithAction` actually destructures as a bare
 * variable (only a label that is a DIRECT element of an enclosing
 * action's own expression -- see `collectTopLevelLabels` -- and that the
 * action's code textually references -- see `filterReferencedLabels` --
 * ever becomes a JS binding at all): rejecting every label matching a
 * reserved word, not just the ones provably destructured, means adding a
 * semantic action to an existing rule later never turns an
 * already-accepted grammar into a generation-time error. A rule with no
 * action anywhere never actually emits `const { <label> } = $$;` for any
 * of these, so this is deliberately more conservative than strictly
 * necessary.
 */
const collectAllLabels = (expr: Expression): string[] => {
  const labels: string[] = [];
  forEachExpression(expr, (node) => {
    if (node.type === "LabeledExpression") {
      labels.push(node.label);
    }
  });
  return labels;
};

/** Options for {@link validateGeneratedIdentifiers}: the exact prefix and
 * import set the calling generator will actually emit, so the collision
 * check matches real output rather than a guessed static list. */
export interface GeneratedIdentifierCheckOptions {
  /** `CodeGenOptions.namePrefix` (or its Eta-generator equivalent),
   * defaulting to `""` -- prepended to every rule name before it's
   * checked, since that's the name actually emitted as `export const
   * <namePrefix><rule.name>`. */
  namePrefix: string;
  /** Every binding the generator will import (or otherwise declare at
   * module scope) alongside the rules themselves -- e.g. `"Parser"` plus
   * the sorted `usedCombinators` set, `"memoize"`, `"commitAtTopLevel"`.
   * A rule name colliding with one of these produces a duplicate-
   * declaration error (`literal` colliding with `import { literal }`) or
   * a self-referential TDZ (`lazy` colliding with `import { lazy }`),
   * depending on the combinator. Checked against the PREFIXED rule name,
   * matching what's actually emitted. */
  importedBindings: readonly string[];
}

/**
 * Rejects a grammar whose generated TypeScript would fail to parse, fail
 * to compile, or throw a temporal-dead-zone `ReferenceError` the moment
 * it's loaded -- because a rule name, a capture label, or a transform
 * function's parameter name collides with a JS reserved word, an import
 * this generator will emit, or one of the fixed internal names
 * `wrapWithAction`/`wrapWithTransform`/`wrapWithMonitoring` declare inside
 * a rule's own body.
 * TPEG's identifier grammar (`[a-zA-Z_][a-zA-Z0-9_]*`) allows all of
 * these unconditionally -- see `JS_RESERVED_WORDS`'s doc comment for
 * concrete, `tsc`-verified reproductions of each failure mode this
 * guards against.
 *
 * Called by every code generator (`codegen.ts`, `codegen-optimized.ts`,
 * `@suzumiyaaoba/tpeg-generator`'s `eta-generator.ts`) right after
 * collecting the combinator set it's about to import, so
 * `options.importedBindings` reflects what will actually be emitted for
 * THIS grammar under THESE options -- not a static guess that would
 * either miss a real collision or reject a grammar that's actually fine.
 *
 * Rejects rather than silently renaming: a rule name is the generated
 * module's own public export name, so renaming it out from under the
 * grammar author would silently change the generated API. This matches
 * every other check in this module (duplicate names, left recursion,
 * cut-only patterns) -- reported at generation time, not worked around.
 *
 * @throws {Error} naming the offending rule/label/parameter and
 *   suggesting a fix (rename the rule, or pass `--name-prefix`/
 *   `namePrefix` -- neither helps for a label or transform parameter,
 *   which have no prefix option, so those must simply be renamed).
 */
export const validateGeneratedIdentifiers = (
  grammar: GrammarDefinition,
  options: GeneratedIdentifierCheckOptions,
): void => {
  const importedBindings = new Set(options.importedBindings);
  const localRuleNames = new Set(grammar.rules.map((rule) => rule.name));

  // The checks below validate `namePrefix + rule.name` as a whole against
  // reserved words and imports, but a prefix that is not itself
  // identifier-shaped slips through them entirely: "my-" + "start" is not
  // a reserved word, collides with nothing, and emits `export const
  // my-start` -- a SyntaxError. Since every legal rule name starts with
  // `[a-zA-Z_]`, `prefix + name` is a valid JS identifier for ALL rules
  // exactly when the non-empty prefix is itself a JS identifier
  // (`[a-zA-Z_$][a-zA-Z0-9_$]*` -- `$` included, matching the emitted
  // code's rules rather than TPEG's own identifier grammar).
  if (
    options.namePrefix !== "" &&
    !JS_IDENTIFIER_FULL.test(options.namePrefix)
  ) {
    throw new Error(
      `namePrefix "${options.namePrefix}" is not a valid JavaScript identifier prefix -- it would produce declaration names like "export const ${options.namePrefix}ruleName" that fail to parse. Use a prefix matching /[a-zA-Z_$][a-zA-Z0-9_$]*/ (or none).`,
    );
  }

  for (const rule of grammar.rules) {
    const emittedName = options.namePrefix + rule.name;
    // Parser-produced rule names are always `[a-zA-Z_][a-zA-Z0-9_]*`, but
    // `generateTypeScriptParser` also accepts a hand-built
    // `GrammarDefinition` -- a name like "my-rule" emits `export const
    // my-rule`, a SyntaxError in the generated file. Check the whole
    // emitted name's shape before the reserved-word/import checks, since
    // a malformed name slips through both ("my-rule" is not a reserved
    // word and collides with no import).
    if (!JS_IDENTIFIER_FULL.test(emittedName)) {
      throw new Error(
        `Rule name "${rule.name}" generates to "${emittedName}", which is not a valid JavaScript identifier -- the emitted \`export const ${emittedName}\` would fail to parse. Rule names must match /[a-zA-Z_$][a-zA-Z0-9_$]*/.`,
      );
    }
    if (JS_RESERVED_WORDS.has(emittedName)) {
      throw new Error(
        `Rule name "${rule.name}" generates to the reserved word "${emittedName}", which cannot be used as a TypeScript \`const\` declaration name -- rename the rule${options.namePrefix ? "" : " (or pass a --name-prefix that makes the emitted name safe)"}.`,
      );
    }
    if (RESERVED_INTERNAL_RULE_NAMES.has(emittedName)) {
      throw new Error(
        `Rule name "${rule.name}" generates to "${emittedName}", a name the code generator itself uses internally inside an action/transform-wrapped rule's body -- rename the rule${options.namePrefix ? "" : " (or pass a --name-prefix)"} to avoid a self-referential ReferenceError in the generated code.`,
      );
    }
    if (importedBindings.has(emittedName)) {
      throw new Error(
        `Rule name "${rule.name}" generates to "${emittedName}", which collides with a runtime import this grammar's generated code also needs -- rename the rule${options.namePrefix ? "" : " (or pass a --name-prefix)"}.`,
      );
    }

    for (const label of collectAllLabels(rule.pattern)) {
      // `JS_RESERVED_WORDS` only -- NOT `RESERVED_INTERNAL_RULE_NAMES`
      // (whose own doc comment says it does not apply to labels): the
      // `const { <label> } = $$` destructure `wrapWithAction` emits sits
      // INSIDE the inner `(() => { ... })()` IIFE scope, so a label like
      // `__base` legally shadows the wrapper's own `const __base`
      // binding rather than colliding with it (#115). A JS reserved
      // word still can't be a binding name anywhere, IIFE or not --
      // and neither can a label that isn't identifier-shaped at all
      // (`const { my-label } = $$` -- reachable from a hand-built AST,
      // since the grammar parser itself only produces identifier-shaped
      // labels).
      if (!JS_IDENTIFIER_FULL.test(label)) {
        throw new Error(
          `Rule "${rule.name}" has a capture label named "${label}", which is not a valid JavaScript identifier -- the emitted \`const { ${label} } = ...\` destructure would fail to parse. Label names must match /[a-zA-Z_$][a-zA-Z0-9_$]*/.`,
        );
      }
      if (JS_RESERVED_WORDS.has(label)) {
        throw new Error(
          `Rule "${rule.name}" has a capture label named "${label}", which cannot be used as a destructured variable name (\`const { ${label} } = ...\`) in generated code -- rename the label.`,
        );
      }
      // A label named `$$` IS a legal destructured binding name in
      // isolation (and `RESERVED_INTERNAL_RULE_NAMES` deliberately does
      // not cover labels -- see above), but `wrapWithAction` emits the
      // destructure in the SAME IIFE scope as its own
      // `const $$ = __result.val;` -- so `const { $$ } = ($$ ?? {})`
      // is a duplicate-`const` SyntaxError, not a legal shadow. Reachable
      // only from a hand-built AST (the grammar parser's identifier rule
      // can't produce a `$`).
      if (label === "$$") {
        throw new Error(
          `Rule "${rule.name}" has a capture label named "$$", which collides with the \`const $$ = __result.val;\` binding wrapWithAction declares in the same scope as its \`const { ${label} } = ...\` destructure -- the emitted code fails to parse (duplicate lexical declaration). Rename the label.`,
        );
      }
    }

    // A `QualifiedIdentifier` (`module.rule`) is emitted verbatim as a
    // property access `module.name`, so its `module` part lands in
    // expression position: a reserved word there is a SyntaxError
    // (`function.foo`), and a name colliding with a generated import
    // (e.g. `literal.foo`) silently reads a property off the imported
    // combinator instead of the intended module binding -- a runtime
    // TypeError, not a compile error, but equally a mis-binding the
    // grammar author can't have intended. The `name` part sits in
    // property position, where reserved words and collisions are legal
    // (`m.class` is fine), so it is deliberately not checked.
    const qualifiedRefs: QualifiedIdentifierReference[] = [];
    collectQualifiedIdentifierReferences(
      rule.pattern,
      rule.name,
      qualifiedRefs,
    );
    for (const ref of qualifiedRefs) {
      // Both parts must be identifier-shaped before the reserved-word/
      // import checks below can mean anything: `foo.bar-baz` emits
      // verbatim as `foo.bar-baz`, which is not a SyntaxError but parses
      // as `(foo.bar) - baz` -- a silent mis-parse. Reachable only from
      // a hand-built AST (the grammar parser's qualified-identifier rule
      // only produces identifier-shaped parts).
      if (!JS_IDENTIFIER_FULL.test(ref.module)) {
        throw new Error(
          `Rule "${rule.name}" references "${ref.module}.${ref.name}", whose module part "${ref.module}" is not a valid JavaScript identifier -- the generated code emits it verbatim in expression position, where it mis-parses. Module parts must match /[a-zA-Z_$][a-zA-Z0-9_$]*/.`,
        );
      }
      if (!JS_IDENTIFIER_FULL.test(ref.name)) {
        throw new Error(
          `Rule "${rule.name}" references "${ref.module}.${ref.name}", whose name part "${ref.name}" is not a valid JavaScript identifier -- the emitted \`${ref.module}.${ref.name}\` would mis-parse (e.g. "a.b-c" parses as \`(a.b) - c\`).`,
        );
      }
      if (JS_RESERVED_WORDS.has(ref.module)) {
        throw new Error(
          `Rule "${rule.name}" references "${ref.module}.${ref.name}", whose module part "${ref.module}" is a JavaScript reserved word -- the generated code emits it verbatim in expression position, which is a SyntaxError. Rename the module (e.g. via an import alias).`,
        );
      }
      if (importedBindings.has(ref.module)) {
        throw new Error(
          `Rule "${rule.name}" references "${ref.module}.${ref.name}", whose module part "${ref.module}" collides with a runtime import this grammar's generated code also needs -- the emitted \`${ref.module}.${ref.name}\` would read a property off that import instead of the intended module binding. Rename the module (e.g. via an import alias).`,
        );
      }
    }

    // A bare `Identifier` resolving to no LOCAL rule is the external-
    // parser escape hatch (`generateIdentifierCode` emits it verbatim,
    // unprefixed) -- but verbatim emission can only work if the emitted
    // name is actually free for the caller to bind. A name colliding
    // with an import this grammar's generated code already emits (e.g.
    // `rule = literal` alongside a string literal, which forces
    // `import { literal }`) silently binds the reference to the
    // COMBINATOR -- `literal(input, pos)` then returns a `Parser`, not
    // a `ParseResult`, so `sequence`/`choice` treat the call as a
    // failure carrying `error: undefined` rather than parsing anything
    // (and a caller CAN'T supply their own `literal` binding: it would
    // be a duplicate-declaration SyntaxError against the import). A
    // reserved word is a SyntaxError outright (`sequence(..., function)`),
    // and an internal `__*` name either resolves to a wrapper's own
    // `const __*` binding (a self-referential TDZ ReferenceError) or
    // stays unbound -- none can ever mean "the caller's parser", so all
    // three are rejected here, exactly as the `QualifiedIdentifier`
    // module-part check above rejects the same collisions there.
    forEachExpression(rule.pattern, (node) => {
      if (node.type !== "Identifier" || localRuleNames.has(node.name)) {
        return;
      }
      const name = node.name;
      if (!JS_IDENTIFIER_FULL.test(name)) {
        throw new Error(
          `Rule "${rule.name}" references external parser "${name}", which is not a valid JavaScript identifier -- the generated code emits it verbatim in expression position, where it mis-parses (e.g. "foo-bar" parses as \`foo - bar\`).`,
        );
      }
      if (JS_RESERVED_WORDS.has(name)) {
        throw new Error(
          `Rule "${rule.name}" references external parser "${name}", which is a JavaScript reserved word -- the generated code emits it verbatim in expression position, which is a SyntaxError. Reference the external parser under a different name.`,
        );
      }
      if (RESERVED_INTERNAL_RULE_NAMES.has(name)) {
        throw new Error(
          `Rule "${rule.name}" references external parser "${name}", a name the code generator itself declares inside an action/transform-wrapped rule's body -- the emitted reference would resolve to that internal binding (or nothing at all), never to the caller's parser. Reference the external parser under a different name.`,
        );
      }
      if (importedBindings.has(name)) {
        throw new Error(
          `Rule "${rule.name}" references external parser "${name}", which collides with a runtime import this grammar's generated code also needs -- the emitted reference would resolve to that imported combinator (a function returning a Parser, not a Parser), silently mis-binding instead of calling the intended parser. Reference the external parser under a different name (e.g. wrap it in a differently-named rule or alias it at the call site).`,
        );
      }
      // Emitted UNPREFIXED (see `generateIdentifierCode`), so it can
      // also collide with a LOCAL rule's own emitted name when a
      // `namePrefix` is in effect: `x = "a"` under `namePrefix: "p_"`
      // declares `const p_x`, and an external reference spelled `p_x`
      // binds to that declaration instead of the caller's binding --
      // the same silent mis-binding as the import collision above.
      // (`name` equal to an UNPREFIXED local name is impossible: such
      // an `Identifier` resolves as a local reference, not external.)
      if (
        localRuleNames.has(
          name.startsWith(options.namePrefix)
            ? name.slice(options.namePrefix.length)
            : "\0",
        )
      ) {
        throw new Error(
          `Rule "${rule.name}" references external parser "${name}", which collides with the declaration this grammar emits for local rule "${name.slice(options.namePrefix.length)}" (\`export const ${name}\` under the \`${options.namePrefix}\` name prefix) -- the emitted reference would resolve to that generated rule instead of the caller's binding, and a caller-supplied \`${name}\` would be shadowed by it. Reference the external parser under a different name.`,
        );
      }
    });
  }

  for (const transformDef of grammar.transforms ?? []) {
    for (const fn of transformDef.transformSet.functions) {
      // Every parameter, not just `parameters[0]`:
      // `assertValidTransformFunctionNames` rejects multi-parameter
      // transforms outright, but this check stands guard regardless --
      // the day multi-parameter signatures are ever given a real meaning,
      // a reserved name in position 2+ must still not slip through (#108).
      for (const param of fn.parameters) {
        // `JS_RESERVED_WORDS` only here too -- a transform parameter is a
        // function parameter inside `wrapWithTransform`'s emitted arrow,
        // where it legally shadows the wrapper-scope `__*` bindings, so
        // `RESERVED_INTERNAL_RULE_NAMES` doesn't apply to it either
        // (#115; see the label check above). The identifier-shape check
        // guards the same hand-built-AST hole as the rule/label checks:
        // a parameter named "foo-bar" emits `=> (foo-bar) => ...`, a
        // SyntaxError.
        if (!JS_IDENTIFIER_FULL.test(param.name)) {
          throw new Error(
            `Transform function "${fn.name}" has a parameter named "${param.name}", which is not a valid JavaScript identifier -- the emitted arrow's parameter list would fail to parse. Parameter names must match /[a-zA-Z_$][a-zA-Z0-9_$]*/.`,
          );
        }
        if (JS_RESERVED_WORDS.has(param.name)) {
          throw new Error(
            `Transform function "${fn.name}" has a parameter named "${param.name}", which cannot be used as a function parameter name in generated code -- rename the parameter.`,
          );
        }
      }
    }
  }
};
