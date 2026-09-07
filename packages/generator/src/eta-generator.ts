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
  filterReferencedLabels,
  generateCharacterClassCode,
  generateIdentifierCode,
  generateQualifiedIdentifierCode,
  generateStringLiteralCode,
  validateGeneratedIdentifiers,
  wrapWithAction,
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
  Group,
  Identifier,
  LabeledExpression,
  NegativeLookahead,
  Optional,
  ParserTemplateData,
  Plus,
  PositiveLookahead,
  QualifiedIdentifier,
  Quantified,
  RuleDefinition,
  RuleTemplateData,
  Sequence,
  Star,
  StringLiteral,
  TransformFunction,
} from "./types";

/**
 * Target language transform functions are matched against when a grammar
 * carries multiple `transforms ... @language { ... }` blocks.
 */
const CODEGEN_TARGET_LANGUAGE = "typescript";

/**
 * Builds a rule-name -> TransformFunction lookup for the TypeScript-targeted
 * transform set on a grammar. If more than one TypeScript transform set is
 * present, the first one (in declaration order) wins.
 */
const collectTransformFunctions = (
  grammar: GrammarDefinition,
): Map<string, TransformFunction> => {
  const byName = new Map<string, TransformFunction>();
  const transformSet = grammar.transforms?.find(
    (t) => t.transformSet.targetLanguage === CODEGEN_TARGET_LANGUAGE,
  )?.transformSet;

  if (!transformSet) {
    return byName;
  }

  for (const fn of transformSet.functions) {
    byName.set(fn.name, fn);
  }

  return byName;
};

/**
 * Wraps a rule's generated parser expression so that, on a successful parse,
 * the matching TypeScript transform function's body runs against the parse
 * result (the rule's capture structure) and its Result<T> return value
 * becomes the parser's own success/failure outcome.
 */
const wrapWithTransform = (
  ruleName: string,
  parserCode: string,
  transformFn: TransformFunction,
): string => {
  const paramName = transformFn.parameters[0]?.name ?? "captures";
  return `(input, pos) => {
  const __base = (${parserCode});
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __transformed = ((${paramName}) => {
${transformFn.body}
  })(__result.val);
  if (!__transformed.success) {
    return {
      success: false,
      error: {
        message: __transformed.error ?? "Transform failed",
        pos: __result.current,
        parserName: "${ruleName}",
        expected: "successful transform",
        found: JSON.stringify(__result.val),
      },
    };
  }
  return {
    success: true,
    val: __transformed.value,
    current: __result.current,
    next: __result.next,
  };
}`;
};

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
    // and unbounded repetition over a nullable body BEFORE any code is
    // generated -- see `grammar-validation.ts`'s module doc comment for
    // why this package carries its own copy of these checks rather than
    // importing `tpeg-parser`'s.
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
    // `collectTopLevelLabels`/`wrapWithAction`/etc. above) rather than
    // duplicated into this package's own `grammar-validation.ts`, unlike
    // that file's other checks -- see this call's sibling
    // `validateGrammarForEtaGenerator` for why THOSE are a deliberate,
    // pre-existing duplication this fix doesn't revisit.
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

      // When a transform applies, memoization (if any) is baked into the
      // wrapper's own base-parser call instead of left to the template's
      // `memoize(<%= implementation %>)` wrapping -- that would otherwise
      // memoize the *transformed* result, re-running the transform's own
      // caching semantics differently from codegen.ts/codegen-optimized.ts.
      const implementation = transformFn
        ? wrapWithTransform(
            rule.name,
            memoized ? `memoize(${baseImplementation})` : baseImplementation,
            transformFn,
          )
        : baseImplementation;

      const ruleData: RuleTemplateData = {
        namePrefix: this.options.namePrefix,
        name: rule.name,
        type: this.inferRuleType(rule),
        implementation,
        memoized: transformFn ? false : memoized,
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

    // Add performance imports for optimized template
    if (this.options.optimize) {
      templateData.performanceImports = this.generatePerformanceImports();
      templateData.header = this.generateHeader(grammar);
      templateData.footer = this.generateFooter();
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
   * needed for the `Identifier` case below to decide, exactly like
   * `generateIdentifier`/`generateIdentifierCode` do, whether a reference
   * is forward/self/mutual (and therefore emitted as `lazy(() => ...)`,
   * which needs the import).
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
        combinators.add(
          (expr as CharacterClass).negated ? "negatedCharClass" : "charClass",
        );
        break;
      case "AnyChar":
        combinators.add("anyChar");
        break;
      case "Identifier": {
        // Mirrors `generateIdentifier`'s decision (via the shared
        // `generateIdentifierCode`): a forward/self/mutual reference is
        // generated as `lazy(() => name)`, which needs the import.
        const targetIndex = this.ruleIndex.get((expr as Identifier).name);
        if (targetIndex !== undefined && targetIndex >= currentRuleIndex) {
          combinators.add("lazy");
        }
        break;
      }
      case "Sequence": {
        // Mirrors `generateSequence`'s own single-surviving-element
        // shortcut: with exactly one non-`Cut` element and no label, that
        // element's own generated code is returned bare, never passed
        // through `sequence(...)`/`captureSequence(...)` at all (e.g.
        // `~ "a"`, where the Cut is dropped and "a" is the sole remaining
        // element) -- see the identical fix/comment in
        // `packages/parser/src/codegen.ts`'s own `collectUsedCombinators`.
        const hasLabel = collectTopLevelLabels(expr).length > 0;
        const nonCutElementCount = (expr as Sequence).elements.filter(
          (el) => el.type !== "Cut",
        ).length;
        const isBareSinglePassthrough = nonCutElementCount === 1 && !hasLabel;
        if (!isBareSinglePassthrough) {
          combinators.add(hasLabel ? "captureSequence" : "sequence");
        }
        for (const element of (expr as Sequence).elements) {
          if (element.type === "Cut") {
            // Dropped from the emitted sequence() call itself (see
            // `generateSequence`); every element after it is wrapped in
            // `commit(...)` instead, so that import is needed here too.
            combinators.add("commit");
            continue;
          }
          this.collectUsedCombinators(element, combinators, currentRuleIndex);
        }
        break;
      }
      case "Cut":
        break;
      case "Choice":
        // Mirrors `generateChoice`'s own single-alternative shortcut:
        // exactly one alternative is returned bare, never passed through
        // `choice(...)` at all.
        if ((expr as Choice).alternatives.length !== 1) {
          combinators.add("choice");
        }
        for (const alternative of (expr as Choice).alternatives) {
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
          (expr as Star).expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "Plus":
        combinators.add("oneOrMore");
        this.collectUsedCombinators(
          (expr as Plus).expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "Optional":
        combinators.add("optional");
        this.collectUsedCombinators(
          (expr as Optional).expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "PositiveLookahead":
        combinators.add("andPredicate");
        this.collectUsedCombinators(
          (expr as PositiveLookahead).expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "NegativeLookahead":
        combinators.add("notPredicate");
        this.collectUsedCombinators(
          (expr as NegativeLookahead).expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "Group":
        this.collectUsedCombinators(
          (expr as Group).expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "LabeledExpression":
        combinators.add("capture");
        this.collectUsedCombinators(
          (expr as LabeledExpression).expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "ActionExpression":
        this.collectUsedCombinators(
          (expr as ActionExpression).expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "Quantified": {
        const quantifiedExpr = expr as Quantified;
        // Add combinator based on what the quantified expression will generate
        if (quantifiedExpr.max === undefined) {
          if (quantifiedExpr.min === 0) combinators.add("zeroOrMore");
          else if (quantifiedExpr.min === 1) combinators.add("oneOrMore");
          else combinators.add("quantified");
        } else if (quantifiedExpr.min === quantifiedExpr.max) {
          if (quantifiedExpr.min !== 1) combinators.add("quantified");
        } else {
          if (quantifiedExpr.min === 0 && quantifiedExpr.max === 1) {
            combinators.add("optional");
          } else {
            combinators.add("quantified");
          }
        }
        this.collectUsedCombinators(
          quantifiedExpr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      }
    }
  }

  /**
   * Generate implementation code for a rule
   */
  private generateRuleImplementation(rule: RuleDefinition): string {
    return this.generateExpressionCode(rule.pattern);
  }

  /**
   * Generate code for any expression type
   */
  private generateExpressionCode(expr: Expression): string {
    switch (expr.type) {
      case "StringLiteral":
        return this.generateStringLiteral(expr as StringLiteral);
      case "CharacterClass":
        return this.generateCharacterClass(expr as CharacterClass);
      case "Identifier":
        return this.generateIdentifier(expr as Identifier);
      case "QualifiedIdentifier":
        return this.generateQualifiedIdentifier(expr as QualifiedIdentifier);
      case "AnyChar":
        return "anyChar()";
      case "Sequence":
        return this.generateSequence(expr as Sequence);
      case "Choice":
        return this.generateChoice(expr as Choice);
      case "Group":
        return this.generateExpressionCode((expr as Group).expression);
      case "Star":
        return `zeroOrMore(${this.generateExpressionCode((expr as Star).expression)})`;
      case "Plus":
        return `oneOrMore(${this.generateExpressionCode((expr as Plus).expression)})`;
      case "Optional":
        return `optional(${this.generateExpressionCode((expr as Optional).expression)})`;
      case "Quantified":
        return this.generateQuantified(expr as Quantified);
      case "PositiveLookahead":
        return `andPredicate(${this.generateExpressionCode((expr as PositiveLookahead).expression)})`;
      case "NegativeLookahead":
        return `notPredicate(${this.generateExpressionCode((expr as NegativeLookahead).expression)})`;
      case "LabeledExpression":
        return this.generateLabeledExpression(expr as LabeledExpression);
      case "ActionExpression":
        return this.generateActionExpression(expr as ActionExpression);
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
    // every element *after* it is individually wrapped in `commit(...)`.
    // Mirrors `codegen.ts`'s `generateSequence` exactly (see that
    // function's doc comment for the full rationale, including why
    // wrapping each element individually rather than nesting the tail in
    // a sub-sequence keeps the emitted tuple shape unchanged, and why the
    // single-remaining-part shortcut below must be checked AFTER dropping
    // the cut -- not on the original element count, which would wrongly
    // wrap a degenerate `~ "a"` / `"a" ~` in `sequence(...)`, turning its
    // value from `"a"` into `["a"]`).
    const hasLabel = collectTopLevelLabels(expr).length > 0;
    const parts: string[] = [];
    let committed = false;
    for (const el of expr.elements) {
      if (el.type === "Cut") {
        committed = true;
        continue;
      }
      const code = this.generateExpressionCode(el);
      parts.push(committed ? `commit(${code})` : code);
    }
    if (parts.length === 0) {
      return "sequence()";
    }
    if (parts.length === 1 && !hasLabel) {
      const [only] = parts;
      if (only) return only;
    }
    // A sequence with labeled elements needs its per-element captured
    // objects merged into one named-field object -- plain `sequence()`
    // returns a positional tuple instead (each label's value left nested
    // inside it, still `capture()`-tagged), which would leave every label
    // unreachable by name. Mirrors `codegen.ts`'s identical check.
    return hasLabel
      ? `captureSequence(${parts.join(", ")})`
      : `sequence(${parts.join(", ")})`;
  }

  private generateChoice(expr: Choice): string {
    if (expr.alternatives.length === 0) {
      return "choice()";
    }

    if (expr.alternatives.length === 1) {
      const alternative = expr.alternatives[0];
      if (alternative) {
        return this.generateExpressionCode(alternative);
      }
    }

    const alternatives = expr.alternatives.map((alt) =>
      this.generateExpressionCode(alt),
    );
    return `choice(${alternatives.join(", ")})`;
  }

  private generateQuantified(expr: Quantified): string {
    const inner = this.generateExpressionCode(expr.expression);

    // Special cases that map to existing combinators
    if (expr.max === undefined) {
      if (expr.min === 0) return `zeroOrMore(${inner})`;
      if (expr.min === 1) return `oneOrMore(${inner})`;
      return `quantified(${inner}, ${expr.min})`;
    }

    if (expr.min === expr.max) {
      if (expr.min === 0) return `quantified(${inner}, 0, 0)`; // {0,0} - always returns empty array
      if (expr.min === 1) return inner;
      return `quantified(${inner}, ${expr.min}, ${expr.max})`;
    }

    // Range case {min,max}
    if (expr.min === 0 && expr.max === 1) {
      return `optional(${inner})`;
    }

    return `quantified(${inner}, ${expr.min}, ${expr.max})`;
  }

  private generateLabeledExpression(expr: LabeledExpression): string {
    const inner = this.generateExpressionCode(expr.expression);
    return `capture("${expr.label}", ${inner})`;
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
    return `/**
 * Generated TPEG Parser: ${grammar.name}
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
