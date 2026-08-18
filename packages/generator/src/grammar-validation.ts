/**
 * Grammar-level structural validation for `tpeg-generator`'s Eta-based
 * code generator (`eta-generator.ts`).
 *
 * ## Why this is a DUPLICATE of `packages/parser/src/grammar-validation.ts`
 * and `first-sets.ts`'s nullability machinery, not a shared import
 *
 * `tpeg-generator` has no dependency on `tpeg-parser` (see this package's
 * `package.json` and the dependency graph in the repo root `CLAUDE.md`),
 * and `packages/cli/src/cli.ts` generates code via `tpeg-parser`'s
 * `generateTypeScriptParser`/`generateOptimizedTypeScriptParser` directly,
 * not via this Eta-based generator -- so the `tpeg` CLI never exercises
 * this file's own path. Before this file existed, `generateGrammar` below
 * ran no structural validation at all: a duplicate rule name would make
 * an equivalent FIRST-set-style analysis oscillate (not applicable to the
 * Eta generator's own simpler code paths today, but see the sibling
 * module's doc comment for the general hazard), a left-recursive grammar
 * would compile to a parser that stack-overflows at runtime instead of
 * failing at generation time, and an unbounded repetition over a nullable
 * body (`("a"?)*`) would compile to a parser that throws an infinite-loop
 * error at RUNTIME on any input reaching that rule, rather than being
 * rejected up front the same way `tpeg-parser`'s two generators already
 * reject it.
 *
 * Porting or sharing this properly needs a package-boundary decision
 * (add a `tpeg-parser` dependency to `tpeg-generator`, or hoist the
 * shared analysis into `tpeg-core`, which currently has none of this),
 * not a same-file patch -- see `shouldMemoize`'s doc comment in
 * `eta-generator.ts` for an identical judgment call already made for a
 * different piece of `tpeg-parser`-only analysis. This file duplicates
 * only the minimum needed to reject the three grammar shapes above at
 * generation time: it deliberately does NOT port `tpeg-parser`'s full
 * FIRST-set analysis (`first-sets.ts`'s `analyzeFirstSets`,
 * `predictiveChoice` filter derivation, etc.) -- none of that is needed
 * for validation, only for `tpeg-parser`'s optimizing codegen path, which
 * this generator doesn't have.
 *
 * Keep this in sync BY HAND with `packages/parser/src/grammar-validation.ts`
 * and the nullability half of `packages/parser/src/first-sets.ts` if either
 * changes; there is no automated check tying the two together.
 */

import type { Expression, GrammarDefinition } from "@suzumiyaaoba/tpeg-core";

// --- Nullability (ported from `packages/parser/src/first-sets.ts`'s
// `isNullableUncached`/`computeNullableRules` -- see that module's doc
// comment for the full rationale; only the subset needed by the two
// checks below is reproduced here) --------------------------------------

const isNullableUncached = (
  expr: Expression,
  nullableRules: ReadonlyMap<string, boolean>,
): boolean => {
  switch (expr.type) {
    case "StringLiteral":
      return expr.value === "";
    case "CharacterClass":
      return false;
    case "AnyChar":
      return false;
    case "Identifier":
      return nullableRules.get(expr.name) ?? true;
    case "QualifiedIdentifier":
      return true;
    case "Sequence":
      return expr.elements.every((el) => isNullableUncached(el, nullableRules));
    case "Choice":
      return expr.alternatives.some((alt) =>
        isNullableUncached(alt, nullableRules),
      );
    case "Group":
      return isNullableUncached(expr.expression, nullableRules);
    case "Star":
    case "Optional":
      return true;
    case "Plus":
      return isNullableUncached(expr.expression, nullableRules);
    case "Quantified":
      return (
        expr.min === 0 || isNullableUncached(expr.expression, nullableRules)
      );
    case "PositiveLookahead":
    case "NegativeLookahead":
      return true;
    case "Cut":
      return true;
    case "LabeledExpression":
    case "ActionExpression":
      return isNullableUncached(expr.expression, nullableRules);
    default:
      return true;
  }
};

/** Rule-name -> "might match zero characters" fixpoint. Monotone
 * (`false -> true` only), so safe even on a grammar with duplicate rule
 * names -- whichever declaration sets a shared entry `true` first, it
 * stays `true`. */
const computeNullableRules = (
  grammar: GrammarDefinition,
): Map<string, boolean> => {
  const nullable = new Map<string, boolean>(
    grammar.rules.map((r) => [r.name, false]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of grammar.rules) {
      if (nullable.get(rule.name)) continue;
      if (isNullableUncached(rule.pattern, nullable)) {
        nullable.set(rule.name, true);
        changed = true;
      }
    }
  }
  return nullable;
};

// --- Duplicate rule names -----------------------------------------------

const findDuplicateRuleNames = (grammar: GrammarDefinition): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const rule of grammar.rules) {
    if (seen.has(rule.name)) duplicates.add(rule.name);
    seen.add(rule.name);
  }
  return [...duplicates].sort();
};

// --- QualifiedIdentifier / local-rule-name collisions (ported from
// `grammar-validation.ts`'s
// `collectQualifiedIdentifierCollisions`/`findQualifiedIdentifierCollisions`)
// -------------------------------------------------------------------------
//
// Deliberately does NOT flag a bare `Identifier` referencing something
// outside this grammar's own rules -- `generateIdentifier` below (mirroring
// `packages/parser/src/codegen.ts`'s `generateIdentifierCode`) treats an
// unresolved `Identifier` as an intentional escape hatch for binding a
// hand-written parser into generated code, falling through to `return
// name;` rather than an error. Only a `QualifiedIdentifier` whose `module`
// part collides with a rule actually declared in this grammar is checked
// -- that node type is never used for the external-binding escape hatch
// (see its own doc comment in `packages/parser/src/types.ts`), so this
// narrower check has no legitimate use to break.

interface QualifiedIdentifierCollision {
  readonly ruleName: string;
  readonly refersTo: string;
}

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
      return;
  }
};

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

// --- Left recursion (ported from `grammar-validation.ts`'s
// `zeroOffsetRuleRefs`/`findLeftRecursiveRules`) --------------------------

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
        if (!isNullableUncached(el, nullableRules)) break;
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
      return new Set();
  }
};

const findLeftRecursiveRules = (grammar: GrammarDefinition): string[] => {
  const nullableRules = computeNullableRules(grammar);
  const graph = new Map<string, ReadonlySet<string>>();
  for (const rule of grammar.rules) {
    graph.set(rule.name, zeroOffsetRuleRefs(rule.pattern, nullableRules));
  }

  const recursive = new Set<string>();
  for (const start of graph.keys()) {
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

// --- Cut-only patterns (ported from `grammar-validation.ts`'s
// `isCutOnlyPattern`/`containsCutOnlyPattern`/`findCutOnlyRules`) --------

const isCutOnlyPattern = (expr: Expression): boolean =>
  expr.type === "Cut" ||
  (expr.type === "Sequence" &&
    expr.elements.length > 0 &&
    expr.elements.every((el) => el.type === "Cut"));

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

const findCutOnlyRules = (grammar: GrammarDefinition): string[] => {
  const flagged: string[] = [];
  for (const rule of grammar.rules) {
    if (containsCutOnlyPattern(rule.pattern, "other")) {
      flagged.push(rule.name);
    }
  }
  return flagged;
};

// --- Unbounded repetition over a nullable body (ported from
// `first-sets.ts`'s `collectNullableRepetitions`/`assertNoNullableRepetition`,
// minus the FIRST-set analysis neither check actually needs) ------------

interface NullableRepetitionIssue {
  readonly ruleName: string;
  readonly nodeType: "Star" | "Plus" | "Quantified";
}

const collectNullableRepetitions = (
  expr: Expression,
  ruleName: string,
  nullableRules: ReadonlyMap<string, boolean>,
  issues: NullableRepetitionIssue[],
): void => {
  switch (expr.type) {
    case "Star":
    case "Plus":
      if (isNullableUncached(expr.expression, nullableRules)) {
        issues.push({ ruleName, nodeType: expr.type });
      }
      collectNullableRepetitions(
        expr.expression,
        ruleName,
        nullableRules,
        issues,
      );
      return;
    case "Quantified":
      if (
        expr.max === undefined &&
        isNullableUncached(expr.expression, nullableRules)
      ) {
        issues.push({ ruleName, nodeType: "Quantified" });
      }
      collectNullableRepetitions(
        expr.expression,
        ruleName,
        nullableRules,
        issues,
      );
      return;
    case "Sequence":
      for (const element of expr.elements) {
        collectNullableRepetitions(element, ruleName, nullableRules, issues);
      }
      return;
    case "Choice":
      for (const alt of expr.alternatives) {
        collectNullableRepetitions(alt, ruleName, nullableRules, issues);
      }
      return;
    case "Group":
    case "Optional":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "LabeledExpression":
    case "ActionExpression":
      collectNullableRepetitions(
        expr.expression,
        ruleName,
        nullableRules,
        issues,
      );
      return;
    default:
      return;
  }
};

const findNullableRepetitions = (
  grammar: GrammarDefinition,
  nullableRules: ReadonlyMap<string, boolean>,
): NullableRepetitionIssue[] => {
  const issues: NullableRepetitionIssue[] = [];
  for (const rule of grammar.rules) {
    collectNullableRepetitions(rule.pattern, rule.name, nullableRules, issues);
  }
  return issues;
};

/**
 * Validates `grammar` for the same structural problems
 * `packages/parser/src/grammar-validation.ts`'s `validateGrammar` and
 * `packages/parser/src/first-sets.ts`'s `assertNoNullableRepetition`
 * reject, throwing on the first category found: duplicate rule names, a
 * `QualifiedIdentifier` whose `module` part collides with a
 * locally-declared rule name, left recursion (direct, indirect, or
 * hidden behind a nullable prefix), a cut-only pattern (`~` on its own,
 * matching nothing), or an unbounded repetition over a nullable body.
 * Called by `generateGrammar` (`eta-generator.ts`) before generating any
 * code. Deliberately does NOT reject a bare `Identifier` referencing
 * something outside this grammar's own rules -- see
 * `collectQualifiedIdentifierCollisions`'s doc comment for why.
 *
 * @throws {Error} on the first validation failure found, in the order
 *   listed above.
 */
export const validateGrammarForEtaGenerator = (
  grammar: GrammarDefinition,
): void => {
  const duplicates = findDuplicateRuleNames(grammar);
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate rule definition: ${duplicates.join(", ")} -- each rule name must be declared exactly once.`,
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
    throw new Error(`Reference to an undefined rule: ${details}`);
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
      `\`~\` cannot be a rule body (or sub-expression) on its own (rule(s): ${cutOnly.join(", ")}) -- \`~\` only has meaning as one of several elements of a sequence (e.g. "a" ~ "b"); a rule, group, choice alternative, or repetition/lookahead body made up of nothing but \`~\` doesn't match anything.`,
    );
  }

  const nullableRules = computeNullableRules(grammar);
  const nullableRepetitions = findNullableRepetitions(grammar, nullableRules);
  if (nullableRepetitions.length > 0) {
    const description = nullableRepetitions
      .map(
        (issue) =>
          `rule '${issue.ruleName}': ${issue.nodeType} over a nullable expression`,
      )
      .join("; ");
    throw new Error(
      `Grammar contains unbounded repetition over a nullable (possibly zero-width) expression -- this has no well-defined PEG semantics, since the repetition could succeed without ever consuming input: ${description}`,
    );
  }
};
