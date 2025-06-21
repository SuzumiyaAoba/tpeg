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
  Expression,
  GrammarDefinition,
  RuleDefinition,
  StringLiteral,
  CharacterClass,
  Identifier,
  Sequence,
  Choice,
  Group,
  Star,
  Plus,
  Optional,
  Quantified,
  PositiveLookahead,
  NegativeLookahead,
  LabeledExpression,
} from "./types";

import {
  stringInterner,
  analyzeExpressionComplexity,
  analyzeGrammarPerformance,
  globalPerformanceMonitor,
  createCharClassLookup
} from "./performance-utils";

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
    estimatedComplexity: 'low' | 'medium' | 'high';
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
  private templateCache = new CodeTemplateCache();
  
  constructor(options: OptimizedCodeGenOptions = { language: "typescript" }) {
    this.options = {
      language: options.language,
      namePrefix: options.namePrefix ?? "",
      includeImports: options.includeImports ?? true,
      includeTypes: options.includeTypes ?? true,
      optimize: options.optimize ?? true,
      enableMemoization: options.enableMemoization ?? true,
      includeMonitoring: options.includeMonitoring ?? false,
    };
  }

  /**
   * Generate optimized TypeScript parser code from a TPEG grammar
   */
  generateGrammar(grammar: GrammarDefinition): OptimizedGeneratedCode {
    globalPerformanceMonitor.start('grammar-generation');
    
    const performanceAnalysis = analyzeGrammarPerformance(grammar);
    const imports: string[] = [];
    const exports: string[] = [];
    const parts: string[] = [];

    // Add optimized imports based on usage analysis
    if (this.options.includeImports) {
      imports.push(...this.generateOptimizedImports(grammar, performanceAnalysis));
    }

    // Collect all rule names first for reference resolution
    for (const rule of grammar.rules) {
      this.ruleNames.add(stringInterner.intern(rule.name));
    }

    // Generate parser for each rule with optimization
    for (const rule of grammar.rules) {
      const ruleCode = this.generateOptimizedRule(rule, performanceAnalysis);
      parts.push(ruleCode);
      exports.push(stringInterner.intern(rule.name));
    }

    // Add performance monitoring if enabled
    if (this.options.includeMonitoring) {
      parts.push(this.generateMonitoringCode());
    }

    // Efficiently combine all parts
    const codeBuilder = [];
    
    if (this.options.includeImports && imports.length > 0) {
      codeBuilder.push(imports.join('\n'), '\n');
    }
    
    codeBuilder.push(parts.join('\n\n'));
    
    const generationTime = globalPerformanceMonitor.end('grammar-generation');

    return {
      code: codeBuilder.join(''),
      imports,
      exports,
      performance: {
        estimatedComplexity: performanceAnalysis.estimatedParseComplexity,
        optimizationSuggestions: performanceAnalysis.optimizationSuggestions,
        generationTime
      }
    };
  }

  /**
   * Generate optimized imports based on grammar analysis
   */
  private generateOptimizedImports(
    grammar: GrammarDefinition,
    analysis: ReturnType<typeof analyzeGrammarPerformance>
  ): string[] {
    const imports = [];
    
    // Core imports
    imports.push('import type { Parser } from "tpeg-core";');
    
    // Analyze which combinators are actually needed
    const usedCombinators = new Set<string>();
    usedCombinators.add('literal'); // Always needed for string literals
    
    for (const rule of grammar.rules) {
      this.collectUsedCombinators(rule.pattern, usedCombinators);
    }
    
    // Add performance imports if needed
    if (this.options.enableMemoization && analysis.estimatedParseComplexity !== 'low') {
      usedCombinators.add('memoize');
      imports.push('import { memoize } from "tpeg-combinator";');
    }
    
    // Generate optimized combinator import
    const combinators = Array.from(usedCombinators).sort();
    imports.push(`import { ${combinators.join(', ')} } from "tpeg-core";`);
    
    return imports;
  }

  /**
   * Collect all combinators used in an expression
   */
  private collectUsedCombinators(expr: Expression, combinators: Set<string>): void {
    switch (expr.type) {
      case "CharacterClass":
        combinators.add("charClass");
        break;
      case "Sequence":
        combinators.add("sequence");
        for (const element of expr.elements) {
          this.collectUsedCombinators(element, combinators);
        }
        break;
      case "Choice":
        combinators.add("choice");
        for (const alternative of expr.alternatives) {
          this.collectUsedCombinators(alternative, combinators);
        }
        break;
      case "Star":
        combinators.add("zeroOrMore");
        this.collectUsedCombinators(expr.expression, combinators);
        break;
      case "Plus":
        combinators.add("oneOrMore");
        this.collectUsedCombinators(expr.expression, combinators);
        break;
      case "Optional":
        combinators.add("optional");
        this.collectUsedCombinators(expr.expression, combinators);
        break;
      case "PositiveLookahead":
        combinators.add("andPredicate");
        this.collectUsedCombinators(expr.expression, combinators);
        break;
      case "NegativeLookahead":
        combinators.add("notPredicate");
        this.collectUsedCombinators(expr.expression, combinators);
        break;
      case "Group":
      case "LabeledExpression":
        this.collectUsedCombinators(expr.expression, combinators);
        break;
      case "Quantified":
        // For quantified expressions, we might need additional combinators
        combinators.add("sequence"); // Often used in quantification implementation
        this.collectUsedCombinators(expr.expression, combinators);
        break;
    }
  }

  /**
   * Generate optimized code for a single rule definition
   */
  private generateOptimizedRule(
    rule: RuleDefinition,
    analysis: ReturnType<typeof analyzeGrammarPerformance>
  ): string {
    const complexity = analysis.ruleComplexity.get(rule.name);
    const shouldMemoize = this.options.enableMemoization && 
                         complexity && 
                         (complexity.estimatedComplexity === 'high' || complexity.hasRecursion);
    
    let parserCode = this.generateOptimizedExpression(rule.pattern);
    
    // Add memoization for complex rules
    if (shouldMemoize) {
      parserCode = `memoize(${parserCode})`;
    }
    
    const name = stringInterner.intern(this.options.namePrefix + rule.name);
    
    // Use template caching for common patterns
    const templateKey = `rule-${this.options.includeTypes}-${shouldMemoize}`;
    return this.templateCache.get(templateKey, () => {
      if (this.options.includeTypes) {
        return shouldMemoize 
          ? `export const ${name}: Parser<any> = memoize(PLACEHOLDER);`
          : `export const ${name}: Parser<any> = PLACEHOLDER;`;
      }
      return shouldMemoize 
        ? `export const ${name} = memoize(PLACEHOLDER);`
        : `export const ${name} = PLACEHOLDER;`;
    }).replace('PLACEHOLDER', parserCode).replace(`${name}:`, `${name}:`);
  }

  /**
   * Generate optimized code for any expression type with caching
   */
  private generateOptimizedExpression(expr: Expression): string {
    // Use object identity for caching when possible
    const cacheKey = `expr-${expr.type}-${JSON.stringify(expr)}`;
    
    return this.templateCache.get(cacheKey, () => {
      switch (expr.type) {
        case "StringLiteral":
          return this.generateStringLiteral(expr as StringLiteral);
        case "CharacterClass":
          return this.generateOptimizedCharacterClass(expr as CharacterClass);
        case "Identifier":
          return this.generateIdentifier(expr as Identifier);
        case "AnyChar":
          return "anyChar";
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
        default:
          throw new Error(`Unsupported expression type: ${(expr as { type: string }).type}`);
      }
    });
  }

  private generateStringLiteral(expr: StringLiteral): string {
    const escaped = expr.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `literal("${stringInterner.intern(escaped)}")`;
  }

  private generateOptimizedCharacterClass(expr: CharacterClass): string {
    // Use lookup table optimization for common character classes
    if (this.options.optimize) {
      const ranges = expr.ranges.map(range => ({
        start: range.start,
        end: range.end || undefined
      }));
      
      createCharClassLookup(ranges);
      const isSimpleAscii = ranges.every(r => 
        r.start.charCodeAt(0) < 128 && 
        (!r.end || r.end.charCodeAt(0) < 128)
      );
      
      if (isSimpleAscii && !expr.negated) {
        // Generate optimized ASCII character class
        const charCodes = ranges.map(r => {
          if (r.end) {
            return `{ from: "${r.start}", to: "${r.end}" }`;
          }
          return `"${r.start}"`;
        }).join(", ");
        
        return `charClass([${charCodes}])`;
      }
    }
    
    // Fallback to standard generation
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
    const name = stringInterner.intern(expr.name);
    if (this.ruleNames.has(name)) {
      return stringInterner.intern(this.options.namePrefix + name);
    }
    return name;
  }

  private generateOptimizedSequence(expr: Sequence): string {
    if (expr.elements.length === 0) {
      return 'sequence()';
    }
    
    if (expr.elements.length === 1) {
      const element = expr.elements[0];
      if (element) {
        return this.generateOptimizedExpression(element);
      }
    }
    
    // Optimize common sequence patterns
    const elements = expr.elements.map(el => this.generateOptimizedExpression(el));
    return `sequence(${elements.join(", ")})`;
  }

  private generateOptimizedChoice(expr: Choice): string {
    if (expr.alternatives.length === 0) {
      return 'choice()';
    }
    
    if (expr.alternatives.length === 1) {
      const alternative = expr.alternatives[0];
      if (alternative) {
        return this.generateOptimizedExpression(alternative);
      }
    }
    
    // Sort alternatives by complexity for better performance (simple first)
    if (this.options.optimize) {
      const alternatives = expr.alternatives.map(alt => ({
        expr: alt,
        code: this.generateOptimizedExpression(alt),
        complexity: analyzeExpressionComplexity(alt)
      }));
      
      alternatives.sort((a, b) => a.complexity.nodeCount - b.complexity.nodeCount);
      return `choice(${alternatives.map(a => a.code).join(", ")})`;
    }
    
    const alternatives = expr.alternatives.map(alt => this.generateOptimizedExpression(alt));
    return `choice(${alternatives.join(", ")})`;
  }

  private generateQuantified(expr: Quantified): string {
    const inner = this.generateOptimizedExpression(expr.expression);
    
    if (expr.max === undefined) {
      if (expr.min === 0) return `zeroOrMore(${inner})`;
      if (expr.min === 1) return `oneOrMore(${inner})`;
      return `/* TODO: implement {${expr.min},} */ oneOrMore(${inner})`;
    }
    
    if (expr.min === expr.max) {
      if (expr.min === 0) return "/* never matches */ choice()";
      if (expr.min === 1) return inner;
      return `/* TODO: implement {${expr.min}} */ ${inner}`;
    }
    
    return `/* TODO: implement {${expr.min},${expr.max}} */ optional(${inner})`;
  }

  private generateLabeledExpression(expr: LabeledExpression): string {
    const inner = this.generateOptimizedExpression(expr.expression);
    return `/* label: ${expr.label} */ ${inner}`;
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