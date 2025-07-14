/**
 * Eta Template Engine Based Code Generator for TPEG
 *
 * High-performance code generation using external template files
 * with complete type safety and predictable output.
 */

import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Eta } from "eta";
import {
  analyzeGrammarPerformance,
  globalPerformanceMonitor,
} from "./performance-utils";
import type {
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
  Quantified,
  RuleDefinition,
  RuleTemplateData,
  Sequence,
  Star,
  StringLiteral,
} from "./types";

/**
 * Eta-based TPEG code generator
 */
export class EtaTPEGCodeGenerator {
  private eta: Eta;
  private options: Required<CodeGenOptions>;
  private ruleNames: Set<string> = new Set();

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

  /**
   * Generate TypeScript parser code from TPEG grammar
   */
  async generateGrammar(grammar: GrammarDefinition): Promise<GeneratedCode> {
    globalPerformanceMonitor.start("eta-grammar-generation");

    const performanceAnalysis = analyzeGrammarPerformance(grammar);

    // Collect all rule names for reference resolution
    for (const rule of grammar.rules) {
      this.ruleNames.add(rule.name);
    }

    const imports = this.generateImports(grammar, performanceAnalysis);
    const exports: string[] = [];
    const rules: RuleTemplateData[] = [];

    // Generate template data for each rule
    for (const rule of grammar.rules) {
      const complexity = performanceAnalysis.ruleComplexity.get(rule.name);
      const ruleData: RuleTemplateData = {
        namePrefix: this.options.namePrefix,
        name: rule.name,
        type: this.inferRuleType(rule),
        implementation: this.generateRuleImplementation(rule),
        memoized: this.shouldMemoize(rule, complexity),
        includeTypes: this.options.includeTypes,
        comment: this.generateRuleComment(complexity) || undefined,
        complexity: complexity || undefined,
      };

      rules.push(ruleData);
      exports.push(this.options.namePrefix + rule.name);
    }

    const templateData: ParserTemplateData = {
      imports,
      rules,
      options: this.options,
    };

    // Add performance imports for optimized template
    if (this.options.optimize) {
      templateData.performanceImports =
        this.generatePerformanceImports(performanceAnalysis);
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
    _analysis: ReturnType<typeof analyzeGrammarPerformance>,
  ): string[] {
    const imports = [];

    if (this.options.includeImports) {
      // Core imports
      imports.push('import type { Parser } from "tpeg-core";');

      // Analyze which combinators are actually needed
      const usedCombinators = new Set<string>();
      usedCombinators.add("literal"); // Always needed for string literals

      for (const rule of grammar.rules) {
        this.collectUsedCombinators(rule.pattern, usedCombinators);
      }

      // Add memoization import if needed
      if (
        this.options.enableMemoization &&
        _analysis.estimatedParseComplexity !== "low"
      ) {
        usedCombinators.add("memoize");
      }

      // Generate combinator import
      const combinators = Array.from(usedCombinators).sort();
      imports.push(`import { ${combinators.join(", ")} } from "tpeg-core";`);
    }

    return imports;
  }

  /**
   * Generate performance-specific imports
   */
  private generatePerformanceImports(
    _analysis: ReturnType<typeof analyzeGrammarPerformance>,
  ): string[] {
    const imports = [];

    if (this.options.includeMonitoring) {
      imports.push(
        'import { globalPerformanceMonitor } from "tpeg-generator";',
      );
    }

    return imports;
  }

  /**
   * Collect all combinators used in an expression
   */
  private collectUsedCombinators(
    expr: Expression,
    combinators: Set<string>,
  ): void {
    switch (expr.type) {
      case "CharacterClass":
        combinators.add("charClass");
        break;
      case "Sequence":
        combinators.add("sequence");
        for (const element of (expr as Sequence).elements) {
          this.collectUsedCombinators(element, combinators);
        }
        break;
      case "Choice":
        combinators.add("choice");
        for (const alternative of (expr as Choice).alternatives) {
          this.collectUsedCombinators(alternative, combinators);
        }
        break;
      case "Star":
        combinators.add("zeroOrMore");
        this.collectUsedCombinators((expr as Star).expression, combinators);
        break;
      case "Plus":
        combinators.add("oneOrMore");
        this.collectUsedCombinators((expr as Plus).expression, combinators);
        break;
      case "Optional":
        combinators.add("optional");
        this.collectUsedCombinators((expr as Optional).expression, combinators);
        break;
      case "PositiveLookahead":
        combinators.add("andPredicate");
        this.collectUsedCombinators(
          (expr as PositiveLookahead).expression,
          combinators,
        );
        break;
      case "NegativeLookahead":
        combinators.add("notPredicate");
        this.collectUsedCombinators(
          (expr as NegativeLookahead).expression,
          combinators,
        );
        break;
      case "Group":
        this.collectUsedCombinators((expr as Group).expression, combinators);
        break;
      case "LabeledExpression":
        combinators.add("capture");
        this.collectUsedCombinators(
          (expr as LabeledExpression).expression,
          combinators,
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
        this.collectUsedCombinators(quantifiedExpr.expression, combinators);
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
      case "AnyChar":
        return "anyChar";
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
      default:
        throw new Error(
          `Unsupported expression type: ${(expr as { type: string }).type}`,
        );
    }
  }

  private generateStringLiteral(expr: StringLiteral): string {
    const escaped = expr.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `literal("${escaped}")`;
  }

  private generateCharacterClass(expr: CharacterClass): string {
    const ranges = expr.ranges
      .map((range) => {
        if (range.end) {
          return `{ from: "${range.start}", to: "${range.end}" }`;
        }
        return `"${range.start}"`;
      })
      .join(", ");

    const negated = expr.negated ? ", true" : "";
    return `charClass([${ranges}]${negated})`;
  }

  private generateIdentifier(expr: Identifier): string {
    const name = expr.name;
    if (this.ruleNames.has(name)) {
      return this.options.namePrefix + name;
    }
    return name;
  }

  private generateSequence(expr: Sequence): string {
    if (expr.elements.length === 0) {
      return "sequence()";
    }

    if (expr.elements.length === 1) {
      const element = expr.elements[0];
      if (element) {
        return this.generateExpressionCode(element);
      }
    }

    const elements = expr.elements.map((el) => this.generateExpressionCode(el));
    return `sequence(${elements.join(", ")})`;
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

  /**
   * Infer TypeScript type for a rule
   */
  private inferRuleType(_rule: RuleDefinition): string {
    // For now, return 'any' - this could be enhanced with actual type inference
    return "any";
  }

  /**
   * Determine if a rule should be memoized
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
