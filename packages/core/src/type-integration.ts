/**
 * Type Integration System for TPEG
 * 
 * This module integrates type inference with code generation, providing
 * enhanced type-safe parser generation capabilities.
 */

import type { GrammarDefinition, RuleDefinition, Expression } from "../../parser/src/types";
import { TypeInferenceEngine, type GrammarTypeInference, type InferredType } from "./type-inference";

/**
 * Enhanced rule information with type inference
 */
export interface TypedRuleDefinition extends RuleDefinition {
  /** Inferred TypeScript type for this rule's result */
  inferredType: InferredType;
  /** Whether this rule has circular dependencies */
  hasCircularDependency: boolean;
  /** Dependencies of this rule (other rules it references) */
  dependencies: string[];
}

/**
 * Enhanced grammar definition with type information
 */
export interface TypedGrammarDefinition extends Omit<GrammarDefinition, 'rules'> {
  /** Original grammar definition */
  originalGrammar: GrammarDefinition;
  /** Rules with type information */
  rules: TypedRuleDefinition[];
  /** Type inference results */
  typeInference: GrammarTypeInference;
  /** Generated TypeScript type definitions */
  typeDefinitions: string;
  /** Required imports for the generated types */
  imports: string[];
}

/**
 * Options for type integration
 */
export interface TypeIntegrationOptions {
  /** Whether to generate strict types (no 'any' or 'unknown') */
  strictTypes: boolean;
  /** Whether to include JSDoc comments in generated types */
  includeDocumentation: boolean;
  /** Custom type mappings for specific patterns */
  customTypeMappings: Map<string, string>;
  /** Whether to generate type guards for the inferred types */
  generateTypeGuards: boolean;
  /** Namespace for generated types */
  typeNamespace?: string | undefined;
}

/**
 * Default type integration options
 */
export const DEFAULT_TYPE_INTEGRATION_OPTIONS: TypeIntegrationOptions = {
  strictTypes: true,
  includeDocumentation: true,
  customTypeMappings: new Map(),
  generateTypeGuards: false,
};

/**
 * Type integration engine that combines grammar parsing with type inference
 */
export class TypeIntegrationEngine {
  private typeInferenceEngine: TypeInferenceEngine;
  private options: TypeIntegrationOptions;

  constructor(options: Partial<TypeIntegrationOptions> = {}) {
    this.options = { ...DEFAULT_TYPE_INTEGRATION_OPTIONS, ...options };
    
    // Configure type inference engine based on integration options
    this.typeInferenceEngine = new TypeInferenceEngine({
      inferArrayTypes: true,
      inferUnionTypes: true,
      inferObjectTypes: true,
      includePositions: false,
      customTypeMappings: this.options.customTypeMappings,
      generateDocumentation: this.options.includeDocumentation,
    });
  }

  /**
   * Create a typed grammar definition with full type information
   */
  createTypedGrammar(grammar: GrammarDefinition): TypedGrammarDefinition {
    // Perform type inference
    const typeInference = this.typeInferenceEngine.inferGrammarTypes(grammar);
    
    // Create typed rules
    const typedRules = grammar.rules.map(rule => this.createTypedRule(rule, typeInference));
    
    // Generate type definitions
    const typeDefinitions = this.generateTypeDefinitions(typeInference, typedRules);
    
    // Collect all required imports
    const imports = this.collectImports(typeInference);

    return {
      ...grammar,
      originalGrammar: grammar,
      rules: typedRules,
      typeInference,
      typeDefinitions,
      imports,
    };
  }

  /**
   * Create a typed rule definition with dependency analysis
   */
  private createTypedRule(rule: RuleDefinition, typeInference: GrammarTypeInference): TypedRuleDefinition {
    const inferredType = typeInference.ruleTypes.get(rule.name);
    if (!inferredType) {
      throw new Error(`No type information found for rule: ${rule.name}`);
    }

    // Check for circular dependencies
    const hasCircularDependency = typeInference.circularDependencies.some(
      cycle => cycle.includes(rule.name)
    );

    // Analyze dependencies
    const dependencies = this.analyzeDependencies(rule);

    return {
      ...rule,
      inferredType,
      hasCircularDependency,
      dependencies,
    };
  }

  /**
   * Analyze dependencies of a rule by traversing its pattern
   */
  private analyzeDependencies(rule: RuleDefinition): string[] {
    const dependencies = new Set<string>();
    
    const traverse = (expr: Expression): void => {
      if (expr.type === "Identifier") {
        dependencies.add(expr.name);
      } else if (expr.type === "Sequence") {
        expr.elements.forEach(traverse);
      } else if (expr.type === "Choice") {
        expr.alternatives.forEach(traverse);
      } else if ("expression" in expr && expr.expression) {
        traverse(expr.expression);
      }
    };

    traverse(rule.pattern);
    return Array.from(dependencies);
  }

  /**
   * Generate TypeScript type definitions for the grammar
   */
  private generateTypeDefinitions(
    _typeInference: GrammarTypeInference,
    typedRules: TypedRuleDefinition[]
  ): string {
    const typeDefinitions: string[] = [];

    // Add namespace if specified
    if (this.options.typeNamespace) {
      typeDefinitions.push(`export namespace ${this.options.typeNamespace} {`);
    }

    // Generate type aliases for each rule
    for (const rule of typedRules) {
      const inferredType = rule.inferredType;
      
      if (this.options.includeDocumentation && inferredType.documentation) {
        typeDefinitions.push("  /**");
        typeDefinitions.push(`   * ${inferredType.documentation}`);
        if (rule.dependencies.length > 0) {
          typeDefinitions.push(`   * Dependencies: ${rule.dependencies.join(", ")}`);
        }
        if (rule.hasCircularDependency) {
          typeDefinitions.push("   * Note: This rule has circular dependencies");
        }
        typeDefinitions.push("   */");
      }

      const ruleName = this.pascalCase(rule.name);
      typeDefinitions.push(`  export type ${ruleName}Result = ${inferredType.typeString};`);
      
      if (this.options.generateTypeGuards) {
        typeDefinitions.push(this.generateTypeGuard(ruleName, inferredType));
      }
      
      typeDefinitions.push("");
    }

    // Generate result type union
    const resultTypes = typedRules.map(rule => `${this.pascalCase(rule.name)}Result`);
    typeDefinitions.push("  /** Union of all parser result types */");
    typeDefinitions.push(`  export type ParserResult = ${resultTypes.join(" | ")};`);

    // Close namespace if specified
    if (this.options.typeNamespace) {
      typeDefinitions.push("}");
    }

    return typeDefinitions.join("\n");
  }

  /**
   * Generate a type guard function for a rule result type
   */
  private generateTypeGuard(ruleName: string, inferredType: InferredType): string {
    const guardName = `is${ruleName}Result`;
    const typeName = `${ruleName}Result`;
    
    // Simple type guards based on the inferred type
    let guardImplementation: string;
    
    if (inferredType.typeString.startsWith('"') && inferredType.typeString.endsWith('"')) {
      // String literal type
      const literal = inferredType.typeString.slice(1, -1);
      guardImplementation = `return typeof value === "string" && value === "${literal}";`;
    } else if (inferredType.baseType === "string") {
      guardImplementation = `return typeof value === "string";`;
    } else if (inferredType.isArray) {
      guardImplementation = "return Array.isArray(value);";
    } else {
      guardImplementation = "return value !== undefined;";
    }

    return [
      `  /** Type guard for ${typeName} */`,
      `  export function ${guardName}(value: unknown): value is ${typeName} {`,
      `    ${guardImplementation}`,
      "  }",
    ].join("\n");
  }

  /**
   * Collect all required imports from type inference
   */
  private collectImports(typeInference: GrammarTypeInference): string[] {
    const imports = new Set<string>();
    
    // Add imports from each rule type
    for (const inferredType of Array.from(typeInference.ruleTypes.values())) {
      for (const imp of inferredType.imports) {
        imports.add(imp);
      }
    }
    
    // Add any additional imports from type inference
    for (const imp of typeInference.imports) {
      imports.add(imp);
    }
    
    return Array.from(imports);
  }

  /**
   * Convert a string to PascalCase
   */
  private pascalCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  }

  /**
   * Get type information for a specific rule
   */
  getTypeInfo(typedGrammar: TypedGrammarDefinition, ruleName: string): InferredType | undefined {
    return typedGrammar.typeInference.ruleTypes.get(ruleName);
  }

  /**
   * Check if a rule has circular dependencies
   */
  hasCircularDependency(typedGrammar: TypedGrammarDefinition, ruleName: string): boolean {
    const rule = typedGrammar.rules.find(r => r.name === ruleName);
    return rule?.hasCircularDependency ?? false;
  }

  /**
   * Get all dependencies for a rule
   */
  getDependencies(typedGrammar: TypedGrammarDefinition, ruleName: string): string[] {
    const rule = typedGrammar.rules.find(r => r.name === ruleName);
    return rule?.dependencies ?? [];
  }

  /**
   * Generate complete TypeScript interface for the parser
   */
  generateParserInterface(typedGrammar: TypedGrammarDefinition): string {
    const interfaceLines: string[] = [];
    
    interfaceLines.push("/**");
    interfaceLines.push(` * Generated parser interface for ${typedGrammar.name} grammar`);
    interfaceLines.push(" * This interface provides type-safe access to all parser rules");
    interfaceLines.push(" */");
    interfaceLines.push(`export interface ${typedGrammar.name}Parser {`);
    
    for (const rule of typedGrammar.rules) {
      const resultType = `${this.pascalCase(rule.name)}Result`;
      
      if (this.options.includeDocumentation) {
        interfaceLines.push("  /**");
        interfaceLines.push(`   * Parse ${rule.name}: ${rule.inferredType.documentation}`);
        if (rule.hasCircularDependency) {
          interfaceLines.push("   * @warning This rule has circular dependencies");
        }
        interfaceLines.push("   */");
      }
      
      interfaceLines.push(`  ${rule.name}(input: string): ParseResult<${resultType}>;`);
    }
    
    interfaceLines.push("}");
    
    return interfaceLines.join("\n");
  }
}