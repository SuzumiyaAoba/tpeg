/**
 * Type Integration System for TPEG
 *
 * This module integrates type inference with code generation, providing
 * enhanced type-safe parser generation capabilities.
 */

import type {
  GrammarDefinition,
  RuleDefinition,
} from "@suzumiyaaoba/tpeg-core";
import { collectRuleReferences } from "@suzumiyaaoba/tpeg-core";
import {
  type GrammarTypeInference,
  type InferredType,
  TypeInferenceEngine,
} from "./type-inference";
import { isStringLiteralType, mappedBaseType } from "./type-mappings";

/**
 * Renders one logical documentation line inside a generated JSDoc block
 * comment. `text` originates in grammar source (a string literal's
 * decoded value, e.g. `String literal: "<value>"`), so it is arbitrary
 * user input: a star-slash pair in it would terminate the block comment
 * early and break the generated file's syntax (#86), and a raw newline
 * would produce an un-prefixed continuation line. Star-slash is
 * rewritten to star-backslash-slash (which renders identically in JSDoc
 * viewers), and the text is split on hard newlines so every emitted
 * line keeps its ` * ` gutter.
 */
const escapeDocCommentText = (text: string): string =>
  text.replace(/\*\//g, "*\\/");

const docCommentLines = (text: string): string[] =>
  escapeDocCommentText(text)
    .split(/\r\n|\r|\n/)
    .map((line) => `   * ${line}`);

/** Whole-string TypeScript identifier shape -- what every name this
 * module emits as a type alias, interface, namespace segment, type-guard
 * function, or interface method must satisfy. The grammar parser only
 * produces `[a-zA-Z_][a-zA-Z0-9_]*` names, but a hand-built
 * `GrammarDefinition` can carry anything (`"my-rule"`, `"123abc"`,
 * `"a.b"`) -- the checks below turn those into a clear generation-time
 * error instead of an `export type 123abcResult = ...`/`a.b(input...)`-shaped
 * SyntaxError buried in the emitted definitions. */
const TS_IDENTIFIER_FULL = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/** `TS_IDENTIFIER_FULL` per `.`-separated segment -- `namespace A.B` is
 * legal TypeScript (nested namespaces), so `typeNamespace` gets the
 * dotted form of the same check. */
const TS_DOTTED_IDENTIFIER_FULL =
  /^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*$/;

// Type-only namespaces allow keyword properties after a dot (`Types.class`).
// Runtime namespaces also introduce local bindings for those segments.
const TS_NAMESPACE_ROOT_KEYWORDS = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
]);
const TS_NAMESPACE_STRICT_KEYWORDS = new Set([
  "implements",
  "interface",
  "let",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "yield",
]);
const TS_NAMESPACE_RUNTIME_KEYWORDS = new Set([
  ...TS_NAMESPACE_ROOT_KEYWORDS,
  "await",
  "eval",
  "arguments",
]);

interface TypeGuardContext {
  arrayConstructor: string;
  usesArrayConstructor: boolean;
}

interface TypeGuardExpression {
  code: string;
  usesArrayConstructor?: boolean;
}

function namespaceAlias(name: string, segments: readonly string[]): string {
  while (segments.includes(name)) name += "_";
  return name;
}

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
  /** Whether to include JSDoc comments in generated types */
  includeDocumentation: boolean;
  /** Replacements keyed by exact inferred type strings */
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
      customTypeMappings: this.options.customTypeMappings,
      generateDocumentation: this.options.includeDocumentation,
    });
  }

  private validateTypeNamespace(emitRuntimeNamespace = false): string[] {
    const namespace = this.options.typeNamespace;
    if (!namespace) return [];
    const segments = namespace.split(".");
    if (
      !TS_DOTTED_IDENTIFIER_FULL.test(namespace) ||
      TS_NAMESPACE_ROOT_KEYWORDS.has(segments[0] ?? "") ||
      segments.some((segment) => TS_NAMESPACE_STRICT_KEYWORDS.has(segment)) ||
      (emitRuntimeNamespace &&
        segments.some((segment) => TS_NAMESPACE_RUNTIME_KEYWORDS.has(segment)))
    ) {
      throw new Error(
        `typeNamespace "${namespace}" is not a valid TypeScript namespace name${emitRuntimeNamespace ? " for generated runtime guards" : ""}. Use dotted identifiers with no reserved bindings (e.g. "My.Grammar").`,
      );
    }
    return segments;
  }

  /**
   * Create a typed grammar definition with full type information
   */
  createTypedGrammar(grammar: GrammarDefinition): TypedGrammarDefinition {
    // Perform type inference
    const typeInference = this.typeInferenceEngine.inferGrammarTypes(grammar);

    const circularRules = new Set(typeInference.circularDependencies.flat());
    const typedRules = grammar.rules.map((rule) =>
      this.createTypedRule(rule, typeInference, circularRules),
    );

    // Generate type definitions
    const typeDefinitions = this.generateTypeDefinitions(typedRules);

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
    circularRules: ReadonlySet<string>,
  ): TypedRuleDefinition {
    const inferredType: InferredType = typeInference.ruleTypes.get(
      rule.name,
    ) ?? {
      typeString: "unknown",
      nullable: true,
      isArray: false,
      baseType: "unknown",
      imports: [],
      documentation: this.options.includeDocumentation
        ? `No type information available for rule ${rule.name}`
        : undefined,
    };

    // Analyze dependencies
    const dependencies = [...collectRuleReferences(rule.pattern)];

    return {
      ...rule,
      inferredType,
      hasCircularDependency: circularRules.has(rule.name),
      dependencies,
    };
  }

  /**
   * Generate TypeScript type definitions for the grammar
   */
  private generateTypeDefinitions(typedRules: TypedRuleDefinition[]): string {
    const typeDefinitions: string[] = [];
    const namespaceSegments = this.validateTypeNamespace(
      this.options.generateTypeGuards && typedRules.length > 0,
    );
    const guardContext: TypeGuardContext = {
      arrayConstructor: "Array",
      usesArrayConstructor: false,
    };
    if (namespaceSegments.includes("Array")) {
      // Capture the global constructor outside the namespace. Avoid all
      // namespace segments so an inner namespace cannot shadow the alias.
      guardContext.arrayConstructor = namespaceAlias(
        "__tpegArray",
        namespaceSegments,
      );
    }

    // Distinct rule names can collapse to the same PascalCase identifier
    // (`foo` vs `Foo`, `foo_bar` vs `fooBar`, ...), which would emit two
    // `<Name>Result` type aliases and two `is<Name>Result` guards under
    // one name -- uncompilable TypeScript, produced with no diagnostic.
    // Reject instead of silently disambiguating (a `FooResult2` renames
    // the type out from under the grammar author, the same reason
    // `validateGeneratedIdentifiers` in tpeg-parser rejects rather than
    // renames).
    {
      // Two rules literally named the same are a duplicate-rule-name
      // problem rather than a PascalCase collision, but the outcome here
      // is the same class of defect: `createTypedGrammar` does not run
      // `validateGrammar` itself, so without this check a hand-built
      // grammar carrying duplicate rule names emits a second
      // `export type <Name>Result` (and, with type guards on, a second
      // `export function is<Name>Result`) under the identical identifier
      // -- uncompilable TypeScript, produced with no diagnostic.
      const ruleNameCounts = new Map<string, number>();
      for (const rule of typedRules) {
        ruleNameCounts.set(rule.name, (ruleNameCounts.get(rule.name) ?? 0) + 1);
      }
      const duplicatedNames = [...ruleNameCounts]
        .filter(([, count]) => count > 1)
        .map(([name]) => name);
      if (duplicatedNames.length > 0) {
        throw new Error(
          `Duplicate rule name(s) ${duplicatedNames.map((n) => `"${n}"`).join(", ")} -- each duplicate emits an \`export type <Name>Result\`/guard under the same identifier. Reject the grammar with \`validateGrammar\` (or remove the duplicate rules) before calling createTypedGrammar.`,
        );
      }

      const rulesByGeneratedName = new Map<string, Set<string>>();
      for (const rule of typedRules) {
        const generated = this.pascalCase(rule.name);
        const names = rulesByGeneratedName.get(generated) ?? new Set();
        names.add(rule.name);
        rulesByGeneratedName.set(generated, names);
      }
      for (const [generated, names] of rulesByGeneratedName) {
        if (names.size > 1) {
          throw new Error(
            `Rules ${[...names].map((n) => `"${n}"`).join(", ")} all generate the type name "${generated}Result" (PascalCase collision) -- rename the rules so their generated names are distinct.`,
          );
        }
        // Check `generated` itself, not `${generated}Result`: a rule
        // named entirely of separators ("---") produces `generated ===
        // ""`, where `"" + "Result"` is a perfectly valid identifier
        // that silently detaches the type name from the rule name.
        if (!TS_IDENTIFIER_FULL.test(generated)) {
          throw new Error(
            `Rule name "${[...names][0] as string}" generates the type name "${generated}Result", which is not a valid TypeScript identifier -- the emitted \`export type ${generated}Result = ...\` would fail to parse. Rule names must consist of ASCII letters, digits, "_", and "-" only (and must not start with a digit).`,
          );
        }
        if (`${generated}Result` === "ParserResult") {
          throw new Error(
            `Rule "${[...names][0] as string}" generates the type name "ParserResult", which is reserved for the union of all parser result types -- rename the rule so its generated type name is distinct.`,
          );
        }
      }
    }

    // Add namespace if specified
    if (this.options.typeNamespace) {
      if (
        this.options.generateTypeGuards &&
        namespaceSegments.length > 1 &&
        typedRules.length > 0
      ) {
        // Namespace lowering reuses `parent.child || {}`. Preinitialize an
        // own property so `constructor`, `__proto__`, etc. cannot reuse an
        // inherited global object. Keep existing own namespace members.
        const objectConstructor = namespaceAlias(
          "__tpegObject",
          namespaceSegments,
        );
        const globalObject =
          namespaceSegments[0] === "globalThis"
            ? "Object"
            : "globalThis.Object";
        typeDefinitions.push(
          `const ${objectConstructor} = ${globalObject};`,
          "",
        );
        for (let index = 1; index < namespaceSegments.length; index++) {
          const parentNamespace = namespaceSegments.slice(0, index).join(".");
          const parentName = namespaceSegments[index - 1] as string;
          const key = JSON.stringify(namespaceSegments[index]);
          typeDefinitions.push(
            `export namespace ${parentNamespace} {`,
            `  if (!${objectConstructor}.prototype.hasOwnProperty.call(${parentName}, ${key})) {`,
            `    ${objectConstructor}.defineProperty(${parentName}, ${key}, { value: {}, writable: true, enumerable: true, configurable: true });`,
            "  }",
            "}",
            "",
          );
        }
      }
      typeDefinitions.push(`export namespace ${this.options.typeNamespace} {`);
    }

    // Generate type aliases for each rule
    for (const rule of typedRules) {
      const inferredType = rule.inferredType;

      if (this.options.includeDocumentation && inferredType.documentation) {
        typeDefinitions.push("  /**");
        typeDefinitions.push(...docCommentLines(inferredType.documentation));
        if (rule.dependencies.length > 0) {
          // Dependency names originate in the grammar's `Identifier` nodes,
          // so -- like the documentation text above -- they are arbitrary
          // input to this block comment: a `*/` inside one would terminate
          // the comment early (#86), and a raw newline would break the
          // ` * ` gutter. Escape both the same way `docCommentLines` does.
          const safeDependencies = rule.dependencies.map((name) =>
            escapeDocCommentText(name).replace(/[\r\n]+/g, " "),
          );
          typeDefinitions.push(
            `   * Dependencies: ${safeDependencies.join(", ")}`,
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
        typeDefinitions.push(
          this.generateTypeGuard(ruleName, inferredType, guardContext),
        );
      }

      typeDefinitions.push("");
    }

    // Generate result type union
    const resultTypes = typedRules.map(
      (rule) => `${this.pascalCase(rule.name)}Result`,
    );
    if (this.options.includeDocumentation) {
      typeDefinitions.push("  /** Union of all parser result types */");
    }
    typeDefinitions.push(
      `  export type ParserResult = ${resultTypes.length > 0 ? resultTypes.join(" | ") : "never"};`,
    );

    // Close namespace if specified
    if (this.options.typeNamespace) {
      typeDefinitions.push("}");
    }

    if (
      guardContext.usesArrayConstructor &&
      guardContext.arrayConstructor !== "Array"
    ) {
      // A root namespace named globalThis shadows that identifier at the
      // module level; in that case Array itself is still the global binding.
      const globalArray =
        namespaceSegments[0] === "globalThis" ? "Array" : "globalThis.Array";
      typeDefinitions.unshift(
        `const ${guardContext.arrayConstructor} = ${globalArray};`,
        "",
      );
    }

    return typeDefinitions.join("\n");
  }

  /**
   * Generate a type guard function for a rule result type
   */
  private generateTypeGuard(
    ruleName: string,
    inferredType: InferredType,
    context: TypeGuardContext,
  ): string {
    const guardName = `is${ruleName}Result`;
    const typeName = `${ruleName}Result`;
    const expression = this.guardExpression(inferredType, "value", context);
    if (expression.usesArrayConstructor) context.usesArrayConstructor = true;
    const parameter =
      expression.code === "true" || expression.code === "false"
        ? "_value"
        : "value";
    const guardImplementation = `return ${expression.code};`;

    return [
      ...(this.options.includeDocumentation
        ? [`  /** Type guard for ${typeName} */`]
        : []),
      `  export function ${guardName}(${parameter}: unknown): ${parameter} is ${typeName} {`,
      `    ${guardImplementation}`,
      "  }",
    ].join("\n");
  }

  /**
   * Build the boolean expression and its required globals for a type guard.
   * Keep dependencies with the expression so simplifying a constant guard
   * also removes globals referenced only by its discarded checks.
   * `valueExpr` is the JS expression naming the value under test --
   * `"value"` at the top level, an element/member expression inside
   * array/tuple checks.
   */
  private guardExpression(
    inferredType: InferredType,
    valueExpr: string,
    context: TypeGuardContext,
  ): TypeGuardExpression {
    if (inferredType.mappedFrom && !mappedBaseType(inferredType.typeString)) {
      throw new Error(
        `Cannot generate a type guard for custom type mapping ${JSON.stringify(inferredType.mappedFrom.typeString)} -> ${JSON.stringify(inferredType.typeString)}: its runtime shape is not known. Disable generateTypeGuards and provide your own validator for this type.`,
      );
    }
    // Checked before the string-literal heuristic below: a union's own
    // typeString (e.g. `"yes" | "no"`) can itself start and end with a
    // quote, which would otherwise be misread as a single string literal.
    if (inferredType.baseType === "union" && inferredType.unionMembers) {
      const members = inferredType.unionMembers.map((member) =>
        this.guardExpression(member, valueExpr, context),
      );
      if (members.some((member) => member.code === "true")) {
        return { code: "true" };
      }
      const alternatives = members.filter((member) => member.code !== "false");
      if (alternatives.length === 0) return { code: "false" };
      return {
        code: alternatives.map((member) => `(${member.code})`).join(" || "),
        usesArrayConstructor: alternatives.some(
          (member) => member.usesArrayConstructor,
        ),
      };
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
      return this.arrayGuardExpression(inferredType, valueExpr, context);
    }
    if (isStringLiteralType(inferredType.typeString)) {
      // String literal type
      return {
        code: `typeof ${valueExpr} === "string" && ${valueExpr} === ${inferredType.typeString.trim()}`,
      };
    }
    if (inferredType.baseType === "string") {
      return { code: `typeof ${valueExpr} === "string"` };
    }
    if (inferredType.baseType === "number") {
      return { code: `typeof ${valueExpr} === "number"` };
    }
    if (inferredType.baseType === "boolean") {
      return { code: `typeof ${valueExpr} === "boolean"` };
    }
    if (
      inferredType.baseType === "bigint" ||
      inferredType.baseType === "symbol"
    ) {
      return { code: `typeof ${valueExpr} === "${inferredType.baseType}"` };
    }
    if (inferredType.baseType === "object") {
      const objectCheck = `((typeof ${valueExpr} === "object" && ${valueExpr} !== null) || typeof ${valueExpr} === "function")`;
      if (!inferredType.objectProperties) return { code: objectCheck };
      const propertyChecks = Array.from(
        inferredType.objectProperties,
        ([name, type]) => {
          const key = JSON.stringify(name);
          const optional = inferredType.optionalObjectProperties?.has(name);
          const expression = this.guardExpression(type, "field", context);
          if (expression.code === "false")
            return optional
              ? { code: `!(${key} in ${valueExpr})` }
              : expression;
          if (expression.code === "true") {
            return { code: optional ? "true" : `(${key} in ${valueExpr})` };
          }
          const propertyExpr = `(${valueExpr} as Record<string, unknown>)[${key}]`;
          // Bind once so TypeScript can narrow a stable identifier through
          // nested checks, and an accessor is not read repeatedly.
          return {
            code: optional
              ? `(!(${key} in ${valueExpr}) || ((field: unknown) => ${expression.code})(${propertyExpr}))`
              : `(${key} in ${valueExpr}) && ((field: unknown) => ${expression.code})(${propertyExpr})`,
            usesArrayConstructor: expression.usesArrayConstructor,
          };
        },
      );
      if (propertyChecks.some((check) => check.code === "false")) {
        return { code: "false" };
      }
      return {
        code: [objectCheck, ...propertyChecks.map((check) => check.code)].join(
          " && ",
        ),
        usesArrayConstructor: propertyChecks.some(
          (check) => check.usesArrayConstructor,
        ),
      };
    }
    if (
      inferredType.baseType === "void" ||
      inferredType.baseType === "undefined"
    ) {
      // Lookaheads (inferLookaheadType) never produce a value, so the
      // runtime result actually is undefined -- unlike the generic
      // fallback below, "!== undefined" would be backwards here.
      return { code: `${valueExpr} === void 0` };
    }
    if (inferredType.baseType === "never") {
      // An always-failing parser (a zero-alternative `Choice` -- see
      // `inferChoiceType` in type-inference.ts) can never produce a
      // value, so no runtime value is a `never`. Without this branch the
      // generic fallback below would emit `value !== undefined`, which
      // OR'd into an enclosing union guard accepts every defined value.
      return { code: "false" };
    }
    if (inferredType.baseType === "null") {
      // The `null` half of `optional()`'s `T | null` (NULL_INFERRED_TYPE
      // in type-inference.ts). The generic fallback `!== undefined`
      // would accept null -- and every other defined value -- so this
      // needs its own exact check.
      return { code: `${valueExpr} === null` };
    }
    if (
      inferredType.baseType === "unknown" ||
      inferredType.baseType === "any"
    ) {
      return { code: "true" };
    }
    return { code: `${valueExpr} !== void 0` };
  }

  /**
   * The `isArray` case of {@link guardExpression}: checks `valueExpr` is an
   * array AND that its contents match the inferred element/member shapes,
   * rather than a bare `Array.isArray` which would accept `[1,2,3]` for a
   * `string[]` or a wrong-arity tuple. Falls back to `Array.isArray` only
   * when the inferred type carries no element information (e.g. an
   * externally-supplied `unknown[]`).
   */
  private arrayGuardExpression(
    inferredType: InferredType,
    valueExpr: string,
    context: TypeGuardContext,
  ): TypeGuardExpression {
    const arrayConstructor = context.arrayConstructor;
    const arrayCheck = `${arrayConstructor}.isArray(${valueExpr})`;
    if (inferredType.tupleVariants) {
      const variants = inferredType.tupleVariants
        .map((members) => this.tupleVariantGuard(members, valueExpr, context))
        .filter((variant) => variant.code !== "false");
      if (variants.length === 0) return { code: "false" };
      return {
        code: `${arrayCheck} && (${variants.map((variant) => `(${variant.code})`).join(" || ")})`,
        usesArrayConstructor: true,
      };
    }
    if (inferredType.tupleMembers) {
      const tuple = this.tupleVariantGuard(
        inferredType.tupleMembers,
        valueExpr,
        context,
      );
      if (tuple.code === "false") return tuple;
      return {
        code: `${arrayCheck} && ${tuple.code}`,
        usesArrayConstructor: true,
      };
    }
    if (inferredType.arrayElement) {
      const element = this.guardExpression(
        inferredType.arrayElement,
        "el",
        context,
      );
      // Constant element predicates need no indexed reads. A never[] can
      // contain no elements; unknown[] accepts any array, including holes.
      if (element.code === "true") {
        return { code: arrayCheck, usesArrayConstructor: true };
      }
      if (element.code === "false") {
        return {
          code: `${arrayCheck} && ${valueExpr}.length === 0`,
          usesArrayConstructor: true,
        };
      }
      // findIndex visits holes as undefined, whereas every skips them.
      return {
        code: `${arrayCheck} && ${arrayConstructor}.prototype.findIndex.call(${valueExpr}, (el: unknown) => !(${element.code})) === -1`,
        usesArrayConstructor: true,
      };
    }
    return { code: arrayCheck, usesArrayConstructor: true };
  }

  /**
   * One tuple shape's `length === N && per-member checks` clause for
   * {@link arrayGuardExpression}. A zero-member variant reduces to the
   * length check alone (the `[]` half of `[T] | []`).
   */
  private tupleVariantGuard(
    members: InferredType[],
    valueExpr: string,
    context: TypeGuardContext,
  ): TypeGuardExpression {
    const lengthCheck = `${valueExpr}.length === ${members.length}`;
    const memberChecks = members.map((member, i) => {
      const expression = this.guardExpression(member, "field", context);
      if (expression.code === "true" || expression.code === "false") {
        return expression;
      }
      // Bind only when this member is reached, preserving short-circuiting
      // while keeping accessor values stable through nested checks.
      return {
        code: `((field: unknown) => ${expression.code})(${valueExpr}[${i}])`,
        usesArrayConstructor: expression.usesArrayConstructor,
      };
    });
    if (memberChecks.some((check) => check.code === "false")) {
      return { code: "false" };
    }
    const checks = memberChecks.filter((check) => check.code !== "true");
    return {
      code: [lengthCheck, ...checks.map((check) => check.code)].join(" && "),
      usesArrayConstructor: checks.some((check) => check.usesArrayConstructor),
    };
  }

  /**
   * Collect all required imports from type inference
   */
  private collectImports(typeInference: GrammarTypeInference): string[] {
    const imports = new Set<string>();

    // Add imports from each rule type
    for (const inferredType of typeInference.ruleTypes.values()) {
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
    const namespaceSegments = this.validateTypeNamespace();
    const resultTypeNames = typedGrammar.rules.map(
      (rule) => `${this.pascalCase(rule.name)}Result`,
    );
    // Keep the core result wrapper distinct from a generated ParseResult
    // alias or a root namespace of that name. Nested namespace members
    // cannot shadow this module-level import.
    const parseResultType =
      namespaceSegments[0] === "ParseResult" ||
      (namespaceSegments.length === 0 &&
        resultTypeNames.includes("ParseResult"))
        ? namespaceAlias("__tpegParseResult", [
            ...namespaceSegments,
            ...resultTypeNames,
          ])
        : "ParseResult";

    // `${name}Parser` is emitted as the interface identifier -- a
    // hand-built grammar carrying a non-identifier name would produce a
    // SyntaxError-shaped declaration with no diagnostic otherwise (same
    // class of defect `generateTypeDefinitions` now rejects).
    if (!TS_IDENTIFIER_FULL.test(typedGrammar.name)) {
      throw new Error(
        `Grammar name "${typedGrammar.name}" is not a valid TypeScript identifier -- the emitted \`export interface ${typedGrammar.name}Parser {\` would fail to parse.`,
      );
    }

    // Self-contained output: the interface references `ParseResult` and
    // the `<Rule>Result` types from `createTypedGrammar`'s
    // `typeDefinitions`. Without the import (and, when those types were
    // emitted inside `typeNamespace`, without qualifying them) the two
    // outputs concatenated failed to type-check with "Cannot find name".
    if (typedGrammar.rules.length > 0) {
      const importName =
        parseResultType === "ParseResult"
          ? "ParseResult"
          : `ParseResult as ${parseResultType}`;
      interfaceLines.push(
        `import type { ${importName} } from "@suzumiyaaoba/tpeg-core";`,
      );
      interfaceLines.push("");
    }
    if (this.options.includeDocumentation) {
      interfaceLines.push("/**");
      interfaceLines.push(
        ` * Generated parser interface for ${typedGrammar.name} grammar`,
      );
      interfaceLines.push(
        " * This interface provides type-safe access to all parser rules",
      );
      interfaceLines.push(" */");
    }
    interfaceLines.push(`export interface ${typedGrammar.name}Parser {`);

    for (const rule of typedGrammar.rules) {
      const resultType = `${this.pascalCase(rule.name)}Result`;

      if (this.options.includeDocumentation) {
        interfaceLines.push("  /**");
        interfaceLines.push(
          ...docCommentLines(
            `Parse ${rule.name}: ${rule.inferredType.documentation ?? ""}`,
          ),
        );
        if (rule.hasCircularDependency) {
          interfaceLines.push(
            "   * @warning This rule has circular dependencies",
          );
        }
        interfaceLines.push("   */");
      }

      // A non-identifier rule name (reachable only from a hand-built
      // grammar) is emitted as a quoted method signature --
      // `"my-rule"(input: string): ...` -- which is legal TypeScript and
      // preserves the actual method name a consumer would call, rather
      // than emitting `my-rule(input...)` (a SyntaxError). The type
      // reference can't be quoted the same way, so a name whose
      // PascalCase form still isn't an identifier (`"123abc"` ->
      // `ParseResult<123abcResult>`) is rejected outright -- the same
      // check `generateTypeDefinitions` applies to its own output.
      // An unquoted new(...) declares a construct signature on the interface.
      const methodName =
        rule.name !== "new" && TS_IDENTIFIER_FULL.test(rule.name)
          ? rule.name
          : JSON.stringify(rule.name);
      if (!TS_IDENTIFIER_FULL.test(resultType)) {
        throw new Error(
          `Rule name "${rule.name}" generates the type name "${resultType}", which is not a valid TypeScript identifier -- the emitted \`ParseResult<${resultType}>\` reference would fail to parse.`,
        );
      }
      const resultTypeRef = this.options.typeNamespace
        ? `${this.options.typeNamespace}.${resultType}`
        : resultType;
      interfaceLines.push(
        `  ${methodName}(input: string): ${parseResultType}<${resultTypeRef}>;`,
      );
    }

    interfaceLines.push("}");

    return interfaceLines.join("\n");
  }
}
