/**
 * Type Inference System for TPEG Grammar
 * 
 * This module provides automatic type inference for parser results based on grammar structure.
 * It analyzes TPEG expressions and generates TypeScript type information for better type safety.
 */

import type { 
  Expression, 
  GrammarDefinition, 
  RuleDefinition,
  StringLiteral,
  CharacterClass,
  Identifier,
  AnyChar,
  Sequence,
  Choice,
  Group,
  Star,
  Plus,
  Optional,
  Quantified,
  PositiveLookahead,
  NegativeLookahead,
  LabeledExpression
} from "./grammar-types";

/**
 * Represents an inferred TypeScript type for a parser result
 */
export interface InferredType {
  /** The TypeScript type string representation */
  typeString: string;
  /** Whether this type is nullable (can be undefined) */
  nullable: boolean;
  /** Whether this type is an array type */
  isArray: boolean;
  /** Base type name without modifiers */
  baseType: string;
  /** Import statements needed for this type */
  imports: string[];
  /** JSDoc comment for the type */
  documentation?: string;
}

/**
 * Context for type inference operation
 */
export interface TypeInferenceContext {
  /** Available rule definitions for reference */
  rules: Map<string, RuleDefinition>;
  /** Current rule being processed (for recursion detection) */
  currentRule?: string;
  /** Stack of rules being processed (for circular dependency detection) */
  ruleStack: string[];
  /** Cache of inferred types to avoid recomputation */
  typeCache: Map<string, InferredType>;
  /** Whether to generate detailed type annotations */
  verbose: boolean;
}

/**
 * Options for type inference configuration
 */
export interface TypeInferenceOptions {
  /** Whether to infer array types for repetition operators */
  inferArrayTypes: boolean;
  /** Whether to infer union types for choice operators */
  inferUnionTypes: boolean;
  /** Whether to infer object types for sequence operators */
  inferObjectTypes: boolean;
  /** Whether to include position information in types */
  includePositions: boolean;
  /** Custom type mappings for specific patterns */
  customTypeMappings: Map<string, string>;
  /** Whether to generate JSDoc comments */
  generateDocumentation: boolean;
}

/**
 * Default type inference options
 */
export const DEFAULT_TYPE_INFERENCE_OPTIONS: TypeInferenceOptions = {
  inferArrayTypes: true,
  inferUnionTypes: true,
  inferObjectTypes: true,
  includePositions: false,
  customTypeMappings: new Map(),
  generateDocumentation: true,
};

/**
 * Result of type inference for a complete grammar
 */
export interface GrammarTypeInference {
  /** Inferred types for each rule */
  ruleTypes: Map<string, InferredType>;
  /** Import statements needed */
  imports: string[];
  /** Circular dependencies detected */
  circularDependencies: string[][];
}

/**
 * Type inference engine for TPEG grammars
 */
export class TypeInferenceEngine {
  private options: TypeInferenceOptions;
  private context: TypeInferenceContext;

  constructor(options: Partial<TypeInferenceOptions> = {}) {
    this.options = { ...DEFAULT_TYPE_INFERENCE_OPTIONS, ...options };
    this.context = {
      rules: new Map(),
      ruleStack: [],
      typeCache: new Map(),
      verbose: this.options.generateDocumentation,
    };
  }

  /**
   * Infer types for a complete grammar
   */
  inferGrammarTypes(grammar: GrammarDefinition): GrammarTypeInference {
    // Initialize context with grammar rules
    this.context.rules.clear();
    this.context.typeCache.clear();
    this.context.ruleStack = [];

    for (const rule of grammar.rules) {
      this.context.rules.set(rule.name, rule);
    }

    const result: GrammarTypeInference = {
      ruleTypes: new Map(),
      imports: [],
      circularDependencies: [],
    };

    // Infer types for each rule
    for (const rule of grammar.rules) {
      try {
        this.context.currentRule = rule.name;
        this.context.ruleStack = [rule.name];
        
        const inferredType = this.inferExpressionType(rule.pattern);
        result.ruleTypes.set(rule.name, inferredType);
        
        // Add any new imports
        result.imports.push(...inferredType.imports);
      } catch (error) {
        // Handle circular dependencies
        if (error instanceof Error && error.message.includes("Circular dependency")) {
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
          throw error;
        }
      }
    }

    // Deduplicate imports
    result.imports = Array.from(new Set(result.imports));

    return result;
  }

  /**
   * Infer the type for a specific expression
   */
  inferExpressionType(expression: Expression): InferredType {
    const cacheKey = this.getExpressionCacheKey(expression);
    
    // Check cache first
    if (this.context.typeCache.has(cacheKey)) {
      const cached = this.context.typeCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    let inferredType: InferredType;

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
      default:
        const unknownType = 'type' in expression ? (expression as any).type : 'unknown';
        inferredType = {
          typeString: "unknown",
          nullable: false,
          isArray: false,
          baseType: "unknown",
          imports: [],
          documentation: `Unknown expression type: ${unknownType}`,
        };
    }

    // Cache the result
    this.context.typeCache.set(cacheKey, inferredType);
    return inferredType;
  }

  private inferStringLiteralType(expression: StringLiteral): InferredType {
    // Escape quotes in the type string
    const escapedValue = expression.value.replace(/"/g, '\\"');
    return {
      typeString: `"${escapedValue}"`,
      nullable: false,
      isArray: false,
      baseType: "string",
      imports: [],
      documentation: `String literal: "${expression.value}"`,
    };
  }

  private inferCharacterClassType(_expression: CharacterClass): InferredType {
    return {
      typeString: "string",
      nullable: false,
      isArray: false,
      baseType: "string",
      imports: [],
      documentation: "Single character matching character class",
    };
  }

  private inferIdentifierType(expression: Identifier): InferredType {
    const ruleName = expression.name;
    
    // Check for circular dependency
    if (this.context.ruleStack.includes(ruleName)) {
      throw new Error(`Circular dependency detected: ${this.context.ruleStack.join(" -> ")} -> ${ruleName}`);
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
        documentation: `Unknown rule reference: ${ruleName}`,
      };
    }

    // Recursively infer type for referenced rule
    this.context.ruleStack.push(ruleName);
    const inferredType = this.inferExpressionType(rule.pattern);
    this.context.ruleStack.pop();

    return {
      ...inferredType,
      documentation: `Result of rule ${ruleName}`,
    };
  }

  private inferAnyCharType(_expression: AnyChar): InferredType {
    return {
      typeString: "string",
      nullable: false,
      isArray: false,
      baseType: "string",
      imports: [],
      documentation: "Any single character",
    };
  }

  private inferSequenceType(expression: Sequence): InferredType {
    if (!this.options.inferObjectTypes) {
      return {
        typeString: "string",
        nullable: false,
        isArray: false,
        baseType: "string",
        imports: [],
        documentation: "Sequence of expressions",
      };
    }

    const elementTypes = expression.elements.map((element: Expression) =>
      this.inferExpressionType(element)
    );

    const typeStrings = elementTypes.map(t => t.typeString);
    const allImports = elementTypes.flatMap(t => t.imports);

    return {
      typeString: `[${typeStrings.join(", ")}]`,
      nullable: false,
      isArray: true,
      baseType: "tuple",
      imports: Array.from(new Set(allImports)),
      documentation: "Sequence of expressions as tuple",
    };
  }

  private inferChoiceType(expression: Choice): InferredType {
    if (!this.options.inferUnionTypes) {
      return {
        typeString: "string",
        nullable: false,
        isArray: false,
        baseType: "string",
        imports: [],
        documentation: "Choice between alternatives",
      };
    }

    const alternativeTypes = expression.alternatives.map((alt: Expression) =>
      this.inferExpressionType(alt)
    );

    const typeStrings = alternativeTypes.map(t => {
      // Add parentheses for complex types in unions
      const needsParens = t.typeString.includes(" | ") || (t.isArray && t.typeString.includes("["));
      return needsParens ? `(${t.typeString})` : t.typeString;
    });
    const allImports = alternativeTypes.flatMap(t => t.imports);

    return {
      typeString: typeStrings.join(" | "),
      nullable: false,
      isArray: false,
      baseType: "union",
      imports: Array.from(new Set(allImports)),
      documentation: "Union of alternative expressions",
    };
  }

  private inferGroupType(expression: Group): InferredType {
    return this.inferExpressionType(expression.expression);
  }

  private inferStarType(expression: Star): InferredType {
    const innerType = this.inferExpressionType(expression.expression);
    
    if (!this.options.inferArrayTypes) {
      return {
        typeString: "string",
        nullable: false,
        isArray: false,
        baseType: "string",
        imports: innerType.imports,
        documentation: "Zero or more repetitions",
      };
    }

    // Handle parentheses for complex union types
    const needsParens = innerType.typeString.includes(" | ");
    const elementType = needsParens ? `(${innerType.typeString})` : innerType.typeString;

    return {
      typeString: `${elementType}[]`,
      nullable: false,
      isArray: true,
      baseType: innerType.baseType,
      imports: innerType.imports,
      documentation: "Array of zero or more repetitions",
    };
  }

  private inferPlusType(expression: Plus): InferredType {
    const innerType = this.inferExpressionType(expression.expression);
    
    if (!this.options.inferArrayTypes) {
      return {
        typeString: "string",
        nullable: false,
        isArray: false,
        baseType: "string",
        imports: innerType.imports,
        documentation: "One or more repetitions",
      };
    }

    // Handle parentheses for complex union types
    const needsParens = innerType.typeString.includes(" | ");
    const elementType = needsParens ? `(${innerType.typeString})` : innerType.typeString;

    return {
      typeString: `${elementType}[]`,
      nullable: false,
      isArray: true,
      baseType: innerType.baseType,
      imports: innerType.imports,
      documentation: "Array of one or more repetitions",
    };
  }

  private inferOptionalType(expression: Optional): InferredType {
    const innerType = this.inferExpressionType(expression.expression);
    
    // Handle parentheses for complex types
    const needsParens = innerType.typeString.includes(" | ") || innerType.isArray;
    const wrappedType = needsParens ? `(${innerType.typeString})` : innerType.typeString;
    
    return {
      typeString: `${wrappedType} | undefined`,
      nullable: true,
      isArray: false, // Optional wrapper makes it not an array at the top level
      baseType: innerType.baseType,
      imports: innerType.imports,
      documentation: "Optional expression",
    };
  }

  private inferQuantifiedType(expression: Quantified): InferredType {
    const innerType = this.inferExpressionType(expression.expression);
    
    if (!this.options.inferArrayTypes || expression.min === 1 && expression.max === 1) {
      return innerType;
    }

    const isOptional = expression.min === 0;
    const baseTypeString = this.options.inferArrayTypes ? `${innerType.typeString}[]` : "string";
    
    return {
      typeString: isOptional ? `${baseTypeString} | undefined` : baseTypeString,
      nullable: isOptional,
      isArray: this.options.inferArrayTypes,
      baseType: innerType.baseType,
      imports: innerType.imports,
      documentation: `Quantified expression: {${expression.min},${expression.max || ""}}`,
    };
  }

  private inferLookaheadType(_expression: PositiveLookahead | NegativeLookahead): InferredType {
    // Lookaheads don't consume input and don't contribute to the result
    return {
      typeString: "void",
      nullable: false,
      isArray: false,
      baseType: "void",
      imports: [],
      documentation: "Lookahead assertion (no result)",
    };
  }

  private inferLabeledExpressionType(expression: LabeledExpression): InferredType {
    // For labeled expressions, we infer the type of the inner expression
    const innerType = this.inferExpressionType(expression.expression);
    
    return {
      ...innerType,
      documentation: `Labeled expression: ${expression.label}`,
    };
  }

  private getExpressionCacheKey(expression: Expression): string {
    // Generate a unique key for caching based on expression structure
    return JSON.stringify(expression, (key, value) => {
      if (key === "documentation") return undefined; // Exclude documentation from cache key
      return value;
    });
  }
}