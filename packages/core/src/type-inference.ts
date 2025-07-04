/**
 * Type Inference System for TPEG Grammar
 *
 * This module provides automatic type inference for parser results based on grammar structure.
 * It analyzes TPEG expressions and generates TypeScript type information for better type safety.
 *
 * The type inference system supports:
 * - Automatic type inference for all TPEG expression types
 * - Circular dependency detection and handling
 * - Configurable type inference strategies
 * - Caching for performance optimization
 * - Detailed documentation generation
 *
 * @example
 * ```typescript
 * const engine = new TypeInferenceEngine({
 *   inferArrayTypes: true,
 *   inferUnionTypes: true,
 *   generateDocumentation: true
 * });
 *
 * const result = engine.inferGrammarTypes(grammar);
 * console.log(result.ruleTypes.get('expression')?.typeString);
 * ```
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
} from "./grammar-types";

/**
 * Represents an inferred TypeScript type for a parser result
 *
 * This interface provides comprehensive type information including the TypeScript
 * type string, nullability, array status, and documentation.
 */
export interface InferredType {
  /** The TypeScript type string representation (e.g., "string", "number[]", "A | B") */
  typeString: string;
  /** Whether this type is nullable (can be undefined or null) */
  nullable: boolean;
  /** Whether this type is an array type (includes tuple types) */
  isArray: boolean;
  /** Base type name without modifiers (e.g., "string", "number", "object") */
  baseType: string;
  /** Import statements needed for this type (e.g., ["import { MyType } from './types'"]) */
  imports: string[];
  /** JSDoc comment for the type (generated when generateDocumentation is true) */
  documentation?: string | undefined;
  /** Whether this type represents a complex type that needs parentheses in unions */
  needsParens?: boolean;
  /** Position information if includePositions is enabled */
  position?: {
    start: number;
    end: number;
  };
}

/**
 * Context for type inference operation
 *
 * Maintains state during type inference including rule definitions,
 * recursion detection, and caching for performance.
 */
export interface TypeInferenceContext {
  /** Available rule definitions for reference during inference */
  rules: Map<string, RuleDefinition>;
  /** Current rule being processed (for recursion detection) */
  currentRule?: string | undefined;
  /** Stack of rules being processed (for circular dependency detection) */
  ruleStack: string[];
  /** Cache of inferred types to avoid recomputation */
  typeCache: Map<string, InferredType>;
  /** Whether to generate detailed type annotations and documentation */
  verbose: boolean;
  /** Maximum recursion depth to prevent stack overflow */
  maxRecursionDepth: number;
  /** Current recursion depth */
  currentDepth: number;
}

/**
 * Options for type inference configuration
 *
 * Controls various aspects of the type inference process including
 * which types to infer, documentation generation, and performance settings.
 */
export interface TypeInferenceOptions {
  /** Whether to infer array types for repetition operators (Star, Plus, Quantified) */
  inferArrayTypes: boolean;
  /** Whether to infer union types for choice operators */
  inferUnionTypes: boolean;
  /** Whether to infer object types for sequence operators */
  inferObjectTypes: boolean;
  /** Whether to include position information in types */
  includePositions: boolean;
  /** Custom type mappings for specific patterns (e.g., "number" -> "MyNumberType") */
  customTypeMappings: Map<string, string>;
  /** Whether to generate JSDoc comments for inferred types */
  generateDocumentation: boolean;
  /** Maximum recursion depth to prevent stack overflow */
  maxRecursionDepth: number;
  /** Whether to enable aggressive caching for performance */
  enableCaching: boolean;
  /** Whether to detect and handle circular dependencies */
  detectCircularDependencies: boolean;
}

/**
 * Default type inference options
 *
 * Provides sensible defaults for most use cases while allowing
 * customization for specific requirements.
 */
export const DEFAULT_TYPE_INFERENCE_OPTIONS: TypeInferenceOptions = {
  inferArrayTypes: true,
  inferUnionTypes: true,
  inferObjectTypes: true,
  includePositions: false,
  customTypeMappings: new Map(),
  generateDocumentation: true,
  maxRecursionDepth: 100,
  enableCaching: true,
  detectCircularDependencies: true,
};

/**
 * Result of type inference for a complete grammar
 *
 * Contains all inferred types, required imports, and any issues
 * detected during the inference process.
 */
export interface GrammarTypeInference {
  /** Inferred types for each rule in the grammar */
  ruleTypes: Map<string, InferredType>;
  /** Import statements needed for all inferred types */
  imports: string[];
  /** Circular dependencies detected during inference */
  circularDependencies: string[][];
  /** Any warnings or issues encountered during inference */
  warnings: string[];
  /** Performance statistics */
  stats: {
    /** Number of types inferred */
    typesInferred: number;
    /** Number of cache hits */
    cacheHits: number;
    /** Number of cache misses */
    cacheMisses: number;
    /** Time taken for inference in milliseconds */
    inferenceTime: number;
  };
}

/**
 * Custom error for type inference issues
 */
export class TypeInferenceError extends Error {
  constructor(
    message: string,
    public readonly expression?: Expression,
    public readonly ruleName?: string,
  ) {
    super(message);
    this.name = "TypeInferenceError";
  }
}

/**
 * Type inference engine for TPEG grammars
 *
 * Provides comprehensive type inference capabilities for TPEG grammar definitions.
 * Supports various inference strategies, caching, and detailed error reporting.
 *
 * @example
 * ```typescript
 * const engine = new TypeInferenceEngine({
 *   inferArrayTypes: true,
 *   generateDocumentation: true
 * });
 *
 * const result = engine.inferGrammarTypes(grammar);
 * ```
 */
export class TypeInferenceEngine {
  private readonly options: TypeInferenceOptions;
  private context: TypeInferenceContext;
  private startTime = 0;

  /**
   * Creates a new TypeInferenceEngine with the specified options
   *
   * @param options - Configuration options for type inference
   */
  constructor(options: Partial<TypeInferenceOptions> = {}) {
    this.options = { ...DEFAULT_TYPE_INFERENCE_OPTIONS, ...options };
    this.context = {
      rules: new Map(),
      ruleStack: [],
      typeCache: new Map(),
      verbose: this.options.generateDocumentation,
      maxRecursionDepth: this.options.maxRecursionDepth,
      currentDepth: 0,
    };
  }

  /**
   * Infer types for a complete grammar
   *
   * Analyzes all rules in the grammar and generates TypeScript type information.
   * Handles circular dependencies, provides detailed error reporting, and includes
   * performance statistics.
   *
   * @param grammar - The grammar definition to analyze
   * @returns Complete type inference result with all inferred types
   *
   * @throws {TypeInferenceError} When inference fails due to invalid grammar or configuration
   *
   * @example
   * ```typescript
   * const result = engine.inferGrammarTypes(grammar);
   *
   * // Access inferred types
   * const expressionType = result.ruleTypes.get('expression');
   * console.log(expressionType?.typeString); // e.g., "string | number"
   *
   * // Check for issues
   * if (result.circularDependencies.length > 0) {
   *   console.warn('Circular dependencies detected:', result.circularDependencies);
   * }
   * ```
   */
  inferGrammarTypes(grammar: GrammarDefinition): GrammarTypeInference {
    this.startTime = performance.now();

    // Initialize context with grammar rules
    this.resetContext();

    for (const rule of grammar.rules) {
      this.context.rules.set(rule.name, rule);
    }

    const result: GrammarTypeInference = {
      ruleTypes: new Map(),
      imports: [],
      circularDependencies: [],
      warnings: [],
      stats: {
        typesInferred: 0,
        cacheHits: 0,
        cacheMisses: 0,
        inferenceTime: 0,
      },
    };

    // Infer types for each rule
    for (const rule of grammar.rules) {
      try {
        this.context.currentRule = rule.name;
        this.context.ruleStack = [rule.name];
        this.context.currentDepth = 0;

        const inferredType = this.inferExpressionType(rule.pattern);
        result.ruleTypes.set(rule.name, inferredType);
        result.stats.typesInferred++;

        // Add any new imports
        result.imports.push(...inferredType.imports);
      } catch (error) {
        if (error instanceof TypeInferenceError) {
          result.warnings.push(error.message);

          // Handle circular dependencies
          if (
            this.options.detectCircularDependencies &&
            error.message.includes("Circular dependency")
          ) {
            result.circularDependencies.push([...this.context.ruleStack]);

            // Use a placeholder type for circular dependencies
            result.ruleTypes.set(rule.name, {
              typeString: "unknown",
              nullable: false,
              isArray: false,
              baseType: "unknown",
              imports: [],
              documentation: `Circular dependency detected in rule ${rule.name}`,
            });
          } else {
            // For other errors, use a more specific error type
            result.ruleTypes.set(rule.name, {
              typeString: "unknown",
              nullable: false,
              isArray: false,
              baseType: "unknown",
              imports: [],
              documentation: `Type inference failed: ${error.message}`,
            });
          }
        } else {
          throw error;
        }
      }
    }

    // Deduplicate imports and calculate final stats
    result.imports = Array.from(new Set(result.imports));
    result.stats.inferenceTime = performance.now() - this.startTime;

    return result;
  }

  /**
   * Infer the type for a specific expression
   *
   * Recursively analyzes the expression structure and generates appropriate
   * TypeScript type information. Uses caching for performance optimization.
   *
   * @param expression - The expression to analyze
   * @returns Inferred type information
   *
   * @throws {TypeInferenceError} When inference fails or recursion limit is exceeded
   */
  inferExpressionType(expression: Expression): InferredType {
    // Check recursion depth
    if (this.context.currentDepth > this.context.maxRecursionDepth) {
      throw new TypeInferenceError(
        `Maximum recursion depth exceeded (${this.context.maxRecursionDepth})`,
        expression,
        this.context.currentRule,
      );
    }

    const cacheKey = this.getExpressionCacheKey(expression);

    // Check cache first if enabled
    if (this.options.enableCaching && this.context.typeCache.has(cacheKey)) {
      const cached = this.context.typeCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    this.context.currentDepth++;
    let inferredType: InferredType;

    try {
      switch (expression.type) {
        case "StringLiteral":
          inferredType = this.inferStringLiteralType(expression);
          break;
        case "CharacterClass":
          inferredType = this.inferCharacterClassType(expression);
          break;
        case "Identifier":
          inferredType = this.inferIdentifierType(expression);
          break;
        case "AnyChar":
          inferredType = this.inferAnyCharType(expression);
          break;
        case "Sequence":
          inferredType = this.inferSequenceType(expression);
          break;
        case "Choice":
          inferredType = this.inferChoiceType(expression);
          break;
        case "Group":
          inferredType = this.inferGroupType(expression);
          break;
        case "Star":
          inferredType = this.inferStarType(expression);
          break;
        case "Plus":
          inferredType = this.inferPlusType(expression);
          break;
        case "Optional":
          inferredType = this.inferOptionalType(expression);
          break;
        case "Quantified":
          inferredType = this.inferQuantifiedType(expression);
          break;
        case "PositiveLookahead":
        case "NegativeLookahead":
          inferredType = this.inferLookaheadType(expression);
          break;
        case "LabeledExpression":
          inferredType = this.inferLabeledExpressionType(expression);
          break;
        default: {
          const unknownType =
            "type" in expression
              ? (expression as { type: string }).type
              : "unknown";
          inferredType = {
            typeString: "unknown",
            nullable: false,
            isArray: false,
            baseType: "unknown",
            imports: [],
            documentation: `Unknown expression type: ${unknownType}`,
          };
        }
      }

      // Apply custom type mappings if available
      inferredType = this.applyCustomTypeMappings(inferredType);

      // Cache the result if enabled
      if (this.options.enableCaching) {
        this.context.typeCache.set(cacheKey, inferredType);
      }

      return inferredType;
    } finally {
      this.context.currentDepth--;
    }
  }

  /**
   * Infer type for string literal expressions
   *
   * @param expression - String literal expression
   * @returns Inferred type for string literal
   */
  private inferStringLiteralType(expression: StringLiteral): InferredType {
    // Escape quotes in the type string
    const escapedValue = expression.value.replace(/"/g, '\\"');
    const result: InferredType = {
      typeString: `"${escapedValue}"`,
      nullable: false,
      isArray: false,
      baseType: "string",
      imports: [],
    };

    if (this.options.generateDocumentation) {
      result.documentation = `String literal: "${expression.value}"`;
    }

    return result;
  }

  /**
   * Infer type for character class expressions
   *
   * @param expression - Character class expression
   * @returns Inferred type for character class
   */
  private inferCharacterClassType(_expression: CharacterClass): InferredType {
    const result: InferredType = {
      typeString: "string",
      nullable: false,
      isArray: false,
      baseType: "string",
      imports: [],
    };

    if (this.options.generateDocumentation) {
      result.documentation = "Single character matching character class";
    }

    return result;
  }

  /**
   * Infer type for identifier expressions (rule references)
   *
   * Handles circular dependency detection and recursive type inference.
   *
   * @param expression - Identifier expression
   * @returns Inferred type for the referenced rule
   *
   * @throws {TypeInferenceError} When circular dependency is detected
   */
  private inferIdentifierType(expression: Identifier): InferredType {
    const ruleName = expression.name;

    // Check for circular dependency
    if (
      this.options.detectCircularDependencies &&
      this.context.ruleStack.includes(ruleName)
    ) {
      throw new TypeInferenceError(
        `Circular dependency detected: ${this.context.ruleStack.join(" -> ")} -> ${ruleName}`,
        expression,
        this.context.currentRule,
      );
    }

    // Look up rule definition
    const rule = this.context.rules.get(ruleName);
    if (!rule) {
      return {
        typeString: "unknown",
        nullable: false,
        isArray: false,
        baseType: "unknown",
        imports: [],
        documentation: this.options.generateDocumentation
          ? `Unknown rule reference: ${ruleName}`
          : undefined,
      };
    }

    // Recursively infer type for referenced rule
    this.context.ruleStack.push(ruleName);
    const inferredType = this.inferExpressionType(rule.pattern);
    this.context.ruleStack.pop();

    return {
      ...inferredType,
      documentation: this.options.generateDocumentation
        ? `Result of rule ${ruleName}`
        : undefined,
    };
  }

  /**
   * Infer type for any character expressions
   *
   * @param expression - Any character expression
   * @returns Inferred type for any character
   */
  private inferAnyCharType(_expression: AnyChar): InferredType {
    return {
      typeString: "string",
      nullable: false,
      isArray: false,
      baseType: "string",
      imports: [],
      documentation: this.options.generateDocumentation
        ? "Any single character"
        : undefined,
    };
  }

  /**
   * Infer type for sequence expressions
   *
   * When inferObjectTypes is enabled, generates tuple types.
   * Otherwise, returns a simple string type.
   *
   * @param expression - Sequence expression
   * @returns Inferred type for sequence
   */
  private inferSequenceType(expression: Sequence): InferredType {
    if (!this.options.inferObjectTypes) {
      return {
        typeString: "string",
        nullable: false,
        isArray: false,
        baseType: "string",
        imports: [],
        documentation: this.options.generateDocumentation
          ? "Sequence of expressions"
          : undefined,
      };
    }

    const elementTypes = expression.elements.map((element: Expression) =>
      this.inferExpressionType(element),
    );

    const typeStrings = elementTypes.map((t) => t.typeString);
    const allImports = elementTypes.flatMap((t) => t.imports);

    return {
      typeString: `[${typeStrings.join(", ")}]`,
      nullable: false,
      isArray: true,
      baseType: "tuple",
      imports: Array.from(new Set(allImports)),
      documentation: this.options.generateDocumentation
        ? "Sequence of expressions as tuple"
        : undefined,
    };
  }

  /**
   * Infer type for choice expressions
   *
   * When inferUnionTypes is enabled, generates union types.
   * Otherwise, returns a simple string type.
   *
   * @param expression - Choice expression
   * @returns Inferred type for choice
   */
  private inferChoiceType(expression: Choice): InferredType {
    if (!this.options.inferUnionTypes) {
      return {
        typeString: "string",
        nullable: false,
        isArray: false,
        baseType: "string",
        imports: [],
        documentation: this.options.generateDocumentation
          ? "Choice between alternatives"
          : undefined,
      };
    }

    const alternativeTypes = expression.alternatives.map((alt: Expression) =>
      this.inferExpressionType(alt),
    );

    const typeStrings = alternativeTypes.map((t) => {
      // Add parentheses for complex types in unions
      const needsParens =
        t.typeString.includes(" | ") ||
        (t.isArray && t.typeString.includes("["));
      return needsParens ? `(${t.typeString})` : t.typeString;
    });
    const allImports = alternativeTypes.flatMap((t) => t.imports);

    return {
      typeString: typeStrings.join(" | "),
      nullable: false,
      isArray: false,
      baseType: "union",
      imports: Array.from(new Set(allImports)),
      documentation: this.options.generateDocumentation
        ? "Union of alternative expressions"
        : undefined,
    };
  }

  /**
   * Infer type for group expressions
   *
   * Simply delegates to the inner expression's type inference.
   *
   * @param expression - Group expression
   * @returns Inferred type for the grouped expression
   */
  private inferGroupType(expression: Group): InferredType {
    return this.inferExpressionType(expression.expression);
  }

  /**
   * Infer type for star expressions (zero or more repetitions)
   *
   * When inferArrayTypes is enabled, generates array types.
   * Otherwise, returns a simple string type.
   *
   * @param expression - Star expression
   * @returns Inferred type for star repetition
   */
  private inferStarType(expression: Star): InferredType {
    const innerType = this.inferExpressionType(expression.expression);

    if (!this.options.inferArrayTypes) {
      return {
        typeString: "string",
        nullable: false,
        isArray: false,
        baseType: "string",
        imports: innerType.imports,
        documentation: this.options.generateDocumentation
          ? "Zero or more repetitions"
          : undefined,
      };
    }

    // Handle parentheses for complex union types
    const needsParens = innerType.typeString.includes(" | ");
    const elementType = needsParens
      ? `(${innerType.typeString})`
      : innerType.typeString;

    return {
      typeString: `${elementType}[]`,
      nullable: false,
      isArray: true,
      baseType: innerType.baseType,
      imports: innerType.imports,
      documentation: this.options.generateDocumentation
        ? "Array of zero or more repetitions"
        : undefined,
    };
  }

  /**
   * Infer type for plus expressions (one or more repetitions)
   *
   * When inferArrayTypes is enabled, generates array types.
   * Otherwise, returns a simple string type.
   *
   * @param expression - Plus expression
   * @returns Inferred type for plus repetition
   */
  private inferPlusType(expression: Plus): InferredType {
    const innerType = this.inferExpressionType(expression.expression);

    if (!this.options.inferArrayTypes) {
      return {
        typeString: "string",
        nullable: false,
        isArray: false,
        baseType: "string",
        imports: innerType.imports,
        documentation: this.options.generateDocumentation
          ? "One or more repetitions"
          : undefined,
      };
    }

    // Handle parentheses for complex union types
    const needsParens = innerType.typeString.includes(" | ");
    const elementType = needsParens
      ? `(${innerType.typeString})`
      : innerType.typeString;

    return {
      typeString: `${elementType}[]`,
      nullable: false,
      isArray: true,
      baseType: innerType.baseType,
      imports: innerType.imports,
      documentation: this.options.generateDocumentation
        ? "Array of one or more repetitions"
        : undefined,
    };
  }

  /**
   * Infer type for optional expressions
   *
   * Always generates nullable types (union with undefined).
   *
   * @param expression - Optional expression
   * @returns Inferred type for optional expression
   */
  private inferOptionalType(expression: Optional): InferredType {
    const innerType = this.inferExpressionType(expression.expression);

    // Handle parentheses for complex types
    const needsParens =
      innerType.typeString.includes(" | ") || innerType.isArray;
    const wrappedType = needsParens
      ? `(${innerType.typeString})`
      : innerType.typeString;

    return {
      typeString: `${wrappedType} | undefined`,
      nullable: true,
      isArray: false, // Optional wrapper makes it not an array at the top level
      baseType: innerType.baseType,
      imports: innerType.imports,
      documentation: this.options.generateDocumentation
        ? "Optional expression"
        : undefined,
    };
  }

  /**
   * Infer type for quantified expressions
   *
   * Handles various quantification patterns including exact counts,
   * ranges, and optional repetitions.
   *
   * @param expression - Quantified expression
   * @returns Inferred type for quantified expression
   */
  private inferQuantifiedType(expression: Quantified): InferredType {
    const innerType = this.inferExpressionType(expression.expression);

    // If min === max === 1, it's just the inner type
    if (expression.min === 1 && expression.max === 1) {
      return innerType;
    }

    // If min === 0, it's optional
    const isOptional = expression.min === 0;
    const baseTypeString = this.options.inferArrayTypes
      ? `${innerType.typeString}[]`
      : "string";

    return {
      typeString: isOptional ? `${baseTypeString} | undefined` : baseTypeString,
      nullable: isOptional,
      isArray: this.options.inferArrayTypes,
      baseType: innerType.baseType,
      imports: innerType.imports,
      documentation: this.options.generateDocumentation
        ? `Quantified expression: {${expression.min},${expression.max || ""}}`
        : undefined,
    };
  }

  /**
   * Infer type for lookahead expressions
   *
   * Lookaheads don't consume input and don't contribute to the result,
   * so they always return void.
   *
   * @param expression - Lookahead expression
   * @returns Inferred type for lookahead (always void)
   */
  private inferLookaheadType(
    expression: PositiveLookahead | NegativeLookahead,
  ): InferredType {
    // Lookaheads don't consume input and don't contribute to the result
    return {
      typeString: "void",
      nullable: false,
      isArray: false,
      baseType: "void",
      imports: [],
      documentation: this.options.generateDocumentation
        ? `Lookahead assertion (${expression.type === "PositiveLookahead" ? "positive" : "negative"}) - no result`
        : undefined,
    };
  }

  /**
   * Infer type for labeled expressions
   *
   * Simply delegates to the inner expression's type inference.
   *
   * @param expression - Labeled expression
   * @returns Inferred type for the labeled expression
   */
  private inferLabeledExpressionType(
    expression: LabeledExpression,
  ): InferredType {
    // For labeled expressions, we infer the type of the inner expression
    const innerType = this.inferExpressionType(expression.expression);

    return {
      ...innerType,
      documentation: this.options.generateDocumentation
        ? `Labeled expression: ${expression.label}`
        : undefined,
    };
  }

  /**
   * Apply custom type mappings to the inferred type
   *
   * @param inferredType - The inferred type to modify
   * @returns Modified type with custom mappings applied
   */
  private applyCustomTypeMappings(inferredType: InferredType): InferredType {
    const customType = this.options.customTypeMappings.get(
      inferredType.typeString,
    );
    if (customType) {
      return {
        ...inferredType,
        typeString: customType,
        baseType: customType,
      };
    }
    return inferredType;
  }

  /**
   * Reset the inference context for a new grammar
   */
  private resetContext(): void {
    this.context.rules.clear();
    this.context.typeCache.clear();
    this.context.ruleStack = [];
    this.context.currentRule = undefined as string | undefined;
    this.context.currentDepth = 0;
  }

  /**
   * Generate a unique cache key for an expression
   *
   * Creates a deterministic string representation of the expression
   * for caching purposes, excluding documentation to avoid cache misses.
   *
   * @param expression - The expression to generate a key for
   * @returns Unique cache key string
   */
  private getExpressionCacheKey(expression: Expression): string {
    // Generate a unique key for caching based on expression structure
    return JSON.stringify(expression, (key, value) => {
      // Exclude documentation and other non-structural properties from cache key
      if (key === "documentation" || key === "position") {
        return undefined;
      }
      return value;
    });
  }
}
