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

import {
  escapeStringLiteral,
  unwrapToLabeledExpression,
} from "@suzumiyaaoba/tpeg-core";
import { mappedBaseType } from "./type-mappings";
import {
  expressionCacheKey,
  expressionCacheSnapshot,
  expressionSnapshotUnchanged,
} from "./type-cache-key";
import type { ExpressionCacheSnapshot } from "./type-cache-key";
import type {
  ActionExpression,
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
  QualifiedIdentifier,
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
  /** For baseType "union": the inferred type of each alternative, used to build a type guard */
  unionMembers?: InferredType[];
  /** For an isArray `T[]` type: the inferred element type, used to build
   * an element-checking type guard instead of a bare
   * `Array.isArray(value)` that would accept any array regardless of
   * contents. */
  arrayElement?: InferredType;
  /** For an isArray fixed-shape `[A, B, ...]` tuple type: each member's
   * inferred type in order -- lets a type guard check length AND each
   * position's shape. */
  tupleMembers?: InferredType[];
  /** For an isArray union-of-tuples type (e.g. `[T] | []` -- previously
   * produced by `optional(...)`, retained for hand-built types): each
   * variant's member list, in order. */
  tupleVariants?: InferredType[][];
  /** Capture properties and their inferred value types, used to
   * validate labeled objects recursively instead of accepting any object. */
  objectProperties?: ReadonlyMap<string, InferredType>;
  /** Object properties that may be absent; other recorded properties are required. */
  optionalObjectProperties?: ReadonlySet<string>;
  /** Original inferred type before a custom mapping replaced its type string. */
  mappedFrom?: InferredType;
}

/**
 * The inferred type of `null` -- the no-match half of `optional()`'s
 * `T | null` result, used as the second union member of
 * `inferOptionalType`'s return.
 */
const NULL_INFERRED_TYPE: InferredType = {
  typeString: "null",
  nullable: true,
  isArray: false,
  baseType: "null",
  imports: [],
};

const UNKNOWN_INFERRED_TYPE: InferredType = {
  typeString: "unknown",
  nullable: true,
  isArray: false,
  baseType: "unknown",
  imports: [],
};
const OBJECT_PROTOTYPE_FIELDS = new Set(
  Object.getOwnPropertyNames(Object.prototype),
);

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

/** Internal bookkeeping belongs to the same run as rules and type results. */
interface InferenceRunContext extends TypeInferenceContext {
  /** Extra recursive calls required by cached expressions; missing means zero. */
  cachedDepths: Map<string, number>;
  /** Largest relative depth reached by each active uncached inference. */
  requiredDepths: number[];
  cachedDependencies: Map<string, InferenceDependency>;
  dependencyFrames: InferenceDependency[];
  /** Same-level capture tags, kept separate from public structural type metadata. */
  captureVariants: WeakMap<InferredType, readonly CaptureVariant[]>;
}

type CaptureFields = ReadonlyMap<string, InferredType>;
interface CaptureVariant {
  fields: CaptureFields;
  /** Arbitrary tagged fields may accompany the explicitly known fields. */
  unknownFields: boolean;
}
const NO_CAPTURE_FIELDS: readonly CaptureVariant[] = [
  { fields: new Map(), unknownFields: false },
];
const UNKNOWN_CAPTURE_FIELDS: readonly CaptureVariant[] = [
  { fields: new Map(), unknownFields: true },
];
const MAX_CAPTURE_VARIANTS = 256;

/** Mapping and rule lookups used by one inference, including its children. */
interface InferenceDependency {
  /** Absent when this analysis never queried a value's type mapping. */
  source: string | undefined;
  replacement: string | undefined;
  hasMappings: boolean;
  hasRules: boolean;
  cacheable: boolean;
  /** Rule existence used only to determine whether its boundary strips tags. */
  captureRules?: { name: string; exists: boolean }[];
  rule?: {
    name: string;
    exists: boolean;
    pattern: Expression | undefined;
    snapshot: ExpressionCacheSnapshot | undefined;
  };
  children?: InferenceDependency[];
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
  /** Replacements keyed by exact inferred type strings (e.g., "number" -> "MyNumberType") */
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
    /**
     * The full rule-reference path of a circular-dependency error (e.g.
     * `["expr", "term", "factor", "expr"]`), captured at THROW time.
     * `inferGrammarTypes` uses this rather than re-reading
     * `context.ruleStack` from its `catch` block: once
     * `inferIdentifierType`'s `push`/`pop` is wrapped in `try/finally` (so
     * a thrown error can never leave a stale entry on `ruleStack`), the
     * stack has already unwound back to just the starting rule's name by
     * the time the exception reaches that `catch` -- the cycle path has to
     * travel WITH the error, not be read back out of mutable state after
     * the fact. Only ever set for a circular-dependency
     * `TypeInferenceError` (see `inferIdentifierType`); absent otherwise.
     */
    public readonly cycle?: readonly string[],
  ) {
    super(message);
    this.name = "TypeInferenceError";
  }
}

/**
 * Rotates `cycle` so it starts at its lexicographically smallest element,
 * giving the same canonical key to every rotation of the same cycle (e.g.
 * `["expr","term","factor"]`, `["term","factor","expr"]`, and
 * `["factor","expr","term"]` all normalize to the same key) -- used to
 * de-duplicate a single circular dependency that `inferGrammarTypes`
 * would otherwise discover once per rule participating in it, since it
 * infers each rule's type starting from a fresh `ruleStack`. `" -> "`
 * joins the rotated names since a TPEG identifier is always
 * `[a-zA-Z_][a-zA-Z0-9_]*` (`packages/parser/src/identifier.ts`) and can
 * never contain a space, so this can't collide across different cycles.
 */
const normalizeCycleKey = (cycle: readonly string[]): string => {
  if (cycle.length === 0) return "";
  let minIndex = 0;
  for (let i = 1; i < cycle.length; i++) {
    if ((cycle[i] as string) < (cycle[minIndex] as string)) minIndex = i;
  }
  return [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)].join(" -> ");
};

/**
 * The `unknown` placeholder recorded for a rule whose inference hit a
 * circular dependency -- shared by `handleRuleInferenceError`'s
 * `TypeInferenceError` and plain-`Error` branches so both produce the
 * exact same shape/documentation.
 */
const circularDependencyPlaceholder = (
  ruleName: string,
  generateDocumentation: boolean,
): InferredType => ({
  typeString: "unknown",
  nullable: true,
  isArray: false,
  baseType: "unknown",
  imports: [],
  documentation: generateDocumentation
    ? `Circular dependency detected in rule ${ruleName}`
    : undefined,
});

/** Whole-string JavaScript identifier shape -- the condition under which
 * a capture label can be emitted as a bare object-literal property name
 * in an inferred type string (`{ a: T }`). */
const TS_IDENTIFIER_FULL = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Renders a capture label as an object-literal property name: bare when
 * identifier-shaped (keeping `{ a: T }` output unchanged for every label
 * the grammar parser can produce), `JSON.stringify`-quoted otherwise.
 * A label like `my-label` -- reachable only from a hand-built AST, since
 * the grammar parser's identifier rule can't produce one -- used to emit
 * `{ my-label: T }`, a SyntaxError in any file `type-integration.ts`
 * writes the typeString into; `{ "my-label": T }` is legal TypeScript
 * and preserves the actual runtime key.
 */
const labelPropertyKey = (label: string): string =>
  TS_IDENTIFIER_FULL.test(label) ? label : JSON.stringify(label);

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
  private context: InferenceRunContext;
  private activeGrammarRuns = 0;

  /**
   * Creates a new TypeInferenceEngine with the specified options
   *
   * @param options - Configuration options for type inference
   */
  constructor(options: Partial<TypeInferenceOptions> = {}) {
    this.options = { ...DEFAULT_TYPE_INFERENCE_OPTIONS, ...options };
    if (
      !Number.isSafeInteger(this.options.maxRecursionDepth) ||
      this.options.maxRecursionDepth < 0
    ) {
      throw new TypeInferenceError(
        "maxRecursionDepth must be a non-negative safe integer",
      );
    }
    this.context = this.createContext();
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
    const previousContext = this.context;
    const nested =
      this.activeGrammarRuns > 0 || previousContext.currentDepth > 0;
    this.activeGrammarRuns++;
    try {
      const startTime = performance.now();
      if (nested) this.context = this.createContext();
      else this.resetContext();

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

      // Each rule starts with a fresh ruleStack. Normalize rotations so a
      // cycle is recorded once rather than once per participating rule.
      const seenCycles = new Set<string>();
      for (const rule of grammar.rules) {
        this.inferRuleType(rule, result, seenCycles);
      }

      result.imports = Array.from(new Set(result.imports));
      result.stats.cacheHits = this.context.cacheHits;
      result.stats.cacheMisses = this.context.cacheMisses;
      result.stats.inferenceTime = performance.now() - startTime;
      return result;
    } finally {
      this.activeGrammarRuns--;
      // Standalone runs remain available to later expression inference.
      // A reentrant run must resume its caller's rules, caches, and depth.
      if (nested) this.context = previousContext;
    }
  }

  /**
   * Infers a single rule's type into `result.ruleTypes`/`result.imports`,
   * or records the error/placeholder on failure -- see
   * {@link handleRuleInferenceError}.
   */
  private inferRuleType(
    rule: RuleDefinition,
    result: GrammarTypeInference,
    seenCycles: Set<string>,
  ): void {
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
      this.handleRuleInferenceError(rule, error, result, seenCycles);
    } finally {
      this.context.currentRule = undefined;
      this.context.ruleStack.length = 0;
    }
  }

  /**
   * Records the outcome of a failed {@link inferRuleType} call: a
   * de-duplicated entry in `result.circularDependencies`/`.warnings`
   * plus an `unknown` placeholder type for a circular dependency, a
   * warning + placeholder for any other `TypeInferenceError`, and a
   * rethrow for anything else.
   */
  private handleRuleInferenceError(
    rule: RuleDefinition,
    error: unknown,
    result: GrammarTypeInference,
    seenCycles: Set<string>,
  ): void {
    if (error instanceof TypeInferenceError) {
      // Handle circular dependencies
      if (
        this.options.detectCircularDependencies &&
        error.message.includes("Circular dependency")
      ) {
        // `error.cycle` was captured at THROW time (see
        // `TypeInferenceError`'s own doc comment) -- `ruleStack` itself
        // can no longer be read back here for this, now that
        // `inferIdentifierType`'s `push`/`pop` is properly `finally`-
        // guarded and has already unwound to just this rule's name by
        // the time the exception reaches this `catch`. Falls back to
        // this rule's own name only in the [in-practice unreachable]
        // case of a `TypeInferenceError` thrown some other way with a
        // message that happens to contain "Circular dependency".
        const cycle = error.cycle ?? [rule.name];
        const key = normalizeCycleKey(cycle);
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          result.circularDependencies.push([...cycle]);
          result.warnings.push(error.message);
        }

        // Use a placeholder type for circular dependencies
        result.ruleTypes.set(
          rule.name,
          circularDependencyPlaceholder(
            rule.name,
            this.options.generateDocumentation,
          ),
        );
      } else {
        result.warnings.push(error.message);
        // For other errors, use a more specific error type
        result.ruleTypes.set(rule.name, {
          typeString: "unknown",
          nullable: true,
          isArray: false,
          baseType: "unknown",
          imports: [],
          documentation: this.options.generateDocumentation
            ? `Type inference failed: ${error.message}`
            : undefined,
        });
      }
      return;
    }
    if (
      error instanceof Error &&
      error.message.includes("Circular dependency")
    ) {
      // Same de-duplication as above, for the [equally unreachable in
      // practice] case of a plain `Error` rather than a
      // `TypeInferenceError` -- no `.cycle` to key on here, so this
      // falls back to the rule's own name.
      const key = normalizeCycleKey([rule.name]);
      if (!seenCycles.has(key)) {
        seenCycles.add(key);
        result.circularDependencies.push([rule.name]);
        result.warnings.push(error.message);
      }
      // Use a placeholder type for circular dependencies
      result.ruleTypes.set(
        rule.name,
        circularDependencyPlaceholder(
          rule.name,
          this.options.generateDocumentation,
        ),
      );
      return;
    }
    throw error;
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
    return this.inferExpression(expression, false);
  }

  private inferExpression(
    expression: Expression,
    captureOnly: boolean,
  ): InferredType {
    // Check recursion depth
    if (this.context.currentDepth > this.context.maxRecursionDepth) {
      throw new TypeInferenceError(
        `Maximum recursion depth exceeded (${this.context.maxRecursionDepth})`,
        expression,
        this.context.currentRule,
      );
    }

    const expressionKey = this.options.enableCaching
      ? expressionCacheKey(
          expression,
          this.context.maxRecursionDepth - this.context.currentDepth,
          this.options,
        )
      : undefined;
    // The same AST can contribute a value or only a capture tag. Results and
    // dependencies differ, so those two analyses must never share an entry.
    const cacheKey =
      expressionKey !== undefined && captureOnly
        ? `capture:${expressionKey}`
        : expressionKey;

    // Check cache first if enabled
    let hadCachedType = false;
    if (cacheKey !== undefined) {
      const cached = this.context.typeCache.get(cacheKey);
      if (cached) {
        hadCachedType = true;
        const requiredDepth = this.context.cachedDepths.get(cacheKey) ?? 0;
        const mappings = this.context.cachedDependencies.get(cacheKey);
        if (
          requiredDepth <=
            this.context.maxRecursionDepth - this.context.currentDepth &&
          this.dependenciesUnchanged(mappings)
        ) {
          this.context.cacheHits++;
          this.recordRequiredDepth(requiredDepth);
          this.recordDependency(mappings!);
          return cached;
        }
      }
    }
    if (this.options.enableCaching) {
      this.context.cacheMisses++;
    }

    this.context.currentDepth++;
    if (this.options.enableCaching) this.context.requiredDepths.push(0);
    const dependency: InferenceDependency | undefined = this.options
      .enableCaching
      ? {
          source: undefined,
          replacement: undefined,
          hasMappings: false,
          hasRules: false,
          cacheable: cacheKey !== undefined,
        }
      : undefined;
    if (dependency) this.context.dependencyFrames.push(dependency);
    let succeeded = false;

    try {
      // Apply custom type mappings if available
      const originalType = captureOnly
        ? this.inferCaptureTypeUncached(expression)
        : this.inferExpressionTypeUncached(expression);
      const inferredType = captureOnly
        ? originalType
        : this.applyCustomTypeMappings(originalType, dependency);
      if (originalType !== inferredType) {
        const captures = this.context.captureVariants.get(originalType);
        if (captures) this.context.captureVariants.set(inferredType, captures);
      }

      // Cache the result if enabled
      if (cacheKey !== undefined && dependency!.cacheable) {
        this.context.typeCache.set(cacheKey, inferredType);
        this.context.cachedDependencies.set(cacheKey, dependency!);
        const requiredDepth =
          this.context.requiredDepths[this.context.requiredDepths.length - 1]!;
        // Leaf results need no depth entry or extra lookup on a cache miss.
        if (requiredDepth > 0)
          this.context.cachedDepths.set(cacheKey, requiredDepth);
        else if (hadCachedType) this.context.cachedDepths.delete(cacheKey);
      }

      succeeded = true;
      return inferredType;
    } finally {
      this.context.currentDepth--;
      if (this.options.enableCaching) {
        this.context.dependencyFrames.pop();
        if (succeeded) this.recordDependency(dependency!);
        this.recordRequiredDepth(this.context.requiredDepths.pop()!);
      }
    }
  }

  /** Include a child's full cost even when its result came from the cache. */
  private recordRequiredDepth(childDepth: number): void {
    const depths = this.context.requiredDepths;
    const parent = depths.length - 1;
    if (parent >= 0) {
      depths[parent] = Math.max(depths[parent]!, childDepth + 1);
    }
  }

  private recordDependency(child: InferenceDependency): void {
    const frames = this.context.dependencyFrames;
    const parent = frames[frames.length - 1];
    if (parent) {
      (parent.children ??= []).push(child);
      parent.hasMappings ||= child.hasMappings;
      parent.hasRules ||= child.hasRules;
      parent.cacheable &&= child.cacheable;
    }
  }

  /** Validate only lookups that contributed to this result. */
  private dependenciesUnchanged(
    dependency: InferenceDependency | undefined,
  ): boolean {
    if (!dependency) return false;
    const mappings = this.options.customTypeMappings;
    const emptyMappings = mappings.size === 0;
    if (emptyMappings && dependency.hasMappings) return false;
    if (emptyMappings && !dependency.hasRules) return true;
    const activeRules =
      this.options.detectCircularDependencies && dependency.hasRules
        ? new Set(this.context.ruleStack)
        : undefined;
    const pending = [dependency];
    const visited = new Set<InferenceDependency>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (emptyMappings && !current.hasRules) continue;
      if (
        !emptyMappings &&
        current.source !== undefined &&
        mappings.get(current.source) !== current.replacement
      )
        return false;
      if (current.rule) {
        if (activeRules?.has(current.rule.name)) return false;
        const rule = this.context.rules.get(current.rule.name);
        if ((rule !== undefined) !== current.rule.exists) return false;
        if (rule) {
          const pattern = Object.getOwnPropertyDescriptor(rule, "pattern");
          if (
            !pattern ||
            !("value" in pattern) ||
            pattern.value !== current.rule.pattern ||
            !current.rule.snapshot ||
            !expressionSnapshotUnchanged(current.rule.snapshot)
          )
            return false;
        }
      }
      if (current.captureRules)
        for (const lookup of current.captureRules)
          if (
            (this.context.rules.get(lookup.name) !== undefined) !==
            lookup.exists
          )
            return false;
      if (current.children)
        for (const child of current.children) pending.push(child);
    }
    return true;
  }

  private recordRuleDependency(
    name: string,
    rule: RuleDefinition | undefined,
  ): void {
    const frames = this.context.dependencyFrames;
    const frame = frames[frames.length - 1];
    if (!frame?.cacheable) return;
    const descriptor = rule
      ? Object.getOwnPropertyDescriptor(rule, "pattern")
      : undefined;
    const pattern =
      descriptor && "value" in descriptor
        ? (descriptor.value as Expression)
        : undefined;
    const snapshot = pattern
      ? expressionCacheSnapshot(
          pattern,
          this.context.maxRecursionDepth,
          this.options,
        )
      : undefined;
    frame.rule = { name, exists: rule !== undefined, pattern, snapshot };
    frame.hasRules = true;
    if (rule && snapshot === undefined) frame.cacheable = false;
  }

  /**
   * The per-node-type dispatch inside {@link inferExpressionType}, split
   * out so the public method only owns the depth guard + cache
   * bookkeeping around it.
   */
  private inferExpressionTypeUncached(expression: Expression): InferredType {
    switch (expression.type) {
      case "StringLiteral":
        return this.inferStringLiteralType(expression);
      case "CharacterClass":
        return this.inferCharacterClassType(expression);
      case "Identifier":
        return this.inferIdentifierType(expression);
      case "AnyChar":
        return this.inferAnyCharType(expression);
      case "Sequence":
        return this.inferSequenceType(expression);
      case "Choice":
        return this.inferChoiceType(expression);
      case "Group":
        return this.inferGroupType(expression);
      case "Star":
        return this.inferStarType(expression);
      case "Plus":
        return this.inferPlusType(expression);
      case "Optional":
        return this.inferOptionalType(expression);
      case "Quantified":
        return this.inferQuantifiedType(expression);
      case "PositiveLookahead":
      case "NegativeLookahead":
        return this.inferLookaheadType(expression);
      case "Cut":
        // The `~` cut/commit marker: consumes no input and, per
        // `generateSequence` in packages/parser/src/codegen.ts, is
        // dropped entirely rather than emitted as a `sequence(...)`
        // argument -- so, like a lookahead, it contributes nothing to
        // the result type.
        return {
          typeString: "void",
          nullable: true,
          isArray: false,
          baseType: "void",
          imports: [],
          documentation: this.options.generateDocumentation
            ? "Cut/commit marker - no result"
            : undefined,
        };
      case "Skip":
        // `applySkipDesugar`-inserted boundary skip: consumes input but
        // its `IGNORED`-sentinel value is filtered out of the enclosing
        // sequence's result -- like `Cut`, it contributes nothing to
        // the result type.
        return {
          typeString: "void",
          nullable: true,
          isArray: false,
          baseType: "void",
          imports: [],
          documentation: this.options.generateDocumentation
            ? "@skip boundary skip - no result"
            : undefined,
        };
      case "Span":
        // `@expr` source-text extraction: whatever the wrapped
        // expression's value was, `span(...)` replaces it with the raw
        // consumed input text -- the result is always a plain `string`.
        return {
          typeString: "string",
          nullable: false,
          isArray: false,
          baseType: "string",
          imports: [],
          documentation: this.options.generateDocumentation
            ? "Source text extraction (@expr) - matched text"
            : undefined,
        };
      case "WordBoundary":
        // `\b` / `\B` -- a zero-width assertion like a lookahead: the
        // emitted `wordBoundary`/`nonWordBoundary` parser succeeds with
        // `undefined`, so it occupies a `void` slot in a sequence tuple
        // but is never itself the produced value.
        return {
          typeString: "void",
          nullable: true,
          isArray: false,
          baseType: "void",
          imports: [],
          documentation: this.options.generateDocumentation
            ? `Word boundary assertion (\\${expression.negated ? "B" : "b"}) - no result`
            : undefined,
        };
      case "LabeledExpression":
        return this.inferLabeledExpressionType(expression);
      case "ActionExpression":
        return this.inferActionExpressionType(expression);
      case "QualifiedIdentifier":
        return this.inferQualifiedIdentifierType(expression);
      default: {
        // Exhaustiveness check: every `Expression` union member has its
        // own `case` above. If a new variant is ever added to
        // `Expression` (`@suzumiyaaoba/tpeg-core`) without a
        // corresponding case here, `expression` is no longer
        // assignable to `never` and this line fails to COMPILE --
        // catching the omission at build time instead of silently
        // falling through to "unknown" the way `ActionExpression` and
        // `QualifiedIdentifier` both did before this check existed
        // (confirmed: every rule using a semantic action inferred as
        // `unknown`, and `analyzeDependencies` in `type-integration.ts`
        // silently returned no dependencies for such a rule -- neither
        // was flagged by `tsc`, since the switch's own `default` branch
        // is reachable code, not a type error).
        const exhaustive: never = expression;
        const unknownType =
          "type" in exhaustive
            ? (exhaustive as { type: string }).type
            : "unknown";
        return {
          typeString: "unknown",
          nullable: true,
          isArray: false,
          baseType: "unknown",
          imports: [],
          documentation: this.options.generateDocumentation
            ? `Unknown expression type: ${unknownType}`
            : undefined,
        };
      }
    }
  }

  /**
   * Infer type for string literal expressions
   *
   * @param expression - String literal expression
   * @returns Inferred type for string literal
   */
  private inferStringLiteralType(expression: StringLiteral): InferredType {
    const value = expression.value;
    const escapedValue = escapeStringLiteral(value);
    const result: InferredType = {
      typeString: `"${escapedValue}"`,
      nullable: false,
      isArray: false,
      baseType: "string",
      imports: [],
    };

    if (this.options.generateDocumentation) {
      result.documentation = `String literal: "${value}"`;
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
      // `cycle` (the array attached to the error, and later stored in
      // `GrammarTypeInference.circularDependencies`) deliberately does NOT
      // repeat `ruleName` at the end -- it lists each participating rule
      // exactly once, matching the pre-existing `[...ruleStack]` shape
      // this replaces. The MESSAGE below repeats it once more for
      // readability (`"a -> b -> a"` reads as a cycle; `"a -> b"` alone
      // doesn't make the closure obvious), but that's a display-only
      // concern separate from the stored array's shape.
      //
      // Only rules from `ruleName`'s FIRST occurrence on the stack onward
      // actually form the cycle: the stack is the full DFS path from
      // whichever rule `inferGrammarTypes` started at, so a rule that
      // merely REFERENCES a circular one (`a -> b`, `b -> b`) used to be
      // recorded as part of the cycle itself (`[a, b]` for the true cycle
      // `[b]`) -- and re-reported under every prefix reaching it.
      const cycleStart = this.context.ruleStack.indexOf(ruleName);
      const cycle = this.context.ruleStack.slice(
        cycleStart === -1 ? 0 : cycleStart,
      );
      throw new TypeInferenceError(
        `Circular dependency detected: ${cycle.join(" -> ")} -> ${ruleName}`,
        expression,
        this.context.currentRule,
        cycle,
      );
    }

    // Look up rule definition
    const rule = this.context.rules.get(ruleName);
    this.recordRuleDependency(ruleName, rule);
    if (!rule) {
      return this.withCaptureVariants(
        {
          typeString: "unknown",
          nullable: true,
          isArray: false,
          baseType: "unknown",
          imports: [],
          documentation: this.options.generateDocumentation
            ? `Unknown rule reference: ${ruleName}`
            : undefined,
        },
        UNKNOWN_CAPTURE_FIELDS,
      );
    }

    // Recursively infer type for referenced rule. The `pop()` MUST happen
    // even if `inferExpressionType` throws (a nested circular-dependency
    // detection further down the recursion, or any other error) --
    // otherwise `ruleStack` is left with this rule's name still on it.
    // `inferGrammarTypes` currently resets `ruleStack` at the start of
    // every rule's own inference call, which happens to mask this for that
    // one caller, but nothing about `inferExpressionType`/
    // `inferIdentifierType`'s own contract should depend on a caller
    // always doing that reset.
    this.context.ruleStack.push(ruleName);
    let inferredType: InferredType;
    try {
      inferredType = this.inferExpressionType(rule.pattern);
    } finally {
      this.context.ruleStack.pop();
    }

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
   *    single object rather than a positional tuple. Choices, optionals,
   *    groups, and a bare singleton sequence can forward capture tags too.
   *    Merge successful capture variants in order: later fields overwrite
   *    earlier ones. Rule boundaries, arrays, and nested merged objects do
   *    not forward a same-level tag.
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

    // `Skip` elements are excluded for the same reason `Cut`s are:
    // their `ignore(optional(...))` emission consumes input but the
    // `IGNORED` sentinel is filtered out of the runtime tuple -- the
    // inferred tuple must not carry a slot for them either.
    const nonCutElements = expression.elements.filter(
      (element: Expression) =>
        element.type !== "Cut" && element.type !== "Skip",
    );
    const labeledElements = nonCutElements.map((element) =>
      unwrapToLabeledExpression(element),
    );
    if (labeledElements.some((element) => element !== undefined)) {
      const contributions: (readonly CaptureVariant[])[] = [];
      for (let index = 0; index < nonCutElements.length; index++) {
        const labeled = labeledElements[index];
        if (labeled) {
          // Direct labels retain their inner type, even if a mapping replaces
          // the standalone capture object's type. Group labels are transparent.
          const label = labeled.label;
          contributions.push([
            {
              fields: new Map([
                [label, this.inferExpressionType(labeled.expression)],
              ]),
              unknownFields: false,
            },
          ]);
          continue;
        }
        const element = nonCutElements[index]!;
        // Actions and external parsers may return arbitrary tagged fields.
        // Registered rule boundaries, arrays and merged sequences strip tags.
        if (
          [
            "Group",
            "Choice",
            "Optional",
            "Sequence",
            "ActionExpression",
            "Identifier",
            "QualifiedIdentifier",
          ].includes(element.type)
        ) {
          const variants = this.captureContribution(element);
          if (variants) contributions.push(variants);
        }
      }
      return this.mergeCaptureTypes(contributions);
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
      tupleMembers: elementTypes,
    };
  }

  private withCaptureVariants(
    type: InferredType,
    variants: readonly CaptureVariant[] | undefined,
  ): InferredType {
    if (variants) this.context.captureVariants.set(type, variants);
    return type;
  }

  private captureContribution(
    expression: Expression,
  ): readonly CaptureVariant[] | undefined {
    return this.context.captureVariants.get(
      this.inferExpression(expression, true),
    );
  }

  /** Analyze tags without inferring discarded values or traversing local rules. */
  private inferCaptureTypeUncached(expression: Expression): InferredType {
    const result = (variants?: readonly CaptureVariant[]) =>
      this.withCaptureVariants(
        {
          typeString: "unknown",
          nullable: true,
          isArray: false,
          baseType: "unknown",
          imports: [],
        },
        variants,
      );
    if (
      expression.type === "ActionExpression" ||
      expression.type === "QualifiedIdentifier"
    )
      return result(UNKNOWN_CAPTURE_FIELDS);
    if (expression.type === "Identifier") {
      const name = expression.name;
      const exists = this.context.rules.get(name) !== undefined;
      const frames = this.context.dependencyFrames;
      const frame = frames[frames.length - 1];
      if (frame?.cacheable) {
        frame.hasRules = true;
        (frame.captureRules ??= []).push({ name, exists });
      }
      // A local rule strips tags regardless of its value. Its pattern, depth
      // and cycles do not contribute to these fields and must not be read.
      return result(exists ? undefined : UNKNOWN_CAPTURE_FIELDS);
    }
    switch (expression.type) {
      case "LabeledExpression":
        return result([
          {
            fields: new Map([
              [
                expression.label,
                this.inferExpressionType(expression.expression),
              ],
            ]),
            unknownFields: false,
          },
        ]);
      case "Group":
        return this.inferExpression(expression.expression, true);
      case "Optional": {
        const inner = this.captureContribution(expression.expression);
        return result(inner ? [...inner, ...NO_CAPTURE_FIELDS] : undefined);
      }
      case "Choice": {
        const alternatives = expression.alternatives.map((alternative) =>
          this.captureContribution(alternative),
        );
        return result(
          alternatives.some((variants) => variants !== undefined)
            ? alternatives.flatMap((variants) => variants ?? NO_CAPTURE_FIELDS)
            : undefined,
        );
      }
      case "Sequence": {
        const elements = expression.elements.filter(
          (element) => element.type !== "Cut" && element.type !== "Skip",
        );
        // Only a bare singleton forwards its child's tag. A labeled sequence
        // creates an untagged merged object; multiple values create a tuple.
        if (elements.length === 1 && !unwrapToLabeledExpression(elements[0]!))
          return this.inferExpression(elements[0]!, true);
        return result();
      }
      default:
        return result();
    }
  }

  private captureObjectType(
    fields: CaptureFields,
    optional?: ReadonlySet<string>,
    unknownFields = false,
  ): InferredType {
    const result: InferredType = {
      typeString: `{ ${unknownFields ? "[key: string]: unknown; " : ""}${Array.from(fields, ([name, type]) => `${labelPropertyKey(name)}${optional?.has(name) ? "?" : ""}: ${type.typeString}`).join(", ")} }`,
      nullable: false,
      isArray: false,
      baseType: "object",
      objectProperties: fields,
      imports: Array.from(
        new Set(Array.from(fields.values()).flatMap((type) => type.imports)),
      ),
      documentation: this.options.generateDocumentation
        ? "Sequence with labeled elements merged into an object"
        : undefined,
    };
    if (optional?.size) result.optionalObjectProperties = optional;
    return result;
  }

  private captureUnionType(types: readonly InferredType[]): InferredType {
    const members = new Map<string, InferredType>();
    for (const type of types) {
      for (const member of type.baseType === "union" && type.unionMembers
        ? type.unionMembers
        : [type])
        members.set(member.typeString, member);
    }
    const unique = Array.from(members.values());
    if (unique.length === 1) return unique[0]!;
    return {
      typeString: unique.map((type) => type.typeString).join(" | "),
      baseType: "union",
      nullable: unique.some((type) => type.nullable),
      isArray: false,
      imports: Array.from(new Set(unique.flatMap((type) => type.imports))),
      unionMembers: unique,
      documentation: this.options.generateDocumentation
        ? "Sequence with conditional captures merged into an object"
        : undefined,
    };
  }

  /** Keep correlated variants, then widen fields if combinations grow too large. */
  private mergeCaptureTypes(
    contributions: readonly (readonly CaptureVariant[])[],
  ): InferredType {
    if (contributions.every((variants) => variants.length === 1)) {
      const fields = new Map<string, InferredType>();
      let unknownFields = false;
      for (const [variant] of contributions) {
        if (variant!.unknownFields) {
          for (const name of fields.keys())
            fields.set(name, UNKNOWN_INFERRED_TYPE);
          unknownFields = true;
        }
        for (const [name, type] of variant!.fields) fields.set(name, type);
      }
      return this.captureObjectType(fields, undefined, unknownFields);
    }
    let variants: CaptureVariant[] | undefined = [...NO_CAPTURE_FIELDS];
    let unknownFields = false;
    const summary = new Map<
      string,
      { type: InferredType; required: boolean }
    >();
    for (const incoming of contributions) {
      const incomingUnknown = incoming.some((variant) => variant.unknownFields);
      if (incomingUnknown) {
        for (const field of summary.values())
          field.type = UNKNOWN_INFERRED_TYPE;
      }
      const fields = new Map<
        string,
        { types: InferredType[]; count: number }
      >();
      for (const variant of incoming) {
        for (const [name, type] of variant.fields) {
          const field = fields.get(name);
          if (field) {
            field.types.push(type);
            field.count++;
          } else fields.set(name, { types: [type], count: 1 });
        }
      }
      for (const [name, field] of fields) {
        const required = field.count === incoming.length;
        const previous = summary.get(name);
        const arbitraryValue =
          (!required && unknownFields) ||
          incoming.some(
            (variant) => variant.unknownFields && !variant.fields.has(name),
          );
        summary.set(name, {
          type: this.captureUnionType([
            ...(previous && !required ? [previous.type] : []),
            ...field.types,
            ...(arbitraryValue ? [UNKNOWN_INFERRED_TYPE] : []),
          ]),
          required: required || previous?.required === true,
        });
      }
      unknownFields ||= incomingUnknown;
      if (!variants) continue;
      const merged = new Map<string, CaptureVariant>();
      combinations: for (const previous of variants) {
        for (const next of incoming) {
          const fields = new Map(previous.fields);
          if (next.unknownFields)
            for (const name of fields.keys())
              fields.set(name, UNKNOWN_INFERRED_TYPE);
          for (const [name, type] of next.fields) fields.set(name, type);
          const result: CaptureVariant = {
            fields,
            unknownFields: previous.unknownFields || next.unknownFields,
          };
          const key = JSON.stringify([
            result.unknownFields,
            Array.from(fields, ([name, type]) => [name, type.typeString]).sort(
              ([a], [b]) => a!.localeCompare(b!),
            ),
          ]);
          merged.set(key, result);
          if (merged.size > MAX_CAPTURE_VARIANTS) {
            variants = undefined;
            break combinations;
          }
        }
      }
      if (variants) variants = Array.from(merged.values());
    }
    if (variants)
      return this.captureUnionType(
        variants.map((variant) =>
          this.captureObjectType(
            variant.fields,
            undefined,
            variant.unknownFields,
          ),
        ),
      );
    const fields = new Map<string, InferredType>();
    const optional = new Set<string>();
    for (const [name, field] of summary) {
      // An absent own capture can still expose an inherited prototype
      // property. A precise optional value type would reject valid plain
      // parser results (and misdescribe reads of constructor/__proto__).
      fields.set(
        name,
        !field.required && OBJECT_PROTOTYPE_FIELDS.has(name)
          ? this.captureUnionType([field.type, UNKNOWN_INFERRED_TYPE])
          : field.type,
      );
      if (!field.required) optional.add(name);
    }
    return this.captureObjectType(fields, optional, unknownFields);
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
    // A zero-alternative `Choice` is the AST shape `createChoice([])`
    // produces -- unreachable from `.tpeg` grammar text (the parser's
    // `choiceExpression` always yields at least two alternatives), but a
    // legal input to this public API via a hand-built AST, and one the
    // code generators accept: `generateChoiceCode` emits `choice()`,
    // `tpeg-core`'s always-failing `Parser<never>` (`combinators.ts`'s
    // `parsers.length === 0` branch). `never` is therefore the correct
    // inferred type -- and the only safe one to produce here: joining
    // zero member type strings would leave `typeString: ""`, which
    // `type-integration.ts`'s `export type ${name}Result =
    // ${typeString};` then writes out as `export type X = ;`, a
    // SyntaxError in the generated file. As a union member `never` is
    // also correct -- `"a" | never` collapses to `"a"` the same way the
    // always-failing alternative collapses out of the runtime choice.
    if (expression.alternatives.length === 0) {
      return {
        typeString: "never",
        nullable: false,
        isArray: false,
        baseType: "never",
        imports: [],
        documentation: this.options.generateDocumentation
          ? "Empty choice - can never match, so it produces no value"
          : undefined,
      };
    }

    if (!this.options.inferUnionTypes) {
      const variants = this.options.inferObjectTypes
        ? expression.alternatives.map((alternative) => {
            if (
              ![
                "LabeledExpression",
                "Group",
                "Choice",
                "Optional",
                "Sequence",
                "ActionExpression",
                "Identifier",
                "QualifiedIdentifier",
              ].includes(alternative.type)
            )
              return NO_CAPTURE_FIELDS;
            return this.captureContribution(alternative) ?? NO_CAPTURE_FIELDS;
          })
        : [];
      const captures = variants.some((choices) =>
        choices.some(
          (variant) => variant.fields.size > 0 || variant.unknownFields,
        ),
      )
        ? variants.flat()
        : undefined;
      return this.withCaptureVariants(
        {
          typeString: "string",
          nullable: false,
          isArray: false,
          baseType: "string",
          imports: [],
          documentation: this.options.generateDocumentation
            ? "Choice between alternatives"
            : undefined,
        },
        captures,
      );
    }

    const alternativeTypes = expression.alternatives.map((alt: Expression) =>
      this.inferExpressionType(alt),
    );

    const captures = alternativeTypes.some((type) =>
      this.context.captureVariants.has(type),
    )
      ? alternativeTypes.flatMap(
          (type) => this.context.captureVariants.get(type) ?? NO_CAPTURE_FIELDS,
        )
      : undefined;
    const typeStrings = alternativeTypes.map((t) => {
      // Add parentheses for complex types in unions
      const needsParens =
        t.typeString.includes(" | ") ||
        (t.isArray && t.typeString.includes("["));
      return needsParens ? `(${t.typeString})` : t.typeString;
    });
    const allImports = alternativeTypes.flatMap((t) => t.imports);

    return this.withCaptureVariants(
      {
        typeString: typeStrings.join(" | "),
        nullable: alternativeTypes.some((type) => type.nullable),
        isArray: false,
        baseType: "union",
        imports: Array.from(new Set(allImports)),
        documentation: this.options.generateDocumentation
          ? "Union of alternative expressions"
          : undefined,
        unionMembers: alternativeTypes,
      },
      captures,
    );
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
    return this.inferRepetitionType(
      innerType,
      this.options.inferArrayTypes
        ? "Array of zero or more repetitions"
        : "Zero or more repetitions",
    );
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
    return this.inferRepetitionType(
      innerType,
      this.options.inferArrayTypes
        ? "Array of one or more repetitions"
        : "One or more repetitions",
    );
  }

  /**
   * Infer type for optional expressions
   *
   * `optional()` (packages/core/src/repetition.ts) has signature
   * `Parser<T | null>` and its implementation matches: the parsed value
   * on a match, `null` on failure. This mirrors that runtime shape
   * exactly: `pattern?` infers `T | null` and a labeled `v:pattern?`
   * infers `{ v: T | null }`.
   *
   * @param expression - Optional expression
   * @returns Inferred type for optional expression
   */
  private inferOptionalType(expression: Optional): InferredType {
    const innerType = this.inferExpressionType(expression.expression);

    return this.withCaptureVariants(
      {
        typeString: `${innerType.typeString} | null`,
        nullable: true,
        isArray: false,
        baseType: "union",
        imports: innerType.imports,
        documentation: this.options.generateDocumentation
          ? "Optional expression"
          : undefined,
        unionMembers: [innerType, NULL_INFERRED_TYPE],
      },
      this.context.captureVariants.has(innerType)
        ? [
            ...this.context.captureVariants.get(innerType)!,
            ...NO_CAPTURE_FIELDS,
          ]
        : undefined,
    );
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
   * `T | null` shape.
   *
   * @param expression - Quantified expression
   * @returns Inferred type for quantified expression
   */
  private inferQuantifiedType(expression: Quantified): InferredType {
    const innerType = this.inferExpressionType(expression.expression);

    return this.inferRepetitionType(
      innerType,
      `Quantified expression: {${expression.min},${expression.max ?? ""}}`,
    );
  }

  /** Builds the shared array/string result for repetition expressions. */
  private inferRepetitionType(
    innerType: InferredType,
    description: string,
  ): InferredType {
    const documentation = this.options.generateDocumentation
      ? description
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
      arrayElement: innerType,
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
      nullable: true,
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
    const label = expression.label;

    return this.withCaptureVariants(
      {
        typeString: `{ ${labelPropertyKey(label)}: ${innerType.typeString} }`,
        nullable: false,
        isArray: false,
        baseType: "object",
        objectProperties: new Map([[label, innerType]]),
        imports: innerType.imports,
        documentation: this.options.generateDocumentation
          ? `Labeled expression: ${label}`
          : undefined,
      },
      [{ fields: new Map([[label, innerType]]), unknownFields: false }],
    );
  }

  /**
   * Infer the type of a semantic action (`expr { ... code ... }`,
   * `packages/parser/src/codegen.ts`'s `wrapWithAction`). The action's
   * return value REPLACES the wrapped expression's own captured value at
   * runtime (see `docs/peg-grammar.md`'s "Semantic Actions" section) --
   * since that return value comes from arbitrary, unparsed TypeScript
   * source (`expression.code`), there is no sound way to infer its type
   * from the grammar alone. `unknown` is therefore the CORRECT inferred
   * type here, not a fallback for an unhandled case -- this differs from
   * this class's `default` branch (reached only for a genuinely
   * unrecognized `Expression` variant, which should never happen given
   * the exhaustiveness check there) in being an intentional, documented
   * policy rather than an omission.
   */
  private inferActionExpressionType(
    _expression: ActionExpression,
  ): InferredType {
    return this.withCaptureVariants(
      {
        typeString: "unknown",
        nullable: true,
        isArray: false,
        baseType: "unknown",
        imports: [],
        documentation: this.options.generateDocumentation
          ? "Semantic action result (return type not statically inferable from the action's code)"
          : undefined,
      },
      UNKNOWN_CAPTURE_FIELDS,
    );
  }

  /**
   * Infer the type of a `module.rule`-style qualified reference
   * (`packages/parser/src/module.ts`). Like an unresolvable bare
   * `Identifier` (see `inferIdentifierType` above), this points outside
   * the current grammar's own rule set -- `this.context.rules` only ever
   * holds THIS grammar's rules, never another module's -- so there is
   * nothing here to recurse into. Mirrors `inferIdentifierType`'s
   * "Unknown rule reference" shape/message for the analogous case,
   * rather than falling through to a generic "Unknown expression type"
   * message that would misdescribe a syntactically well-formed,
   * intentional cross-module reference as if it were malformed AST.
   */
  private inferQualifiedIdentifierType(
    expression: QualifiedIdentifier,
  ): InferredType {
    return this.withCaptureVariants(
      {
        typeString: "unknown",
        nullable: true,
        isArray: false,
        baseType: "unknown",
        imports: [],
        documentation: this.options.generateDocumentation
          ? `Unknown rule reference: ${expression.module}.${expression.name}`
          : undefined,
      },
      UNKNOWN_CAPTURE_FIELDS,
    );
  }

  /**
   * Apply custom type mappings to the inferred type
   *
   * @param inferredType - The inferred type to modify
   * @returns Modified type with custom mappings applied
   */
  private applyCustomTypeMappings(
    inferredType: InferredType,
    dependency?: InferenceDependency,
  ): InferredType {
    const customType = this.options.customTypeMappings.get(
      inferredType.typeString,
    );
    if (dependency) {
      dependency.source = inferredType.typeString;
      dependency.replacement = customType;
      dependency.hasMappings ||= customType !== undefined;
    }
    if (customType) {
      if (customType.trim() === inferredType.typeString.trim()) {
        return inferredType;
      }
      const baseType = mappedBaseType(customType);
      if (baseType) {
        // A replacement is a complete type, not an element type modifier.
        // The original tuple, union, array and capture metadata no longer
        // describes its runtime shape.
        return {
          typeString: customType,
          baseType,
          nullable: ["unknown", "any", "void", "undefined", "null"].includes(
            baseType,
          ),
          isArray: false,
          imports: inferredType.imports,
          documentation: inferredType.documentation,
          mappedFrom: inferredType,
        };
      }
      return {
        ...inferredType,
        typeString: customType,
        baseType: customType,
        mappedFrom: inferredType,
      };
    }
    return inferredType;
  }

  /**
   * Create independent state for a new grammar or the initial expression run.
   */
  private createContext(): InferenceRunContext {
    return {
      rules: new Map(),
      ruleStack: [],
      typeCache: new Map(),
      verbose: this.options.generateDocumentation,
      maxRecursionDepth: this.options.maxRecursionDepth,
      currentDepth: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cachedDepths: new Map(),
      requiredDepths: [],
      cachedDependencies: new Map(),
      dependencyFrames: [],
      captureVariants: new WeakMap(),
    };
  }

  /** Reuse idle state; no active inference can observe these cleared maps. */
  private resetContext(): void {
    const context = this.context;
    context.rules.clear();
    context.typeCache.clear();
    context.cachedDepths.clear();
    context.requiredDepths.length = 0;
    context.cachedDependencies.clear();
    context.dependencyFrames.length = 0;
    context.captureVariants = new WeakMap();
    context.ruleStack.length = 0;
    context.currentRule = undefined;
    context.currentDepth = 0;
    context.cacheHits = 0;
    context.cacheMisses = 0;
  }
}
