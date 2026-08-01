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

import {
  collectTopLevelLabels,
  collectTransformFunctions,
  filterReferencedLabels,
  findMemoizeAnnotation,
  wrapWithAction,
  wrapWithMemoize,
  wrapWithTransform,
} from "./codegen";
import { escapeStringLiteral } from "./constants";
import type { GrammarFirstSetAnalysis } from "./first-sets";
import { analyzeFirstSets, predictiveFilterForExpression } from "./first-sets";
import {
  analyzeGrammarPerformance,
  globalPerformanceMonitor,
  stringInterner,
} from "./performance-utils";
import type { ReentrancyAnalysis } from "./reentrancy";
import { analyzeReentrancy } from "./reentrancy";

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
   * Default `false`: this is a narrowly-scoped, explicitly opt-in
   * experiment (see the plan's Phase 3 section) -- unlike
   * `enableMemoization`, it is NOT wired into `optimize: true` by
   * default, following the same reasoning as `ast-optimize.ts`'s
   * rewrites (Phase 0's lesson: an "optimization" must not silently
   * change existing callers' output).
   */
  enablePredictiveDispatch?: boolean;
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

  constructor(options: OptimizedCodeGenOptions = { language: "typescript" }) {
    this.options = {
      language: options.language,
      namePrefix: options.namePrefix ?? "",
      includeImports: options.includeImports ?? true,
      includeTypes: options.includeTypes ?? true,
      optimize: options.optimize ?? true,
      enableMemoization: options.enableMemoization ?? true,
      includeMonitoring: options.includeMonitoring ?? false,
      enablePredictiveDispatch: options.enablePredictiveDispatch ?? false,
    };
  }

  /**
   * Generate optimized TypeScript parser code from a TPEG grammar
   */
  generateGrammar(grammar: GrammarDefinition): OptimizedGeneratedCode {
    globalPerformanceMonitor.start("grammar-generation");

    // Reset per-instance state so a reused generator doesn't leak rule
    // names or cached expression templates from a previous grammar.
    this.ruleNames.clear();
    this.ruleIndex.clear();
    this.templateCache.clear();
    this.firstSetAnalysis = this.options.enablePredictiveDispatch
      ? analyzeFirstSets(grammar)
      : null;
    this.reentrancyAnalysis = this.options.enableMemoization
      ? analyzeReentrancy(grammar)
      : null;

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
      const ruleCode = this.generateOptimizedRule(
        rule,
        transformsByRuleName.get(rule.name),
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

    grammar.rules.forEach((rule, index) => {
      this.collectUsedCombinators(rule.pattern, usedCombinators, index);
    });

    // Add performance imports if needed. memoize lives in tpeg-combinator,
    // not tpeg-core, so it must not also be folded into the tpeg-core
    // import below -- that would import a name tpeg-core doesn't export.
    // An explicit `@memoize` annotation on any rule forces the import
    // regardless of `enableMemoization`/reentrancy -- see
    // `generateOptimizedRule`, which applies it independently of the
    // automatic trigger below.
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
    if (
      (this.reentrancyAnalysis &&
        this.reentrancyAnalysis.reentrantRules.size > 0) ||
      grammar.rules.some((rule) => findMemoizeAnnotation(rule))
    ) {
      imports.push('import { memoize } from "@suzumiyaaoba/tpeg-combinator";');
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
  ): void {
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
        if (expr.elements.some((el) => el.type === "Cut")) {
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
        combinators.add("zeroOrMore");
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "Plus":
        combinators.add("oneOrMore");
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
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
      case "Quantified":
        // Add the quantified combinator for quantified expressions
        combinators.add("quantified");
        // Also add basic combinators that might be used as fallbacks
        combinators.add("zeroOrMore");
        combinators.add("oneOrMore");
        combinators.add("optional");
        combinators.add("choice");
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
    }
  }

  /**
   * Generate optimized code for a single rule definition
   */
  private generateOptimizedRule(
    rule: RuleDefinition,
    transformFn?: TransformFunction,
  ): string {
    const innerCode = this.generateOptimizedExpression(rule.pattern);

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
   * Generate optimized code for any expression type with caching
   */
  private generateOptimizedExpression(expr: Expression): string {
    // Use object identity for caching when possible. Identifier codegen
    // depends on this.currentRuleIndex (whether the reference needs a
    // `lazy` wrapper), so it must be part of the key - otherwise the same
    // rule name referenced from two different rules could reuse a cached
    // decision that was only correct for the first one.
    const cacheKey = `expr-${expr.type}-${this.currentRuleIndex}-${JSON.stringify(expr)}`;

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
          return this.generateOptimizedSequence(expr as Sequence);
        case "Choice":
          return this.generateOptimizedChoice(expr as Choice);
        case "Group":
          return this.generateOptimizedExpression((expr as Group).expression);
        case "Star":
          return `zeroOrMore(${this.generateOptimizedExpression((expr as Star).expression)})`;
        case "Plus":
          return `oneOrMore(${this.generateOptimizedExpression((expr as Plus).expression)})`;
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
    const escaped = escapeStringLiteral(expr.value);
    return `literal("${stringInterner.intern(escaped)}")`;
  }

  private generateOptimizedCharacterClass(expr: CharacterClass): string {
    const ranges = expr.ranges
      .map((range) => {
        if (range.end) {
          return `["${escapeStringLiteral(range.start)}", "${escapeStringLiteral(range.end)}"]`;
        }
        return `"${escapeStringLiteral(range.start)}"`;
      })
      .join(", ");

    const combinator = expr.negated ? "negatedCharClass" : "charClass";
    return `${combinator}(${ranges})`;
  }

  private generateIdentifier(expr: Identifier): string {
    const name = stringInterner.intern(expr.name);
    if (this.ruleNames.has(name)) {
      const prefixedName = stringInterner.intern(
        this.options.namePrefix + name,
      );
      // A reference to a rule declared at or after the current one would
      // read that `const` before its initializer has run (forward
      // reference, self-recursion, or mutual recursion) - defer the lookup
      // with `lazy` so it only resolves once every rule has been declared.
      const targetIndex = this.ruleIndex.get(name);
      if (targetIndex !== undefined && targetIndex >= this.currentRuleIndex) {
        return `lazy(() => ${prefixedName})`;
      }
      return prefixedName;
    }
    return name;
  }

  private generateQualifiedIdentifier(expr: QualifiedIdentifier): string {
    // References a rule exported from another module, e.g. `math.expr`.
    // The generated code assumes the module is imported as a namespace
    // object under its alias (see namespace-manager.ts's import resolution).
    return stringInterner.intern(`${expr.module}.${expr.name}`);
  }

  private generateOptimizedSequence(expr: Sequence): string {
    const hasCut = expr.elements.some((el) => el.type === "Cut");

    if (!hasCut) {
      if (expr.elements.length === 0) {
        return "sequence()";
      }

      if (expr.elements.length === 1) {
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
    // rationale.
    const parts: string[] = [];
    let committed = false;
    for (const el of expr.elements) {
      if (el.type === "Cut") {
        committed = true;
        continue;
      }
      const code = this.generateOptimizedExpression(el);
      parts.push(committed ? `commit(${code})` : code);
    }

    if (parts.length === 0) {
      return "sequence()";
    }
    if (parts.length === 1) {
      const [only] = parts;
      if (only) return only;
    }

    // A sequence with labeled elements needs its per-element captured
    // objects merged into one - `sequence()` returns a positional tuple
    // instead, which would leave labels unreachable by name.
    return collectTopLevelLabels(expr).length > 0
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
    const filters = expr.alternatives.map((alt) =>
      predictiveFilterForExpression(alt, analysis),
    );
    if (!filters.some((f) => f !== null)) {
      return null;
    }

    const entries = expr.alternatives.map((alt, i) => {
      const code = this.generateOptimizedExpression(alt);
      const filter = filters[i];
      return `[${code}, ${filter ? this.renderFirstCharFilter(filter) : "null"}]`;
    });
    return `predictiveChoice([${entries.join(", ")}])`;
  }

  private renderFirstCharFilter(filter: {
    chars: ReadonlySet<string>;
    ranges: readonly { start: string; end: string }[];
  }): string {
    const chars = [...filter.chars]
      .map((c) => `"${escapeStringLiteral(c)}"`)
      .join(", ");
    const ranges = filter.ranges
      .map(
        (r) =>
          `{ start: "${escapeStringLiteral(r.start)}", end: "${escapeStringLiteral(r.end)}" }`,
      )
      .join(", ");
    return `{ chars: new Set([${chars}]), ranges: [${ranges}] }`;
  }

  private generateQuantified(expr: Quantified): string {
    const inner = this.generateOptimizedExpression(expr.expression);

    if (expr.max === undefined) {
      // {n,} - at least n
      if (expr.min === 0) return `zeroOrMore(${inner})`;
      if (expr.min === 1) return `oneOrMore(${inner})`;
      // Use quantified combinator for {n,} where n > 1
      return `quantified(${inner}, ${expr.min})`;
    }

    if (expr.min === expr.max) {
      // {n} - exactly n
      if (expr.min === 0) {
        // {0} always matches zero repetitions, producing an empty array --
        // not "choice()", which always fails.
        return `quantified(${inner}, 0, 0)`;
      }
      if (expr.min === 1) return inner;
      // Use quantified combinator for exact repetition {n}
      return `quantified(${inner}, ${expr.min}, ${expr.max})`;
    }

    // {n,m} - between n and m
    if (expr.min === 0 && expr.max === 1) {
      return `optional(${inner})`;
    }

    // Use quantified combinator for general {n,m} case
    return `quantified(${inner}, ${expr.min}, ${expr.max})`;
  }

  private generateLabeledExpression(expr: LabeledExpression): string {
    const inner = this.generateOptimizedExpression(expr.expression);
    return `capture("${expr.label}", ${inner})`;
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
