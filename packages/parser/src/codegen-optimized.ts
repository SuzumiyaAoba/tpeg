/**
 * Optimized TPEG Code Generation System
 *
 * High-performance version of the code generator with:
 * - String interning and caching
 * - Optimized AST traversal
 * - Template-based generation
 * - Memory-efficient operations
 */

import type {
  ActionExpression,
  CharacterClass,
  Choice,
  Expression,
  GrammarDefinition,
  Identifier,
  LabeledExpression,
  QualifiedIdentifier,
  Quantified,
  RuleDefinition,
  Sequence,
  StringLiteral,
  TransformFunction,
} from "./types";

import type { CharSet } from "./char-set";
import {
  buildExternalIdentifierWarnings,
  buildQualifiedIdentifierWarnings,
  collectTopLevelLabels,
  collectTransformFunctions,
  filterReferencedLabels,
  findMemoizeAnnotation,
  generateCharacterClassCode,
  generateChoiceCode,
  generateIdentifierCode,
  generateLabeledExpressionCode,
  generateQualifiedIdentifierCode,
  generateQuantifiedCode,
  generateStringLiteralCode,
  isRuleReferencedAnywhere,
  tryGenerateCharClassRunCode,
  wrapWithAction,
  wrapWithMemoize,
  wrapWithMonitoring,
  wrapWithTransform,
} from "./codegen";
import {
  collectUsedCombinators,
  forEachSequenceElement,
  grammarHasGlobalCut,
  sequenceHasCutFollowedByElement,
} from "./codegen";
import type { GrammarFirstSetAnalysis } from "./first-sets";
import {
  analyzeFirstSets,
  assertNoNullableRepetition,
  canCommitWithoutConsuming,
  predictiveFilterForExpression,
} from "./first-sets";
import {
  resolveStartRule,
  validateGeneratedIdentifiers,
  validateGrammar,
} from "./grammar-validation";
import { applySkipDesugar } from "./skip-desugar";
import {
  analyzeGrammarPerformance,
  globalPerformanceMonitor,
  stringInterner,
} from "./performance-utils";
import type { ReentrancyAnalysis } from "./reentrancy";
import { analyzeReentrancy } from "./reentrancy";
import {
  MIN_FUSION_WEIGHT,
  emitFusedExpression,
  planFusion,
} from "./regex-fusion";

/**
 * Enhanced code generation options with performance settings
 */
export interface OptimizedCodeGenOptions {
  /** Target language (currently only TypeScript) */
  language: "typescript";
  /** Generated parser name prefix */
  namePrefix?: string;
  /** Include runtime imports */
  includeImports?: boolean;
  /** Generate with type annotations */
  includeTypes?: boolean;
  /**
   * Master switch for the optional performance passes: when explicitly
   * `false`, the DEFAULT for each default-on per-feature flag
   * (`enableMemoization`, `enablePredictiveDispatch`,
   * `enableCharClassRun`) flips to off, so no `predictiveChoice`/
   * `charClassRun`/`memoize` calls are emitted. An explicitly-set
   * per-feature flag still wins -- this supplies defaults, not
   * overrides. `enableRegexFusion` is opt-in (default `false`) and
   * unaffected. Defaults to `true`.
   */
  optimize?: boolean;
  /**
   * Wrap rules `./reentrancy.ts` flags as reentrant in `memoize(...)`.
   * Defaults to `optimize`'s value (`true` unless `optimize: false`).
   * An explicit `@memoize` rule annotation memoizes regardless of this
   * flag -- it's the user directly saying "memoize this rule", not a
   * suggestion this generator inferred.
   */
  enableMemoization?: boolean;
  /** Generate performance monitoring code */
  includeMonitoring?: boolean;
  /**
   * Emit `predictiveChoice(...)` instead of `choice(...)` for a `Choice`
   * whenever at least one alternative has a statically computable,
   * non-nullable FIRST set (see `packages/parser/src/first-sets.ts`).
   *
   * Defaults to `optimize`'s value (`true` unless `optimize: false`),
   * like `enableMemoization` -- unlike this package's other
   * grammar rewrites (`./ast-optimize.ts`'s `leftFactorChoices` and
   * friends, which stay opt-in). The two have different safety
   * properties: `predictiveChoice` only *filters* which alternatives are
   * attempted, in their original relative order (see
   * `packages/core/src/combinators.ts`'s doc comment on `predictiveChoice`
   * for the exact guarantee) -- it never changes which alternative wins,
   * never changes a value's shape, and doesn't need `ast-optimize.ts`'s
   * `isShapeSensitiveRule` gate or its "does an ancestor rule's action
   * read this rule's value shape" caveat, because no value shape changes.
   * The only observable difference on a fully-failed parse is that
   * `expected` may list fewer alternatives (see that doc comment's
   * "Failure diagnostics differ from `choice`" section) -- strictly a
   * diagnostic narrowing, not a behavior change. That's a much narrower
   * risk surface than an AST rewrite, so it defaults on.
   *
   * Benchmark effect (`packages/parser/bench/run.ts`, JSON grammar):
   * ~1.73x throughput, leaf invocations/char
   * 1.45x -> 1.15x. Set to `false` to opt back out.
   */
  enablePredictiveDispatch?: boolean;
  /**
   * Compiles a fusion root -- by default, a rule's ENTIRE pattern (see
   * `regexFusionScope` below) -- to a single `regexFusedMap(...)` call
   * (`packages/core/src/regex-fused.ts`) instead of a combinator tree,
   * whenever `./regex-fusion.ts`'s `planFusion` proves it safe (no
   * non-terminal references, and every repetition/choice inside the
   * pattern is provably deterministic -- see that module's doc comment
   * for both conditions and why they're each necessary).
   *
   * Default `false`, unlike `enablePredictiveDispatch`: fusion changes
   * how a node's value is PRODUCED (one regex match plus a
   * reconstruction expression built from its capture groups, in place
   * of nested combinator calls), even though `./regex-fusion.ts` builds
   * that reconstruction to be byte-identical to the unfused shape. This
   * is a much larger, newer piece of machinery than predictive dispatch
   * (which only ever filters an existing `choice`'s alternative list),
   * so it stays opt-in pending more real-world grammar coverage, the
   * same conservative posture `./ast-optimize.ts`'s rewrites take.
   *
   * Gate measurement backing this option: on the JSON and
   * unfactored-arithmetic bench grammars (`packages/parser/bench/grammars.ts`),
   * ~82-87% of leaf-parser invocations belong to wholly-clean rules,
   * with a ~6.7x collapse factor (leaf invocations saved per rule
   * entry) -- both high enough to justify building this.
   */
  enableRegexFusion?: boolean;
  /**
   * Only meaningful when `enableRegexFusion` is on. `"rule"` (the
   * default): consider only each rule's own top-level pattern as a
   * fusion candidate, exactly this module's original behavior -- setting
   * `enableRegexFusion: true` alone, with no `regexFusionScope`, changes
   * nothing about what fuses. `"subtree"`: additionally fuse any MAXIMAL
   * fusable node reachable by walking a rule's pattern top-down,
   * including through a `LabeledExpression`/`ActionExpression` --
   * reaching real, action-bearing grammars whole-rule fusion could never
   * touch (an action anywhere in a rule disqualifies the WHOLE rule
   * under `"rule"` scope). See `./regex-fusion.ts`'s `planFusion` doc
   * comment for the full soundness argument and why the two scopes are
   * two independently-correct decisions, not a superset relationship.
   */
  regexFusionScope?: "rule" | "subtree";
  /**
   * Only meaningful when `enableRegexFusion` is on and
   * `regexFusionScope: "subtree"`. Minimum `./regex-fusion.ts` `weight`
   * (an estimate of leaf-parser invocations removed) for a sub-
   * expression fusion candidate to be worth compiling to a
   * `regexFusedMap` call at all -- see that module's `MIN_FUSION_WEIGHT`
   * doc comment for the cost model. Not applied under `"rule"` scope
   * (whole-rule fusion has never been weight-gated; changing that would
   * be a behavior change for existing `enableRegexFusion: true` callers).
   * Defaults to `MIN_FUSION_WEIGHT`. Exists as a real option mainly so
   * `packages/parser/bench/`'s harness can sweep it; ordinary callers
   * should not need to set this.
   */
  regexFusionMinWeight?: number;
  /**
   * Emit `charClassRun(...)` instead of `zeroOrMore`/`oneOrMore` driving
   * `charClass`/`negatedCharClass` one character at a time, for a
   * `Star`/`Plus`/`Quantified{0,}`/`Quantified{1,}` whose repeated
   * element is a bare `CharacterClass`. See `CodeGenOptions`'s option of
   * the same name (`./codegen.ts`) for the full rationale -- this
   * generator defaults it to `optimize`'s value (`true` unless
   * `optimize: false`) for the identical reason the base generator
   * defaults it on: the emitted value is byte-identical to the unfused
   * shape, so there's no risk surface to gate behind an opt-in.
   */
  enableCharClassRun?: boolean;
}

/**
 * Enhanced generated code result with performance metadata
 */
export interface OptimizedGeneratedCode {
  /** Generated TypeScript code */
  code: string;
  /** Required imports */
  imports: string[];
  /** Export declarations */
  exports: string[];
  /** Non-fatal generation warnings (e.g. an unresolved `QualifiedIdentifier`
   * reference -- see `buildQualifiedIdentifierWarnings`). Empty when there
   * is nothing to report. */
  warnings: string[];
  /** Performance analysis */
  performance: {
    estimatedComplexity: "low" | "medium" | "high";
    optimizationSuggestions: string[];
    generationTime: number;
  };
}

/**
 * Unwraps `Group`/`ActionExpression`/`LabeledExpression` -- transparent at
 * codegen time for the purpose of finding a Choice alternative's actual
 * leading terminal (mirrors `ast-optimize.ts`'s own transparent-wrapper
 * handling for the same node types elsewhere).
 */
const unwrapTransparentPrefix = (expr: Expression): Expression => {
  switch (expr.type) {
    case "Group":
    case "ActionExpression":
    case "LabeledExpression":
      return unwrapTransparentPrefix(expr.expression);
    default:
      return expr;
  }
};

/**
 * Derives a Choice alternative's known literal prefix for `predictiveChoice`'s
 * optional third tuple slot (`packages/core/src/
 * combinators.ts`'s `DispatchTrieNode`), or `null` if it doesn't have one.
 *
 * Returns non-`null` only for a bare `StringLiteral` of length >= 2, or a
 * `Sequence` whose FIRST element (after unwrapping `Group`/
 * `ActionExpression`/`LabeledExpression`) is one -- exactly element 0, not
 * "the first non-nullable element" the way `ast-optimize.ts`'s cut-
 * insertion logic scans: a nullable element ahead of the literal would
 * mean "every match of this alternative starts with this string" is
 * false (the alternative could also match starting from whatever comes
 * after a skipped nullable prefix), and this needs that stronger claim to
 * be true unconditionally, not just when a cut has already proven a
 * narrower disjointness argument. A `Sequence` with no elements, or one
 * whose element 0 isn't (or doesn't unwrap to) a `StringLiteral`, or a
 * `StringLiteral` of length < 2 (no useful second character to trie on),
 * all return `null`.
 *
 * This narrow scope is also what keeps `predictiveChoice`'s own
 * "`literalPrefix` must agree with `filter`" caller contract
 * (`packages/core/src/combinators.ts`'s doc comment on that function)
 * satisfied by construction: the ONLY expression shapes this returns a
 * prefix for are ones whose FIRST set -- and therefore the `filter`
 * computed alongside this by `predictiveFilterForExpression`, below -- is
 * always exactly that literal's first character, never broader.
 */
const literalPrefixForExpression = (alt: Expression): string | null => {
  if (alt.type === "StringLiteral") {
    return alt.value.length >= 2 ? alt.value : null;
  }
  if (alt.type !== "Sequence") return null;
  const first = alt.elements[0];
  if (!first) return null;
  const unwrapped = unwrapTransparentPrefix(first);
  if (unwrapped.type === "StringLiteral" && unwrapped.value.length >= 2) {
    return unwrapped.value;
  }
  return null;
};

/**
 * Code template cache for common patterns
 */
class CodeTemplateCache {
  private templates = new Map<string, string>();

  get(key: string, generator: () => string): string {
    const cached = this.templates.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const code = generator();
    this.templates.set(key, code);
    return code;
  }

  clear(): void {
    this.templates.clear();
  }
}

/**
 * High-performance code generator with optimizations
 */
export class OptimizedTPEGCodeGenerator {
  private options: Required<OptimizedCodeGenOptions>;
  private ruleNames: Set<string> = new Set();
  /** Rule name -> declaration index, used to detect forward/self/mutual references. */
  private ruleIndex: Map<string, number> = new Map();
  /** Declaration index of the rule currently being generated. */
  private currentRuleIndex = -1;
  /** Name of the rule currently being generated -- used only as the
   * `description` argument to `regexFusedMap` for a fusion root found
   * inside it (see `generateFusedExpression`); every fusion root within
   * one rule shares that rule's name as its failure-message description,
   * matching whole-rule fusion's existing description exactly. */
  private currentRuleName = "";
  private templateCache = new CodeTemplateCache();
  /** Converged FIRST-set analysis for the grammar currently being
   * generated, computed once per `generateGrammar` call when
   * `enablePredictiveDispatch` is on; `null` otherwise (including before
   * the first `generateGrammar` call). */
  private firstSetAnalysis: GrammarFirstSetAnalysis | null = null;
  /** Converged reentrancy analysis (`./reentrancy.ts`) for the grammar
   * currently being generated -- the memoization trigger, replacing the
   * old `hasRecursion || estimatedComplexity === "high"` heuristic.
   * Computed once per `generateGrammar` call when `enableMemoization` is
   * on; `null` otherwise. */
  private reentrancyAnalysis: ReentrancyAnalysis | null = null;
  /** AST nodes (by identity) `generateGrammar` decided to compile via
   * `regexFusedMap(...)` instead of a combinator tree -- computed once
   * per `generateGrammar` call by `./regex-fusion.ts`'s `planFusion`
   * (empty when `enableRegexFusion` is off). A node in this set is
   * always the HIGHEST fusable node on its path (see `planFusion`'s doc
   * comment): under `regexFusionScope: "rule"` that's always (at most)
   * one whole `rule.pattern` per rule, matching this module's original
   * whole-rule-only behavior exactly; under `"subtree"` it can be any
   * node reachable from a rule's pattern, including one reached through
   * a `LabeledExpression`/`ActionExpression`.
   *
   * Consulted by BOTH `generateOptimizedExpression` (to emit the fused
   * code the moment it reaches a root, instead of recursing further) and
   * `collectUsedCombinators` (to import `regexFusedMap` instead of
   * walking a fused node's subtree for its normal combinator set), so
   * the two passes can never disagree about what's fused -- both simply
   * ask the same `Set.has(expr)` question. */
  private fusionRoots: ReadonlySet<Expression> = new Set();
  /** Whether `commitAtTopLevel` is safe to emit for a `Cut` that is a
   * direct element of the grammar's start rule's own top-level Sequence
   * (the `@start`-resolved entry rule, `resolveStartRule` in
   * `grammar-validation.ts`) -- computed once per `generateGrammar` call.
   * See `codegen.ts`'s `isRuleReferencedAnywhere` doc comment: that shape
   * alone is NOT sufficient, since the start rule being referenced by
   * name from elsewhere in the grammar (a live backtrack point above what
   * `commitAtTopLevel` assumes has none) makes the narrow structural
   * condition this codebase's codegen relies on unsound. `true` before
   * the first `generateGrammar` call only as an unused default. */
  private startRuleIsSafeForCommitAtTopLevel = true;
  /** Declaration index of the grammar's entry rule -- `rules[0]` when no
   * `@start` annotation is present, the `@start`-named rule's index
   * otherwise (see `resolveStartRule`, `grammar-validation.ts`). `-1`
   * before the first `generateGrammar` call and for an empty grammar, so
   * `index === this.startRuleIndex` is then simply never true. */
  private startRuleIndex = -1;

  constructor(options: OptimizedCodeGenOptions = { language: "typescript" }) {
    // `optimize` is the master switch for this generator's optional
    // performance passes: when explicitly `false` it flips the DEFAULT of
    // each per-feature flag (`enableMemoization`,
    // `enablePredictiveDispatch`, `enableCharClassRun` -- all default-on)
    // to off, so `generateOptimizedTypeScriptParser(g, { optimize:
    // false })` emits a plain combinator tree without
    // `predictiveChoice`/`charClassRun`/`memoize` calls. It supplies the
    // default, not an override: an explicitly-set per-feature flag still
    // wins (`{ optimize: false, enableMemoization: true }` memoizes).
    // `enableRegexFusion` stays opt-in (default `false`) regardless --
    // see its doc comment for why it takes the more conservative
    // posture. This field previously was stored and never read, so
    // `optimize: false` silently produced byte-identical output to
    // `optimize: true`.
    const optimize = options.optimize ?? true;
    this.options = {
      language: options.language,
      namePrefix: options.namePrefix ?? "",
      includeImports: options.includeImports ?? true,
      includeTypes: options.includeTypes ?? true,
      optimize,
      enableMemoization: options.enableMemoization ?? optimize,
      includeMonitoring: options.includeMonitoring ?? false,
      enablePredictiveDispatch: options.enablePredictiveDispatch ?? optimize,
      enableRegexFusion: options.enableRegexFusion ?? false,
      regexFusionScope: options.regexFusionScope ?? "rule",
      regexFusionMinWeight: options.regexFusionMinWeight ?? MIN_FUSION_WEIGHT,
      enableCharClassRun: options.enableCharClassRun ?? optimize,
    };
  }

  /**
   * Generate optimized TypeScript parser code from a TPEG grammar
   */
  generateGrammar(grammar: GrammarDefinition): OptimizedGeneratedCode {
    globalPerformanceMonitor.start("grammar-generation");

    // Reject a duplicate rule name or a left-recursive rule outright,
    // before anything else -- see `grammar-validation.ts`'s doc comment
    // for why this MUST run before `analyzeFirstSets` below (a duplicate
    // name can make that fixpoint oscillate forever instead of
    // converging).
    validateGrammar(grammar);

    // `@skip`-desugar BEFORE first-set analysis and every downstream
    // walk (reentrancy, fusion planning, performance analysis, the
    // rules loops): the grammar the emitted code implements is the
    // desugared one, so every analysis must see the `Skip`-inserted
    // shape too. Rule names, order, annotations, and transforms are
    // unchanged by the rewrite -- see `skip-desugar.ts`.
    const desugared = applySkipDesugar(grammar);

    // Reset per-instance state so a reused generator doesn't leak rule
    // names or cached expression templates from a previous grammar.
    this.ruleNames.clear();
    this.ruleIndex.clear();
    this.templateCache.clear();
    this.fusionRoots = new Set();
    // Computed unconditionally now (not just when
    // enablePredictiveDispatch/enableRegexFusion are on): `
    // assertNoNullableRepetition` below needs a converged FIRST-set
    // analysis regardless of which optional codegen features are
    // enabled -- an unbounded repetition over a nullable body has no
    // well-defined PEG semantics whether or not this grammar happens to
    // also want predictive dispatch or regex fusion.
    this.firstSetAnalysis = analyzeFirstSets(desugared);
    assertNoNullableRepetition(desugared, this.firstSetAnalysis);
    // See this field's own doc comment for why the narrow
    // `isStartRuleTopLevel` shape needs this extra check. Which rule IS
    // the start rule comes from `resolveStartRule`
    // (`grammar-validation.ts`): the rule named by `@start` when the
    // annotation is present, `rules[0]` otherwise -- `index ===
    // startRuleIndex` below replaces the historical `index === 0` so
    // the resolved rule, not just the first-declared one, gets the
    // top-level treatment.
    const startRule = resolveStartRule(desugared);
    this.startRuleIndex = startRule?.index ?? -1;
    const startRuleName = startRule?.rule.name;
    this.startRuleIsSafeForCommitAtTopLevel =
      startRuleName !== undefined &&
      !isRuleReferencedAnywhere(desugared, startRuleName);
    this.reentrancyAnalysis = this.options.enableMemoization
      ? analyzeReentrancy(desugared)
      : null;
    if (this.options.enableRegexFusion && this.firstSetAnalysis) {
      this.fusionRoots = planFusion(desugared, this.firstSetAnalysis, {
        scope: this.options.regexFusionScope,
        minWeight: this.options.regexFusionMinWeight,
      }).roots;
    }

    const performanceAnalysis = analyzeGrammarPerformance(desugared);
    const imports: string[] = [];
    const exports: string[] = [];
    const parts: string[] = [];

    // Collect all rule names and their declaration order first for
    // reference resolution (see generateIdentifier) - generateOptimizedImports
    // below needs ruleIndex populated to know whether a "lazy" import is
    // required.
    desugared.rules.forEach((rule, index) => {
      this.ruleNames.add(stringInterner.intern(rule.name));
      this.ruleIndex.set(rule.name, index);
    });

    // `includeMonitoring` appends a module-scope `const
    // performanceMonitor` plus `export { performanceMonitor }` (see
    // `generateMonitoringCode`) -- not an import, but a top-level
    // declaration a rule named `performanceMonitor` would collide with
    // (duplicate `const`), so it joins the checked bindings exactly like
    // an imported name.
    const monitoringBindings = this.options.includeMonitoring
      ? ["performanceMonitor"]
      : [];

    // Compute the imports this grammar needs, then reject a rule
    // name, capture label, or transform parameter name that would
    // generate to a reserved word, an internal codegen name, or one of
    // the bindings just collected (plus `performanceMonitor`, a real
    // top-level declaration whenever monitoring is emitted) -- see
    // `validateGeneratedIdentifiers`'s doc comment
    // (`grammar-validation.ts`) for the concrete failure modes.
    //
    // The binding set is computed even when `includeImports` is false:
    // the emitted code still CALLS these combinators in that mode (the
    // caller supplies the bindings), so a rule named e.g. `sequence` or
    // `untagCapture` would otherwise pass validation and emit
    // `export const sequence = sequence(...)`, a TDZ `ReferenceError`
    // at module evaluation. Only the `import` lines themselves stay
    // gated on `includeImports`.
    const { lines, bindings } = this.generateOptimizedImports(desugared);
    if (this.options.includeImports) {
      imports.push(...lines);
    }
    validateGeneratedIdentifiers(desugared, {
      namePrefix: this.options.namePrefix,
      importedBindings: [...bindings, ...monitoringBindings],
    });

    // Generate parser for each rule with optimization, applying a matching
    // TypeScript transform function (if the grammar declares one)
    const transformsByRuleName = collectTransformFunctions(desugared);
    desugared.rules.forEach((rule, index) => {
      this.currentRuleIndex = index;
      this.currentRuleName = rule.name;
      const ruleCode = this.generateOptimizedRule(
        rule,
        transformsByRuleName.get(rule.name),
        index === this.startRuleIndex &&
          this.startRuleIsSafeForCommitAtTopLevel,
      );
      parts.push(ruleCode);
      // Same as codegen.ts's generateGrammar: record the PREFIXED name
      // (`export const <namePrefix><rule.name>` is what's actually
      // emitted), matching eta-generator.ts.
      exports.push(stringInterner.intern(this.options.namePrefix + rule.name));
    });

    // Same `@start` alias as codegen.ts's generateGrammar: an explicit
    // `@start: <name>` emits `export { <name> as start }` so the entry
    // point is reachable under one stable name. Skipped when the
    // resolved rule's own emitted name is already `start`; a DIFFERENT
    // rule emitting `start` throws rather than silently dropping the
    // alias (which would hand the caller the wrong rule under the
    // entry-point name).
    if (startRule?.explicit) {
      const startEmittedName = this.options.namePrefix + startRule.rule.name;
      if (startEmittedName !== "start") {
        if (
          desugared.rules.some(
            (rule) => `${this.options.namePrefix}${rule.name}` === "start",
          )
        ) {
          throw new Error(
            `Rule name "start" collides with the \`start\` export alias @start emits for entry rule "${startRule.rule.name}" -- rename the rule, or set a namePrefix so the rule no longer emits that name.`,
          );
        }
        parts.push(`export { ${startEmittedName} as start };`);
        exports.push("start");
      }
    }

    // Add performance monitoring if enabled
    if (this.options.includeMonitoring) {
      parts.push(this.generateMonitoringCode());
    }

    // Efficiently combine all parts
    const codeBuilder = [];

    if (this.options.includeImports && imports.length > 0) {
      codeBuilder.push(imports.join("\n"), "\n");
    }

    codeBuilder.push(parts.join("\n\n"));

    const generationTime = globalPerformanceMonitor.end("grammar-generation");

    return {
      code: codeBuilder.join(""),
      imports,
      exports,
      warnings: [
        ...buildExternalIdentifierWarnings(grammar),
        ...buildQualifiedIdentifierWarnings(grammar),
      ],
      performance: {
        estimatedComplexity: performanceAnalysis.estimatedParseComplexity,
        optimizationSuggestions: performanceAnalysis.optimizationSuggestions,
        generationTime,
      },
    };
  }

  /**
   * Generate optimized imports based on grammar analysis
   */
  private generateOptimizedImports(grammar: GrammarDefinition): {
    lines: string[];
    /** Every binding name these `lines` actually import (`"Parser"` plus
     * each combinator/`tpeg-combinator` name), flattened out of the
     * assembled import statement strings above -- passed to
     * `validateGeneratedIdentifiers` so its collision check matches what
     * this grammar, under these options, will really emit. */
    bindings: string[];
  } {
    const imports = [];
    // `Parser` is referenced only by the `: Parser<any>` rule annotations
    // and the `import type` line emitted alongside them (`includeTypes`)
    // -- a rule named `Parser` collides with the generated code only then.
    const bindings: string[] = this.options.includeTypes ? ["Parser"] : [];

    // Core imports. `Parser` is only referenced by the `: Parser<any>`
    // annotations, so `includeTypes: false` (`--no-types`) omits it -- an
    // unused `import type` fails `noUnusedLocals` and is a SyntaxError if
    // the output is used as plain JavaScript.
    if (this.options.includeTypes) {
      imports.push('import type { Parser } from "@suzumiyaaoba/tpeg-core";');
    }

    // Analyze which combinators are actually needed
    const usedCombinators = new Set<string>();

    // `collectUsedCombinators` itself checks `this.fusionRoots` at every
    // node (see its doc comment) and stops descending -- adding
    // `regexFusedMap` instead of whatever combinators a fused node's
    // subtree would otherwise need -- so this pass and the actual
    // per-rule codegen (`generateOptimizedExpression`, same check) can
    // never disagree about what's fused, at rule level OR sub-expression
    // level.
    grammar.rules.forEach((rule, index) => {
      this.collectUsedCombinators(
        rule.pattern,
        usedCombinators,
        index,
        index === this.startRuleIndex &&
          this.startRuleIsSafeForCommitAtTopLevel,
      );
    });
    // Every rule's emitted parser is wrapped in `untagCapture(...)` (see
    // `generateOptimizedRule`) regardless of its pattern, so the import is
    // needed unconditionally whenever the grammar declares any rule at all.
    if (grammar.rules.length > 0) {
      usedCombinators.add("untagCapture");
    }

    // Add performance imports if needed. memoize and commitAtTopLevel
    // both live in tpeg-combinator, not tpeg-core, so they must not also
    // be folded into the tpeg-core import below -- that would import
    // names tpeg-core doesn't export. An explicit `@memoize` annotation
    // on any rule forces the memoize import regardless of
    // `enableMemoization`/reentrancy -- see `generateOptimizedRule`,
    // which applies it independently of the automatic trigger below.
    //
    // This used to gate on `analysis.estimatedParseComplexity !== "low"`
    // -- the same proxy `generateOptimizedRule` used to use for the
    // per-rule decision (see `reentrancy.ts`'s module doc comment for why
    // that's unsound). That mattered here specifically: a grammar can
    // have every individual rule classified "low" complexity (small,
    // non-recursive) while still containing rules the reentrancy analysis
    // correctly flags as needing memoization (`BENCH_ACYCLIC_CHAIN_GRAMMAR`
    // in `bench/grammars.ts` is exactly such a case) -- the old gate would
    // have emitted `memoize(...)` calls in the rule bodies below without
    // importing `memoize` at all, a `ReferenceError` at runtime.
    const combinatorPackageImports: string[] = [];
    if (
      (this.reentrancyAnalysis &&
        this.reentrancyAnalysis.reentrantRules.size > 0) ||
      grammar.rules.some((rule) => findMemoizeAnnotation(rule))
    ) {
      combinatorPackageImports.push("memoize");
    }
    // commitAtTopLevel is emitted (in place of the ordinary `commit`, see
    // generateOptimizedSequence) only for a `Cut` that is a direct
    // element of the grammar's start rule's own top-level Sequence, AND
    // only when nothing else in the grammar references that start rule by
    // name -- see `startRuleIsSafeForCommitAtTopLevel`'s own doc comment,
    // and `packages/combinator/src/logic.ts`'s `commitAtTopLevel` doc
    // comment for why the narrower shape is the one that's actually safe.
    // The `@start`-resolved entry rule, not blindly `rules[0]` -- see
    // `resolveStartRule` (`grammar-validation.ts`).
    const startRule = resolveStartRule(grammar)?.rule;
    if (
      (this.startRuleIsSafeForCommitAtTopLevel &&
        startRule?.pattern.type === "Sequence" &&
        sequenceHasCutFollowedByElement(startRule.pattern.elements)) ||
      grammarHasGlobalCut(grammar)
    ) {
      combinatorPackageImports.push("commitAtTopLevel");
    }
    if (combinatorPackageImports.length > 0) {
      imports.push(
        `import { ${combinatorPackageImports.join(", ")} } from "@suzumiyaaoba/tpeg-combinator";`,
      );
      bindings.push(...combinatorPackageImports);
    }

    // Generate optimized combinator import. Guarded on `length > 0` --
    // unlike `combinatorPackageImports` above, which was already guarded
    // -- a grammar whose every rule is a bare external-parser reference
    // (see `generateIdentifierCode`'s "external parser" escape hatch)
    // needs no `tpeg-core` combinator at all, and an unconditional push
    // here emitted `import {  } from "@suzumiyaaoba/tpeg-core";` (valid
    // but pointless) in that case. Mirrors `codegen.ts`'s identical guard
    // on its own equivalent import line.
    const combinators = Array.from(usedCombinators).sort();
    if (combinators.length > 0) {
      imports.push(
        `import { ${combinators.join(", ")} } from "@suzumiyaaoba/tpeg-core";`,
      );
      bindings.push(...combinators);
    }

    return { lines: imports, bindings };
  }

  /**
   * Collect all combinators used in an expression. Delegates to the
   * shared {@link collectUsedCombinators} in `codegen.ts` with this
   * generator's own decisions: fusion roots are handled by `handled`
   * (emitting `regexFusedMap` and never recursing -- see the comment
   * inside it for why that check comes first at EVERY level), a
   * single-alternative `Choice` is returned bare by
   * `generateOptimizedChoice` so it adds no combinator, and a
   * multi-alternative one emits `predictiveChoice` exactly when
   * `tryGeneratePredictiveChoice`'s eligibility test passes
   * (`firstSetAnalysis` IS already populated by this point -- `generate`
   * computes it before the import pass).
   */
  private collectUsedCombinators(
    expr: Expression,
    combinators: Set<string>,
    currentRuleIndex: number,
    isStartRuleTopLevel = false,
  ): void {
    collectUsedCombinators(
      expr,
      combinators,
      {
        ruleIndex: this.ruleIndex,
        currentRuleIndex,
        enableCharClassRun: this.options.enableCharClassRun,
        commitAfterAnyCut: false,
        choiceCombinatorFor: (choice) =>
          // `generateChoiceCode` emits ONLY a single-alternative Choice
          // bare; an EMPTY one still emits `choice()` (the always-failing
          // parser -- `combinators.ts`'s zero-argument case), so `choice`
          // must be imported for it. `<= 1` here previously grouped the
          // empty case with the bare-passthrough case and skipped the
          // import, leaving a `choice()` call with no `choice` binding in
          // the generated module.
          choice.alternatives.length === 1
            ? null
            : this.options.enablePredictiveDispatch &&
                this.firstSetAnalysis !== null &&
                this.predictiveChoiceFilters(choice, this.firstSetAnalysis) !==
                  null
              ? "predictiveChoice"
              : "choice",
        handled: (e, into) => {
          // A fusion root (`this.fusionRoots`, populated by `planFusion`
          // in `generateGrammar`) compiles to one `regexFusedMap(...)`
          // call in `generateOptimizedExpression` -- checked FIRST,
          // before the switch, so it applies uniformly whether `e` is a
          // whole rule's pattern (`regexFusionScope: "rule"`) or an
          // interior node reached through recursion (`"subtree"`). Not
          // walking further into `e` here is what keeps this pass and
          // `generateOptimizedExpression` in lockstep: neither one ever
          // looks at what's inside a fused node.
          if (this.fusionRoots.has(e)) {
            into.add("regexFusedMap");
            return true;
          }
          return false;
        },
      },
      isStartRuleTopLevel,
    );
  }

  /**
   * Generate optimized code for a single rule definition
   */
  private generateOptimizedRule(
    rule: RuleDefinition,
    transformFn?: TransformFunction,
    isStartRule = false,
  ): string {
    // `generateOptimizedExpression` itself checks `this.fusionRoots`
    // first thing (see its doc comment) -- whether `rule.pattern` is a
    // fusion root (`regexFusionScope: "rule"`, or a whole rule that also
    // happens to be the maximal fusable node under `"subtree"`) is
    // decided there, uniformly with every interior node.
    // `untagCapture` strips a surviving CAPTURE_TAG at the rule boundary --
    // see `codegen.ts`'s `generateRule` for why a rule's own pattern can
    // still yield a tagged object and why that must not leak into an
    // enclosing `captureSequence` merge. Applied inside `memoize(...)`
    // below so the memo table stores the already-clean value.
    const innerCode = `untagCapture(${this.generateOptimizedExpression(
      rule.pattern,
      isStartRule,
    )})`;

    // An explicit `@memoize` annotation wins over the automatic
    // reentrancy-based trigger below (and applies regardless of
    // `enableMemoization`) -- it's the user directly saying "memoize this
    // rule", not a suggestion this generator inferred on its own.
    const memoizeAnnotation = findMemoizeAnnotation(rule);
    let parserCode: string;
    if (memoizeAnnotation) {
      parserCode = wrapWithMemoize(innerCode, memoizeAnnotation);
    } else {
      // `reentrancyAnalysis` is non-null exactly when `enableMemoization`
      // is on (see `generateGrammar`) -- memoizing here iff this rule can
      // actually be re-invoked at an offset it was already parsed at,
      // per `./reentrancy.ts`. This replaced a proxy
      // (`hasRecursion || estimatedComplexity === "high"`) that neither
      // caught every rule worth memoizing (a chain of small, non-
      // recursive, unfactored-choice rules is exponential but trips
      // neither condition -- see `BENCH_ACYCLIC_CHAIN_GRAMMAR` in
      // `bench/grammars.ts`) nor avoided memoizing rules it doesn't help
      // (a recursive rule whose alternatives are FIRST-disjoint, e.g.
      // JSON's `value`, is never actually re-invoked at a shared offset).
      const shouldMemoize =
        this.reentrancyAnalysis?.reentrantRules.has(rule.name) ?? false;
      parserCode = shouldMemoize ? `memoize(${innerCode})` : innerCode;
    }

    if (transformFn) {
      parserCode = wrapWithTransform(rule.name, parserCode, transformFn);
    }

    // `includeMonitoring` times every invocation of this rule against the
    // module-scope `performanceMonitor` `generateMonitoringCode` emits --
    // applied last so the measurement covers memoization and the
    // transform, i.e. what a caller of the exported parser actually pays.
    if (this.options.includeMonitoring) {
      parserCode = wrapWithMonitoring(
        rule.name,
        parserCode,
        "performanceMonitor",
        this.options.includeTypes,
      );
    }

    const name = stringInterner.intern(this.options.namePrefix + rule.name);
    const typeAnnotation = this.options.includeTypes ? ": Parser<any>" : "";

    return `export const ${name}${typeAnnotation} = ${parserCode};`;
  }

  /**
   * Emits `regexFusedMap(source, description, (m) => <valueExpr>)` for a
   * node `this.fusionRoots` already confirmed fusable (and, under
   * `regexFusionScope: "subtree"`, profitable) -- `./regex-fusion.ts`'s
   * `emitFusedExpression` builds both `source` (regex pattern text) and
   * `valueExpr` (a JS expression, as source text, reading `m` -- the raw
   * `RegExpExecArray` `regexFusedMap`'s callback receives -- to
   * reconstruct the node's original value shape) from the same AST
   * subtree, so the value produced here is byte-identical to what the
   * unfused combinator tree would have produced -- see that module's doc
   * comment's "Shape reconstruction" section. `description` is
   * `this.currentRuleName`: every fusion root found while generating one
   * rule shares that rule's name as its failure-message description,
   * same as whole-rule fusion always has. `JSON.stringify` on
   * `source`/`description` is what safely embeds them as JS string
   * literals regardless of what characters they contain (backslashes
   * from `\u{...}` escapes, quotes, etc.).
   */
  private generateFusedExpression(expr: Expression): string {
    const { source, valueExpr } = emitFusedExpression(expr);
    return `regexFusedMap(${JSON.stringify(source)}, ${JSON.stringify(this.currentRuleName)}, (m) => ${valueExpr})`;
  }

  /**
   * Generate optimized code for any expression type with caching
   */
  /**
   * `isStartRuleTopLevelSequence` mirrors codegen.ts's
   * `generateExpression` flag of the same shape (see its comment): `true`
   * only for the single top-level call from `generateOptimizedRule` on
   * the start rule's own pattern, forwarded ONLY to the `Sequence` case.
   * It's folded into the template-cache key below since it can change
   * the generated output (`commitAtTopLevel` vs `commit`) for otherwise
   * structurally-identical input.
   */
  private generateOptimizedExpression(
    expr: Expression,
    isStartRuleTopLevelSequence = false,
  ): string {
    // Checked FIRST, ahead of the template cache below: a fusion root
    // (`this.fusionRoots`, see its doc comment) is emitted directly via
    // `generateFusedExpression` and never descended into any further --
    // this is what makes `expr` the HIGHEST fusable node on its path
    // actually get compiled as one `regexFusedMap` call rather than
    // being walked node-by-node into the normal combinator tree. Pure
    // function of `expr`'s identity (computed once by `planFusion` in
    // `generateGrammar`), so bypassing the cache costs nothing -- each
    // root is reached at most once anyway, since the AST is a tree.
    if (this.fusionRoots.has(expr)) {
      return this.generateFusedExpression(expr);
    }

    // Use object identity for caching when possible. Identifier codegen
    // depends on this.currentRuleIndex (whether the reference needs a
    // `lazy` wrapper), so it must be part of the key - otherwise the same
    // rule name referenced from two different rules could reuse a cached
    // decision that was only correct for the first one.
    const cacheKey = `expr-${expr.type}-${this.currentRuleIndex}-${isStartRuleTopLevelSequence}-${JSON.stringify(expr)}`;

    return this.templateCache.get(cacheKey, () => {
      switch (expr.type) {
        case "StringLiteral":
          return this.generateStringLiteral(expr);
        case "CharacterClass":
          return this.generateOptimizedCharacterClass(expr);
        case "Identifier":
          return this.generateIdentifier(expr);
        case "QualifiedIdentifier":
          return this.generateQualifiedIdentifier(expr);
        case "AnyChar":
          return "anyChar()";
        case "Sequence":
          return this.generateOptimizedSequence(
            expr,
            isStartRuleTopLevelSequence,
          );
        case "Choice":
          return this.generateOptimizedChoice(expr);
        case "Group":
          return this.generateOptimizedExpression(expr.expression);
        case "Star": {
          const run = this.options.enableCharClassRun
            ? tryGenerateCharClassRunCode(expr.expression, 0)
            : null;
          if (run !== null) return run;
          return `zeroOrMore(${this.generateOptimizedExpression(expr.expression)})`;
        }
        case "Plus": {
          const run = this.options.enableCharClassRun
            ? tryGenerateCharClassRunCode(expr.expression, 1)
            : null;
          if (run !== null) return run;
          return `oneOrMore(${this.generateOptimizedExpression(expr.expression)})`;
        }
        case "Optional":
          return `optional(${this.generateOptimizedExpression(expr.expression)})`;
        case "Quantified":
          return this.generateQuantified(expr);
        case "PositiveLookahead":
          return `andPredicate(${this.generateOptimizedExpression(expr.expression)})`;
        case "NegativeLookahead":
          return `notPredicate(${this.generateOptimizedExpression(expr.expression)})`;
        case "Skip":
          // `applySkipDesugar`-inserted boundary skip -- same emission
          // as `codegen.ts`'s `Skip` case: `ignore` maps the success
          // value to the `IGNORED` sentinel `sequence`/`captureSequence`
          // filter out, so the rule's own value shape is unchanged.
          return `ignore(optional(${this.generateOptimizedExpression(expr.expression)}))`;
        case "Span":
          // `@expr` source-text extraction -- same emission as
          // `codegen.ts`'s `Span` case: `span` replaces the produced
          // value with the consumed source text.
          return `span(${this.generateOptimizedExpression(expr.expression)})`;
        case "WordBoundary":
          // `\b` / `\B` word-boundary assertion -- a bare parser
          // constant (`packages/core/src/boundary.ts`), no call.
          return expr.negated ? "nonWordBoundary" : "wordBoundary";
        case "LabeledExpression":
          return this.generateLabeledExpression(expr);
        case "ActionExpression":
          return this.generateActionExpression(expr);
        default:
          throw new Error(
            `Unsupported expression type: ${(expr as { type: string }).type}`,
          );
      }
    });
  }

  private generateStringLiteral(expr: StringLiteral): string {
    return generateStringLiteralCode(expr.value, (s) =>
      stringInterner.intern(s),
    );
  }

  private generateOptimizedCharacterClass(expr: CharacterClass): string {
    return generateCharacterClassCode(expr);
  }

  private generateIdentifier(expr: Identifier): string {
    return generateIdentifierCode(
      expr,
      {
        ruleNames: this.ruleNames,
        ruleIndex: this.ruleIndex,
        currentRuleIndex: this.currentRuleIndex,
        namePrefix: this.options.namePrefix,
      },
      (s) => stringInterner.intern(s),
    );
  }

  private generateQualifiedIdentifier(expr: QualifiedIdentifier): string {
    return generateQualifiedIdentifierCode(expr, (s) =>
      stringInterner.intern(s),
    );
  }

  private generateOptimizedSequence(
    expr: Sequence,
    isStartRuleTopLevel = false,
  ): string {
    const hasCut = expr.elements.some((el) => el.type === "Cut");
    // Computed once, up front: both single-part shortcuts below must agree
    // with the final `captureSequence`/`sequence` choice on whether THIS
    // sequence carries a label -- bypassing straight to the bare element's
    // own code when it does would return a still-CAPTURE_TAG-tagged value
    // (see `@suzumiyaaoba/tpeg-core`'s capture.ts) instead of the
    // untagged, merged one `captureSequence` produces, silently leaking an
    // inner label into any ancestor `captureSequence` that references this
    // rule unlabeled (regression: `rule = ~x:"v"` reduced to a single
    // `commit(capture("x", ...))` part and returned it bare). codegen.ts
    // has no such shortcut at all -- it always wraps -- so `hasLabel` is
    // exactly the condition under which skipping the wrap here would
    // diverge from it.
    const hasLabel = collectTopLevelLabels(expr).length > 0;
    // Elements that contribute a VALUE to this sequence's result:
    // everything but `~` cuts and `applySkipDesugar`-inserted `Skip`
    // markers (mirrors `codegen.ts`'s `generateSequence` -- the
    // `ignore(optional(...))` a `Skip` emits is filtered out of the
    // result tuple by the `IGNORED` sentinel, so it must not count
    // toward the bare-single-element shortcuts below either: a lone
    // `Skip` emitted bare would leak the sentinel itself as the
    // sequence's own value).
    const valueElementCount = expr.elements.filter(
      (el) => el.type !== "Cut" && el.type !== "Skip",
    ).length;

    if (!hasCut) {
      if (expr.elements.length === 0) {
        return "sequence()";
      }

      if (expr.elements.length === 1 && valueElementCount === 1 && !hasLabel) {
        const element = expr.elements[0];
        if (element) {
          return this.generateOptimizedExpression(element);
        }
      }
    }

    // A `~` cut marker (see the `Cut` node in grammar-types.ts) is dropped
    // entirely rather than emitted as a sequence()/captureSequence()
    // argument; every element *after* it is instead individually wrapped
    // in commit(...) (tpeg-core's combinators.ts) - mirrors
    // generateSequence in codegen.ts, see its comments for the full
    // rationale, including `isStartRuleTopLevel` (`true` only for the
    // single top-level call from `generateOptimizedRule` on the start
    // rule's own pattern), which switches this to emitting
    // `commitAtTopLevel` (tpeg-combinator) instead of `commit`
    // (tpeg-core) -- see `commitAtTopLevel`'s doc comment in
    // `packages/combinator/src/logic.ts` for the soundness condition.
    const parts: string[] = [];
    forEachSequenceElement(expr.elements, (el, committed, cutIsGlobal) => {
      const code = this.generateOptimizedExpression(el);
      parts.push(
        !committed
          ? code
          : isStartRuleTopLevel || cutIsGlobal
            ? `commitAtTopLevel(${code})`
            : `commit(${code})`,
      );
    });

    if (parts.length === 0) {
      return "sequence()";
    }
    if (valueElementCount === 1 && !hasLabel) {
      // Exactly one value-contributing element: this sequence's own
      // value must be that element's value, not a 1-tuple. With no
      // `Skip` siblings that's the bare emission (the `parts.length`
      // fast path); WITH them, the surrounding `sequence(...)` must
      // still run -- its `ignore(optional(...))` boundary skips consume
      // input -- but the `IGNORED` filter leaves a 1-tuple behind, so
      // `map` unwraps it back to the element's own value.
      if (parts.length === 1) {
        const [only] = parts;
        if (only) return only;
      }
      return `map(sequence(${parts.join(", ")}), ([v]) => v)`;
    }

    // A sequence with labeled elements needs its per-element captured
    // objects merged into one - `sequence()` returns a positional tuple
    // instead, which would leave labels unreachable by name.
    return hasLabel
      ? `captureSequence(${parts.join(", ")})`
      : `sequence(${parts.join(", ")})`;
  }

  private generateOptimizedChoice(expr: Choice): string {
    // NOTE: alternatives must NOT be reordered here. PEG's ordered choice
    // (`/`) is defined by "first alternative that matches wins" — the
    // declaration order is part of the grammar's semantics, not an
    // implementation detail. A previous version of this method sorted
    // alternatives by AST node count ("simple first") to try cheaper
    // parsers first, but that silently changes which language is
    // accepted: e.g. `"==" / "="` reordered to `"=" / "=="` makes `==`
    // permanently unmatchable, since `"="` (fewer nodes) would now be
    // tried — and would succeed — before `"=="` ever gets a chance.
    // The predictive-dispatch path below is the "prove it preserves the
    // original match result" version of that idea: it FILTERS (never
    // reorders) alternatives by a statically-proven-safe FIRST-set check,
    // so declaration order among whatever survives is untouched.
    return generateChoiceCode(
      expr,
      (alt) => this.generateOptimizedExpression(alt),
      (multi) => {
        if (this.options.enablePredictiveDispatch && this.firstSetAnalysis) {
          return (
            this.tryGeneratePredictiveChoice(multi, this.firstSetAnalysis) ??
            undefined
          );
        }
        return undefined;
      },
    );
  }

  /**
   * Computes the per-alternative `predictiveChoice` filters for `expr`,
   * or `null` when not a single alternative yields one (in which case
   * `predictiveChoice` would filter nothing and the caller falls back to
   * plain `choice`). Shared with `collectUsedCombinators`'s Choice case
   * so the import set can never disagree with the emitted code: a
   * grammar whose EVERY multi-alternative Choice is predictive-eligible
   * emits no `choice(...)` call at all, and importing `choice` there is
   * a `noUnusedLocals` compile error in the consumer (#83).
   */
  private predictiveChoiceFilters(
    expr: Choice,
    analysis: GrammarFirstSetAnalysis,
  ): readonly (CharSet | null)[] | null {
    // An alternative that could reach a `Cut` without having consumed any
    // input must never be skipped by a static "next character"/literal-
    // prefix guess -- see `canCommitWithoutConsuming`'s doc comment
    // (`first-sets.ts`) for why skipping it can change which alternative
    // a `fatal` failure ends up aborting the choice in favor of. Such an
    // alternative's filter is forced to `null`, exactly as if its FIRST
    // set were unresolvable.
    const unsafeToSkip = expr.alternatives.map((alt) =>
      canCommitWithoutConsuming(alt, analysis),
    );
    const filters = expr.alternatives.map((alt, i) =>
      unsafeToSkip[i] ? null : predictiveFilterForExpression(alt, analysis),
    );
    return filters.some((f) => f !== null) ? filters : null;
  }

  /**
   * Attempts to generate a `predictiveChoice(...)` call for `expr`.
   * Returns `null` (caller falls back to plain `choice`) if not a single
   * alternative has a computable, non-nullable FIRST set -- in that case
   * `predictiveChoice` would filter nothing and just add overhead over
   * `choice`.
   */
  private tryGeneratePredictiveChoice(
    expr: Choice,
    analysis: GrammarFirstSetAnalysis,
  ): string | null {
    const unsafeToSkip = expr.alternatives.map((alt) =>
      canCommitWithoutConsuming(alt, analysis),
    );
    const filters = this.predictiveChoiceFilters(expr, analysis);
    if (!filters) {
      return null;
    }

    // A literal-prefix trie slot is only emitted for a Choice
    // where at least one alternative actually has one -- see
    // `literalPrefixForExpression`'s doc comment. This keeps every Choice
    // WITHOUT a qualifying alternative byte-identical to before this
    // feature existed (2-element tuples), which is what the JSON
    // regression guard in `codegen-optimized.spec.ts` checks.
    const literalPrefixes = expr.alternatives.map((alt, i) =>
      unsafeToSkip[i] ? null : literalPrefixForExpression(alt),
    );
    const anyLiteralPrefix = literalPrefixes.some((p) => p !== null);

    const entries = expr.alternatives.map((alt, i) => {
      const code = this.generateOptimizedExpression(alt);
      const filter = filters[i];
      const filterCode = filter ? this.renderFirstCharFilter(filter) : "null";
      if (!anyLiteralPrefix) {
        return `[${code}, ${filterCode}]`;
      }
      const prefix = literalPrefixes[i];
      return `[${code}, ${filterCode}, ${
        prefix !== null ? JSON.stringify(prefix) : "null"
      }]`;
    });
    return `predictiveChoice([${entries.join(", ")}])`;
  }

  /**
   * Renders a `CharSet` (`./char-set.ts`, a sorted list of inclusive
   * code-point intervals) as a `FirstCharFilter` object literal
   * (`packages/core/src/combinators.ts`) -- just numeric bounds, since
   * both sides now agree on "code point" as the unit. No per-character
   * escaping or lowering needed here; that's the point of matching
   * `predictiveChoice`'s runtime check to `CharSet`'s own representation
   * instead of a separate UTF-16-code-unit shape.
   */
  private renderFirstCharFilter(filter: CharSet): string {
    const ranges = filter.map((r) => `{ lo: ${r.lo}, hi: ${r.hi} }`).join(", ");
    return `{ ranges: [${ranges}] }`;
  }

  private generateQuantified(expr: Quantified): string {
    const inner = this.generateOptimizedExpression(expr.expression);
    return generateQuantifiedCode(expr, inner, this.options.enableCharClassRun);
  }

  private generateLabeledExpression(expr: LabeledExpression): string {
    const inner = this.generateOptimizedExpression(expr.expression);
    return generateLabeledExpressionCode(expr.label, inner);
  }

  private generateActionExpression(expr: ActionExpression): string {
    const inner = this.generateOptimizedExpression(expr.expression);
    const labels = filterReferencedLabels(
      expr.code,
      collectTopLevelLabels(expr.expression),
    );
    return wrapWithAction(inner, expr.code, labels, this.options.includeTypes);
  }

  /**
   * Generate performance monitoring code
   */
  private generateMonitoringCode(): string {
    // `includeTypes: false` output is plain JavaScript (see `wrapWithAction`'s
    // doc comment for the `new Function` use case that contract protects),
    // so the type syntax below is emitted only when types are enabled.
    const t = this.options.includeTypes;
    return `
// Performance monitoring utilities
const performanceMonitor = {
  // A stack of start times per operation, not a single timestamp:
  // monitored rules can recurse, nesting same-name start/end pairs --
  // a lone timestamp silently drops the outer measurement (#109).
  startTimes: new Map${t ? "<string, number[]>" : ""}(),
  metrics: new Map${t ? "<string, { total: number; count: number }>" : ""}(),

  start(operation${t ? ": string" : ""})${t ? ": void" : ""} {
    const stack = this.startTimes.get(operation);
    if (stack) {
      stack.push(performance.now());
    } else {
      this.startTimes.set(operation, [performance.now()]);
    }
  },

  end(operation${t ? ": string" : ""})${t ? ": number" : ""} {
    const stack = this.startTimes.get(operation);
    if (stack === undefined || stack.length === 0) return 0;
    const startTime = stack.pop()${t ? " as number" : ""};
    if (stack.length === 0) this.startTimes.delete(operation);

    const duration = performance.now() - startTime;
    const existing = this.metrics.get(operation) || { total: 0, count: 0 };
    this.metrics.set(operation, {
      total: existing.total + duration,
      count: existing.count + 1
    });

    return duration;
  },

  report()${t ? ": void" : ""} {
    console.log('Parser Performance Report:');
    for (const [op, metrics] of this.metrics) {
      console.log(\`  \${op}: \${metrics.count} calls, avg \${(metrics.total / metrics.count).toFixed(2)}ms\`);
    }
  }
};

export { performanceMonitor };`;
  }
}

/**
 * Convenience function to generate optimized TypeScript parser code
 */
export function generateOptimizedTypeScriptParser(
  grammar: GrammarDefinition,
  options?: Partial<OptimizedCodeGenOptions>,
): OptimizedGeneratedCode {
  const generator = new OptimizedTPEGCodeGenerator({
    language: "typescript",
    ...options,
  });
  return generator.generateGrammar(grammar);
}
