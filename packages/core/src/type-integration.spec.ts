/**
 * Type Integration System Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  TypeIntegrationEngine,
  DEFAULT_TYPE_INTEGRATION_OPTIONS,
  type TypeIntegrationOptions,
  type TypedGrammarDefinition,
} from "./type-integration";
import type { GrammarDefinition } from "./grammar-types";
import {
  createGrammarDefinition,
  createRuleDefinition,
  createStringLiteral,
  createCharacterClass,
  createCharRange,
  createIdentifier,
  createSequence,
  createChoice,
  createOptional,
  createStar,
  createPlus,
} from "./grammar-types";

describe("TypeIntegrationEngine", () => {
  let engine: TypeIntegrationEngine;

  beforeEach(() => {
    engine = new TypeIntegrationEngine();
  });

  describe("Basic Type Integration", () => {
    it("should create typed grammar with complete type information", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("greeting", createStringLiteral("hello", '"')),
          createRuleDefinition("number", createPlus(createCharacterClass([createCharRange("0", "9")]))),
        ]
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.name).toBe("TestGrammar");
      expect(typedGrammar.rules).toHaveLength(2);
      expect(typedGrammar.typeInference).toBeDefined();
      expect(typedGrammar.typeDefinitions).toBeDefined();
      expect(typedGrammar.imports).toBeDefined();
    });

    it("should generate correct TypeScript type definitions", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "SimpleGrammar",
        [],
        [
          createRuleDefinition("literal", createStringLiteral("test", '"')),
          createRuleDefinition("optional", createOptional(createStringLiteral("maybe", '"'))),
        ]
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain("export type LiteralResult = \"test\";");
      expect(typedGrammar.typeDefinitions).toContain("export type OptionalResult = \"maybe\" | undefined;");
      expect(typedGrammar.typeDefinitions).toContain("export type ParserResult = LiteralResult | OptionalResult;");
    });

    it("should detect rule dependencies correctly", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "DependentGrammar",
        [],
        [
          createRuleDefinition("digit", createCharacterClass([createCharRange("0", "9")])),
          createRuleDefinition("number", createPlus(createIdentifier("digit"))),
          createRuleDefinition("expression", createSequence([
            createIdentifier("number"),
            createStringLiteral("+", '"'),
            createIdentifier("number"),
          ])),
        ]
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      const digitRule = typedGrammar.rules.find(r => r.name === "digit");
      const numberRule = typedGrammar.rules.find(r => r.name === "number");
      const expressionRule = typedGrammar.rules.find(r => r.name === "expression");

      expect(digitRule?.dependencies).toEqual([]);
      expect(numberRule?.dependencies).toEqual(["digit"]);
      expect(expressionRule?.dependencies).toEqual(["number"]);
    });

    it("should detect circular dependencies", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "CircularGrammar",
        [],
        [
          createRuleDefinition("a", createSequence([createIdentifier("b"), createStringLiteral("end", '"')])),
          createRuleDefinition("b", createChoice([createIdentifier("a"), createStringLiteral("base", '"')])),
        ]
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      const ruleA = typedGrammar.rules.find(r => r.name === "a");
      const ruleB = typedGrammar.rules.find(r => r.name === "b");

      expect(ruleA?.hasCircularDependency).toBe(true);
      expect(ruleB?.hasCircularDependency).toBe(true);
      expect(typedGrammar.typeInference.circularDependencies.length).toBeGreaterThan(0);
    });
  });

  describe("Type Integration Options", () => {
    it("should respect type namespace option", () => {
      const options: Partial<TypeIntegrationOptions> = {
        typeNamespace: "MyGrammar",
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("value", '"'))]
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain("export namespace MyGrammar {");
      expect(typedGrammar.typeDefinitions).toContain("}");
    });

    it("should generate type guards when enabled", () => {
      const options: Partial<TypeIntegrationOptions> = {
        generateTypeGuards: true,
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("value", '"'))]
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain("export function isTestResult(value: unknown): value is TestResult");
      expect(typedGrammar.typeDefinitions).toContain('return typeof value === "string" && value === "value";');
    });

    it("should include documentation when enabled", () => {
      const options: Partial<TypeIntegrationOptions> = {
        includeDocumentation: true,
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("documented", createStringLiteral("value", '"')),
          createRuleDefinition("dependent", createIdentifier("documented")),
        ]
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain("/**");
      expect(typedGrammar.typeDefinitions).toContain("String literal");
      expect(typedGrammar.typeDefinitions).toContain("Dependencies: documented");
    });

    it("should handle strict types option", () => {
      const options: Partial<TypeIntegrationOptions> = {
        strictTypes: true,
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("value", '"'))]
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      // With strict types, we shouldn't see 'any' or 'unknown' unless necessary
      expect(typedGrammar.typeDefinitions).not.toContain("any");
    });
  });

  describe("Utility Methods", () => {
    let typedGrammar: TypedGrammarDefinition;

    beforeEach(() => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "UtilGrammar",
        [],
        [
          createRuleDefinition("base", createStringLiteral("base", '"')),
          createRuleDefinition("derived", createIdentifier("base")),
          createRuleDefinition("circular1", createIdentifier("circular2")),
          createRuleDefinition("circular2", createIdentifier("circular1")),
        ]
      );

      typedGrammar = engine.createTypedGrammar(grammar);
    });

    it("should get type information for specific rules", () => {
      const baseType = engine.getTypeInfo(typedGrammar, "base");
      const derivedType = engine.getTypeInfo(typedGrammar, "derived");
      const unknownType = engine.getTypeInfo(typedGrammar, "unknown");

      expect(baseType?.typeString).toBe('"base"');
      expect(derivedType?.typeString).toBe('"base"');
      expect(unknownType).toBeUndefined();
    });

    it("should detect circular dependencies for specific rules", () => {
      expect(engine.hasCircularDependency(typedGrammar, "base")).toBe(false);
      expect(engine.hasCircularDependency(typedGrammar, "derived")).toBe(false);
      expect(engine.hasCircularDependency(typedGrammar, "circular1")).toBe(true);
      expect(engine.hasCircularDependency(typedGrammar, "circular2")).toBe(true);
    });

    it("should get dependencies for specific rules", () => {
      const baseDeps = engine.getDependencies(typedGrammar, "base");
      const derivedDeps = engine.getDependencies(typedGrammar, "derived");

      expect(baseDeps).toEqual([]);
      expect(derivedDeps).toEqual(["base"]);
    });
  });

  describe("Parser Interface Generation", () => {
    it("should generate complete parser interface", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "ParserGrammar",
        [],
        [
          createRuleDefinition("identifier", createCharacterClass([createCharRange("a", "z")])),
          createRuleDefinition("number", createPlus(createCharacterClass([createCharRange("0", "9")]))),
        ]
      );

      const typedGrammar = engine.createTypedGrammar(grammar);
      const parserInterface = engine.generateParserInterface(typedGrammar);

      expect(parserInterface).toContain("export interface ParserGrammarParser {");
      expect(parserInterface).toContain("identifier(input: string): ParseResult<IdentifierResult>;");
      expect(parserInterface).toContain("number(input: string): ParseResult<NumberResult>;");
      expect(parserInterface).toContain("}");
    });

    it("should include warnings for circular dependencies in interface", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "CircularGrammar",
        [],
        [
          createRuleDefinition("a", createIdentifier("b")),
          createRuleDefinition("b", createIdentifier("a")),
        ]
      );

      const typedGrammar = engine.createTypedGrammar(grammar);
      const parserInterface = engine.generateParserInterface(typedGrammar);

      expect(parserInterface).toContain("@warning This rule has circular dependencies");
    });
  });

  describe("Complex Type Scenarios", () => {
    it("should handle nested complex expressions", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "ComplexGrammar",
        [],
        [
          createRuleDefinition("element", createChoice([
            createStringLiteral("a", '"'),
            createStringLiteral("b", '"'),
          ])),
          createRuleDefinition("list", createStar(createIdentifier("element"))),
          createRuleDefinition("optionalList", createOptional(createIdentifier("list"))),
        ]
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      const elementType = engine.getTypeInfo(typedGrammar, "element");
      const listType = engine.getTypeInfo(typedGrammar, "list");
      const optionalListType = engine.getTypeInfo(typedGrammar, "optionalList");

      expect(elementType?.typeString).toBe('"a" | "b"');
      expect(listType?.typeString).toBe('("a" | "b")[]');
      expect(optionalListType?.typeString).toBe('(("a" | "b")[]) | undefined');
    });

    it("should convert rule names to PascalCase for types", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "NamingGrammar",
        [],
        [
          createRuleDefinition("snake_case", createStringLiteral("test", '"')),
          createRuleDefinition("kebab-case", createStringLiteral("test", '"')),
          createRuleDefinition("camelCase", createStringLiteral("test", '"')),
        ]
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain("export type SnakeCaseResult");
      expect(typedGrammar.typeDefinitions).toContain("export type KebabCaseResult");
      expect(typedGrammar.typeDefinitions).toContain("export type CamelCaseResult");
    });
  });
});