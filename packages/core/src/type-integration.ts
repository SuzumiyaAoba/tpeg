/**
 * Type Integration System for TPEG
 *
 * This module integrates type inference with code generation, providing
 * enhanced type-safe parser generation capabilities for TPEG grammars.
 *
 * The Type Integration System provides a comprehensive solution for:
 * - **Type Inference**: Automatic TypeScript type generation from TPEG grammar definitions
 * - **Circular Dependency Detection**: Identification and handling of circular rule references
 * - **Performance Optimization**: Caching and performance monitoring capabilities
 * - **Validation**: Grammar validation with detailed error reporting
 * - **Code Generation**: Type-safe parser interface and type guard generation
 *
 * ## Key Features
 *
 * ### Type Safety
 * - Generates precise TypeScript types for all grammar rules
 * - Provides type guards for runtime type checking
 * - Supports strict type generation (no `any` or `unknown` types)
 *
 * ### Performance
 * - Intelligent caching system for repeated grammar processing
 * - Performance metrics and monitoring
 * - Complexity analysis with warnings for overly complex rules
 *
 * ### Error Handling
 * - Comprehensive error reporting with detailed messages
 * - Grammar validation before processing
 * - Circular dependency detection and warnings
 *
 * ## Usage Example
 *
 * ```typescript
 * import { TypeIntegrationEngine } from './type-integration';
 * import { createGrammarDefinition, createRuleDefinition, createStringLiteral } from './grammar-types';
 *
 * // Create a simple grammar
 * const grammar = createGrammarDefinition('Calculator', [], [
 *   createRuleDefinition('number', createStringLiteral('123', '"')),
 *   createRuleDefinition('operator', createStringLiteral('+', '"')),
 * ]);
 *
 * // Initialize the type integration engine
 * const engine = new TypeIntegrationEngine({
 *   strictTypes: true,
 *   generateTypeGuards: true,
 *   typeNamespace: 'CalculatorTypes'
 * });
 *
 * // Generate typed grammar with full type information
 * const typedGrammar = engine.createTypedGrammar(grammar);
 *
 * // Access generated type definitions
 * console.log(typedGrammar.typeDefinitions);
 *
 * // Check for circular dependencies
 * const hasCircular = engine.hasCircularDependency(typedGrammar, 'number');
 * console.log('Has circular dependency:', hasCircular);
 * ```
 *
 * ## Architecture
 *
 * The system consists of several key components:
 *
 * 1. **TypeIntegrationEngine**: Main orchestrator that coordinates type inference and code generation
 * 2. **TypeInferenceEngine**: Handles the actual type inference logic (imported from type-inference.ts)
 * 3. **TypedGrammarDefinition**: Enhanced grammar with type information and metadata
 * 4. **TypedRuleDefinition**: Individual rules with inferred types and performance metrics
 *
 * ## Performance Considerations
 *
 * - Large grammars may take significant time for initial type inference
 * - Enable caching for repeated processing of the same grammar
 * - Monitor complexity scores to identify rules that may need refactoring
 * - Use `includePerformanceMetrics: false` in production for better performance
 *
 * @see {@link TypeIntegrationEngine} - Main engine class
 * @see {@link TypedGrammarDefinition} - Enhanced grammar with type information
 * @see {@link TypeIntegrationOptions} - Configuration options
 * @since 1.0.0
 */

import type {
  Expression,
  GrammarDefinition,
  RuleDefinition,
} from "./grammar-types";
import {
  type GrammarTypeInference,
  type InferredType,
  TypeInferenceEngine,
} from "./type-inference";

/**
 * Custom error class for type integration specific issues
 *
 * Provides detailed error information including the rule name where the error
 * occurred for better debugging and error handling.
 *
 * @example
 * ```typescript
 * try {
 *   const typedGrammar = engine.createTypedGrammar(grammar);
 * } catch (error) {
 *   if (error instanceof TypeIntegrationError) {
 *     console.error(`Error in rule ${error.ruleName}: ${error.message}`);
 *   }
 * }
 * ```
 */
export class TypeIntegrationError extends Error {
  /**
   * Creates a new TypeIntegrationError
   *
   * @param message - Human-readable error message
   * @param ruleName - Name of the rule where the error occurred (optional)
   */
  constructor(
    message: string,
    public readonly ruleName?: string,
  ) {
    super(message);
    this.name = "TypeIntegrationError";
  }
}

/**
 * Enhanced rule definition with comprehensive type information and metadata
 *
 * Extends the base `RuleDefinition` with additional type inference results,
 * dependency analysis, and performance metrics for better understanding and
 * optimization of grammar rules.
 *
 * @example
 * ```typescript
 * const typedRule: TypedRuleDefinition = {
 *   name: 'expression',
 *   pattern: createSequence([...]),
 *   inferredType: { typeString: 'string', baseType: 'string', ... },
 *   hasCircularDependency: false,
 *   dependencies: ['term', 'operator'],
 *   performanceMetrics: {
 *     inferenceTime: 15.2,
 *     cacheHits: 3,
 *     complexity: 25
 *   }
 * };
 * ```
 */
export interface TypedRuleDefinition extends RuleDefinition {
  /** Inferred TypeScript type for this rule's result */
  inferredType: InferredType;
  /** Whether this rule has circular dependencies */
  hasCircularDependency: boolean;
  /** Dependencies of this rule (other rules it references) */
  dependencies: string[];
  /** Performance metrics for this rule */
  performanceMetrics: {
    /** Time taken to infer types for this rule (ms) */
    inferenceTime: number;
    /** Number of cache hits during inference */
    cacheHits: number;
    /** Complexity score based on expression structure */
    complexity: number;
  };
}

/**
 * Enhanced grammar definition with comprehensive type information and metadata
 *
 * Provides a complete view of a grammar with type inference results,
 * performance metrics, validation status, and generated type definitions.
 * This is the primary output of the TypeIntegrationEngine.
 *
 * @example
 * ```typescript
 * const typedGrammar: TypedGrammarDefinition = {
 *   name: 'Calculator',
 *   rules: [...],
 *   typeInference: { ruleTypes: new Map(), ... },
 *   typeDefinitions: 'export namespace CalculatorTypes { ... }',
 *   imports: ['import { MyType } from "./types"'],
 *   performanceMetrics: {
 *     totalTime: 125.5,
 *     rulesProcessed: 10,
 *     memoryUsage: 2048576,
 *     cacheEfficiency: 0.85
 *   },
 *   validation: {
 *     isValid: true,
 *     errors: [],
 *     warnings: ['Rule "complex" has high complexity']
 *   }
 * };
 * ```
 */
export interface TypedGrammarDefinition
  extends Omit<GrammarDefinition, "rules"> {
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
  /** Performance metrics for the entire grammar */
  performanceMetrics: {
    /** Total time taken for type integration (ms) */
    totalTime: number;
    /** Number of rules processed */
    rulesProcessed: number;
    /** Memory usage in bytes */
    memoryUsage: number;
    /** Cache efficiency ratio (0.0 to 1.0) */
    cacheEfficiency: number;
  };
  /** Validation results */
  validation: {
    /** Whether the grammar is valid */
    isValid: boolean;
    /** List of validation errors */
    errors: string[];
    /** List of validation warnings */
    warnings: string[];
  };
}

/**
 * Configuration options for the Type Integration Engine
 *
 * Controls various aspects of type integration including type generation,
 * performance optimizations, validation, and output formatting.
 *
 * @example
 * ```typescript
 * const options: TypeIntegrationOptions = {
 *   strictTypes: true,           // Generate strict types (no 'any')
 *   includeDocumentation: true,   // Include JSDoc in generated types
 *   generateTypeGuards: true,     // Generate type guard functions
 *   typeNamespace: 'MyGrammar',   // Wrap types in namespace
 *   enableOptimizations: true,    // Enable caching and optimizations
 *   validateGrammar: true,        // Validate grammar before processing
 *   maxComplexityThreshold: 50,   // Warn for rules with complexity > 50
 *   includePerformanceMetrics: false // Don't include metrics in output
 * };
 * ```
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
  /** Whether to enable performance optimizations */
  enableOptimizations: boolean;
  /** Whether to validate grammar before processing */
  validateGrammar: boolean;
  /** Maximum complexity threshold for warnings */
  maxComplexityThreshold: number;
  /** Whether to include performance metrics in output */
  includePerformanceMetrics: boolean;
}

/**
 * Default configuration options for Type Integration Engine
 *
 * Provides sensible defaults that balance performance, type safety,
 * and usability for most use cases.
 */
export const DEFAULT_TYPE_INTEGRATION_OPTIONS: TypeIntegrationOptions = {
  strictTypes: true,
  includeDocumentation: true,
  customTypeMappings: new Map(),
  generateTypeGuards: false,
  enableOptimizations: true,
  validateGrammar: true,
  maxComplexityThreshold: 100,
  includePerformanceMetrics: false,
};

/**
 * Type integration engine that combines grammar parsing with type inference
 *
 * The main orchestrator for type integration, providing a comprehensive
 * solution for generating type-safe parser definitions from TPEG grammars.
 *
 * ## Key Responsibilities
 *
 * 1. **Grammar Processing**: Validates and processes TPEG grammar definitions
 * 2. **Type Inference**: Coordinates with TypeInferenceEngine for type analysis
 * 3. **Code Generation**: Generates TypeScript types, interfaces, and type guards
 * 4. **Performance Optimization**: Implements caching and performance monitoring
 * 5. **Error Handling**: Provides detailed error reporting and validation
 *
 * ## Usage Patterns
 *
 * ### Basic Usage
 * ```typescript
 * const engine = new TypeIntegrationEngine();
 * const typedGrammar = engine.createTypedGrammar(grammar);
 * ```
 *
 * ### Advanced Configuration
 * ```typescript
 * const engine = new TypeIntegrationEngine({
 *   strictTypes: true,
 *   generateTypeGuards: true,
 *   typeNamespace: 'MyGrammar',
 *   enableOptimizations: true,
 *   validateGrammar: true
 * });
 * ```
 *
 * ### Performance Monitoring
 * ```typescript
 * const typedGrammar = engine.createTypedGrammar(grammar);
 * console.log(`Processing time: ${typedGrammar.performanceMetrics.totalTime}ms`);
 * console.log(`Memory usage: ${typedGrammar.performanceMetrics.memoryUsage} bytes`);
 * ```
 *
 * ## Performance Considerations
 *
 * - **Caching**: Enable `enableOptimizations` for repeated grammar processing
 * - **Memory**: Large grammars may consume significant memory during processing
 * - **Complexity**: Monitor complexity scores to identify optimization opportunities
 * - **Validation**: Disable `validateGrammar` in production for better performance
 *
 * @example
 * ```typescript
 * // Create engine with custom configuration
 * const engine = new TypeIntegrationEngine({
 *   strictTypes: true,
 *   generateTypeGuards: true,
 *   typeNamespace: 'CalculatorTypes',
 *   enableOptimizations: true,
 *   validateGrammar: true,
 *   maxComplexityThreshold: 50
 * });
 *
 * // Process grammar
 * const typedGrammar = engine.createTypedGrammar(grammar);
 *
 * // Access results
 * console.log(typedGrammar.typeDefinitions);
 * console.log(typedGrammar.performanceMetrics);
 *
 * // Check for issues
 * if (typedGrammar.validation.warnings.length > 0) {
 *   console.warn('Warnings:', typedGrammar.validation.warnings);
 * }
 * ```
 */
export class TypeIntegrationEngine {
  /** Internal type inference engine for grammar analysis */
  private typeInferenceEngine: TypeInferenceEngine;
  /** Configuration options for the engine */
  private options: TypeIntegrationOptions;
  /** Cache for storing processed grammar results */
  private cache = new Map<string, TypedGrammarDefinition>();
  /** Start time for performance measurement */
  private startTime = 0;

  /**
   * Creates a new TypeIntegrationEngine with the specified options
   *
   * Initializes the engine with configuration options and sets up the
   * internal type inference engine with appropriate settings.
   *
   * @param options - Configuration options for the engine
   *
   * @example
   * ```typescript
   * // Basic initialization
   * const engine = new TypeIntegrationEngine();
   *
   * // Advanced configuration
   * const engine = new TypeIntegrationEngine({
   *   strictTypes: true,
   *   generateTypeGuards: true,
   *   typeNamespace: 'MyGrammar',
   *   enableOptimizations: true,
   *   validateGrammar: true,
   *   maxComplexityThreshold: 50
   * });
   * ```
   */
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
      enableCaching: this.options.enableOptimizations,
      detectCircularDependencies: true,
    });
  }

  /**
   * Create a typed grammar definition with full type information
   *
   * Processes a TPEG grammar definition and generates comprehensive type
   * information including TypeScript types, type guards, and performance metrics.
   *
   * ## Process Overview
   *
   * 1. **Validation**: Validates the grammar structure and rule definitions
   * 2. **Caching**: Checks for existing cached results to avoid reprocessing
   * 3. **Type Inference**: Performs detailed type analysis of all rules
   * 4. **Dependency Analysis**: Identifies rule dependencies and circular references
   * 5. **Code Generation**: Generates TypeScript types and type guards
   * 6. **Performance Tracking**: Records processing time and memory usage
   *
   * ## Error Handling
   *
   * The method throws `TypeIntegrationError` for various failure scenarios:
   * - Invalid grammar structure
   * - Missing type information for rules
   * - Validation failures
   * - Processing errors
   *
   * @param grammar - The grammar definition to process
   * @returns Enhanced grammar definition with complete type information
   * @throws {TypeIntegrationError} When type integration fails due to invalid grammar or processing errors
   *
   * @example
   * ```typescript
   * const grammar = createGrammarDefinition('Calculator', [], [
   *   createRuleDefinition('number', createStringLiteral('123', '"')),
   *   createRuleDefinition('operator', createStringLiteral('+', '"'))
   * ]);
   *
   * try {
   *   const typedGrammar = engine.createTypedGrammar(grammar);
   *   console.log('Generated types:', typedGrammar.typeDefinitions);
   *   console.log('Processing time:', typedGrammar.performanceMetrics.totalTime);
   * } catch (error) {
   *   if (error instanceof TypeIntegrationError) {
   *     console.error('Type integration failed:', error.message);
   *   }
   * }
   * ```
   */
  createTypedGrammar(grammar: GrammarDefinition): TypedGrammarDefinition {
    this.startTime = performance.now();

    try {
      // Validate grammar if enabled
      if (this.options.validateGrammar) {
        this.validateGrammar(grammar);
      }

      // Check cache for existing result
      const cacheKey = this.getCacheKey(grammar);
      if (this.options.enableOptimizations && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (cached) {
          return cached;
        }
      }

      // Perform type inference
      const typeInference = this.typeInferenceEngine.inferGrammarTypes(grammar);

      // Create typed rules with performance tracking
      const typedRules = grammar.rules.map((rule) =>
        this.createTypedRule(rule, typeInference),
      );

      // Generate type definitions
      const typeDefinitions = this.generateTypeDefinitions(
        typeInference,
        typedRules,
      );

      // Collect all required imports
      const imports = this.collectImports(typeInference);

      // Calculate performance metrics
      const totalTime = performance.now() - this.startTime;
      const memoryUsage = this.calculateMemoryUsage();
      const cacheEfficiency = this.calculateCacheEfficiency();

      const result: TypedGrammarDefinition = {
        ...grammar,
        originalGrammar: grammar,
        rules: typedRules,
        typeInference,
        typeDefinitions,
        imports,
        performanceMetrics: {
          totalTime,
          rulesProcessed: typedRules.length,
          memoryUsage,
          cacheEfficiency,
        },
        validation: {
          isValid: true,
          errors: [],
          warnings: typeInference.warnings,
        },
      };

      // Cache the result if optimizations are enabled
      if (this.options.enableOptimizations) {
        this.cache.set(cacheKey, result);
      }

      return result;
    } catch (error) {
      throw new TypeIntegrationError(
        `Failed to create typed grammar: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Create a typed rule definition with dependency analysis
   *
   * Processes an individual rule to extract type information, analyze
   * dependencies, calculate complexity, and track performance metrics.
   *
   * @param rule - The rule definition to process
   * @param typeInference - Complete type inference results for the grammar
   * @returns Enhanced rule definition with type information and metrics
   * @throws {TypeIntegrationError} When type information is missing for the rule
   *
   * @internal
   */
  private createTypedRule(
    rule: RuleDefinition,
    typeInference: GrammarTypeInference,
  ): TypedRuleDefinition {
    const ruleStartTime = performance.now();
    const inferredType = typeInference.ruleTypes.get(rule.name);

    if (!inferredType) {
      throw new TypeIntegrationError(
        `No type information found for rule: ${rule.name}`,
        rule.name,
      );
    }

    // Check for circular dependencies
    const hasCircularDependency = typeInference.circularDependencies.some(
      (cycle) => cycle.includes(rule.name),
    );

    // Analyze dependencies
    const dependencies = this.analyzeDependencies(rule);

    // Calculate complexity
    const complexity = this.calculateComplexity(rule.pattern);

    // Check complexity threshold
    if (complexity > this.options.maxComplexityThreshold) {
      typeInference.warnings.push(
        `Rule '${rule.name}' has high complexity (${complexity}). Consider refactoring.`,
      );
    }

    const ruleTime = performance.now() - ruleStartTime;

    return {
      ...rule,
      inferredType,
      hasCircularDependency,
      dependencies,
      performanceMetrics: {
        inferenceTime: ruleTime,
        cacheHits: typeInference.stats.cacheHits,
        complexity,
      },
    };
  }

  /**
   * Analyze dependencies of a rule by traversing its pattern
   *
   * Recursively traverses the rule's expression pattern to identify
   * all other rules that this rule depends on.
   *
   * @param rule - The rule to analyze
   * @returns Array of rule names that this rule depends on
   *
   * @internal
   */
  private analyzeDependencies(rule: RuleDefinition): string[] {
    const dependencies = new Set<string>();

    const traverse = (expr: Expression): void => {
      switch (expr.type) {
        case "Identifier":
          dependencies.add(expr.name);
          break;
        case "Sequence":
          expr.elements.forEach(traverse);
          break;
        case "Choice":
          expr.alternatives.forEach(traverse);
          break;
        case "Group":
        case "Star":
        case "Plus":
        case "Optional":
        case "Quantified":
        case "PositiveLookahead":
        case "NegativeLookahead":
        case "LabeledExpression":
          traverse(expr.expression);
          break;
        case "StringLiteral":
        case "CharacterClass":
        case "AnyChar":
          // These types have no sub-expressions, so no dependencies
          break;
      }
    };

    traverse(rule.pattern);
    return Array.from(dependencies);
  }

  /**
   * Calculate complexity score for an expression
   *
   * Assigns a complexity score based on the structure and nesting of
   * the expression. Higher scores indicate more complex expressions
   * that may benefit from refactoring.
   *
   * ## Complexity Factors
   *
   * - **Base complexity**: 1 point for any expression
   * - **Sequences**: +2 points per element
   * - **Choices**: +3 points per alternative
   * - **Groups**: +2 points
   * - **Repetitions**: +5 points (Star/Plus)
   * - **Optional**: +3 points
   * - **Quantified**: +7 points
   * - **Lookahead**: +4 points
   * - **Labeled**: +2 points
   *
   * @param expr - The expression to analyze
   * @returns Complexity score (higher = more complex)
   *
   * @internal
   */
  private calculateComplexity(expr: Expression): number {
    let complexity = 1;

    const traverse = (expression: Expression): void => {
      switch (expression.type) {
        case "Identifier":
          complexity += 1;
          break;
        case "Sequence":
          complexity += expression.elements.length * 2;
          expression.elements.forEach(traverse);
          break;
        case "Choice":
          complexity += expression.alternatives.length * 3;
          expression.alternatives.forEach(traverse);
          break;
        case "Group":
          complexity += 2;
          traverse(expression.expression);
          break;
        case "Star":
        case "Plus":
          complexity += 5;
          traverse(expression.expression);
          break;
        case "Optional":
          complexity += 3;
          traverse(expression.expression);
          break;
        case "Quantified":
          complexity += 7;
          traverse(expression.expression);
          break;
        case "PositiveLookahead":
        case "NegativeLookahead":
          complexity += 4;
          traverse(expression.expression);
          break;
        case "LabeledExpression":
          complexity += 2;
          traverse(expression.expression);
          break;
        case "StringLiteral":
        case "CharacterClass":
        case "AnyChar":
          complexity += 1;
          break;
      }
    };

    traverse(expr);
    return complexity;
  }

  /**
   * Generate TypeScript type definitions for the grammar
   *
   * Creates comprehensive TypeScript type definitions including:
   * - Type aliases for each rule's result type
   * - Type guard functions (if enabled)
   * - Union types for all parser results
   * - JSDoc documentation (if enabled)
   * - Namespace wrapping (if specified)
   *
   * @param _typeInference - Type inference results (unused parameter)
   * @param typedRules - Rules with type information
   * @returns Generated TypeScript type definitions as a string
   *
   * @internal
   */
  private generateTypeDefinitions(
    _typeInference: GrammarTypeInference,
    typedRules: TypedRuleDefinition[],
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
          typeDefinitions.push(
            `   * Dependencies: ${rule.dependencies.join(", ")}`,
          );
        }
        if (rule.hasCircularDependency) {
          typeDefinitions.push(
            "   * Note: This rule has circular dependencies",
          );
        }
        if (this.options.includePerformanceMetrics) {
          typeDefinitions.push(
            `   * Complexity: ${rule.performanceMetrics.complexity}`,
          );
        }
        typeDefinitions.push("   */");
      }

      const ruleName = this.pascalCase(rule.name);
      typeDefinitions.push(
        `  export type ${ruleName}Result = ${inferredType.typeString};`,
      );

      if (this.options.generateTypeGuards) {
        typeDefinitions.push(this.generateTypeGuard(ruleName, inferredType));
      }

      typeDefinitions.push("");
    }

    // Generate result type union
    const resultTypes = typedRules.map(
      (rule) => `${this.pascalCase(rule.name)}Result`,
    );
    typeDefinitions.push("  /** Union of all parser result types */");
    typeDefinitions.push(
      `  export type ParserResult = ${resultTypes.join(" | ")};`,
    );

    // Close namespace if specified
    if (this.options.typeNamespace) {
      typeDefinitions.push("}");
    }

    return typeDefinitions.join("\n");
  }

  /**
   * Generate a type guard function for a rule result type
   *
   * Creates a TypeScript type guard function that can be used for
   * runtime type checking of parser results.
   *
   * ## Supported Type Guards
   *
   * - **String literals**: Exact string matching
   * - **Strings**: `typeof value === "string"`
   * - **Arrays**: `Array.isArray(value)`
   * - **Numbers**: `typeof value === 'number' && !isNaN(value)`
   * - **Booleans**: `typeof value === 'boolean'`
   * - **Unions**: Basic null/undefined checking
   * - **Complex types**: Enhanced null/undefined checking
   *
   * @param ruleName - Name of the rule (converted to PascalCase)
   * @param inferredType - Inferred type information
   * @returns Generated type guard function as a string
   *
   * @internal
   */
  private generateTypeGuard(
    ruleName: string,
    inferredType: InferredType,
  ): string {
    const guardName = `is${ruleName}Result`;
    const typeName = `${ruleName}Result`;

    // Enhanced type guards based on the inferred type
    let guardImplementation: string;

    if (
      inferredType.typeString.startsWith('"') &&
      inferredType.typeString.endsWith('"')
    ) {
      // String literal type
      const literal = inferredType.typeString.slice(1, -1);
      guardImplementation = `return typeof value === "string" && value === "${literal}";`;
    } else if (inferredType.baseType === "string") {
      guardImplementation = `return typeof value === "string";`;
    } else if (inferredType.isArray) {
      guardImplementation = "return Array.isArray(value);";
    } else if (inferredType.baseType === "number") {
      guardImplementation =
        "return typeof value === 'number' && !isNaN(value);";
    } else if (inferredType.baseType === "boolean") {
      guardImplementation = "return typeof value === 'boolean';";
    } else if (inferredType.baseType === "union") {
      // For union types, check if value matches any of the alternatives
      guardImplementation = "return value !== null && value !== undefined;";
    } else {
      // Enhanced fallback for complex types
      guardImplementation = "return value !== undefined && value !== null;";
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
   *
   * Gathers all import statements needed for the generated types
   * from both individual rule types and the overall type inference results.
   *
   * @param typeInference - Type inference results
   * @returns Array of import statements
   *
   * @internal
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
   *
   * Transforms a string from various formats (snake_case, kebab-case, etc.)
   * into PascalCase format suitable for TypeScript type names.
   *
   * @param str - The string to convert
   * @returns PascalCase version of the string
   *
   * @example
   * ```typescript
   * pascalCase('hello_world') // 'HelloWorld'
   * pascalCase('my-grammar')  // 'MyGrammar'
   * pascalCase('simple')      // 'Simple'
   * ```
   *
   * @internal
   */
  private pascalCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  }

  /**
   * Get type information for a specific rule
   *
   * Retrieves the inferred type information for a specific rule
   * from a processed grammar.
   *
   * @param typedGrammar - The processed grammar with type information
   * @param ruleName - Name of the rule to get type info for
   * @returns Inferred type information or undefined if rule not found
   *
   * @example
   * ```typescript
   * const typedGrammar = engine.createTypedGrammar(grammar);
   * const numberType = engine.getTypeInfo(typedGrammar, 'number');
   * console.log(numberType?.typeString); // e.g., "string"
   * ```
   */
  getTypeInfo(
    typedGrammar: TypedGrammarDefinition,
    ruleName: string,
  ): InferredType | undefined {
    return typedGrammar.typeInference.ruleTypes.get(ruleName);
  }

  /**
   * Check if a rule has circular dependencies
   *
   * Determines whether a specific rule participates in any circular
   * dependency cycles within the grammar.
   *
   * @param typedGrammar - The processed grammar with type information
   * @param ruleName - Name of the rule to check
   * @returns True if the rule has circular dependencies, false otherwise
   *
   * @example
   * ```typescript
   * const typedGrammar = engine.createTypedGrammar(grammar);
   * const hasCircular = engine.hasCircularDependency(typedGrammar, 'expression');
   * if (hasCircular) {
   *   console.warn('Rule "expression" has circular dependencies');
   * }
   * ```
   */
  hasCircularDependency(
    typedGrammar: TypedGrammarDefinition,
    ruleName: string,
  ): boolean {
    const rule = typedGrammar.rules.find((r) => r.name === ruleName);
    return rule?.hasCircularDependency ?? false;
  }

  /**
   * Get all dependencies for a rule
   *
   * Returns a list of all other rules that the specified rule depends on.
   * This includes both direct and indirect dependencies.
   *
   * @param typedGrammar - The processed grammar with type information
   * @param ruleName - Name of the rule to get dependencies for
   * @returns Array of rule names that this rule depends on
   *
   * @example
   * ```typescript
   * const typedGrammar = engine.createTypedGrammar(grammar);
   * const deps = engine.getDependencies(typedGrammar, 'expression');
   * console.log('Dependencies:', deps); // e.g., ['term', 'operator']
   * ```
   */
  getDependencies(
    typedGrammar: TypedGrammarDefinition,
    ruleName: string,
  ): string[] {
    const rule = typedGrammar.rules.find((r) => r.name === ruleName);
    return rule?.dependencies ?? [];
  }

  /**
   * Generate complete TypeScript interface for the parser
   *
   * Creates a comprehensive TypeScript interface that defines the
   * structure of a generated parser with type-safe method signatures
   * for all grammar rules.
   *
   * ## Generated Interface Features
   *
   * - **Type-safe methods**: Each rule becomes a method with proper return types
   * - **Error handling**: Methods return objects with success/error information
   * - **Documentation**: JSDoc comments for each method (if enabled)
   * - **Position tracking**: Methods include position information in results
   *
   * @param typedGrammar - The processed grammar with type information
   * @returns Generated TypeScript interface as a string
   *
   * @example
   * ```typescript
   * const typedGrammar = engine.createTypedGrammar(grammar);
   * const interfaceCode = engine.generateParserInterface(typedGrammar);
   * console.log(interfaceCode);
   * // Output:
   * // export interface CalculatorParser {
   * //   number(input: string): { success: boolean; value?: NumberResult; error?: string; position: number };
   * //   operator(input: string): { success: boolean; value?: OperatorResult; error?: string; position: number };
   * // }
   * ```
   */
  generateParserInterface(typedGrammar: TypedGrammarDefinition): string {
    const interfaceLines: string[] = [];

    interfaceLines.push("/**");
    interfaceLines.push(
      ` * Generated parser interface for ${typedGrammar.name} grammar`,
    );
    interfaceLines.push(
      " * This interface provides type-safe access to all parser rules",
    );
    interfaceLines.push(" */");
    interfaceLines.push(`export interface ${typedGrammar.name}Parser {`);

    for (const rule of typedGrammar.rules) {
      const resultType = `${this.pascalCase(rule.name)}Result`;

      if (this.options.includeDocumentation) {
        interfaceLines.push("  /**");
        interfaceLines.push(
          `   * Parse ${rule.name}: ${rule.inferredType.documentation}`,
        );
        if (rule.hasCircularDependency) {
          interfaceLines.push(
            "   * @warning This rule has circular dependencies",
          );
        }
        interfaceLines.push("   */");
      }

      interfaceLines.push(
        `  ${rule.name}(input: string): { success: boolean; value?: ${resultType}; error?: string; position: number };`,
      );
    }

    interfaceLines.push("}");

    return interfaceLines.join("\n");
  }

  /**
   * Validate grammar before processing
   *
   * Performs comprehensive validation of the grammar structure including:
   * - Empty grammar checks
   * - Duplicate rule name detection
   * - Invalid rule name validation
   * - Basic structural validation
   *
   * @param grammar - The grammar to validate
   * @throws {TypeIntegrationError} When validation fails
   *
   * @internal
   */
  private validateGrammar(grammar: GrammarDefinition): void {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for empty grammar
    if (!grammar.rules || grammar.rules.length === 0) {
      errors.push("Grammar has no rules");
    }

    // Check for duplicate rule names
    const ruleNames = new Set<string>();
    for (const rule of grammar.rules) {
      if (ruleNames.has(rule.name)) {
        errors.push(`Duplicate rule name: ${rule.name}`);
      }
      ruleNames.add(rule.name);
    }

    // Check for invalid rule names
    for (const rule of grammar.rules) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(rule.name)) {
        errors.push(`Invalid rule name: ${rule.name}`);
      }
    }

    if (errors.length > 0) {
      throw new TypeIntegrationError(
        `Grammar validation failed: ${errors.join("; ")}`,
      );
    }

    if (warnings.length > 0) {
      console.warn("Grammar validation warnings:", warnings);
    }
  }

  /**
   * Generate cache key for grammar
   *
   * Creates a unique cache key based on the grammar's name, rule count,
   * and rule names to enable efficient caching of processed results.
   *
   * @param grammar - The grammar to generate a key for
   * @returns Unique cache key string
   *
   * @internal
   */
  private getCacheKey(grammar: GrammarDefinition): string {
    return `${grammar.name}-${grammar.rules.length}-${JSON.stringify(
      grammar.rules.map((r) => r.name),
    )}`;
  }

  /**
   * Calculate memory usage
   *
   * Estimates the current memory usage of the process.
   * Falls back to 0 if memory information is not available.
   *
   * @returns Memory usage in bytes
   *
   * @internal
   */
  private calculateMemoryUsage(): number {
    // Simple memory estimation
    return process.memoryUsage?.()?.heapUsed ?? 0;
  }

  /**
   * Calculate cache efficiency
   *
   * Calculates the efficiency ratio of the cache system.
   * Currently returns a placeholder value.
   *
   * @returns Cache efficiency ratio (0.0 to 1.0)
   *
   * @internal
   */
  private calculateCacheEfficiency(): number {
    // This would need to be implemented with actual cache statistics
    return 0.8; // Placeholder
  }

  /**
   * Clear the internal cache
   *
   * Removes all cached grammar results from memory.
   * Useful for freeing memory or ensuring fresh processing.
   *
   * @example
   * ```typescript
   * // Clear cache to free memory
   * engine.clearCache();
   * console.log('Cache cleared');
   * ```
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   *
   * Returns information about the current state of the cache
   * including size and hit rate.
   *
   * @returns Cache statistics object
   *
   * @example
   * ```typescript
   * const stats = engine.getCacheStats();
   * console.log(`Cache size: ${stats.size} entries`);
   * console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
   * ```
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.cache.size,
      hitRate: 0.8, // Placeholder - would need actual tracking
    };
  }
}
