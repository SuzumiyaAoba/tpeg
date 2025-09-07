/**
 * Type Integration System Tests
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  createCharRange,
  createCharacterClass,
  createGrammarDefinition,
  createIdentifier,
  createPlus,
  createRuleDefinition,
  createStringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import {
  TypeIntegrationEngine,
} from "./type-integration";

describe("TypeIntegrationEngine", () => {
  let engine: TypeIntegrationEngine;

  beforeEach(() => {
    engine = new TypeIntegrationEngine();
  });

  describe("Basic Type Integration", () => {
    it("should create typed grammar with type information", () => {
      const grammar = createGrammarDefinition("TestGrammar", [], [
        createRuleDefinition("greeting", createStringLiteral("hello", '"')),
        createRuleDefinition("number", createCharacterClass([createCharRange("0", "9")])),
      ]);

      // Debug: Check if grammar is created correctly
      expect(grammar.rules).toHaveLength(2);
      expect(grammar.rules[0]?.name).toBe("greeting");
      expect(grammar.rules[1]?.name).toBe("number");

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.rules).toHaveLength(2);
      expect(typedGrammar.rules[0]?.name).toBe("greeting");
      expect(typedGrammar.rules[0]?.inferredType.typeString).toBe('"hello"');
      expect(typedGrammar.rules[1]?.name).toBe("number");
      expect(typedGrammar.rules[1]?.inferredType.typeString).toBe("string");
    });

    it("should detect dependencies correctly", () => {
      const grammar = createGrammarDefinition("TestGrammar", [], [
        createRuleDefinition("digit", createCharacterClass([createCharRange("0", "9")])),
        createRuleDefinition("number", createPlus(createIdentifier("digit"))),
      ]);

      const typedGrammar = engine.createTypedGrammar(grammar);

      const numberRule = typedGrammar.rules.find(r => r.name === "number");
      expect(numberRule?.dependencies).toContain("digit");
    });

    it("should generate type definitions", () => {
      const grammar = createGrammarDefinition("TestGrammar", [], [
        createRuleDefinition("greeting", createStringLiteral("hello", '"')),
      ]);

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain("export type GreetingResult");
      expect(typedGrammar.typeDefinitions).toContain('"hello"');
    });
  });

  describe("Advanced Type Integration", () => {
    it("should handle circular dependencies", () => {
      const grammar = createGrammarDefinition("TestGrammar", [], [
        createRuleDefinition("a", createIdentifier("b")),
        createRuleDefinition("b", createIdentifier("a")),
      ]);

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeInference.circularDependencies.length).toBeGreaterThan(0);
      expect(typedGrammar.rules[0]?.hasCircularDependency).toBe(true);
      expect(typedGrammar.rules[1]?.hasCircularDependency).toBe(true);
    });

    it("should generate parser interface", () => {
      const grammar = createGrammarDefinition("TestGrammar", [], [
        createRuleDefinition("greeting", createStringLiteral("hello", '"')),
        createRuleDefinition("number", createCharacterClass([createCharRange("0", "9")])),
      ]);

      const typedGrammar = engine.createTypedGrammar(grammar);
      const parserInterface = engine.generateParserInterface(typedGrammar);

      expect(parserInterface).toContain("export interface TestGrammarParser");
      expect(parserInterface).toContain("greeting(input: string): ParseResult<GreetingResult>");
      expect(parserInterface).toContain("number(input: string): ParseResult<NumberResult>");
    });
  });

  describe("Configuration Options", () => {
    it("should respect strict types option", () => {
      const engine = new TypeIntegrationEngine({
        strictTypes: true,
        includeDocumentation: true,
      });

      const grammar = createGrammarDefinition("TestGrammar", [], [
        createRuleDefinition("greeting", createStringLiteral("hello", '"')),
      ]);

      const typedGrammar = engine.createTypedGrammar(grammar);
      expect(typedGrammar.typeDefinitions).toContain("export type GreetingResult");
    });

    it("should generate type guards when enabled", () => {
      const engine = new TypeIntegrationEngine({
        generateTypeGuards: true,
      });

      const grammar = createGrammarDefinition("TestGrammar", [], [
        createRuleDefinition("greeting", createStringLiteral("hello", '"')),
      ]);

      const typedGrammar = engine.createTypedGrammar(grammar);
      expect(typedGrammar.typeDefinitions).toContain("export function isGreetingResult");
    });
  });

  describe("Utility Methods", () => {
    it("should get type info for specific rule", () => {
      const grammar = createGrammarDefinition("TestGrammar", [], [
        createRuleDefinition("greeting", createStringLiteral("hello", '"')),
      ]);

      const typedGrammar = engine.createTypedGrammar(grammar);
      const typeInfo = engine.getTypeInfo(typedGrammar, "greeting");

      expect(typeInfo?.typeString).toBe('"hello"');
    });

    it("should check circular dependencies", () => {
      const grammar = createGrammarDefinition("TestGrammar", [], [
        createRuleDefinition("a", createIdentifier("b")),
        createRuleDefinition("b", createIdentifier("a")),
      ]);

      const typedGrammar = engine.createTypedGrammar(grammar);
      const hasCircular = engine.hasCircularDependency(typedGrammar, "a");

      expect(hasCircular).toBe(true);
    });

    it("should get dependencies for rule", () => {
      const grammar = createGrammarDefinition("TestGrammar", [], [
        createRuleDefinition("digit", createCharacterClass([createCharRange("0", "9")])),
        createRuleDefinition("number", createPlus(createIdentifier("digit"))),
      ]);

      const typedGrammar = engine.createTypedGrammar(grammar);
      const dependencies = engine.getDependencies(typedGrammar, "number");

      expect(dependencies).toContain("digit");
    });
  });
}); 