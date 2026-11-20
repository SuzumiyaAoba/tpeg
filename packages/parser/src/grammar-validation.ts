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

import { childExpressions, forEachExpression } from "@suzumiyaaoba/tpeg-core";
import { analyzeFailureModes } from "./grammar-failure-modes";
import { ERROR_MESSAGES } from "./constants";
import {
  analyzeFirstSets,
  assertNoNullableRepetition,
  collectZeroOffsetRuleRefs,
  computeNullableRules,
  type GrammarFirstSetAnalysis,
} from "./first-sets";
import { applySkipDesugar } from "./skip-desugar";
import { findRecursiveRuleNames } from "./performance-utils";
import type {
  Expression,
  GrammarAnnotation,
  GrammarDefinition,
  RuleDefinition,
} from "./types";

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
 * is made unless the maximum is zero) and
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

/** A cut is only meaningful as a direct sibling of a non-cut sequence element. */
const containsCutOnlyPattern = (expr: Expression): boolean => {
  if (expr.type === "Cut") return true;
  if (expr.type === "Sequence") {
    const { elements } = expr;
    return (
      (elements.length > 0 &&
        elements.every((child) => child.type === "Cut")) ||
      elements.some(
        (child) => child.type !== "Cut" && containsCutOnlyPattern(child),
      )
    );
  }
  return childExpressions(expr).some(containsCutOnlyPattern);
};

/** Rule names whose pattern contains a cut-only sub-expression anywhere. */
const findCutOnlyRules = (grammar: GrammarDefinition): string[] => {
  const flagged: string[] = [];
  for (const rule of grammar.rules) {
    if (containsCutOnlyPattern(rule.pattern)) {
      flagged.push(rule.name);
    }
  }
  return flagged;
};

// ============================================================================
// Unreachable ordered-choice alternatives
// ============================================================================

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
 * one cannot fail non-fatally (see {@link analyzeFailureModes}).
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
): UnreachableAlternativesIssue[] =>
  unreachableAfterDesugaring(applySkipDesugar(grammar));

function unreachableAfterDesugaring(
  grammar: GrammarDefinition,
): UnreachableAlternativesIssue[] {
  const failureModes = analyzeFailureModes(grammar);
  const issues: UnreachableAlternativesIssue[] = [];
  for (const rule of grammar.rules) {
    forEachExpression(rule.pattern, (node) => {
      if (node.type !== "Choice") return;
      for (const [i, alternative] of node.alternatives.entries()) {
        if (i + 1 === node.alternatives.length) break;
        const cause = failureModes(alternative);
        if (cause.nonFatal) continue;
        issues.push({
          ruleName: rule.name,
          deadAlternatives: Array.from(
            { length: node.alternatives.length - i - 1 },
            (_, j) => i + j + 2,
          ),
          causeAlternative: i + 1,
          causeKind: cause.fatal ? "committed" : "infallible",
        });
        break;
      }
    });
  }
  return issues;
}

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

  // A transform receives one argument, the rule's parse result.
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

/**
 * Finds a rule's `@memoize` annotation (see `packages/parser/src/grammar.ts`'s
 * `memoizeAnnotation`), if any. If `@memoize` appears more than once on the
 * same rule, the first one wins.
 */
export const findMemoizeAnnotation = (
  rule: RuleDefinition,
): GrammarAnnotation | undefined =>
  rule.annotations?.find((a) => a.key === "memoize");

/** A bare @memoize has unlimited capacity. A numeric capacity must be exact. */
export function memoizeCapacity(annotation: GrammarAnnotation): number {
  if (annotation.value === "") return Infinity;
  const capacity = Number(annotation.value);
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 0 ||
    !/^\d+$/.test(annotation.value)
  ) {
    throw new Error(
      `Invalid @memoize capacity "${annotation.value}": expected a non-negative safe integer`,
    );
  }
  return capacity;
}

/** Validate names, annotations, transforms and cut placement before rewriting the source. */
export const validateGrammarDeclarations = (
  grammar: GrammarDefinition,
): void => {
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

  for (const rule of grammar.rules) {
    const annotation = findMemoizeAnnotation(rule);
    if (annotation) memoizeCapacity(annotation);
  }

  const cutOnly = findCutOnlyRules(grammar);
  if (cutOnly.length > 0) {
    throw new Error(
      `${ERROR_MESSAGES.CUT_ONLY_PATTERN} (rule(s): ${cutOnly.join(", ")}) -- \`~\` only has meaning as one of several elements of a sequence (e.g. "a" ~ "b"); a rule, group, choice alternative, or repetition/lookahead body made up of nothing but \`~\` doesn't match anything.`,
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

  assertValidTransformFunctionNames(grammar);
};

function validatedGrammar(source: GrammarDefinition): GrammarDefinition {
  validateGrammarDeclarations(source);
  const grammar = applySkipDesugar(source);
  const leftRecursive = findLeftRecursiveRules(grammar);
  if (leftRecursive.length > 0) {
    throw new Error(
      `Left-recursive rule(s): ${leftRecursive.join(", ")} -- a PEG parser cannot recognize left recursion at runtime; it re-invokes the same rule at the same position without consuming any input first, until the call stack overflows. Rewrite using repetition instead of left-recursive self-reference (e.g. "expr = expr op term / term" becomes "expr = term (op term)*").`,
    );
  }

  const unreachable = unreachableAfterDesugaring(grammar);
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

  return grammar;
}

/** Validate the grammar with the same control flow that will run in the parser. */
export const validateGrammar = (source: GrammarDefinition): void => {
  validatedGrammar(source);
};

/** Validate the source, expand @skip, and analyze the grammar that generators emit. */
export function prepareGrammarForGeneration(source: GrammarDefinition): {
  grammar: GrammarDefinition;
  firstSets: GrammarFirstSetAnalysis;
} {
  const grammar = validatedGrammar(source);
  const firstSets = analyzeFirstSets(grammar);
  assertNoNullableRepetition(grammar, firstSets);
  return { grammar, firstSets };
}

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
  "__current",
  "__next",
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
  /** True when generated infrastructure accesses standard objects through
   * globalThis. Only then must a rule's emitted binding avoid that name. */
  requiresGlobalThis?: boolean;
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
    if (options.requiresGlobalThis && emittedName === "globalThis") {
      throw new Error(
        `Rule name "${rule.name}" generates to "globalThis", which shadows the global object needed by generated transform diagnostics or monitoring -- rename the rule${options.namePrefix ? "" : " (or pass a --name-prefix)"}.`,
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
      // not cover labels -- see above), but $$ denotes the action's
      // aggregate capture value. `const { $$ } = ($$ ?? {})` would read
      // its own uninitialized binding instead of that aggregate. Reachable
      // only from a hand-built AST (the grammar parser's identifier rule
      // can't produce a `$`).
      if (label === "$$") {
        throw new Error(
          `Rule "${rule.name}" has a capture label named "$$", which is reserved for the action's aggregate capture value -- its \`const { $$ } = ($$ ?? {})\` destructure would read an uninitialized binding. Rename the label.`,
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
