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
  Group,
  Identifier,
  LabeledExpression,
  NegativeLookahead,
  Optional,
  Plus,
  PositiveLookahead,
  QualifiedIdentifier,
  Quantified,
  RuleDefinition,
  Sequence,
  Star,
  StringLiteral,
  TransformFunction,
} from "./types";

import type { CharSet } from "./char-set";
import {
  collectTopLevelLabels,
  collectTransformFunctions,
  filterReferencedLabels,
  findMemoizeAnnotation,
  generateCharacterClassCode,
  generateIdentifierCode,
  generateLabeledExpressionCode,
  generateQualifiedIdentifierCode,
  generateQuantifiedCode,
  generateStringLiteralCode,
  isRuleReferencedAnywhere,
  tryGenerateCharClassRunCode,
  wrapWithAction,
  wrapWithMemoize,
  wrapWithTransform,
} from "./codegen";
import { grammarHasGlobalCut } from "./codegen";
import type { GrammarFirstSetAnalysis } from "./first-sets";
import {
  analyzeFirstSets,
  assertNoNullableRepetition,
  canCommitWithoutConsuming,
  predictiveFilterForExpression,
} from "./first-sets";
import { validateGrammar } from "./grammar-validation";
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
  /** Enable performance optimizations */
  optimize?: boolean;
  /** Enable memoization for complex expressions */
  enableMemoization?: boolean;
  /** Generate performance monitoring code */
  includeMonitoring?: boolean;
  /**
   * Emit `predictiveChoice(...)` instead of `choice(...)` for a `Choice`
   * whenever at least one alternative has a statically computable,
   * non-nullable FIRST set (see `packages/parser/src/first-sets.ts`).
   *
   * Default `true` (like `enableMemoization`), unlike this package's other
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
   * generator's default is identical (`true`) for the identical reason:
   * the emitted value is byte-identical to the unfused shape, so there's
   * no risk surface to gate behind an opt-in.
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
   * direct element of the grammar's start rule's (`rules[0]`) own
   * top-level Sequence -- computed once per `generateGrammar` call. See
   * `codegen.ts`'s `isRuleReferencedAnywhere` doc comment: that shape
   * alone is NOT sufficient, since `rules[0]` being referenced by name
   * from elsewhere in the grammar (a live backtrack point above what
   * `commitAtTopLevel` assumes has none) makes the narrow structural
   * condition this codebase's codegen relies on unsound. `true` before
   * the first `generateGrammar` call only as an unused default. */
  private startRuleIsSafeForCommitAtTopLevel = true;

  constructor(options: OptimizedCodeGenOptions = { language: "typescript" }) {
    this.options = {
      language: options.language,
      namePrefix: options.namePrefix ?? "",
      includeImports: options.includeImports ?? true,
      includeTypes: options.includeTypes ?? true,
      optimize: options.optimize ?? true,
      enableMemoization: options.enableMemoization ?? true,
      includeMonitoring: options.includeMonitoring ?? false,
      enablePredictiveDispatch: options.enablePredictiveDispatch ?? true,
      enableRegexFusion: options.enableRegexFusion ?? false,
      regexFusionScope: options.regexFusionScope ?? "rule",
      regexFusionMinWeight: options.regexFusionMinWeight ?? MIN_FUSION_WEIGHT,
      enableCharClassRun: options.enableCharClassRun ?? true,
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
    this.firstSetAnalysis = analyzeFirstSets(grammar);
    assertNoNullableRepetition(grammar, this.firstSetAnalysis);
    // See this field's own doc comment for why the narrow
    // `isStartRuleTopLevel` shape needs this extra check.
    const startRuleName = grammar.rules[0]?.name;
    this.startRuleIsSafeForCommitAtTopLevel =
      startRuleName !== undefined &&
      !isRuleReferencedAnywhere(grammar, startRuleName);
    this.reentrancyAnalysis = this.options.enableMemoization
      ? analyzeReentrancy(grammar)
      : null;
    if (this.options.enableRegexFusion && this.firstSetAnalysis) {
      this.fusionRoots = planFusion(grammar, this.firstSetAnalysis, {
        scope: this.options.regexFusionScope,
        minWeight: this.options.regexFusionMinWeight,
      }).roots;
    }

    const performanceAnalysis = analyzeGrammarPerformance(grammar);
    const imports: string[] = [];
    const exports: string[] = [];
    const parts: string[] = [];

    // Collect all rule names and their declaration order first for
    // reference resolution (see generateIdentifier) - generateOptimizedImports
    // below needs ruleIndex populated to know whether a "lazy" import is
    // required.
    grammar.rules.forEach((rule, index) => {
      this.ruleNames.add(stringInterner.intern(rule.name));
      this.ruleIndex.set(rule.name, index);
    });

    // Add optimized imports based on usage analysis
    if (this.options.includeImports) {
      imports.push(...this.generateOptimizedImports(grammar));
    }

    // Generate parser for each rule with optimization, applying a matching
    // TypeScript transform function (if the grammar declares one)
    const transformsByRuleName = collectTransformFunctions(grammar);
    grammar.rules.forEach((rule, index) => {
      this.currentRuleIndex = index;
      this.currentRuleName = rule.name;
      const ruleCode = this.generateOptimizedRule(
        rule,
        transformsByRuleName.get(rule.name),
        index === 0 && this.startRuleIsSafeForCommitAtTopLevel,
      );
      parts.push(ruleCode);
      exports.push(stringInterner.intern(rule.name));
    });

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
  private generateOptimizedImports(grammar: GrammarDefinition): string[] {
    const imports = [];

    // Core imports
    imports.push('import type { Parser } from "@suzumiyaaoba/tpeg-core";');

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
        index === 0 && this.startRuleIsSafeForCommitAtTopLevel,
      );
    });

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
    const startRule = grammar.rules[0];
    if (
      (this.startRuleIsSafeForCommitAtTopLevel &&
        startRule?.pattern.type === "Sequence" &&
        startRule.pattern.elements.some((el) => el.type === "Cut")) ||
      grammarHasGlobalCut(grammar)
    ) {
      combinatorPackageImports.push("commitAtTopLevel");
    }
    if (combinatorPackageImports.length > 0) {
      imports.push(
        `import { ${combinatorPackageImports.join(", ")} } from "@suzumiyaaoba/tpeg-combinator";`,
      );
    }

    // Generate optimized combinator import
    const combinators = Array.from(usedCombinators).sort();
    imports.push(
      `import { ${combinators.join(", ")} } from "@suzumiyaaoba/tpeg-core";`,
    );

    return imports;
  }

  /**
   * Collect all combinators used in an expression
   */
  private collectUsedCombinators(
    expr: Expression,
    combinators: Set<string>,
    currentRuleIndex: number,
    isStartRuleTopLevel = false,
  ): void {
    // A fusion root (`this.fusionRoots`, populated by `planFusion` in
    // `generateGrammar`) compiles to one `regexFusedMap(...)` call in
    // `generateOptimizedExpression` -- checked FIRST, before the switch,
    // so it applies uniformly whether `expr` is a whole rule's pattern
    // (`regexFusionScope: "rule"`) or an interior node reached through
    // recursion (`"subtree"`). Not walking further into `expr` here is
    // what keeps this pass and `generateOptimizedExpression` in
    // lockstep: neither one ever looks at what's inside a fused node.
    if (this.fusionRoots.has(expr)) {
      combinators.add("regexFusedMap");
      return;
    }
    switch (expr.type) {
      case "StringLiteral":
        combinators.add("literal");
        break;
      case "CharacterClass":
        combinators.add(expr.negated ? "negatedCharClass" : "charClass");
        break;
      case "AnyChar":
        combinators.add("anyChar");
        break;
      case "Identifier": {
        // Mirrors generateIdentifier's decision: a forward/self/mutual
        // reference is generated as `lazy(() => name)`, which needs the
        // import.
        const targetIndex = this.ruleIndex.get(expr.name);
        if (targetIndex !== undefined && targetIndex >= currentRuleIndex) {
          combinators.add("lazy");
        }
        break;
      }
      case "Sequence":
        combinators.add(
          collectTopLevelLabels(expr).length > 0
            ? "captureSequence"
            : "sequence",
        );
        // Mirrors codegen.ts's identical guard: when this IS the start
        // rule's own top-level Sequence, OR a Cut here was marked
        // `global: true` by `promoteGlobalCuts`, it emits
        // `commitAtTopLevel` (tpeg-combinator) instead of `commit`
        // (tpeg-core) -- see generateOptimizedSequence -- so `commit`
        // must not be added to the tpeg-core import set in that case.
        if (
          expr.elements.some(
            (el) =>
              el.type === "Cut" && !isStartRuleTopLevel && el.global !== true,
          )
        ) {
          combinators.add("commit");
        }
        for (const element of expr.elements) {
          if (element.type === "Cut") continue;
          this.collectUsedCombinators(element, combinators, currentRuleIndex);
        }
        break;
      case "Choice":
        combinators.add("choice");
        // Whether this *particular* Choice ends up eligible for
        // `predictiveChoice` depends on FIRST-set analysis this pass
        // doesn't have (it only walks the raw AST) -- import it
        // whenever the option is on and there's more than one
        // alternative, rather than duplicating that analysis here. An
        // unused import in the rare all-unknown-FIRST-set case is
        // harmless in generated code.
        if (
          this.options.enablePredictiveDispatch &&
          expr.alternatives.length > 1
        ) {
          combinators.add("predictiveChoice");
        }
        for (const alternative of expr.alternatives) {
          this.collectUsedCombinators(
            alternative,
            combinators,
            currentRuleIndex,
          );
        }
        break;
      case "Star":
        // Mirrors generateOptimizedExpression's Star case exactly (same
        // option check, same `tryGenerateCharClassRunCode` call), so the
        // import set and the generated code can never disagree.
        if (
          this.options.enableCharClassRun &&
          tryGenerateCharClassRunCode(expr.expression, 0) !== null
        ) {
          combinators.add("charClassRun");
        } else {
          combinators.add("zeroOrMore");
          this.collectUsedCombinators(
            expr.expression,
            combinators,
            currentRuleIndex,
          );
        }
        break;
      case "Plus":
        // Mirrors generateOptimizedExpression's Plus case -- see the
        // Star case's comment just above.
        if (
          this.options.enableCharClassRun &&
          tryGenerateCharClassRunCode(expr.expression, 1) !== null
        ) {
          combinators.add("charClassRun");
        } else {
          combinators.add("oneOrMore");
          this.collectUsedCombinators(
            expr.expression,
            combinators,
            currentRuleIndex,
          );
        }
        break;
      case "Optional":
        combinators.add("optional");
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "PositiveLookahead":
        combinators.add("andPredicate");
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "NegativeLookahead":
        combinators.add("notPredicate");
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "Group":
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "LabeledExpression":
        combinators.add("capture");
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "ActionExpression":
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "Quantified": {
        const quantified = expr as Quantified;
        // Add the quantified combinator for quantified expressions
        combinators.add("quantified");
        // Also add basic combinators that might be used as fallbacks
        combinators.add("zeroOrMore");
        combinators.add("oneOrMore");
        combinators.add("optional");
        combinators.add("choice");
        // {0,}/{1,} over a bare CharacterClass collapses to
        // `charClassRun` instead (mirrors `generateQuantifiedCode`'s
        // decision exactly, via the same call) -- add its import, and
        // skip recursing into the CharacterClass itself so it doesn't
        // ALSO add an unused charClass/negatedCharClass import.
        const usesRun =
          this.options.enableCharClassRun &&
          quantified.max === undefined &&
          (quantified.min === 0 || quantified.min === 1) &&
          tryGenerateCharClassRunCode(
            quantified.expression,
            quantified.min as 0 | 1,
          ) !== null;
        if (usesRun) {
          combinators.add("charClassRun");
        } else {
          this.collectUsedCombinators(
            quantified.expression,
            combinators,
            currentRuleIndex,
          );
        }
        break;
      }
    }
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
    const innerCode = this.generateOptimizedExpression(
      rule.pattern,
      isStartRule,
    );

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
          return this.generateStringLiteral(expr as StringLiteral);
        case "CharacterClass":
          return this.generateOptimizedCharacterClass(expr as CharacterClass);
        case "Identifier":
          return this.generateIdentifier(expr as Identifier);
        case "QualifiedIdentifier":
          return this.generateQualifiedIdentifier(expr as QualifiedIdentifier);
        case "AnyChar":
          return "anyChar()";
        case "Sequence":
          return this.generateOptimizedSequence(
            expr as Sequence,
            isStartRuleTopLevelSequence,
          );
        case "Choice":
          return this.generateOptimizedChoice(expr as Choice);
        case "Group":
          return this.generateOptimizedExpression((expr as Group).expression);
        case "Star": {
          const run = this.options.enableCharClassRun
            ? tryGenerateCharClassRunCode((expr as Star).expression, 0)
            : null;
          if (run !== null) return run;
          return `zeroOrMore(${this.generateOptimizedExpression((expr as Star).expression)})`;
        }
        case "Plus": {
          const run = this.options.enableCharClassRun
            ? tryGenerateCharClassRunCode((expr as Plus).expression, 1)
            : null;
          if (run !== null) return run;
          return `oneOrMore(${this.generateOptimizedExpression((expr as Plus).expression)})`;
        }
        case "Optional":
          return `optional(${this.generateOptimizedExpression((expr as Optional).expression)})`;
        case "Quantified":
          return this.generateQuantified(expr as Quantified);
        case "PositiveLookahead":
          return `andPredicate(${this.generateOptimizedExpression((expr as PositiveLookahead).expression)})`;
        case "NegativeLookahead":
          return `notPredicate(${this.generateOptimizedExpression((expr as NegativeLookahead).expression)})`;
        case "LabeledExpression":
          return this.generateLabeledExpression(expr as LabeledExpression);
        case "ActionExpression":
          return this.generateActionExpression(expr as ActionExpression);
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

    if (!hasCut) {
      if (expr.elements.length === 0) {
        return "sequence()";
      }

      if (expr.elements.length === 1 && !hasLabel) {
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
    let committed = false;
    let committingCutIsGlobal = false;
    for (const el of expr.elements) {
      if (el.type === "Cut") {
        committed = true;
        committingCutIsGlobal = el.global === true;
        continue;
      }
      const code = this.generateOptimizedExpression(el);
      if (!committed) {
        parts.push(code);
      } else {
        parts.push(
          isStartRuleTopLevel || committingCutIsGlobal
            ? `commitAtTopLevel(${code})`
            : `commit(${code})`,
        );
      }
    }

    if (parts.length === 0) {
      return "sequence()";
    }
    if (parts.length === 1 && !hasLabel) {
      const [only] = parts;
      if (only) return only;
    }

    // A sequence with labeled elements needs its per-element captured
    // objects merged into one - `sequence()` returns a positional tuple
    // instead, which would leave labels unreachable by name.
    return hasLabel
      ? `captureSequence(${parts.join(", ")})`
      : `sequence(${parts.join(", ")})`;
  }

  private generateOptimizedChoice(expr: Choice): string {
    if (expr.alternatives.length === 0) {
      return "choice()";
    }

    if (expr.alternatives.length === 1) {
      const alternative = expr.alternatives[0];
      if (alternative) {
        return this.generateOptimizedExpression(alternative);
      }
    }

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
    if (this.options.enablePredictiveDispatch && this.firstSetAnalysis) {
      const predictive = this.tryGeneratePredictiveChoice(
        expr,
        this.firstSetAnalysis,
      );
      if (predictive) return predictive;
    }

    const alternatives = expr.alternatives.map((alt) =>
      this.generateOptimizedExpression(alt),
    );
    return `choice(${alternatives.join(", ")})`;
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
    // An alternative that could reach a `Cut` without having consumed any
    // input must never be skipped by a static "next character"/literal-
    // prefix guess -- see `canCommitWithoutConsuming`'s doc comment
    // (`first-sets.ts`) for why skipping it can change which alternative
    // a `fatal` failure ends up aborting the choice in favor of. Both
    // guards below are forced to `null` for such an alternative, exactly
    // as if its FIRST set were unresolvable.
    const unsafeToSkip = expr.alternatives.map((alt) =>
      canCommitWithoutConsuming(alt, analysis),
    );
    const filters = expr.alternatives.map((alt, i) =>
      unsafeToSkip[i] ? null : predictiveFilterForExpression(alt, analysis),
    );
    if (!filters.some((f) => f !== null)) {
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
    return `
// Performance monitoring utilities
const performanceMonitor = {
  startTimes: new Map(),
  metrics: new Map(),
  
  start(operation) {
    this.startTimes.set(operation, performance.now());
  },
  
  end(operation) {
    const startTime = this.startTimes.get(operation);
    if (!startTime) return 0;
    
    const duration = performance.now() - startTime;
    const existing = this.metrics.get(operation) || { total: 0, count: 0 };
    this.metrics.set(operation, {
      total: existing.total + duration,
      count: existing.count + 1
    });
    
    this.startTimes.delete(operation);
    return duration;
  },
  
  report() {
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
