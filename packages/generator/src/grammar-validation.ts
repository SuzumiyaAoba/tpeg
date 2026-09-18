/**
 * Grammar-level structural validation for `tpeg-generator`'s Eta-based
 * code generator (`eta-generator.ts`).
 *
 * This used to be a ~450-line hand-maintained duplicate of the checks in
 * `packages/parser/src/grammar-validation.ts` and `first-sets.ts`
 * (duplicate rule names, `QualifiedIdentifier`/local-rule-name
 * collisions, left recursion, cut-only patterns, unbounded repetition
 * over a nullable body), kept in sync "by hand" with no automated check.
 * That arrangement had already produced drift once (the duplicated
 * `ActionExpression` dependency-walk gap documented in this package's
 * `performance-utils.ts`), and produced it again when `tpeg-parser`'s
 * copies moved to linear-time graph algorithms (a Tarjan SCC pass for
 * left recursion, worklist fixpoints for nullability) while the
 * duplicates here still carried the original O(rules x edges)
 * per-rule-reachability and full-rescan-fixpoint implementations --
 * quadratic on a long rule-reference chain, on a code path
 * `generateGrammar` runs unconditionally before generating anything.
 *
 * `tpeg-generator` already depends on `tpeg-parser` (see this package's
 * `package.json` -- added so `eta-generator.ts` could share
 * `codegen.ts`'s identifier-resolution/escaping/action-wrapping building
 * blocks, and `validateGeneratedIdentifiers`, after earlier copies of
 * THOSE were found to have drifted the same way), so this module now
 * delegates to `tpeg-parser`'s implementations directly -- the same
 * `validateGrammar` + `assertNoNullableRepetition` pair
 * `packages/parser/src/codegen.ts` runs, in the same order -- rather
 * than keeping a third copy that can silently fall behind again.
 *
 * One deliberate consequence: the nullable-repetition check now runs
 * AFTER `validateGrammar`'s transform-function-name check (that check
 * lives inside `validateGrammar`), where the old local copy ran it
 * before. Only which error is reported FIRST changes when a single
 * grammar violates both categories at once; both are still rejections
 * either way.
 */

import type { GrammarDefinition } from "@suzumiyaaoba/tpeg-core";
import {
  analyzeFirstSets,
  assertNoNullableRepetition,
  validateGrammar,
} from "@suzumiyaaoba/tpeg-parser";

/**
 * Validates `grammar` for structural problems that have no well-defined
 * PEG semantics, throwing on the first category found -- identical to
 * what `tpeg-parser`'s own generators run (`codegen.ts` and
 * `codegen-optimized.ts`): duplicate rule names, a `QualifiedIdentifier`
 * whose `module` part collides with a locally-declared rule name, left
 * recursion (direct, indirect, or hidden behind a nullable prefix), a
 * cut-only pattern (`~` on its own, matching nothing), invalid transform
 * function names, or an unbounded repetition over a nullable body.
 * Called by `generateGrammar` (`eta-generator.ts`) before generating any
 * code. Deliberately does NOT reject a bare `Identifier` referencing
 * something outside this grammar's own rules -- that's the documented
 * escape hatch for binding a hand-written parser into generated code
 * (`generateIdentifierCode`, `packages/parser/src/codegen.ts`).
 *
 * @throws {Error} on the first validation failure found.
 */
export const validateGrammarForEtaGenerator = (
  grammar: GrammarDefinition,
): void => {
  validateGrammar(grammar);
  assertNoNullableRepetition(grammar, analyzeFirstSets(grammar));
};
