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
  buildExternalIdentifierWarnings,
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
  findMemoizeAnnotation,
  applySkipDesugar,
  resolveStartRule,
  sequenceCombinatorFor,
  validateGeneratedIdentifiers,
  wrapWithAction,
  wrapWithMemoize,
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

    // `@skip`-desugar BEFORE every downstream walk -- the same point
    // `tpeg-parser`'s own generators apply it (`codegen.ts`/
    // `codegen-optimized.ts`): the grammar the emitted code implements
    // is the desugared one, so import collection, performance analysis,
    // and the rules loop must all see the `Skip`-inserted shape. (The
    // nullable-repetition check inside `validateGrammarForEtaGenerator`
    // is deliberately still on the ORIGINAL grammar: `Skip` nodes are
    // always nullable and only ever inserted at sequence boundaries, so
    // the verdict is provably identical either way.)
    const desugared = applySkipDesugar(grammar);

    globalPerformanceMonitor.start("eta-grammar-generation");

    const performanceAnalysis = analyzeGrammarPerformance(desugared);

    // Reset per-instance state so a reused generator doesn't leak rule
    // names/order from a previous grammar into this one's identifier
    // resolution.
    this.ruleNames.clear();
    this.ruleIndex.clear();
    desugared.rules.forEach((rule, index) => {
      this.ruleNames.add(rule.name);
      this.ruleIndex.set(rule.name, index);
    });

    const { lines: imports, bindings: importedBindings } = this.generateImports(
      desugared,
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
    validateGeneratedIdentifiers(desugared, {
      namePrefix: this.options.namePrefix,
      importedBindings: importedBindingsWithPerformance,
    });
    const exports: string[] = [];
    const rules: RuleTemplateData[] = [];

    // Generate template data for each rule, applying a matching TypeScript
    // transform function (if the grammar declares one) to the rule's result
    const transformsByRuleName = collectTransformFunctions(desugared);
    desugared.rules.forEach((rule, index) => {
      this.currentRuleIndex = index;
      const complexity = performanceAnalysis.ruleComplexity.get(rule.name);
      const transformFn = transformsByRuleName.get(rule.name);
      // An explicit `@memoize` annotation wins over `shouldMemoize`'s
      // complexity heuristic (and applies even when `enableMemoization`
      // is off) -- mirroring codegen-optimized.ts's "the user directly
      // saying memoize this rule" contract. Previously this generator
      // ignored the annotation entirely.
      const memoizeAnnotation = findMemoizeAnnotation(rule);
      const memoized = memoizeAnnotation
        ? false
        : this.shouldMemoize(complexity);
      const baseImplementation = this.generateRuleImplementation(rule);

      // When a transform or monitoring applies, memoization (if any) is
      // baked into the wrapper's own base-parser call instead of left to
      // the template's `memoize(<%= implementation %>)` wrapping -- that
      // would otherwise memoize the *transformed* result (or sit INSIDE
      // the monitoring timer, hiding memo hits), re-running the
      // transform's own caching semantics differently from
      // codegen.ts/codegen-optimized.ts. An annotated rule's wrap is
      // likewise always baked here: the `rule-memoized.eta` template
      // only emits a bare `memoize(...)`, which can't carry
      // `@memoize: N`'s `{ maxCacheSize: N }` argument.
      const bakeWrappers =
        transformFn !== undefined || this.options.includeMonitoring;
      const memoizedImplementation = memoizeAnnotation
        ? wrapWithMemoize(baseImplementation, memoizeAnnotation)
        : memoized && bakeWrappers
          ? `memoize(${baseImplementation})`
          : baseImplementation;
      let implementation = transformFn
        ? wrapWithTransform(rule.name, memoizedImplementation, transformFn)
        : memoizedImplementation;
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

    // Same `@start` alias as `codegen.ts`'s generateGrammar: an explicit
    // `@start: <name>` emits `export { <name> as start }` (appended to
    // the footer, which both templates render verbatim at end-of-file)
    // so the entry point is reachable under one stable name. Skipped
    // when the resolved rule's own emitted name is already `start`; a
    // DIFFERENT rule emitting `start` throws rather than silently
    // dropping the alias.
    const startRule = resolveStartRule(desugared);
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
        templateData.footer = `${templateData.footer}\nexport { ${startEmittedName} as start };`;
        exports.push("start");
      }
    }

    // Add the generated-file header for the optimized template
    if (this.options.optimize) {
      templateData.header = this.generateHeader(desugared);
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
      warnings: [
        ...buildExternalIdentifierWarnings(desugared),
        ...buildQualifiedIdentifierWarnings(desugared),
      ],
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
    /** Every binding name the emitted code can reference (`"Parser"` when
     * a `Parser` type annotation or import is emitted, `"memoize"` when
     * applicable, and each used combinator), for
     * `validateGeneratedIdentifiers` to check rule names against.
     * `lines` is empty when `includeImports` is false, but `bindings` is
     * populated regardless: the emitted code still CALLS these
     * combinators in that mode (the caller supplies the bindings), so a
     * rule named e.g. `sequence` or `untagCapture` would otherwise pass
     * validation and emit `export const sequence = sequence(...)`, a TDZ
     * `ReferenceError` at module evaluation -- matching `codegen.ts`'s
     * `buildImports` and `codegen-optimized.ts`'s import pass. */
    bindings: string[];
  } {
    const imports = [];
    const bindings: string[] = [];

    // `Parser` is referenced only by the `: Parser<...>` rule annotations
    // the templates render and the `import type` line emitted alongside
    // them (`includeTypes`) -- a rule named `Parser` collides with the
    // generated code only then.
    if (this.options.includeTypes) {
      bindings.push("Parser");
    }

    // Analyze which combinators are actually needed -- unconditionally,
    // since the emitted code calls them whether or not the import lines
    // are emitted (see the `bindings` doc above).
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
    // Whether to import it must match the per-rule emission decision
    // exactly: an explicit `@memoize` annotation (which applies even
    // when `enableMemoization` is off -- see the rule loop above), or
    // shouldMemoize's complexity check (estimatedComplexity === "high"
    // || hasRecursion). The coarser grammar-level
    // estimatedParseComplexity can stay "low" even when a single small
    // rule is genuinely recursive, which would skip this import while
    // a rule's generated code still called memoize().
    let anyRuleMemoized = grammar.rules.some(
      (rule) => findMemoizeAnnotation(rule) !== undefined,
    );
    if (!anyRuleMemoized && this.options.enableMemoization) {
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
      bindings.push("memoize");
    }

    const combinators = Array.from(usedCombinators).sort();
    bindings.push(...combinators);

    if (this.options.includeImports) {
      // Core imports. `Parser` only with `includeTypes` (see `bindings`
      // above): unused, it fails `noUnusedLocals` and isn't valid JS.
      if (this.options.includeTypes) {
        imports.push('import type { Parser } from "@suzumiyaaoba/tpeg-core";');
      }

      if (anyRuleMemoized) {
        imports.push(
          'import { memoize } from "@suzumiyaaoba/tpeg-combinator";',
        );
      }

      // Generate combinator import. Guarded on `length > 0` -- a grammar
      // whose every rule is a bare external-parser reference (see
      // `generateIdentifierCode`'s "external parser" escape hatch) needs
      // no `tpeg-core` combinator at all, and an unconditional push here
      // emitted `import {  } from "@suzumiyaaoba/tpeg-core";` (valid but
      // pointless) in that case. Mirrors `codegen.ts`'s identical guard.
      if (combinators.length > 0) {
        imports.push(
          `import { ${combinators.join(", ")} } from "@suzumiyaaoba/tpeg-core";`,
        );
      }
    }

    return { lines: imports, bindings };
  }

  /**
   * Generate performance-specific imports
   */
  private generatePerformanceImports(): string[] {
    const imports = [];

    // Gated on `includeImports` like every other import line: with
    // `includeImports: false` the caller supplies all bindings itself,
    // and this line used to be emitted anyway -- an `import` inside code
    // meant to be evaluated in a caller-provided scope.
    if (this.options.includeMonitoring && this.options.includeImports) {
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
      case "Skip":
        // `applySkipDesugar`-inserted boundary skip -- same emission as
        // `codegen.ts`'s `Skip` case: `ignore` maps the success value to
        // the `IGNORED` sentinel `sequence`/`captureSequence` filter
        // out, so the rule's own value shape is unchanged.
        return `ignore(optional(${this.generateExpressionCode(expr.expression)}))`;
      case "Span":
        // `@expr` source-text extraction -- same emission as
        // `codegen.ts`'s `Span` case: `span` replaces the produced
        // value with the consumed source text.
        return `span(${this.generateExpressionCode(expr.expression)})`;
      case "WordBoundary":
        // `\b` / `\B` word-boundary assertion -- a bare parser
        // constant (`packages/core/src/boundary.ts`), no call.
        return expr.negated ? "nonWordBoundary" : "wordBoundary";
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
    // Exactly one value-contributing element plus `Skip` siblings:
    // `sequence(...)` must still run -- its `ignore(optional(...))`
    // boundary skips consume input -- but the `IGNORED` filter leaves a
    // 1-tuple behind, so `map` unwraps it back to the element's own
    // value (mirrors `codegen.ts`/`codegen-optimized.ts`'s identical
    // shape; a multi-element or labeled sequence never reaches this).
    const valueElementCount = expr.elements.filter(
      (el) => el.type !== "Cut" && el.type !== "Skip",
    ).length;
    if (valueElementCount === 1 && combinator === "sequence") {
      return `map(sequence(${parts.join(", ")}), ([v]) => v)`;
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
  private shouldMemoize(complexity?: ExpressionComplexity): boolean {
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
