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
} from "@suzumiyaaoba/tpeg-core";

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
  /** For baseType "union": the inferred type of each alternative, used to build a type guard */
  unionMembers?: InferredType[];
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
  /** Number of `typeCache` hits during the current inference run */
  cacheHits: number;
  /** Number of `typeCache` misses during the current inference run */
  cacheMisses: number;
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
 * Peels away transparent `Group` wrappers to see if `expr` is (or wraps)
 * a `LabeledExpression` -- a local duplicate of `labelOf` in
 * packages/parser/src/codegen.ts (not imported: this package depends on
 * tpeg-core only, not tpeg-parser). Used by `inferSequenceType` to decide
 * which elements contribute a field to a `captureSequence(...)`-merged
 * object, exactly like codegen's `collectTopLevelLabels` decides which
 * elements name a label.
 */
const unwrapToLabeledExpression = (
  expr: Expression,
): LabeledExpression | undefined => {
  if (expr.type === "LabeledExpression") return expr as LabeledExpression;
  if (expr.type === "Group") {
    return unwrapToLabeledExpression((expr as Group).expression);
  }
  return undefined;
};

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
      cacheHits: 0,
      cacheMisses: 0,
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
        } else if (
          error instanceof Error &&
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
          throw error;
        }
      }
    }

    // Deduplicate imports and calculate final stats
    result.imports = Array.from(new Set(result.imports));
    result.stats.cacheHits = this.context.cacheHits;
    result.stats.cacheMisses = this.context.cacheMisses;
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
        this.context.cacheHits++;
        return cached;
      }
    }
    if (this.options.enableCaching) {
      this.context.cacheMisses++;
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
        case "Cut":
          // The `~` cut/commit marker: consumes no input and, per
          // `generateSequence` in packages/parser/src/codegen.ts, is
          // dropped entirely rather than emitted as a `sequence(...)`
          // argument -- so, like a lookahead, it contributes nothing to
          // the result type.
          inferredType = {
            typeString: "void",
            nullable: false,
            isArray: false,
            baseType: "void",
            imports: [],
            documentation: this.options.generateDocumentation
              ? "Cut/commit marker - no result"
              : undefined,
          };
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
   * When inferObjectTypes is enabled, this mirrors `generateSequence` in
   * packages/parser/src/codegen.ts branch-for-branch (this package
   * deliberately depends on tpeg-core only, not tpeg-parser -- see
   * CLAUDE.md's package dependency graph -- so the branching is
   * duplicated here rather than imported; keep the two in sync by hand):
   *
   * 1. A `Cut` (`~`) marker never becomes an argument to the generated
   *    `sequence(...)`/`captureSequence(...)` call -- unlike a
   *    lookahead, which is kept as a real (void-valued) tuple slot -- so
   *    it's excluded here too, or the inferred tuple would have one more
   *    element than the runtime value actually does.
   * 2. If ANY remaining element is directly (or through a transparent
   *    `Group`) a `LabeledExpression`, codegen emits `captureSequence(...)`
   *    instead of `sequence(...)`, which merges captured fields into a
   *    single object rather than a positional tuple -- see `mergeCaptures`
   *    in packages/core/src/capture.ts. Only elements that are themselves
   *    directly labeled contribute a field here (matching
   *    `collectTopLevelLabels`, codegen.ts); every unlabeled element is
   *    dropped, exactly like `mergeCaptures` drops every untagged entry.
   *    Simplification, not modeled: an unlabeled element that is itself a
   *    `Choice` whose winning alternative happens to be its own raw
   *    `capture(...)` also merges its field in at runtime (`choice`
   *    forwards whichever alternative's value it matched, tag and all --
   *    see `CAPTURE_TAG`'s doc comment, capture.ts). That shape is
   *    under-inferred here (the field is silently absent from the
   *    inferred type) rather than over-claimed, which is the safer
   *    direction to be wrong in.
   * 3. Otherwise, with no direct label anywhere, a single surviving
   *    element (after the Cut is dropped) is returned BARE -- not
   *    wrapped in a 1-tuple -- exactly like `generateSequence`'s
   *    `parts.length === 1 && !hasLabel` branch. Two or more survivors
   *    produce an ordinary positional tuple, as before.
   *
   * When inferObjectTypes is disabled, returns a simple string type.
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

    const nonCutElements = expression.elements.filter(
      (element: Expression) => element.type !== "Cut",
    );
    const labeledElements = nonCutElements
      .map((element: Expression) => unwrapToLabeledExpression(element))
      .filter((element): element is LabeledExpression => element !== undefined);

    if (labeledElements.length > 0) {
      // A repeated label (e.g. `a:"x" a:"y"`) isn't rejected by
      // `validateGrammar` -- and at runtime, `mergeCaptures`
      // (packages/core/src/capture.ts) is `Object.assign` over the
      // elements in order, so the LAST occurrence's value wins. A `Map`
      // keyed by label reproduces that (a later `.set` for the same key
      // overwrites the earlier field's type), which also avoids emitting
      // a duplicate-property object type literal (a `tsc` error) when
      // this typeString is written out verbatim by
      // `type-integration.ts`'s `export type ... = ...;`.
      const fieldsByLabel = new Map<string, InferredType>();
      for (const labeled of labeledElements) {
        fieldsByLabel.set(
          labeled.label,
          this.inferExpressionType(labeled.expression),
        );
      }
      const fields = Array.from(fieldsByLabel, ([key, type]) => ({
        key,
        type,
      }));
      const allImports = fields.flatMap((f) => f.type.imports);

      return {
        typeString: `{ ${fields.map((f) => `${f.key}: ${f.type.typeString}`).join(", ")} }`,
        nullable: false,
        isArray: false,
        baseType: "object",
        imports: Array.from(new Set(allImports)),
        documentation: this.options.generateDocumentation
          ? "Sequence with labeled elements merged into an object"
          : undefined,
      };
    }

    const elementTypes = nonCutElements.map((element: Expression) =>
      this.inferExpressionType(element),
    );

    if (elementTypes.length === 1) {
      const [only] = elementTypes;
      if (only) return only;
    }

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
      unionMembers: alternativeTypes,
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
   * `optional()` (packages/core/src/repetition.ts:41-70) has signature
   * `Parser<[T] | []>` and its implementation matches: a one-element
   * array on a match, an empty array on failure -- NEVER a bare `T` or
   * `undefined`. This mirrors that runtime shape exactly rather than the
   * more conventional-looking `T | undefined` docs/peg-grammar.md's
   * Capture Structure Reference Table used to describe for `pattern?`
   * (that table has been corrected to match). Changing `optional()`
   * itself to return `T | undefined` instead would be a breaking change
   * across core/combinator/codegen/every generated parser, so runtime is
   * treated as the source of truth here, not the other way around.
   *
   * @param expression - Optional expression
   * @returns Inferred type for optional expression
   */
  private inferOptionalType(expression: Optional): InferredType {
    const innerType = this.inferExpressionType(expression.expression);

    return {
      typeString: `[${innerType.typeString}] | []`,
      nullable: false,
      isArray: true,
      baseType: "tuple",
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
   * ranges, and optional repetitions. Note that `quantified()`
   * (packages/core/src/repetition.ts) always returns `T[]`, including for
   * `{0,n}` / `{0,}` -- an empty array on zero matches. Like `Optional`
   * (`inferOptionalType`, just above), this never produces a bare
   * `undefined` result either -- neither PEG repetition operator does;
   * see `inferOptionalType`'s own doc comment for `optional()`'s actual
   * `[T] | []` shape.
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

    const documentation = this.options.generateDocumentation
      ? `Quantified expression: {${expression.min},${expression.max ?? ""}}`
      : undefined;

    if (!this.options.inferArrayTypes) {
      return {
        typeString: "string",
        nullable: false,
        isArray: false,
        baseType: "string",
        imports: innerType.imports,
        documentation,
      };
    }

    // Handle parentheses for complex union types, matching Star/Plus.
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
      documentation,
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
   * The `capture(label, parser)` combinator (packages/core/src/capture.ts)
   * that code generation emits for a labeled expression wraps the inner
   * value in an object keyed by the label -- `Parser<{ [label]: T }>`, not
   * `Parser<T>`. The inferred type must match that actual runtime shape,
   * particularly because `inferSequenceType` builds a tuple type from each
   * element's inferred type as-is: a bare inner type here would produce a
   * tuple slot type that doesn't match what a sequence containing this
   * labeled expression actually produces at runtime.
   *
   * @param expression - Labeled expression
   * @returns Inferred type for the labeled expression, wrapped in an object
   *   keyed by the label
   */
  private inferLabeledExpressionType(
    expression: LabeledExpression,
  ): InferredType {
    const innerType = this.inferExpressionType(expression.expression);

    return {
      typeString: `{ ${expression.label}: ${innerType.typeString} }`,
      nullable: false,
      isArray: false,
      baseType: "object",
      imports: innerType.imports,
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
    this.context.cacheHits = 0;
    this.context.cacheMisses = 0;
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
