/**
 * Type Integration System for TPEG
 *
 * This module integrates type inference with code generation, providing
 * enhanced type-safe parser generation capabilities.
 */

import type {
  Expression,
  GrammarDefinition,
  RuleDefinition,
} from "@suzumiyaaoba/tpeg-core";
import {
  type GrammarTypeInference,
  type InferredType,
  TypeInferenceEngine,
} from "./type-inference";

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
export interface TypedGrammarDefinition extends Omit<
  GrammarDefinition,
  "rules"
> {
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
  private createTypedRule(
    rule: RuleDefinition,
    typeInference: GrammarTypeInference,
  ): TypedRuleDefinition {
    const inferredType = typeInference.ruleTypes.get(rule.name);

    // If no type information found, create a default type
    const defaultType: InferredType = {
      typeString: "unknown",
      nullable: false,
      isArray: false,
      baseType: "unknown",
      imports: [],
      documentation: `No type information available for rule ${rule.name}`,
    };

    const finalInferredType = inferredType || defaultType;

    // Check for circular dependencies
    const hasCircularDependency = typeInference.circularDependencies.some(
      (cycle) => cycle.includes(rule.name),
    );

    // Analyze dependencies
    const dependencies = this.analyzeDependencies(rule);

    return {
      ...rule,
      inferredType: finalInferredType,
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
        case "ActionExpression":
          // Traversing into an action's own wrapped expression (not just
          // treating the action as a leaf) matters even though the
          // action's OWN result type is `unknown`
          // (`inferActionExpressionType`, `type-inference.ts`): the
          // labels/rules the wrapped expression references are still
          // real dependencies for circular-dependency detection and for
          // the "Dependencies: ..." doc comment this analysis feeds
          // below. Before this case existed, every rule using a semantic
          // action silently reported zero dependencies, with no warning
          // -- a `switch` with no `default` doesn't fail to compile just
          // because one union member goes unhandled.
          traverse(expr.expression);
          break;
        case "StringLiteral":
        case "CharacterClass":
        case "AnyChar":
        case "Cut":
          // These types have no sub-expressions, so no dependencies
          break;
        case "QualifiedIdentifier":
          // A `module.rule` reference points OUTSIDE this grammar's own
          // rule set (see `inferQualifiedIdentifierType`'s doc comment,
          // `type-inference.ts`) -- not a dependency edge in this
          // grammar's local rule graph, and nothing further to traverse
          // into.
          break;
        default: {
          // Exhaustiveness check, matching the established pattern
          // elsewhere in this repo (e.g. `packages/samples/src/arith/
          // calculator.ts`) -- see the identical guard in
          // `inferExpressionType` (`type-inference.ts`) for why this
          // matters here specifically: a switch with no `default`
          // silently does nothing for an unhandled union member instead
          // of failing to compile.
          const exhaustiveCheck: never = expr;
          throw new Error(
            `Unhandled expression type in dependency analysis: ${(exhaustiveCheck as { type: string }).type}`,
          );
        }
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
      `  export type ParserResult = ${resultTypes.length > 0 ? resultTypes.join(" | ") : "never"};`,
    );

    // Close namespace if specified
    if (this.options.typeNamespace) {
      typeDefinitions.push("}");
    }

    return typeDefinitions.join("\n");
  }

  /**
   * Generate a type guard function for a rule result type
   */
  private generateTypeGuard(
    ruleName: string,
    inferredType: InferredType,
  ): string {
    const guardName = `is${ruleName}Result`;
    const typeName = `${ruleName}Result`;
    const guardImplementation = `return ${this.guardExpression(inferredType)};`;

    return [
      `  /** Type guard for ${typeName} */`,
      `  export function ${guardName}(value: unknown): value is ${typeName} {`,
      `    ${guardImplementation}`,
      "  }",
    ].join("\n");
  }

  /**
   * Build the boolean expression (no "return"/";") that checks whether
   * `value` matches an inferred type, for use in a type guard body.
   */
  private guardExpression(inferredType: InferredType): string {
    // Checked before the string-literal heuristic below: a union's own
    // typeString (e.g. `"yes" | "no"`) can itself start and end with a
    // quote, which would otherwise be misread as a single string literal.
    if (inferredType.baseType === "union" && inferredType.unionMembers) {
      return inferredType.unionMembers
        .map((member) => `(${this.guardExpression(member)})`)
        .join(" || ");
    }
    // Checked BEFORE `baseType`'s own per-kind branches below: `inferStarType`/
    // `inferPlusType`/`inferQuantifiedType` (type-inference.ts) all set
    // `isArray: true` while leaving `baseType` as whatever the ELEMENT type
    // was (e.g. `[a-z]+` infers `{ baseType: "string", isArray: true,
    // typeString: "string[]" }`) -- an array whose element `baseType`
    // happens to be "string" would otherwise hit the `baseType === "string"`
    // branch below and generate `typeof value === "string"`, a guard that
    // returns `false` for every value of its own declared type (confirmed:
    // `isWordResult(["a"])` returned `false` for `word = [a-z]+` before this
    // reordering). `tsc` never catches this because the guard's declared
    // return type is a bare `value is T` predicate -- any boolean expression
    // type-checks regardless of whether it agrees with the runtime shape.
    if (inferredType.isArray) {
      return "Array.isArray(value)";
    }
    if (
      inferredType.typeString.startsWith('"') &&
      inferredType.typeString.endsWith('"')
    ) {
      // String literal type
      const literal = inferredType.typeString.slice(1, -1);
      return `typeof value === "string" && value === "${literal}"`;
    }
    if (inferredType.baseType === "string") {
      return `typeof value === "string"`;
    }
    if (inferredType.baseType === "object") {
      return `typeof value === "object" && value !== null`;
    }
    if (inferredType.baseType === "void") {
      // Lookaheads (inferLookaheadType) never produce a value, so the
      // runtime result actually is undefined -- unlike the generic
      // fallback below, "!== undefined" would be backwards here.
      return "value === undefined";
    }
    return "value !== undefined";
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
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  }

  /**
   * Get type information for a specific rule
   */
  getTypeInfo(
    typedGrammar: TypedGrammarDefinition,
    ruleName: string,
  ): InferredType | undefined {
    return typedGrammar.typeInference.ruleTypes.get(ruleName);
  }

  /**
   * Check if a rule has circular dependencies
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
        `  ${rule.name}(input: string): ParseResult<${resultType}>;`,
      );
    }

    interfaceLines.push("}");

    return interfaceLines.join("\n");
  }
}
