/**
 * TPEG Code Generation System
 *
 * Generates TypeScript parsers from TPEG grammar AST nodes.
 * This is a basic implementation supporting core TPEG features.
 */

import type {
  AnyChar,
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
  Quantified,
  RuleDefinition,
  Sequence,
  Star,
  StringLiteral,
} from "./types";

/**
 * Code generation options
 */
export interface CodeGenOptions {
  /** Target language (currently only TypeScript) */
  language: "typescript";
  /** Generated parser name prefix */
  namePrefix?: string;
  /** Include runtime imports */
  includeImports?: boolean;
  /** Generate with type annotations */
  includeTypes?: boolean;
}

/**
 * Generated parser code result
 */
export interface GeneratedCode {
  /** Generated TypeScript code */
  code: string;
  /** Required imports */
  imports: string[];
  /** Export declarations */
  exports: string[];
}

/**
 * Main code generator class
 */
export class TPEGCodeGenerator {
  private options: Required<CodeGenOptions>;
  private ruleNames: Set<string> = new Set();

  constructor(options: CodeGenOptions = { language: "typescript" }) {
    this.options = {
      language: options.language,
      namePrefix: options.namePrefix ?? "",
      includeImports: options.includeImports ?? true,
      includeTypes: options.includeTypes ?? true,
    };
  }

  /**
   * Generate TypeScript parser code from a TPEG grammar
   */
  generateGrammar(grammar: GrammarDefinition): GeneratedCode {
    const imports: string[] = [];
    const exports: string[] = [];
    const parts: string[] = [];

    // Add standard imports
    if (this.options.includeImports) {
      imports.push('import type { Parser } from "tpeg-core";');
      imports.push(
        'import { literal, charClass, choice, sequence, map, zeroOrMore, oneOrMore, optional, andPredicate, notPredicate } from "tpeg-core";',
      );
    }

    // Collect all rule names first
    for (const rule of grammar.rules) {
      this.ruleNames.add(rule.name);
    }

    // Generate parser for each rule
    for (const rule of grammar.rules) {
      const ruleCode = this.generateRule(rule);
      parts.push(ruleCode);
      exports.push(rule.name);
    }

    // Combine all parts
    let code = "";

    if (this.options.includeImports && imports.length > 0) {
      code += `${imports.join("\n")}\n\n`;
    }

    code += parts.join("\n\n");

    return {
      code,
      imports,
      exports,
    };
  }

  /**
   * Generate code for a single rule definition
   */
  private generateRule(rule: RuleDefinition): string {
    const parserCode = this.generateExpression(rule.pattern);
    const name = this.options.namePrefix + rule.name;

    if (this.options.includeTypes) {
      return `export const ${name}: Parser<any> = ${parserCode};`;
    }
    return `export const ${name} = ${parserCode};`;
  }

  /**
   * Generate code for any expression type
   */
  private generateExpression(expr: Expression): string {
    switch (expr.type) {
      case "StringLiteral":
        return this.generateStringLiteral(expr as StringLiteral);
      case "CharacterClass":
        return this.generateCharacterClass(expr as CharacterClass);
      case "Identifier":
        return this.generateIdentifier(expr as Identifier);
      case "AnyChar":
        return this.generateAnyChar(expr as AnyChar);
      case "Sequence":
        return this.generateSequence(expr as Sequence);
      case "Choice":
        return this.generateChoice(expr as Choice);
      case "Group":
        return this.generateGroup(expr as Group);
      case "Star":
        return this.generateStar(expr as Star);
      case "Plus":
        return this.generatePlus(expr as Plus);
      case "Optional":
        return this.generateOptional(expr as Optional);
      case "Quantified":
        return this.generateQuantified(expr as Quantified);
      case "PositiveLookahead":
        return this.generatePositiveLookahead(expr as PositiveLookahead);
      case "NegativeLookahead":
        return this.generateNegativeLookahead(expr as NegativeLookahead);
      case "LabeledExpression":
        return this.generateLabeledExpression(expr as LabeledExpression);
      default:
        throw new Error(`Unsupported expression type: ${(expr as { type: string }).type}`);
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
          // Range like a-z
          return `{ from: "${range.start}", to: "${range.end}" }`;
        }
        // Single character
        return `"${range.start}"`;
      })
      .join(", ");

    const negated = expr.negated ? ", true" : "";

    return `charClass(${ranges}${negated})`;
  }

  private generateIdentifier(expr: Identifier): string {
    // For rule references, we need to handle potential recursion
    if (this.ruleNames.has(expr.name)) {
      return `${this.options.namePrefix}${expr.name}`;
    }
    // External reference - might need special handling
    return `${expr.name}`;
  }

  private generateAnyChar(_expr: AnyChar): string {
    return "anyChar";
  }

  private generateSequence(expr: Sequence): string {
    const elements = expr.elements
      .map((el) => this.generateExpression(el))
      .join(", ");
    return `sequence(${elements})`;
  }

  private generateChoice(expr: Choice): string {
    const alternatives = expr.alternatives
      .map((alt) => this.generateExpression(alt))
      .join(", ");
    return `choice(${alternatives})`;
  }

  private generateGroup(expr: Group): string {
    return this.generateExpression(expr.expression);
  }

  private generateStar(expr: Star): string {
    const inner = this.generateExpression(expr.expression);
    return `zeroOrMore(${inner})`;
  }

  private generatePlus(expr: Plus): string {
    const inner = this.generateExpression(expr.expression);
    return `oneOrMore(${inner})`;
  }

  private generateOptional(expr: Optional): string {
    const inner = this.generateExpression(expr.expression);
    return `optional(${inner})`;
  }

  private generateQuantified(expr: Quantified): string {
    const inner = this.generateExpression(expr.expression);
    // For now, implement basic quantification using repetition combinators
    if (expr.max === undefined) {
      // {n,} - at least n
      if (expr.min === 0) {
        return `zeroOrMore(${inner})`;
      }
      if (expr.min === 1) {
        return `oneOrMore(${inner})`;
      }
      // TODO: Implement exact quantification
      return `/* TODO: implement {${expr.min},} */ oneOrMore(${inner})`;
    }
    if (expr.min === expr.max) {
      // {n} - exactly n
      if (expr.min === 0) {
        return "/* never matches */ choice()";
      }
      if (expr.min === 1) {
        return inner;
      }
      // TODO: Implement exact repetition
      return `/* TODO: implement {${expr.min}} */ ${inner}`;
    }
    // {n,m} - between n and m
    return `/* TODO: implement {${expr.min},${expr.max}} */ optional(${inner})`;
  }

  private generatePositiveLookahead(expr: PositiveLookahead): string {
    const inner = this.generateExpression(expr.expression);
    return `andPredicate(${inner})`;
  }

  private generateNegativeLookahead(expr: NegativeLookahead): string {
    const inner = this.generateExpression(expr.expression);
    return `notPredicate(${inner})`;
  }

  private generateLabeledExpression(expr: LabeledExpression): string {
    const inner = this.generateExpression(expr.expression);
    // For now, just generate the inner expression
    // TODO: Implement capture handling
    return `/* label: ${expr.label} */ ${inner}`;
  }
}

/**
 * Convenience function to generate TypeScript parser code from a grammar
 */
export function generateTypeScriptParser(
  grammar: GrammarDefinition,
  options?: Partial<CodeGenOptions>,
): GeneratedCode {
  const generator = new TPEGCodeGenerator({
    language: "typescript",
    ...options,
  });
  return generator.generateGrammar(grammar);
}
