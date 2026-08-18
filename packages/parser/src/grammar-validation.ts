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

import { ERROR_MESSAGES } from "./constants";
import { computeNullableRules, isNullable } from "./first-sets";
import type { Expression, GrammarDefinition } from "./types";

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
  switch (expr.type) {
    case "Identifier":
      return new Set([expr.name]);
    case "Sequence": {
      const refs = new Set<string>();
      for (const el of expr.elements) {
        if (el.type === "Cut") continue;
        for (const name of zeroOffsetRuleRefs(el, nullableRules)) {
          refs.add(name);
        }
        // Only an element that might itself match zero characters lets
        // the position stay at the sequence's own start for whatever
        // comes next -- anything past the first non-nullable element is
        // unreachable at offset 0 into this sequence's own attempt.
        if (!isNullable(el, nullableRules)) break;
      }
      return refs;
    }
    case "Choice": {
      const refs = new Set<string>();
      for (const alt of expr.alternatives) {
        for (const name of zeroOffsetRuleRefs(alt, nullableRules)) {
          refs.add(name);
        }
      }
      return refs;
    }
    case "Group":
    case "LabeledExpression":
    case "ActionExpression":
    case "Star":
    case "Plus":
    case "Optional":
    case "Quantified":
    case "PositiveLookahead":
    case "NegativeLookahead":
      return zeroOffsetRuleRefs(expr.expression, nullableRules);
    default:
      // StringLiteral, CharacterClass, AnyChar, Cut, QualifiedIdentifier
      // (a cross-module reference can't recurse back into THIS grammar's
      // own rules from here -- see `first-sets.ts`'s identical treatment).
      return new Set();
  }
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

  const recursive = new Set<string>();
  for (const start of graph.keys()) {
    // DFS over `start`'s own OUT-edges (not `start` itself as the first
    // node) -- `start` is left-recursive iff that search can reach
    // `start` again.
    const seen = new Set<string>();
    const stack = [...(graph.get(start) ?? [])];
    while (stack.length > 0) {
      const name = stack.pop() as string;
      if (name === start) {
        recursive.add(start);
        break;
      }
      if (seen.has(name)) continue;
      seen.add(name);
      for (const next of graph.get(name) ?? []) stack.push(next);
    }
  }
  return [...recursive].sort();
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
  switch (expr.type) {
    case "QualifiedIdentifier":
      if (ruleNames.has(expr.module)) {
        out.push({
          ruleName,
          refersTo: `${expr.module}.${expr.name}`,
        });
      }
      return;
    case "Sequence":
      for (const el of expr.elements) {
        collectQualifiedIdentifierCollisions(el, ruleName, ruleNames, out);
      }
      return;
    case "Choice":
      for (const alt of expr.alternatives) {
        collectQualifiedIdentifierCollisions(alt, ruleName, ruleNames, out);
      }
      return;
    case "Group":
    case "LabeledExpression":
    case "ActionExpression":
    case "Star":
    case "Plus":
    case "Optional":
    case "Quantified":
    case "PositiveLookahead":
    case "NegativeLookahead":
      collectQualifiedIdentifierCollisions(
        expr.expression,
        ruleName,
        ruleNames,
        out,
      );
      return;
    default:
      // StringLiteral, CharacterClass, AnyChar, Cut, Identifier -- no
      // `QualifiedIdentifier` to check (a bare `Identifier` is
      // deliberately never checked -- see this function's own doc
      // comment).
      return;
  }
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
 * runs last: it doesn't interact with any of the checks above, so its
 * ordering relative to them is not load-bearing.
 *
 * @throws {Error} if any rule name is declared more than once, or (once
 *   no duplicates remain) if any rule contains a `QualifiedIdentifier`
 *   whose `module` part collides with a locally-declared rule name, or if
 *   any rule is left-recursive, or if any rule's pattern reduces to `~`
 *   matching nothing on its own. Deliberately does NOT reject a bare
 *   `Identifier` naming something outside this grammar's own rules --
 *   that's an intentional escape hatch for binding a hand-written parser
 *   into generated code (`codegen.ts`'s `generateIdentifierCode`), not a
 *   grammar-authoring mistake.
 */
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
};
