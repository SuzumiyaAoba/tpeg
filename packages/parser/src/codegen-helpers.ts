export {
  collectTopLevelLabels,
  collectRequiredTopLevelLabels,
} from "@suzumiyaaoba/tpeg-core";
import {
  analyzeSequenceValues,
  childExpressions,
  escapeStringLiteral,
  selectTransformSets,
  someExpression,
} from "@suzumiyaaoba/tpeg-core";
import { codeContainsIdentifier } from "./brace-scanner";
import {
  memoizeCapacity,
  findExternalIdentifierReferences,
  findQualifiedIdentifierReferences,
} from "./grammar-validation";
import type {
  CharacterClass,
  Choice,
  Expression,
  GrammarAnnotation,
  GrammarDefinition,
  Identifier,
  QualifiedIdentifier,
  Quantified,
  Sequence,
  TransformFunction,
} from "./types";

/** Identity string transform, the default `intern` for the leaf-generation
 * helpers below when a caller (codegen.ts itself) has no string-interning
 * table to route through. */
const identity = (s: string): string => s;

/**
 * Builds a rule-name -> TransformFunction lookup for the TypeScript-targeted
 * transform set on a grammar. If more than one TypeScript transform set is
 * present, the first one (in declaration order) wins.
 */
export const collectTransformFunctions = (
  grammar: GrammarDefinition,
): Map<string, TransformFunction> => {
  const functions =
    selectTransformSets(grammar).get("typescript")?.functions ?? [];
  return new Map(functions.map((fn) => [fn.name, fn]));
};

export { findMemoizeAnnotation } from "./grammar-validation";

/**
 * Wraps `parserCode` in a `memoize(...)` call (`@suzumiyaaoba/tpeg-combinator`)
 * per `annotation`'s value: a bare `@memoize` (empty value) memoizes with an
 * unbounded cache, while `@memoize: N` passes `{ maxCacheSize: N }` so the
 * generated rule's memo table never tracks more than N cached positions at
 * once (packages/combinator/src/logic.ts's `memoize` bounds cached
 * positions *for the input currently being parsed*, not across inputs).
 */
export const wrapWithMemoize = (
  parserCode: string,
  annotation: GrammarAnnotation,
): string => {
  const capacity = memoizeCapacity(annotation);
  return capacity === Infinity
    ? `memoize(${parserCode})`
    : `memoize(${parserCode}, { maxCacheSize: ${capacity} })`;
};

/**
 * Wraps a rule's generated parser expression so that, on a successful parse,
 * the matching TypeScript transform function's body runs against the parse
 * result (the rule's capture structure) and its Result<T> return value
 * becomes the parser's own success/failure outcome. Snapshot the positions
 * and read the input value once before invoking user code so result reuse
 * cannot change consumption or replace the value in rejection diagnostics.
 */
export const wrapWithTransform = (
  ruleName: string,
  parserCode: string,
  transformFn: TransformFunction,
  includeTypes = false,
): string => {
  const paramName = transformFn.parameters[0]?.name ?? "captures";
  // Keep the capture binding even when only dynamically referenced by
  // authored code. A harmless read satisfies noUnusedParameters in typed
  // output without changing the function's scope or invocation arguments.
  const parameterUse =
    includeTypes && !codeContainsIdentifier(transformFn.body, paramName)
      ? `    void ${paramName};\n`
      : "";
  return `(input${includeTypes ? ": string" : ""}, pos${includeTypes ? ": number" : ""})${includeTypes ? ": ReturnType<Parser<any>>" : ""} => {
  const __base = (${parserCode});
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const { current: __current, next: __next } = __result;
  const __val = __result.val;
  const __transformed${includeTypes ? ": any" : ""} = ((${paramName}${includeTypes ? ": any" : ""}) => {
${parameterUse}${transformFn.body}
  })(__val);
  if (!__transformed.success) {
    let __found${includeTypes ? ": string | undefined" : ""};
    try {
      __found = globalThis.JSON.stringify(__val);
    } catch {
      __found = "<unserializable value>";
    }
    return {
      success: false,
      error: {
        message: __transformed.error ?? "Transform failed",
        pos: __current,
        parserName: "${ruleName}",
        expected: "successful transform",
        ...(__found === void 0 ? {} : { found: __found }),
      },
    };
  }
  return {
    success: true,
    val: __transformed.value,
    current: __current,
    next: __next,
  };
}`;
};

/**
 * Wraps a rule's generated parser expression so every invocation is timed
 * by a `performanceMonitor` object (the one `generateMonitoringCode` emits
 * for `includeMonitoring`, or `globalPerformanceMonitor` in the Eta
 * generator's output). The inner expression is evaluated ONCE inside an
 * IIFE -- not per call -- so a `memoize(...)` inside `parserCode` keeps its
 * memo table across invocations instead of being rebuilt on every call.
 * Parameter types are emitted only under `includeTypes` -- matching
 * `wrapWithAction`'s `$$: any` convention -- so the `includeTypes: false`
 * output stays plain JavaScript (safe to run via `new Function` without a
 * transpile step).
 */
export const wrapWithMonitoring = (
  ruleName: string,
  parserCode: string,
  monitorObject = "performanceMonitor",
  includeTypes = true,
): string => `(() => {
  const __monitored = (${parserCode});
  return (input${includeTypes ? ": string" : ""}, pos${includeTypes ? ": number" : ""}) => {
    ${monitorObject}.start(${JSON.stringify(ruleName)});
    try {
      return __monitored(input, pos);
    } finally {
      ${monitorObject}.end(${JSON.stringify(ruleName)});
    }
  };
})()`;

/**
 * Does `expr` contain a `Cut` marked `global: true` (by `promoteGlobalCuts`,
 * `packages/parser/src/ast-optimize.ts`) in a position where
 * `generateSequence`/`generateOptimizedSequence` will actually emit a
 * `commitAtTopLevel(...)` call for it? Used to decide whether
 * `commitAtTopLevel` (`@suzumiyaaoba/tpeg-combinator`) needs importing
 * beyond the existing start-rule-top-level-Sequence case this module
 * already handles.
 *
 * A `global: true` `Cut` alone is NOT enough: both sequence generators
 * only wrap elements AFTER a `Cut` in `commitAtTopLevel(...)`/`commit(...)`
 * -- a `Cut` with nothing non-`Cut` after it in its own `Sequence` (a
 * trailing `~`, e.g. hand-written `"a" ~` promoted to global) contributes
 * no `commitAtTopLevel(...)` call to the generated code at all, so
 * treating "a global Cut exists somewhere" as sufficient left an unused
 * import behind for that shape -- the same class of bug the ordinary
 * (non-global) `commit` import check below was already fixed for.
 */
const containsGlobalCut = (expr: Expression): boolean => {
  switch (expr.type) {
    case "Cut":
      // A bare Cut reached directly (not via the Sequence case below,
      // which is the only place that can tell whether a following
      // element exists) has nothing after it either way.
      return false;
    case "Sequence": {
      // Uses the same commit state machine as `generateSequence` (see
      // `forEachSequenceElement`): only the MOST RECENT `Cut` before an
      // element decides whether that element gets wrapped in
      // `commitAtTopLevel(...)` -- matters when a `Sequence` somehow
      // carries more than one `Cut`.
      let found = false;
      forEachSequenceElement(expr.elements, (el, committed, cutIsGlobal) => {
        if ((committed && cutIsGlobal) || containsGlobalCut(el)) {
          found = true;
          return true;
        }
        return undefined;
      });
      return found;
    }
    default:
      // Every other node type has no position-sensitive semantics here:
      // just recurse into whatever children it has.
      return childExpressions(expr).some(containsGlobalCut);
  }
};

/** Does any rule in `grammar` contain a `Cut` marked `global: true`?
 * Exported for reuse by `codegen-optimized.ts`, which needs the identical
 * check. */
export const grammarHasGlobalCut = (grammar: GrammarDefinition): boolean =>
  grammar.rules.some((rule) => containsGlobalCut(rule.pattern));

/**
 * Iterates the non-`Cut` elements of a `Sequence`, tracking the commit
 * state machine `generateSequence`/`generateOptimizedSequence` use to
 * decide each element's `commit(...)`/`commitAtTopLevel(...)` wrapper:
 * `committed` becomes true at the first `Cut`, and `cutIsGlobal` is
 * REASSIGNED (not OR'd) at each `Cut`, so only the MOST RECENT `Cut`
 * before an element decides its wrapper. The callback may return `true`
 * to stop the iteration early. Shared by every site that must mirror
 * that state machine exactly (the sequence generators, the
 * `collectUsedCombinators` import scans, and the `containsGlobalCut`/
 * `sequenceHasCutFollowedByElement` predicates) so they can never
 * disagree about which wrapper -- if any -- a given element gets.
 */
export const forEachSequenceElement = (
  elements: readonly Expression[],
  onElement: (
    element: Expression,
    committed: boolean,
    cutIsGlobal: boolean,
  ) => boolean | void,
): void => {
  let committed = false;
  let committingCutIsGlobal = false;
  for (const el of elements) {
    if (el.type === "Cut") {
      committed = true;
      committingCutIsGlobal = el.global === true;
      continue;
    }
    if (onElement(el, committed, committingCutIsGlobal) === true) return;
  }
};

/**
 * `true` iff `elements` (a `Sequence`'s own elements) contains a `Cut`
 * with at least one non-`Cut` element after it -- i.e. the shape
 * `generateSequence`/`generateOptimizedSequence` actually emits a
 * `commit(...)`/`commitAtTopLevel(...)` call for. Used at the
 * start-rule-top-level-Sequence check (where every `Cut`, global or not,
 * gets wrapped in `commitAtTopLevel(...)` because `isStartRuleTopLevel`
 * is true) instead of a bare "does a Cut exist" test, which -- for a
 * trailing `~` with nothing after it -- would add the `commitAtTopLevel`
 * import for a call that's never actually generated. Exported for reuse
 * by `codegen-optimized.ts`, which needs the identical check.
 */
export const sequenceHasCutFollowedByElement = (
  elements: readonly Expression[],
): boolean => {
  let found = false;
  forEachSequenceElement(elements, (_el, committed) => {
    if (committed) {
      found = true;
      return true;
    }
    return undefined;
  });
  return found;
};

/** The same sequence shape determines the emitted call and its required imports. */
function sequenceShape(expr: Sequence): {
  combinator: "sequence" | "captureSequence" | null;
  unwrapSingleValue: boolean;
} {
  const { hasLabels, valueCount, hasSkip } = analyzeSequenceValues(expr);
  if (hasLabels)
    return { combinator: "captureSequence", unwrapSingleValue: false };
  // A skip consumes input and contributes no value. A sole visible value
  // stays scalar even when a surrounding sequence must run the skips.
  return {
    combinator: valueCount === 1 && !hasSkip ? null : "sequence",
    unwrapSingleValue: valueCount === 1 && hasSkip,
  };
}

/** Returns the outer sequence combinator, or null for a bare child. */
export const sequenceCombinatorFor = (
  expr: Sequence,
): "sequence" | "captureSequence" | null => sequenceShape(expr).combinator;

type CutMode = "local" | "promoted" | "topLevel";

const commitForCut = (mode: CutMode, global: boolean) =>
  mode === "topLevel" || (mode === "promoted" && global)
    ? "commitAtTopLevel"
    : "commit";

/**
 * Emit the children of a sequence in source order. Each cut commits its
 * following children individually so their captures keep their positions.
 * Promoted cuts and cuts at an unreferenced start rule's top level may
 * discard unreachable memo entries. Eta uses local commits throughout.
 */
export function generateSequenceCode(
  expr: Sequence,
  generateElement: (element: Expression) => string,
  cutMode: CutMode = "local",
): string {
  const { combinator, unwrapSingleValue } = sequenceShape(expr);
  const parts: string[] = [];
  forEachSequenceElement(expr.elements, (element, committed, global) => {
    const code = generateElement(element);
    parts.push(committed ? `${commitForCut(cutMode, global)}(${code})` : code);
  });
  if (combinator === null) return parts[0]!;
  const call = `${combinator}(${parts.join(", ")})`;
  return unwrapSingleValue ? `map(${call}, ([v]) => v)` : call;
}

/**
 * `true` iff `generateSequence`/`generateOptimizedSequence` emit an
 * ordinary `commit(...)` (tpeg-core) call anywhere in this `Sequence` --
 * i.e. some non-`Cut` element follows a `Cut` that is neither at the
 * start rule's top level (where `commitAtTopLevel` is emitted instead)
 * nor marked `global: true`. A `Cut` with nothing non-`Cut` after it
 * (e.g. a trailing `~`) contributes no `commit` call at all. Shared by
 * both generators' `collectUsedCombinators` so the tpeg-core `commit`
 * import is added exactly when generated code uses it.
 */
export const sequenceNeedsOrdinaryCommit = (
  expr: Sequence,
  isStartRuleTopLevel: boolean,
): boolean => {
  const mode = isStartRuleTopLevel ? "topLevel" : "promoted";
  let needs = false;
  forEachSequenceElement(expr.elements, (_el, committed, cutIsGlobal) => {
    if (committed && commitForCut(mode, cutIsGlobal) === "commit") {
      needs = true;
      return true;
    }
    return undefined;
  });
  return needs;
};

/**
 * The combinator name `generateQuantifiedCode` emits for `expr`, plus
 * whether the wrapped expression is still generated as ordinary code
 * (`false` when the whole node collapses into a `charClassRun` call that
 * embeds the CharacterClass's ranges directly -- recursing then would
 * also add an unused `charClass`/`negatedCharClass` import). Mirrors
 * `generateQuantifiedCode`'s branches exactly, including the same
 * `tryGenerateCharClassRunCode` calls, so the import decision and the
 * codegen decision can never disagree. Shared by every
 * `collectUsedCombinators`.
 */
export const quantifiedCombinatorFor = (
  expr: Quantified,
  enableCharClassRun: boolean,
): {
  combinator: "charClassRun" | "quantified" | "zeroOrMore" | "oneOrMore";
  recurse: boolean;
} => {
  if (expr.max === undefined) {
    if (expr.min === 0 || expr.min === 1) {
      if (
        enableCharClassRun &&
        tryGenerateCharClassRunCode(expr.expression, expr.min) !== null
      ) {
        return { combinator: "charClassRun", recurse: false };
      }
      return {
        combinator: expr.min === 0 ? "zeroOrMore" : "oneOrMore",
        recurse: true,
      };
    }
    return { combinator: "quantified", recurse: true };
  }
  // Every bounded range -- including {0,1}, which used to lower to
  // `optional` -- is emitted as `quantified(...)` by
  // `generateQuantifiedCode` (uniform `T[]` shape across `{n,m}`).
  return { combinator: "quantified", recurse: true };
};

/**
 * Per-generator decisions the shared {@link collectUsedCombinators}
 * needs: the parts of the import scan where `codegen.ts`,
 * `codegen-optimized.ts`, and `@suzumiyaaoba/tpeg-generator`'s
 * `eta-generator.ts` legitimately differ (each mirrors its own
 * `generateXxx`), so they can share the ~90% of the walk that is
 * identical instead of hand-maintaining a third driftable copy.
 */
export interface UsedCombinatorsContext {
  /** Rule name -> declaration index (for the `lazy(() => ...)` check). */
  readonly ruleIndex: ReadonlyMap<string, number>;
  /** Declaration index of the rule currently being generated. */
  readonly currentRuleIndex: number;
  /** Mirrors the generator's own `enableCharClassRun` option. */
  readonly enableCharClassRun: boolean;
  /**
   * `true` when the generator wraps every element after ANY `Cut` in
   * `commit(...)` (eta-generator, which never emits `commitAtTopLevel`);
   * `false` when only non-top-level, non-`global` cuts produce ordinary
   * `commit` calls (`codegen.ts`/`codegen-optimized.ts`, via
   * `sequenceNeedsOrdinaryCommit`).
   */
  readonly commitAfterAnyCut: boolean;
  /**
   * The combinator name a `Choice` is emitted through, or `null` when
   * the generator returns it bare / emits nothing (eta and
   * codegen-optimized's single-alternative shortcuts). Base
   * `codegen.ts` always emits `choice(...)`, even for one alternative.
   */
  readonly choiceCombinatorFor: (
    expr: Choice,
  ) => "choice" | "predictiveChoice" | null;
  /**
   * Generator-specific node hook consulted BEFORE the standard switch:
   * return `true` when the node was fully handled (e.g.
   * codegen-optimized's fusion roots, which emit `regexFusedMap` and
   * never recurse). Consulted at every recursion level.
   */
  readonly handled?: (expr: Expression, combinators: Set<string>) => boolean;
}

/**
 * Collects every combinator the generated code for `expr` needs
 * imported, mirroring each generator's `generateXxx` decisions through
 * `ctx` (see {@link UsedCombinatorsContext}). `isStartRuleTopLevel`
 * mirrors `generateExpression`'s flag of the same shape: `true` only
 * for the single top-level call on the start rule's own pattern, never
 * forwarded to recursive calls -- when a `Sequence` with that flag set
 * contains a `Cut`, `commitAtTopLevel` is emitted there instead of
 * `commit`, so `commit` must not be added to the tpeg-core import set.
 *
 * Previously triplicated across `codegen.ts`, `codegen-optimized.ts`,
 * and `eta-generator.ts` -- three ~200-line switches whose per-node
 * decisions had already drifted once (unused `commit`/`sequence`/
 * `quantified` imports are `noUnusedLocals` errors in generated code,
 * and `eta-generator`'s copy never learned the `charClassRun` or
 * single-alternative-`Choice` subtleties until they were ported by
 * hand). The differences between the three are real -- they mirror
 * genuinely different `generateXxx` methods -- so they live in `ctx`
 * rather than being picked by inspecting the caller.
 */
export const collectUsedCombinators = (
  expr: Expression,
  combinators: Set<string>,
  ctx: UsedCombinatorsContext,
  isStartRuleTopLevel = false,
): void => {
  if (ctx.handled?.(expr, combinators)) {
    return;
  }
  const recurse = (e: Expression): void => {
    collectUsedCombinators(e, combinators, ctx);
  };
  switch (expr.type) {
    case "StringLiteral":
      if (expr.value.length === 0) {
        combinators.add("map");
        combinators.add("sequence");
      } else {
        combinators.add("literal");
      }
      break;
    case "CharacterClass":
      combinators.add(expr.negated ? "negatedCharClass" : "charClass");
      break;
    case "AnyChar":
      combinators.add("anyChar");
      break;
    case "Identifier": {
      // Mirrors `generateIdentifierCode`'s decision: a
      // forward/self/mutual reference is generated as
      // `lazy(() => name)`, which needs the import.
      const targetIndex = ctx.ruleIndex.get(expr.name);
      if (targetIndex !== undefined && targetIndex >= ctx.currentRuleIndex) {
        combinators.add("lazy");
      }
      break;
    }
    case "Sequence": {
      const { combinator, unwrapSingleValue } = sequenceShape(expr);
      if (combinator) combinators.add(combinator);
      if (unwrapSingleValue) combinators.add("map");
      const needsCommit = ctx.commitAfterAnyCut
        ? sequenceHasCutFollowedByElement(expr.elements)
        : sequenceNeedsOrdinaryCommit(expr, isStartRuleTopLevel);
      if (needsCommit) {
        combinators.add("commit");
      }
      for (const element of expr.elements) {
        if (element.type !== "Cut") {
          recurse(element);
        }
      }
      break;
    }
    case "Choice": {
      const choiceCombinator = ctx.choiceCombinatorFor(expr);
      if (choiceCombinator !== null) {
        combinators.add(choiceCombinator);
      }
      for (const alternative of expr.alternatives) {
        recurse(alternative);
      }
      break;
    }
    case "Star":
      if (
        ctx.enableCharClassRun &&
        tryGenerateCharClassRunCode(expr.expression, 0) !== null
      ) {
        combinators.add("charClassRun");
      } else {
        combinators.add("zeroOrMore");
        recurse(expr.expression);
      }
      break;
    case "Plus":
      if (
        ctx.enableCharClassRun &&
        tryGenerateCharClassRunCode(expr.expression, 1) !== null
      ) {
        combinators.add("charClassRun");
      } else {
        combinators.add("oneOrMore");
        recurse(expr.expression);
      }
      break;
    case "Optional":
      combinators.add("optional");
      recurse(expr.expression);
      break;
    case "PositiveLookahead":
      combinators.add("andPredicate");
      recurse(expr.expression);
      break;
    case "NegativeLookahead":
      combinators.add("notPredicate");
      recurse(expr.expression);
      break;
    case "Skip":
      // Emitted as `ignore(optional(<skipRuleRef>))` by every
      // generator's `Skip` case -- both wrappers must be imported, and
      // the reference itself recursed into for `lazy`-forward-ref
      // detection.
      combinators.add("ignore");
      combinators.add("optional");
      recurse(expr.expression);
      break;
    case "Span":
      // Emitted as `span(<child>)` by every generator's `Span` case.
      combinators.add("span");
      recurse(expr.expression);
      break;
    case "WordBoundary":
      // Emitted as the bare `wordBoundary`/`nonWordBoundary` parser
      // constant -- the right one must be imported.
      combinators.add(expr.negated ? "nonWordBoundary" : "wordBoundary");
      break;
    case "Group":
      recurse(expr.expression);
      break;
    case "LabeledExpression":
      combinators.add("capture");
      recurse(expr.expression);
      break;
    case "ActionExpression":
      recurse(expr.expression);
      break;
    case "Quantified": {
      const { combinator, recurse: rec } = quantifiedCombinatorFor(
        expr,
        ctx.enableCharClassRun,
      );
      combinators.add(combinator);
      if (rec) {
        recurse(expr.expression);
      }
      break;
    }
    case "QualifiedIdentifier":
      // Emits `module.name` directly -- no tpeg-core combinator at all
      // (see `generateQualifiedIdentifierCode`).
      break;
    case "Cut":
      break;
    default: {
      const exhaustiveCheck: never = expr;
      throw new Error(
        `Unhandled expression type: ${(exhaustiveCheck as { type: string }).type}`,
      );
    }
  }
};

/** Does `expr` contain an `Identifier`/`QualifiedIdentifier` naming
 * `ruleName` anywhere in its subtree? Used by
 * {@link isRuleReferencedAnywhere}. A `QualifiedIdentifier` can't match:
 * a cross-module reference never names a LOCAL rule -- see
 * `grammar-validation.ts`'s `collectQualifiedIdentifierCollisions`,
 * which rejects the one shape where it plausibly could (a `module` part
 * colliding with a local rule name) before codegen ever runs. */
const containsReferenceTo = (expr: Expression, ruleName: string): boolean =>
  someExpression(
    expr,
    (node) => node.type === "Identifier" && node.name === ruleName,
  );

/**
 * Is `ruleName` referenced (by a bare `Identifier`) from ANYWHERE in
 * `grammar` -- including from within the named rule's own pattern (a
 * self- or mutually-recursive reference)?
 *
 * Used to decide whether `commitAtTopLevel` is safe to emit for a `Cut`
 * that is a direct element of the grammar's start rule's own top-level
 * `Sequence` (the `@start`-resolved entry rule -- `resolveStartRule` in
 * `grammar-validation.ts`, which is what callers pass in as `ruleName`).
 * That shape alone is NOT sufficient: the
 * soundness argument (`commitAtTopLevel`'s doc comment,
 * `packages/combinator/src/logic.ts`) requires no live backtrack point
 * *anywhere above* the cut, which "direct element of the start rule's
 * top-level `Sequence`" only guarantees if the start rule is EXCLUSIVELY
 * entered as the grammar's own external entry point -- never invoked as
 * an ordinary rule reference from elsewhere in the same grammar, since
 * every `export const` this generator emits is independently callable
 * and a reference from within a `Choice` (e.g. `real = helper "x" /
 * "hz"`, where `helper` happens to be the start rule) is exactly the live
 * backtrack point the soundness argument requires there be none of. This
 * codebase's own `commitAtTopLevel` doc comment names this precisely:
 * "a cut inside a referenced rule that happens to always be invoked at
 * backtrack depth 0" is a case the general Mizushima result would handle
 * safely but this narrow, structural condition does not -- so a
 * reference from elsewhere must fall back to the ordinary, always-safe
 * `commit` instead of asserting an unverified guarantee.
 *
 * Deliberately conservative: falls back to plain `commit` (still
 * correct, just missing the `memoize`-pruning optimization
 * `commitAtTopLevel` exists for) the moment ANY reference is found,
 * including one that might itself be provably safe under the fuller
 * `promoteGlobalCuts` argument -- a grammar wanting that broader
 * treatment can opt into `promoteGlobalCuts` explicitly, which marks a
 * `Cut` `global: true` after actually proving it (see that module's own
 * doc comment); this check only protects the default, always-on
 * `isStartRuleTopLevel` path from asserting something nobody verified.
 */
export const isRuleReferencedAnywhere = (
  grammar: GrammarDefinition,
  ruleName: string,
): boolean =>
  grammar.rules.some((rule) => containsReferenceTo(rule.pattern, ruleName));

/**
 * Narrows a label list down to the ones an action's code actually mentions
 * (matched as a whole identifier token, so a label named `char` doesn't
 * false-match inside `charAt` -- and no longer false-matches inside string
 * literals, comments, or regex bodies either: `codeContainsIdentifier`
 * skips those, while still counting a label inside a `` ${ ... } ``
 * template interpolation, which is real code). An
 * unconditionally-destructured label the action ignores
 * would otherwise be a real `tsc --noEmit` failure on a saved generated file
 * under `noUnusedLocals` - never surfaced by dynamically `new Function`-eval'd
 * generated code in this package's own tests, which skips type-checking
 * entirely. A bare eval reference can access any of the bindings by a
 * computed name, so retain all labels in that case; wrapWithAction emits
 * harmless reads to satisfy typed output's noUnusedLocals check.
 */
export const filterReferencedLabels = (
  code: string,
  labels: string[],
): string[] =>
  codeContainsIdentifier(code, "eval")
    ? [...labels]
    : labels.filter((label) => codeContainsIdentifier(code, label));

/**
 * Wraps an alternative's generated parser expression so that, on a
 * successful parse, the semantic action code runs with `$$` bound to the
 * raw match value and (if the wrapped expression carries labeled captures)
 * each label destructured as its own named variable, then returns the
 * action's own return value as the parser's result. Preserve the match's
 * positions before reading its value or invoking user code: either can
 * reenter a custom parser that reuses the same result object.
 */
export const wrapWithAction = (
  parserCode: string,
  actionCode: string,
  labels: string[],
  includeTypes: boolean,
  requiredLabels: readonly string[] = [],
): string => {
  // Only declare `$$` when something can reference it - a label
  // destructure reads it, and the whole-token check covers a bare `$$` in
  // the action body (e.g. `return $$.join("")` for an unlabeled
  // expression, including one inside a `${ ... }` interpolation) WITHOUT
  // counting a `$$` inside a string literal, comment, or regex body. A bare
  // eval reference may inspect it dynamically and requires the binding too --
  // the previous substring check did, emitting an unused `const $$` that
  // fails `tsc --noEmit` under `noUnusedLocals` (see
  // `filterReferencedLabels` above, and `codeContainsIdentifier` in
  // `brace-scanner.ts` for the scanning rule). An
  // action that ignores its match entirely (e.g. `{ return { type: "X" }; }`)
  // would otherwise leave `$$` unused, which fails a real generated file's
  // own `tsc --noEmit` under `noUnusedLocals` (never surfaced by this
  // package's own tests, which execute generated code via `new Function`
  // rather than saving and compiling it as a file).
  const dynamicReferences = codeContainsIdentifier(actionCode, "eval");
  const needsCaptureValue =
    labels.length > 0 ||
    dynamicReferences ||
    codeContainsIdentifier(actionCode, "$$");
  // captureSequence()'s return type is a union of the merged capture object
  // and a positional tuple (it can't statically know which one a given call
  // produces), so an untyped $$ fails to typecheck a destructure of any
  // label below - the action's arbitrary code is untyped anyway (same as a
  // transform function body), so this is deliberate, not merely convenient.
  // Only added under `includeTypes`, matching every other type annotation
  // this generator emits: with `includeTypes: false` the output has no type
  // syntax at all (plain JS, safe to run via `new Function` without a TS
  // transpile step), so a `: any` annotation here would be the only such
  // syntax in that mode and would break exactly that use case.
  const captureBinding = needsCaptureValue
    ? `    const $$${includeTypes ? ": any" : ""} = __result.val;\n`
    : "";
  // `labels` is computed from the LABELED side of a `Choice` alternative
  // (`collectTopLevelLabels`'s `Choice` case unions every alternative's own
  // labels, per `docs/peg-grammar.md`'s "Capture Inference": `a:first /
  // b:second` -> `{a?: T1, b?: T2}`, each label OPTIONAL). Whichever
  // alternative actually matched at runtime is exactly the value in `$$` --
  // an alternative that carries none of these labels (a bare
  // `notPredicate`/`andPredicate`, an unlabeled literal, an action
  // returning `undefined`, ...) leaves `$$` as `undefined` or some
  // non-capture value. Read possibly absent labels only from own enumerable
  // fields; ordinary destructuring would expose prototype properties or
  // a string/array's length instead of undefined. Guaranteed own labels
  // retain ordinary destructuring without extra presence checks.
  const required = new Set(requiredLabels);
  const destructure =
    labels.length === 0
      ? ""
      : labels.every((label) => required.has(label))
        ? `    const { ${labels.join(", ")} } = ($$ ?? {});\n`
        : labels
            .map((label) => {
              const property = JSON.stringify(label);
              const value = `$$[${property}]`;
              // Capture fields are own enumerable properties. A fresh object
              // supplies the intrinsic without resolving a rule/label named
              // Object, globalThis, or propertyIsEnumerable. Only the selected
              // field's getter is read; strings/arrays' length is not a label.
              const read = required.has(label)
                ? value
                : `({}).propertyIsEnumerable.call($$ ?? {}, ${property}) ? ${value} : void 0`;
              return `    const ${label}${includeTypes ? ": any" : ""} = ${read};\n`;
            })
            .join("");
  // Direct eval can reference any capture, including names computed at
  // runtime. TypeScript does not count those references for noUnusedLocals.
  const dynamicBindingUses =
    includeTypes && dynamicReferences
      ? ["$$", ...labels].map((name) => `    void ${name};\n`).join("")
      : "";
  // Read the wrapper's result before entering the scope that declares
  // labels and runs authored code. Otherwise a label or a const/let/var/
  // function/class declaration named __result shadows that read.
  const scopedAction = needsCaptureValue
    ? `${captureBinding}    return (() => {
${destructure}${dynamicBindingUses}${actionCode}
    })();`
    : actionCode;
  return `(input${includeTypes ? ": string" : ""}, pos${includeTypes ? ": number" : ""})${includeTypes ? ": ReturnType<Parser<any>>" : ""} => {
  const __base = (${parserCode});
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const { current: __current, next: __next } = __result;
  const __val = (() => {
${scopedAction}
  })();
  return {
    success: true,
    val: __val,
    current: __current,
    next: __next,
  };
}`;
};

/**
 * Generates a parser for a `StringLiteral` node. Shared between
 * `codegen.ts` and `codegen-optimized.ts` (which passes `stringInterner.intern`
 * as `intern` to dedupe the escaped literal text across a grammar).
 */
export const generateStringLiteralCode = (
  value: string,
  intern: (s: string) => string = identity,
  includeTypes = false,
): string =>
  // Core's `literal` deliberately accepts only non-empty strings. An empty
  // sequence validates the position and succeeds even at EOF; mapping its
  // value preserves the grammar's exact empty-string result type.
  value.length === 0
    ? `map(sequence(), () => ""${includeTypes ? " as const" : ""})`
    : `literal("${intern(escapeStringLiteral(value))}")`;

/**
 * Renders a `CharacterClass` node's `ranges` as the comma-joined argument
 * list `charClass(...)`/`charClassRun(...)` both expect (without the
 * enclosing call) -- shared by `generateCharacterClassCode` and
 * `tryGenerateCharClassRunCode` so the two can never drift on how a
 * range/single-char spec gets escaped.
 */
const characterClassRangesCode = (expr: CharacterClass): string =>
  expr.ranges
    .map((range) =>
      // `!== undefined`, not a truthy check: a hand-built `CharRange` can
      // carry `end: ""` (`.tpeg` source never produces one), and treating
      // that as "no end" would silently emit a single-char spec instead
      // of the two-bound range `charClass`'s own construction-time
      // validation should (and does) reject.
      range.end !== undefined
        ? `["${escapeStringLiteral(range.start)}", "${escapeStringLiteral(range.end)}"]`
        : `"${escapeStringLiteral(range.start)}"`,
    )
    .join(", ");

/**
 * Generates a `charClass(...)`/`negatedCharClass(...)` call for a
 * `CharacterClass` node. Identical between the base and optimized
 * generators, so shared here rather than duplicated.
 */
export const generateCharacterClassCode = (expr: CharacterClass): string => {
  const ranges = characterClassRangesCode(expr);
  return expr.negated ? `negatedCharClass(${ranges})` : `charClass(${ranges})`;
};

/**
 * Generates a `charClassRun(...)` call (`packages/core/src/char-class.ts`)
 * collapsing a `Star`/`Plus`/`Quantified{0,}`/`Quantified{1,}` whose
 * repeated element is a bare `CharacterClass` into a single scan -- one
 * `ParseSuccess` and one exact-size array instead of the repetition
 * combinator driving `charClass`/`negatedCharClass` one character at a
 * time (see `charClassRun`'s own doc comment for why this produces the
 * EXACT same value `zeroOrMore`/`oneOrMore` over the same class would).
 *
 * Returns `null` when `inner` isn't a bare `CharacterClass` -- nothing to
 * do here, the caller falls back to generating `inner` normally and
 * wrapping it in `zeroOrMore`/`oneOrMore`. Shared between `codegen.ts`
 * and `codegen-optimized.ts`, and also consulted by both generators'
 * `collectUsedCombinators` so the import decision and the codegen
 * decision can never disagree (they call this exact function).
 */
export const tryGenerateCharClassRunCode = (
  inner: Expression,
  min: 0 | 1,
): string | null => {
  if (inner.type !== "CharacterClass") return null;
  const ranges = characterClassRangesCode(inner);
  return `charClassRun([${ranges}], ${min}${inner.negated ? ", true" : ""})`;
};

/**
 * Generates the reference expression for an `Identifier` node: either the
 * rule's own (possibly prefixed) name, a `lazy(() => ...)`-deferred lookup
 * if the referenced rule hasn't been declared yet (forward/self/mutual
 * reference - see the callers' doc comments), or the bare name for an
 * external reference. Shared between `codegen.ts` and
 * `codegen-optimized.ts` (which passes `stringInterner.intern` as `intern`).
 */
export const generateIdentifierCode = (
  expr: Identifier,
  ctx: {
    ruleNames: Set<string>;
    ruleIndex: Map<string, number>;
    currentRuleIndex: number;
    namePrefix: string;
  },
  intern: (s: string) => string = identity,
): string => {
  const name = intern(expr.name);
  if (!ctx.ruleNames.has(name)) {
    return name;
  }
  const prefixedName = intern(ctx.namePrefix + name);
  const targetIndex = ctx.ruleIndex.get(name);
  if (targetIndex !== undefined && targetIndex >= ctx.currentRuleIndex) {
    return `lazy(() => ${prefixedName})`;
  }
  return prefixedName;
};

/**
 * Generates the reference expression for a `QualifiedIdentifier` node
 * (e.g. `math.expr`, a reference to a rule exported from another module -
 * see `namespace-manager.ts`'s import resolution). Shared between
 * `codegen.ts` and `codegen-optimized.ts`.
 *
 * Emitted VERBATIM as `module.name`, with no accompanying `import`
 * statement generated for `module` -- this is the `QualifiedIdentifier`
 * counterpart of `generateIdentifierCode`'s "external parser" escape
 * hatch for a bare `Identifier` that names no local rule (see that
 * function's own doc comment): the consumer of the generated code is
 * expected to supply a binding for `module` themselves (e.g. a real
 * `import` added by hand, or a value passed into a `new Function(...)`
 * scope), exactly as they already must for an unresolved bare
 * `Identifier`. `codegen.ts`/`codegen-optimized.ts`/
 * `@suzumiyaaoba/tpeg-generator`'s Eta generator have no integration
 * with the module-resolution system (`module-resolver.ts`'s
 * `resolveQualifiedIdentifier`, `namespace-manager.ts`'s
 * `resolveQualifiedName`) today -- nothing in this repo currently
 * resolves a `QualifiedIdentifier` and rewrites the grammar's AST
 * before code generation, so this reference always reaches codegen
 * unresolved and is always emitted this way, not auto-imported.
 */
export const generateQualifiedIdentifierCode = (
  expr: QualifiedIdentifier,
  intern: (s: string) => string = identity,
): string => intern(`${expr.module}.${expr.name}`);

/**
 * Builds one non-fatal warning per DISTINCT (rule, module, name) triple
 * found anywhere in `grammar` (see `generateQualifiedIdentifierCode`'s
 * doc comment for why these are never rejected outright), so a caller of
 * `generateTypeScriptParser`/`generateOptimizedTypeScriptParser` -- and,
 * in turn, `tpeg-cli` -- can surface the "you must supply this binding
 * yourself" requirement instead of the consumer only finding out via an
 * unlabeled `ReferenceError` at load time. Shared between `codegen.ts`
 * and `codegen-optimized.ts` so the message text can't drift between the
 * two generators.
 *
 * De-duplicated by triple (not just by `module`) so a rule referencing
 * the same qualified name twice (`start = math.expr math.expr`) doesn't
 * print an identical line twice, while two DIFFERENT rules referencing
 * the same module each still get their own warning -- that spread across
 * rules is itself useful information, not noise.
 */
export const buildQualifiedIdentifierWarnings = (
  grammar: GrammarDefinition,
): string[] => {
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const { ruleName, module, name } of findQualifiedIdentifierReferences(
    grammar,
  )) {
    const key = `${ruleName}\0${module}\0${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push(
      `rule "${ruleName}" references "${module}.${name}" as an external module reference -- ` +
        `codegen does not resolve or import "${module}"; the generated code expects the ` +
        `caller to supply that binding themselves (e.g. a hand-written \`import\`, or a value ` +
        `passed into the scope the generated code runs in).`,
    );
  }
  return warnings;
};

/**
 * The bare-`Identifier` counterpart of
 * {@link buildQualifiedIdentifierWarnings}: one warning per distinct
 * (rule, name) pair referencing a name this grammar declares no rule for
 * (`findExternalIdentifierReferences`). Such a reference is emitted as a
 * bare binding the caller must supply (the external-parser escape hatch
 * -- see `generateIdentifierCode`), which is far more often a misspelled
 * rule name than an intentional external parser; without a warning the
 * mistake only surfaced as a `ReferenceError` when the generated module
 * was loaded.
 */
export const buildExternalIdentifierWarnings = (
  grammar: GrammarDefinition,
): string[] => {
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const { ruleName, name } of findExternalIdentifierReferences(grammar)) {
    const key = `${ruleName}\0${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push(
      `rule "${ruleName}" references "${name}", which is not a rule of this grammar -- ` +
        `the generated code refers to it as an external parser binding the caller must ` +
        `supply themselves (check for a misspelled rule name if that isn't intended).`,
    );
  }
  return warnings;
};

/**
 * Generates the combinator call for a `Quantified` node, given its
 * already-generated inner expression. Identical between the base and
 * optimized generators (only how `inner` itself was produced differs), so
 * shared here rather than duplicated. `enableCharClassRun` mirrors
 * `CodeGenOptions`/`OptimizedCodeGenOptions`'s option of the same name
 * (default `true`) -- both generators pass their own resolved option
 * value through here for the `{0,}`/`{1,}` cases, which are the only
 * ones `tryGenerateCharClassRunCode` can apply to.
 */
export const generateQuantifiedCode = (
  expr: Quantified,
  inner: string,
  enableCharClassRun = true,
): string => {
  // The default maximum is unbounded. Avoid emitting a global Infinity
  // reference: it may be shadowed by a rule in the generated module.
  if (expr.max === Number.POSITIVE_INFINITY) {
    return `quantified(${inner}, ${expr.min})`;
  }
  if (expr.max === undefined) {
    // {n,} - at least n
    if (expr.min === 0) {
      const run = enableCharClassRun
        ? tryGenerateCharClassRunCode(expr.expression, 0)
        : null;
      return run ?? `zeroOrMore(${inner})`;
    }
    if (expr.min === 1) {
      const run = enableCharClassRun
        ? tryGenerateCharClassRunCode(expr.expression, 1)
        : null;
      return run ?? `oneOrMore(${inner})`;
    }
    return `quantified(${inner}, ${expr.min})`;
  }

  // All finite bounds return arrays, including {0}, {1}, and {0,1}.
  return `quantified(${inner}, ${expr.min}, ${expr.max})`;
};

/**
 * Generates a `capture(...)` call for a `LabeledExpression` node, given its
 * already-generated inner expression. Identical between the base and
 * optimized generators, so shared here rather than duplicated.
 */
export const generateLabeledExpressionCode = (
  label: string,
  inner: string,
): string => `capture("${label}", ${inner})`;
