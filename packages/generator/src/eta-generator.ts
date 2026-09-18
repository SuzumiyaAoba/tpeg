/**
 * Eta Template Engine Based Code Generator for TPEG
 *
 * High-performance code generation using external template files
 * with complete type safety and predictable output.
 */

import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildQualifiedIdentifierWarnings,
  collectTopLevelLabels,
  collectTransformFunctions,
  collectUsedCombinators,
  filterReferencedLabels,
  forEachSequenceElement,
  generateCharacterClassCode,
  generateChoiceCode,
  generateIdentifierCode,
  generateLabeledExpressionCode,
  generateQualifiedIdentifierCode,
  generateQuantifiedCode,
  generateStringLiteralCode,
  sequenceCombinatorFor,
  validateGeneratedIdentifiers,
  wrapWithAction,
  wrapWithMonitoring,
  wrapWithTransform,
} from "@suzumiyaaoba/tpeg-parser";
import { Eta } from "eta";
import { validateGrammarForEtaGenerator } from "./grammar-validation";
import {
  analyzeGrammarPerformance,
  globalPerformanceMonitor,
} from "./performance-utils";
import type {
  ActionExpression,
  CharacterClass,
  Choice,
  CodeGenOptions,
  Expression,
  ExpressionComplexity,
  GeneratedCode,
  GrammarDefinition,
  Identifier,
  LabeledExpression,
  ParserTemplateData,
  QualifiedIdentifier,
  Quantified,
  RuleDefinition,
  RuleTemplateData,
  Sequence,
  StringLiteral,
} from "./types";

/**
 * Eta-based TPEG code generator
 */
export class EtaTPEGCodeGenerator {
  private eta: Eta;
  private options: Required<CodeGenOptions>;
  private ruleNames: Set<string> = new Set();
  /** Rule name -> declaration index, used to detect forward/self/mutual
   * references -- mirrors `packages/parser/src/codegen.ts`'s
   * `TPEGCodeGenerator` (`generateIdentifierCode`, shared from that
   * package, needs this same shape). */
  private ruleIndex: Map<string, number> = new Map();
  /** Declaration index of the rule currently being generated. */
  private currentRuleIndex = -1;

  constructor(options: CodeGenOptions = { language: "typescript" }) {
    // Get the directory of the current module
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const defaultTemplatesDir = join(__dirname, "../templates");

    this.options = {
      language: options.language,
      namePrefix: options.namePrefix ?? "",
      includeImports: options.includeImports ?? true,
      includeTypes: options.includeTypes ?? true,
      optimize: options.optimize ?? true,
      enableMemoization: options.enableMemoization ?? true,
      includeMonitoring: options.includeMonitoring ?? false,
      templatesDir: options.templatesDir ?? defaultTemplatesDir,
      cache: options.cache ?? true,
      debug: options.debug ?? false,
    };

    this.eta = new Eta({
      views: this.options.templatesDir,
      cache: this.options.cache,
      debug: this.options.debug,
      autoEscape: false,
      useWith: true,
    });
  }

  // ## A trap in every `.eta` template under `../templates`: Eta's default
  // `autoTrim: [false, "nl"]` strips a text chunk's LEADING newline when
  // that chunk is JUST a bare newline sitting between two adjacent tags
  // (e.g. `<% } %>` on its own line followed by another `<% ... %>` on the
  // next) -- but only when the chunk starts with nothing but the newline
  // itself; a chunk like `;\n` (real content before the newline) is left
  // alone. This bit `optimized/rule-optimized.eta`: its trailing
  // `<% if (it.comment) { %>\n// <%= it.comment %>\n<% } %>` block had TWO
  // such bare-newline chunks (before the `if` and before its closing
  // `}`), both silently stripped -- so a rule with a comment (`@memoize`'d,
  // recursive, or "high complexity") swallowed the FOLLOWING rule's entire
  // `export const ...` declaration into its own `//` line comment,
  // compiling to fewer rules than the grammar declared with no error at
  // all (fixed by emitting the comment's trailing newline as part of a
  // dynamically-interpolated string, `<%~ "// " + it.comment + "\n" %>`,
  // immune to this static-text trimming; see that file and
  // `eta-generator.spec.ts`'s "should generate consistent optimized code"
  // snapshot, and `eta-differential.spec.ts`'s pinned regression for it).
  // `base/rule.eta`/`base/rule-memoized.eta` have no equivalent risk today
  // (verified by rendering each standalone -- both templates end their
  // rule declaration at a SOLE closing tag with no adjacent bare-newline
  // chunk before it), but the SAME class of bug reappears the moment any
  // template here ends its own output at a tag boundary preceded by a
  // bare-newline separator rather than by dynamically-emitted content.

  /**
   * Generate TypeScript parser code from TPEG grammar
   */
  async generateGrammar(grammar: GrammarDefinition): Promise<GeneratedCode> {
    // Rejects duplicate rule names, left recursion, a cut-only pattern,
    // invalid transform function names, and unbounded repetition over a
    // nullable body BEFORE any code is generated -- the same
    // `validateGrammar` + `assertNoNullableRepetition` pair
    // `tpeg-parser`'s own generators run (see `grammar-validation.ts`'s
    // module doc comment for why this delegates rather than duplicating).
    validateGrammarForEtaGenerator(grammar);

    globalPerformanceMonitor.start("eta-grammar-generation");

    const performanceAnalysis = analyzeGrammarPerformance(grammar);

    // Reset per-instance state so a reused generator doesn't leak rule
    // names/order from a previous grammar into this one's identifier
    // resolution.
    this.ruleNames.clear();
    this.ruleIndex.clear();
    grammar.rules.forEach((rule, index) => {
      this.ruleNames.add(rule.name);
      this.ruleIndex.set(rule.name, index);
    });

    const { lines: imports, bindings: importedBindings } = this.generateImports(
      grammar,
      performanceAnalysis,
    );
    // `generatePerformanceImports()` (below) contributes its own binding,
    // `globalPerformanceMonitor`, whenever monitoring is on -- but only
    // gets CALLED later, inside the `this.options.optimize` branch that
    // builds `templateData`, well after this check used to run. A rule
    // actually named `globalPerformanceMonitor` slipped through this
    // validation as a result, producing generated code with both
    // `import { globalPerformanceMonitor } from "@suzumiyaaoba/tpeg-
    // generator";` and `export const globalPerformanceMonitor = ...;` --
    // a duplicate-export `SyntaxError`/bundler failure this check exists
    // specifically to catch. Reserving the name here unconditionally
    // (rather than only under the same `optimize && includeMonitoring`
    // gate that actually emits the import below) costs nothing -- no
    // real grammar names a rule after this package's own monitor -- and
    // stays correct even if that gate's shape changes later.
    const importedBindingsWithPerformance = this.options.includeMonitoring
      ? [...importedBindings, "globalPerformanceMonitor"]
      : importedBindings;
    // Reject a rule name, capture label, or transform parameter name
    // that would generate to a reserved word, an internal codegen name,
    // or one of the bindings `imports` above actually declares -- see
    // `validateGeneratedIdentifiers`'s doc comment
    // (`packages/parser/src/grammar-validation.ts`) for the concrete
    // failure modes (e.g. a rule named `class`, or one named `literal`
    // colliding with `import { literal }`). Imported directly from
    // `tpeg-parser` (already a real dependency of this package -- see
    // `collectTopLevelLabels`/`wrapWithAction`/etc. above), like
    // `validateGrammarForEtaGenerator` now does for the rest of the
    // structural checks.
    validateGeneratedIdentifiers(grammar, {
      namePrefix: this.options.namePrefix,
      importedBindings: importedBindingsWithPerformance,
    });
    const exports: string[] = [];
    const rules: RuleTemplateData[] = [];

    // Generate template data for each rule, applying a matching TypeScript
    // transform function (if the grammar declares one) to the rule's result
    const transformsByRuleName = collectTransformFunctions(grammar);
    grammar.rules.forEach((rule, index) => {
      this.currentRuleIndex = index;
      const complexity = performanceAnalysis.ruleComplexity.get(rule.name);
      const transformFn = transformsByRuleName.get(rule.name);
      const memoized = this.shouldMemoize(rule, complexity);
      const baseImplementation = this.generateRuleImplementation(rule);

      // When a transform or monitoring applies, memoization (if any) is
      // baked into the wrapper's own base-parser call instead of left to
      // the template's `memoize(<%= implementation %>)` wrapping -- that
      // would otherwise memoize the *transformed* result (or sit INSIDE
      // the monitoring timer, hiding memo hits), re-running the
      // transform's own caching semantics differently from
      // codegen.ts/codegen-optimized.ts.
      const bakeWrappers =
        transformFn !== undefined || this.options.includeMonitoring;
      let implementation = transformFn
        ? wrapWithTransform(
            rule.name,
            memoized ? `memoize(${baseImplementation})` : baseImplementation,
            transformFn,
          )
        : memoized && bakeWrappers
          ? `memoize(${baseImplementation})`
          : baseImplementation;
      // `includeMonitoring` previously only imported and re-exported
      // `globalPerformanceMonitor` without ever calling it -- instrument
      // each rule here so the option actually measures something. The wrap
      // is outermost so the timing covers memoization and the transform.
      if (this.options.includeMonitoring) {
        implementation = wrapWithMonitoring(
          rule.name,
          implementation,
          "globalPerformanceMonitor",
          this.options.includeTypes,
        );
      }

      const ruleData: RuleTemplateData = {
        namePrefix: this.options.namePrefix,
        name: rule.name,
        type: this.inferRuleType(rule),
        implementation,
        memoized: bakeWrappers ? false : memoized,
        includeTypes: this.options.includeTypes,
        comment: this.generateRuleComment(complexity) || undefined,
        complexity: complexity || undefined,
      };

      rules.push(ruleData);
      exports.push(this.options.namePrefix + rule.name);
    });

    const templateData: ParserTemplateData = {
      imports,
      rules,
      options: this.options,
    };

    // The `globalPerformanceMonitor` import and its re-export footer are
    // needed by BOTH template families whenever monitoring is on --
    // previously they were gated on `optimize`, so `optimize: false` +
    // `includeMonitoring: true` produced instrumented rules calling an
    // unimported binding. Both generators self-empty (`[]`/`""`) when
    // monitoring is off, so assigning them unconditionally is free.
    templateData.performanceImports = this.generatePerformanceImports();
    templateData.footer = this.generateFooter();

    // Add the generated-file header for the optimized template
    if (this.options.optimize) {
      templateData.header = this.generateHeader(grammar);
    }

    // Generate code using appropriate template
    const templateName = this.options.optimize
      ? "optimized/parser-file"
      : "base/parser-file";
    const code = await this.eta.renderAsync(templateName, templateData);

    const generationTime = globalPerformanceMonitor.end(
      "eta-grammar-generation",
    );

    return {
      code,
      imports,
      exports,
      warnings: buildQualifiedIdentifierWarnings(grammar),
      performance: {
        estimatedComplexity: performanceAnalysis.estimatedParseComplexity,
        optimizationSuggestions: performanceAnalysis.optimizationSuggestions,
        generationTime,
        templateEngine: "eta",
      },
    };
  }

  /**
   * Generate imports based on grammar analysis
   */
  private generateImports(
    grammar: GrammarDefinition,
    analysis: ReturnType<typeof analyzeGrammarPerformance>,
  ): {
    lines: string[];
    /** Every binding name these `lines` actually import (`"Parser"` plus
     * `"memoize"` when applicable and each used combinator), for
     * `validateGeneratedIdentifiers` to check rule names against. Empty
     * when `includeImports` is false, matching `lines` itself. */
    bindings: string[];
  } {
    const imports = [];
    const bindings: string[] = [];

    if (this.options.includeImports) {
      bindings.push("Parser");
      // Core imports
      imports.push('import type { Parser } from "@suzumiyaaoba/tpeg-core";');

      // Analyze which combinators are actually needed
      const usedCombinators = new Set<string>();

      grammar.rules.forEach((rule, index) => {
        this.collectUsedCombinators(rule.pattern, usedCombinators, index);
      });

      // Every rule's emitted implementation is wrapped in
      // `untagCapture(...)` (see `generateRuleImplementation`) regardless
      // of its pattern -- same rule-boundary normalization
      // `codegen.ts`/`codegen-optimized.ts` apply -- so the import is
      // needed unconditionally whenever the grammar declares any rule.
      if (grammar.rules.length > 0) {
        usedCombinators.add("untagCapture");
      }

      // memoize lives in tpeg-combinator, not tpeg-core, so it gets its own
      // import line rather than being folded into usedCombinators below --
      // tpeg-core doesn't export it.
      //
      // Whether to import it must match shouldMemoize's own per-rule check
      // exactly (estimatedComplexity === "high" || hasRecursion). The
      // coarser grammar-level estimatedParseComplexity can stay "low" even
      // when a single small rule is genuinely recursive, which would skip
      // this import while a rule's generated code still called memoize().
      let anyRuleMemoized = false;
      if (this.options.enableMemoization) {
        for (const complexity of analysis.ruleComplexity.values()) {
          if (
            complexity.estimatedComplexity === "high" ||
            complexity.hasRecursion
          ) {
            anyRuleMemoized = true;
            break;
          }
        }
      }
      if (anyRuleMemoized) {
        imports.push(
          'import { memoize } from "@suzumiyaaoba/tpeg-combinator";',
        );
        bindings.push("memoize");
      }

      // Generate combinator import. Guarded on `length > 0` -- a grammar
      // whose every rule is a bare external-parser reference (see
      // `generateIdentifierCode`'s "external parser" escape hatch) needs
      // no `tpeg-core` combinator at all, and an unconditional push here
      // emitted `import {  } from "@suzumiyaaoba/tpeg-core";` (valid but
      // pointless) in that case. Mirrors `codegen.ts`'s identical guard.
      const combinators = Array.from(usedCombinators).sort();
      if (combinators.length > 0) {
        imports.push(
          `import { ${combinators.join(", ")} } from "@suzumiyaaoba/tpeg-core";`,
        );
        bindings.push(...combinators);
      }
    }

    return { lines: imports, bindings };
  }

  /**
   * Generate performance-specific imports
   */
  private generatePerformanceImports(): string[] {
    const imports = [];

    if (this.options.includeMonitoring) {
      imports.push(
        'import { globalPerformanceMonitor } from "@suzumiyaaoba/tpeg-generator";',
      );
    }

    return imports;
  }

  /**
   * Collect all combinators used in an expression. `currentRuleIndex` is
   * the declaration index of the rule this expression tree belongs to --
   * needed for the `Identifier` case to decide, exactly like
   * `generateIdentifier`/`generateIdentifierCode` do, whether a reference
   * is forward/self/mutual (and therefore emitted as `lazy(() => ...)`,
   * which needs the import).
   *
   * Delegates to the shared `collectUsedCombinators` in
   * `packages/parser/src/codegen.ts` (re-exported by `tpeg-parser`) with
   * this generator's own decisions: `generateChoice` returns a
   * single-alternative `Choice` bare (no `choice` import), `generateSequence`
   * wraps every element after ANY `Cut` in `commit(...)` (this generator
   * never emits `commitAtTopLevel`, so `commitAfterAnyCut` is `true`),
   * and this generator has no `charClassRun` path.
   */
  private collectUsedCombinators(
    expr: Expression,
    combinators: Set<string>,
    currentRuleIndex: number,
  ): void {
    collectUsedCombinators(expr, combinators, {
      ruleIndex: this.ruleIndex,
      currentRuleIndex,
      enableCharClassRun: false,
      commitAfterAnyCut: true,
      choiceCombinatorFor: (choice) =>
        choice.alternatives.length === 1 ? null : "choice",
    });
  }

  /**
   * Generate implementation code for a rule
   */
  private generateRuleImplementation(rule: RuleDefinition): string {
    // `untagCapture` strips a surviving CAPTURE_TAG at the rule boundary --
    // see `codegen.ts`'s `generateRule` for why a rule's own pattern can
    // still yield a tagged object and why that must not leak into an
    // enclosing `captureSequence` merge.
    return `untagCapture(${this.generateExpressionCode(rule.pattern)})`;
  }

  /**
   * Generate code for any expression type
   */
  private generateExpressionCode(expr: Expression): string {
    switch (expr.type) {
      case "StringLiteral":
        return this.generateStringLiteral(expr);
      case "CharacterClass":
        return this.generateCharacterClass(expr);
      case "Identifier":
        return this.generateIdentifier(expr);
      case "QualifiedIdentifier":
        return this.generateQualifiedIdentifier(expr);
      case "AnyChar":
        return "anyChar()";
      case "Sequence":
        return this.generateSequence(expr);
      case "Choice":
        return this.generateChoice(expr);
      case "Group":
        return this.generateExpressionCode(expr.expression);
      case "Star":
        return `zeroOrMore(${this.generateExpressionCode(expr.expression)})`;
      case "Plus":
        return `oneOrMore(${this.generateExpressionCode(expr.expression)})`;
      case "Optional":
        return `optional(${this.generateExpressionCode(expr.expression)})`;
      case "Quantified":
        return this.generateQuantified(expr);
      case "PositiveLookahead":
        return `andPredicate(${this.generateExpressionCode(expr.expression)})`;
      case "NegativeLookahead":
        return `notPredicate(${this.generateExpressionCode(expr.expression)})`;
      case "LabeledExpression":
        return this.generateLabeledExpression(expr);
      case "ActionExpression":
        return this.generateActionExpression(expr);
      case "Cut":
        // Only reachable via `generateSequence`'s single-element
        // shortcut, for the degenerate case of a rule whose entire
        // pattern is just `~` -- `generateSequence` itself drops a `Cut`
        // from any multi-element sequence (see its own doc comment), so
        // this mirrors what that reduces to: an empty sequence.
        return "sequence()";
      default:
        throw new Error(
          `Unsupported expression type: ${(expr as { type: string }).type}`,
        );
    }
  }

  // `generateStringLiteral`/`generateCharacterClass` delegate to
  // `packages/parser/src/codegen.ts`'s shared `generateStringLiteralCode`/
  // `generateCharacterClassCode` (both re-exported by `tpeg-parser`'s
  // entry point): those escape control characters (newline, tab, CR, and
  // other non-printables) via `constants.ts`'s `escapeStringLiteral`,
  // where this module's own former copy only escaped backslash/double-
  // quote -- a `StringLiteral`/`CharacterClass` containing a literal
  // control character (e.g. `"\n"`, `[\t]`) would otherwise be emitted as
  // a raw control byte inside a `"..."` source literal, invalid
  // TypeScript.
  private generateStringLiteral(expr: StringLiteral): string {
    return generateStringLiteralCode(expr.value);
  }

  private generateCharacterClass(expr: CharacterClass): string {
    return generateCharacterClassCode(expr);
  }

  // `generateIdentifier` delegates to the shared `generateIdentifierCode`:
  // a reference to a rule declared LATER than (or equal to, for
  // self-recursion) the current rule must be emitted as `lazy(() => ...)`
  // rather than a bare identifier, or the generated module throws a `const`
  // temporal-dead-zone `ReferenceError` the moment it's evaluated -- this
  // module's own former version never did that, so any forward/self/mutual
  // rule reference broke every generated parser at load time.
  private generateIdentifier(expr: Identifier): string {
    return generateIdentifierCode(expr, {
      ruleNames: this.ruleNames,
      ruleIndex: this.ruleIndex,
      currentRuleIndex: this.currentRuleIndex,
      namePrefix: this.options.namePrefix,
    });
  }

  private generateQualifiedIdentifier(expr: QualifiedIdentifier): string {
    return generateQualifiedIdentifierCode(expr);
  }

  private generateSequence(expr: Sequence): string {
    // A `~` cut marker is dropped from the emitted arguments entirely --
    // it consumes no input and contributes no value of its own -- and
    // every element *after* it is individually wrapped in `commit(...)`,
    // via the same `forEachSequenceElement` state machine `codegen.ts`'s
    // `generateSequence` uses (see that function's doc comment for the
    // full rationale, including why wrapping each element individually
    // rather than nesting the tail in a sub-sequence keeps the emitted
    // tuple shape unchanged, and why the single-remaining-part shortcut
    // below must be checked AFTER dropping the cut -- not on the
    // original element count, which would wrongly wrap a degenerate
    // `~ "a"` / `"a" ~` in `sequence(...)`, turning its value from `"a"`
    // into `["a"]`). Unlike `codegen.ts` this generator never emits
    // `commitAtTopLevel`, so `cutIsGlobal` is ignored: EVERY committed
    // element gets the ordinary `commit(...)` wrapper, which is also
    // what this generator's `collectUsedCombinators` ctx
    // (`commitAfterAnyCut: true`) mirrors.
    const parts: string[] = [];
    forEachSequenceElement(expr.elements, (el, committed) => {
      const code = this.generateExpressionCode(el);
      parts.push(committed ? `commit(${code})` : code);
    });
    if (parts.length === 0) {
      return "sequence()";
    }
    // `sequenceCombinatorFor` returns `null` exactly when the sequence
    // is emitted BARE (one surviving non-`Cut` element, no label) --
    // the same shared predicate `codegen.ts` and `codegen-optimized.ts`
    // use. A labeled sole survivor still goes through `captureSequence`
    // below, or its CAPTURE_TAG-tagged value would leak out bare instead
    // of merged.
    const combinator = sequenceCombinatorFor(expr);
    if (combinator === null && parts.length === 1) {
      const [only] = parts;
      if (only) return only;
    }
    // A sequence with labeled elements needs its per-element captured
    // objects merged into one named-field object -- plain `sequence()`
    // returns a positional tuple instead (each label's value left nested
    // inside it, still `capture()`-tagged), which would leave every label
    // unreachable by name. Mirrors `codegen.ts`'s identical check.
    return `${combinator ?? "sequence"}(${parts.join(", ")})`;
  }

  private generateChoice(expr: Choice): string {
    return generateChoiceCode(expr, (alt) => this.generateExpressionCode(alt));
  }

  private generateQuantified(expr: Quantified): string {
    const inner = this.generateExpressionCode(expr.expression);
    // Delegates to the shared `generateQuantifiedCode`
    // (`packages/parser/src/codegen.ts`, re-exported by `tpeg-parser`) --
    // `{n}` must go through `quantified(...)` for every `n`, `{1}`
    // included, or the generated parser returns scalar `T` where every
    // other repetition form produces `T[]`. `false` for
    // `enableCharClassRun`: this generator has no charClassRun path.
    return generateQuantifiedCode(expr, inner, false);
  }

  private generateLabeledExpression(expr: LabeledExpression): string {
    const inner = this.generateExpressionCode(expr.expression);
    return generateLabeledExpressionCode(expr.label, inner);
  }

  // Delegates to the shared `collectTopLevelLabels`/`filterReferencedLabels`/
  // `wrapWithAction` (`packages/parser/src/codegen.ts`, re-exported by
  // `tpeg-parser`) -- this module previously had no `ActionExpression`
  // case at all, so a grammar with an inline `{ ... }` action threw
  // `Unsupported expression type: ActionExpression` at generation time
  // even though `validateGrammarForEtaGenerator` (`grammar-validation.ts`)
  // accepts the node.
  private generateActionExpression(expr: ActionExpression): string {
    const inner = this.generateExpressionCode(expr.expression);
    const labels = filterReferencedLabels(
      expr.code,
      collectTopLevelLabels(expr.expression),
    );
    return wrapWithAction(inner, expr.code, labels, this.options.includeTypes);
  }

  /**
   * Infer TypeScript type for a rule
   */
  private inferRuleType(_rule: RuleDefinition): string {
    // For now, return 'any' - this could be enhanced with actual type inference
    return "any";
  }

  /**
   * Determine if a rule should be memoized
   *
   * KNOWN GAP (not yet fixed here): this is the same
   * `hasRecursion || estimatedComplexity === "high"` proxy that
   * `packages/parser/src/codegen-optimized.ts` used before being
   * replaced by the reentrancy analysis in
   * `packages/parser/src/reentrancy.ts` -- see that module's doc comment
   * for why the proxy under-memoizes some non-recursive grammars (e.g.
   * `BENCH_ACYCLIC_CHAIN_GRAMMAR` in `packages/parser/bench/grammars.ts`)
   * and over-memoizes some recursive ones (a FIRST-disjoint recursive
   * choice, e.g. JSON's `value`). Still left unported here even though
   * `tpeg-generator` now depends on `tpeg-parser` (see
   * `packages/generator/package.json` -- added so this module could
   * share `codegen.ts`'s `lazy()`/escaping/`ActionExpression` handling
   * instead of re-diverging from it) -- `packages/cli/src/cli.ts`
   * generates code via `tpeg-parser`'s `generateTypeScriptParser`/
   * `generateOptimizedTypeScriptParser` directly, not via this Eta-based
   * generator, so this heuristic still doesn't sit on the path the
   * `tpeg` CLI actually exercises. Swapping this proxy for
   * `packages/parser/src/reentrancy.ts`'s analysis (now importable) is
   * an independent follow-up, not part of this fix.
   */
  private shouldMemoize(
    _rule: RuleDefinition,
    complexity?: ExpressionComplexity,
  ): boolean {
    if (!this.options.enableMemoization || !complexity) {
      return false;
    }

    return complexity.estimatedComplexity === "high" || complexity.hasRecursion;
  }

  /**
   * Generate comment for a rule based on complexity
   */
  private generateRuleComment(
    complexity?: ExpressionComplexity,
  ): string | undefined {
    if (!complexity) return undefined;

    const comments = [];
    if (complexity.estimatedComplexity === "high") {
      comments.push("High complexity rule");
    }
    if (complexity.hasRecursion) {
      comments.push("contains recursion");
    }
    if (complexity.depth > 10) {
      comments.push(`deep nesting (${complexity.depth} levels)`);
    }

    return comments.length > 0 ? comments.join(", ") : undefined;
  }

  /**
   * Generate file header
   */
  private generateHeader(grammar: GrammarDefinition): string {
    // `grammar.name` lands inside a block comment -- a hand-built
    // `GrammarDefinition` (the grammar parser itself only produces
    // identifier-shaped names) can carry `*/` in it, which would close
    // the comment early and turn the rest of the name into live code.
    // Neutralize the terminator rather than rejecting: the name is
    // cosmetic here (not part of the generated API).
    const safeName = grammar.name.replace(/\*\//g, "*\\/");
    return `/**
 * Generated TPEG Parser: ${safeName}
 *
 * This file was automatically generated from a TPEG grammar.
 * Do not edit this file directly - regenerate from the grammar instead.
 */`;
  }

  /**
   * Generate file footer
   */
  private generateFooter(): string {
    if (this.options.includeMonitoring) {
      return `
// Performance monitoring exports
export { globalPerformanceMonitor };`;
    }
    return "";
  }
}

/**
 * Convenience function to generate TypeScript parser code using Eta templates
 */
export async function generateEtaTypeScriptParser(
  grammar: GrammarDefinition,
  options?: Partial<CodeGenOptions>,
): Promise<GeneratedCode> {
  const generator = new EtaTPEGCodeGenerator({
    language: "typescript",
    ...options,
  });
  return generator.generateGrammar(grammar);
}
