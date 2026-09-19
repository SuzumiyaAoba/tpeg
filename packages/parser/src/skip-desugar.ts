/**
 * `@skip` desugar pass
 *
 * Rewrites a parsed `GrammarDefinition`'s rule patterns so the skip rule
 * named by a `@skip: <ruleName>` block annotation is invoked optionally
 * at every sequence boundary -- the automatic whitespace/comment
 * insertion the annotation promises (`docs/peg-grammar.md`).
 *
 * For every rule NOT exempted (see {@link computeSkipExemptRules}), the
 * pass inserts `Skip` nodes at a sequence's start, between adjacent
 * elements, and at its end; a rule's top-level pattern is treated as a
 * sequence even when it is a single non-`Sequence` expression, so every
 * covered rule also skips at its own boundaries. Nested `Sequence`s
 * (inside `Group`s, repetitions, lookaheads, action bodies, ...) are
 * rewritten the same way recursively.
 *
 * `Skip` is a desugar-internal node: codegen emits it as
 * `ignore(optional(<skipRule>))` -- always succeeding, always consuming
 * whatever the skip rule matches, and contributing NOTHING to the
 * enclosing sequence's value (the `IGNORED` sentinel is filtered by
 * `sequence`/`captureSequence`). A rule's own value shape is therefore
 * identical with and without `@skip`.
 *
 * Rules exempted from insertion:
 *
 * - rules annotated `@noskip` -- the "this rule is lexical, don't skip
 *   inside me" escape hatch;
 * - every rule in the `@skip` rule's own transitive reference closure
 *   (the skip rule itself included). Inserting skips there would both
 *   recurse forever (`ws = ... ws ...`) and corrupt the skip rule's own
 *   internals -- exactly the same reason pest/Raku treat the whitespace
 *   token's own body as atomic.
 *
 * The pass is a pure AST rewrite run by the code generators and the
 * reference interpreter before compilation/evaluation; the PARSED AST
 * itself (what `grammarDefinition` produces, and what the self-hosted
 * comparison specs compare byte-for-byte) stays un-desugared, so no
 * `.tpeg` source or generated parser needs to know `Skip` exists.
 *
 * Validation of the annotation itself (duplicate `@skip`s, a bare
 * `@skip` flag, a name that doesn't resolve to a declared rule) lives
 * in `grammar-validation.ts` and runs before this pass -- the resolver
 * here simply treats an unresolvable annotation as "no `@skip`".
 */

import {
  type Expression,
  type GrammarDefinition,
  type Identifier,
  createIdentifier,
  createSequence,
  createSkip,
  forEachExpression,
  mapChildExpressions,
} from "@suzumiyaaoba/tpeg-core";

/**
 * Returns the rule name a grammar's `@skip: <ruleName>` annotation
 * selects, or `null` when the grammar carries no usable `@skip`
 * (absent, or a bare flag -- the latter is a `validateGrammar` error
 * before generation, so this is just defensive).
 */
export const resolveSkipRuleName = (
  grammar: GrammarDefinition,
): string | null => {
  // `annotations` is declared required but hand-built grammar literals
  // (differential-test fixtures, `as GrammarDefinition` casts) do omit
  // it -- treat a missing array the same as an empty one.
  const annotation = (grammar.annotations ?? []).find((a) => a.key === "skip");
  if (!annotation || annotation.value === "") {
    return null;
  }
  return annotation.value;
};

/**
 * The set of rule names `applySkipDesugar` must leave untouched: every
 * `@noskip`-annotated rule, plus the transitive `Identifier`-reference
 * closure of the skip rule itself. Walking references via
 * `forEachExpression` (which sees through every wrapper node) keeps the
 * closure correct no matter how the references are nested.
 */
const computeSkipExemptRules = (
  grammar: GrammarDefinition,
  skipRuleName: string,
): ReadonlySet<string> => {
  const exempt = new Set<string>();
  for (const rule of grammar.rules) {
    if (rule.annotations?.some((a) => a.key === "noskip")) {
      exempt.add(rule.name);
    }
  }

  const rulesByName = new Map(grammar.rules.map((r) => [r.name, r]));
  const queue: string[] = [skipRuleName];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (exempt.has(name)) continue;
    exempt.add(name);
    const rule = rulesByName.get(name);
    if (!rule) continue;
    forEachExpression(rule.pattern, (node) => {
      if (node.type === "Identifier") {
        queue.push(node.name);
      }
    });
  }
  return exempt;
};

/**
 * Rewrites `grammar` so the `@skip` rule is invoked optionally at every
 * sequence boundary of every non-exempt rule (see the module doc
 * comment). Returns `grammar` unchanged when it carries no usable
 * `@skip` annotation.
 */
export const applySkipDesugar = (
  grammar: GrammarDefinition,
): GrammarDefinition => {
  const skipRuleName = resolveSkipRuleName(grammar);
  if (skipRuleName === null) {
    return grammar;
  }

  const exempt = computeSkipExemptRules(grammar, skipRuleName);
  const skipRef: Identifier = createIdentifier(skipRuleName);

  /**
   * Inserts a `Skip` before every element and one trailing, skipping
   * insertion next to an element that already IS a `Skip` -- the
   * idempotence guard that makes a second `applySkipDesugar` pass a
   * no-op instead of doubling every insertion.
   */
  const insertBoundarySkips = (
    elements: readonly Expression[],
  ): Expression[] => {
    const out: Expression[] = [];
    for (const element of elements) {
      // Insert a boundary Skip before a real element only -- an element
      // that already IS a Skip supplies its own boundary (and keeps a
      // second desugar pass from doubling every insertion).
      if (element.type !== "Skip" && out[out.length - 1]?.type !== "Skip") {
        out.push(createSkip(skipRef));
      }
      out.push(element);
    }
    if (out[out.length - 1]?.type !== "Skip") {
      out.push(createSkip(skipRef));
    }
    return out;
  };

  const desugarExpression = (expr: Expression): Expression => {
    if (expr.type === "Sequence") {
      return {
        ...expr,
        elements: insertBoundarySkips(expr.elements.map(desugarExpression)),
      };
    }
    return mapChildExpressions(expr, desugarExpression);
  };

  /**
   * A rule's top-level pattern is treated as a sequence: an actual
   * `Sequence` already carries boundary skips from `desugarExpression`,
   * while any other single expression gets wrapped in a synthetic
   * `[Skip, pattern, Skip]` sequence so every covered rule skips at its
   * own boundaries too (an entry rule `start = item` must still accept
   * leading whitespace).
   */
  const desugarPattern = (pattern: Expression): Expression => {
    const desugared = desugarExpression(pattern);
    if (desugared.type === "Sequence") {
      return desugared;
    }
    return createSequence([
      createSkip(skipRef),
      desugared,
      createSkip(skipRef),
    ]);
  };

  return {
    ...grammar,
    rules: grammar.rules.map((rule) =>
      exempt.has(rule.name)
        ? rule
        : { ...rule, pattern: desugarPattern(rule.pattern) },
    ),
  };
};
