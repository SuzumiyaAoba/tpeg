/**
 * Grammar-level structural validation, run before any FIRST-set analysis
 * or code generation: two classes of malformed grammar that have no PEG
 * semantics at all, as opposed to `assertNoNullableRepetition`
 * (`first-sets.ts`), which rejects a narrower shape (an unbounded
 * repetition over a nullable body) that only becomes well-defined or not
 * once FIRST-set analysis has already run.
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
 * Validates `grammar` for structural problems that have no well-defined
 * PEG semantics at all, throwing on the first category found. Must run
 * before `analyzeFirstSets`/`assertNoNullableRepetition` -- see this
 * module's doc comment for why. Called by both `codegen.ts` and
 * `codegen-optimized.ts` before generating any code, matching
 * `assertNoNullableRepetition`'s existing "grammar-authoring error,
 * reported at generation time" contract.
 *
 * Duplicate rule names are checked (and thrown on) BEFORE left recursion:
 * with a duplicate name present, "which rule's pattern does this name
 * refer to" is itself ambiguous, so a left-recursion report built on top
 * of that would be unreliable.
 *
 * @throws {Error} if any rule name is declared more than once, or (once
 *   no duplicates remain) if any rule is left-recursive.
 */
export const validateGrammar = (grammar: GrammarDefinition): void => {
  const duplicates = findDuplicateRuleNames(grammar);
  if (duplicates.length > 0) {
    throw new Error(
      `${ERROR_MESSAGES.DUPLICATE_RULE}: ${duplicates.join(", ")} -- each rule name must be declared exactly once.`,
    );
  }

  const leftRecursive = findLeftRecursiveRules(grammar);
  if (leftRecursive.length > 0) {
    throw new Error(
      `Left-recursive rule(s): ${leftRecursive.join(", ")} -- a PEG parser cannot recognize left recursion at runtime; it re-invokes the same rule at the same position without consuming any input first, until the call stack overflows. Rewrite using repetition instead of left-recursive self-reference (e.g. "expr = expr op term / term" becomes "expr = term (op term)*").`,
    );
  }
};
