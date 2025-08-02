/**
 * Type Inference System Tests
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { GrammarDefinition } from "@tpeg/core";
import {
  createAnyChar,
  createCharRange,
  createCharacterClass,
  createChoice,
  createGrammarDefinition,
  createIdentifier,
  createOptional,
  createPlus,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
  createQuantified,
  createPositiveLookahead,
  createNegativeLookahead,
  createLabeledExpression,
} from "@tpeg/core";
import {
  TypeInferenceEngine,
  type TypeInferenceOptions,
} from "./type-inference";

describe("TypeInferenceEngine", () => {
  let engine: TypeInferenceEngine;

  beforeEach(() => {
    engine = new TypeInferenceEngine();
  });

  describe("Basic Type Inference", () => {
    it("should infer string literal types correctly", () => {
      const literal = createStringLiteral("hello", '"');
      const result = engine.inferExpressionType(literal);

      expect(result.typeString).toBe('"hello"');
      expect(result.baseType).toBe("string");
      expect(result.nullable).toBe(false);
      expect(result.isArray).toBe(false);
    });

    it("should infer character class types as string", () => {
      const charClass = createCharacterClass([createCharRange("a", "z")]);
      const result = engine.inferExpressionType(charClass);

      expect(result.typeString).toBe("string");
      expect(result.baseType).toBe("string");
      expect(result.nullable).toBe(false);
      expect(result.isArray).toBe(false);
    });

    it("should infer any character type as string", () => {
      const anyChar = createAnyChar();
      const result = engine.inferExpressionType(anyChar);

      expect(result.typeString).toBe("string");
      expect(result.baseType).toBe("string");
      expect(result.nullable).toBe(false);
      expect(result.isArray).toBe(false);
    });
  });

  describe("Composition Operators", () => {
    it("should infer sequence types as tuples", () => {
      const sequence = createSequence([
        createStringLiteral("hello", '"'),
        createCharacterClass([createCharRange("0", "9")]),
      ]);
      const result = engine.inferExpressionType(sequence);

      expect(result.typeString).toBe('["hello", string]');
      expect(result.baseType).toBe("tuple");
      expect(result.isArray).toBe(true);
    });

    it("should infer choice types as unions", () => {
      const choice = createChoice([
        createStringLiteral("yes", '"'),
        createStringLiteral("no", '"'),
      ]);
      const result = engine.inferExpressionType(choice);

      expect(result.typeString).toBe('"yes" | "no"');
      expect(result.baseType).toBe("union");
      expect(result.nullable).toBe(false);
    });
  });

  describe("Repetition Operators", () => {
    it("should infer star repetition as arrays", () => {
      const star = createStar(createStringLiteral("item", '"'));
      const result = engine.inferExpressionType(star);

      expect(result.typeString).toBe('"item"[]');
      expect(result.isArray).toBe(true);
      expect(result.baseType).toBe("string");
    });

    it("should infer plus repetition as arrays", () => {
      const plus = createPlus(createStringLiteral("item", '"'));
      const result = engine.inferExpressionType(plus);

      expect(result.typeString).toBe('"item"[]');
      expect(result.isArray).toBe(true);
      expect(result.baseType).toBe("string");
    });

    it("should infer optional types with undefined union", () => {
      const optional = createOptional(createStringLiteral("maybe", '"'));
      const result = engine.inferExpressionType(optional);

      expect(result.typeString).toBe('"maybe" | undefined');
      expect(result.nullable).toBe(true);
      expect(result.baseType).toBe("string");
    });
  });

  describe("Grammar Type Inference", () => {
    it("should infer types for simple grammar", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("greeting", createStringLiteral("hello", '"')),
          createRuleDefinition(
            "number",
            createCharacterClass([createCharRange("0", "9")]),
          ),
        ],
      );

      const result = engine.inferGrammarTypes(grammar);

      expect(result.ruleTypes.has("greeting")).toBe(true);
      expect(result.ruleTypes.has("number")).toBe(true);
      expect(result.ruleTypes.get("greeting")?.typeString).toBe('"hello"');
      expect(result.ruleTypes.get("number")?.typeString).toBe("string");
    });

    it("should handle rule references", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "digit",
            createCharacterClass([createCharRange("0", "9")]),
          ),
          createRuleDefinition("number", createPlus(createIdentifier("digit"))),
        ],
      );

      const result = engine.inferGrammarTypes(grammar);

      expect(result.ruleTypes.get("digit")?.typeString).toBe("string");
      expect(result.ruleTypes.get("number")?.typeString).toBe("string[]");
    });

    it("should detect circular dependencies", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("a", createIdentifier("b")),
          createRuleDefinition("b", createIdentifier("a")),
        ],
      );

      const result = engine.inferGrammarTypes(grammar);

      expect(result.circularDependencies.length).toBeGreaterThan(0);
      expect(result.ruleTypes.get("a")?.typeString).toBe("unknown");
      expect(result.ruleTypes.get("b")?.typeString).toBe("unknown");
    });
  });

  describe("Type Inference Options", () => {
    it("should respect inferArrayTypes option", () => {
      const options: Partial<TypeInferenceOptions> = {
        inferArrayTypes: false,
      };
      const engine = new TypeInferenceEngine(options);
      const star = createStar(createStringLiteral("item", '"'));
      const result = engine.inferExpressionType(star);

      expect(result.typeString).toBe("string");
      expect(result.isArray).toBe(false);
    });

    it("should respect inferUnionTypes option", () => {
      const options: Partial<TypeInferenceOptions> = {
        inferUnionTypes: false,
      };
      const engine = new TypeInferenceEngine(options);
      const choice = createChoice([
        createStringLiteral("yes", '"'),
        createStringLiteral("no", '"'),
      ]);
      const result = engine.inferExpressionType(choice);

      expect(result.typeString).toBe("string");
      expect(result.baseType).toBe("string");
    });

    it("should respect inferObjectTypes option", () => {
      const options: Partial<TypeInferenceOptions> = {
        inferObjectTypes: false,
      };
      const engine = new TypeInferenceEngine(options);
      const sequence = createSequence([
        createStringLiteral("hello", '"'),
        createStringLiteral("world", '"'),
      ]);
      const result = engine.inferExpressionType(sequence);

      expect(result.typeString).toBe("string");
      expect(result.baseType).toBe("string");
    });
  });

  describe("Complex Type Scenarios", () => {
    it("should handle nested expressions correctly", () => {
      const nested = createOptional(
        createStar(
          createChoice([
            createStringLiteral("a", '"'),
            createStringLiteral("b", '"'),
          ]),
        ),
      );
      const result = engine.inferExpressionType(nested);

      expect(result.typeString).toBe('(("a" | "b")[]) | undefined');
      expect(result.nullable).toBe(true);
      expect(result.isArray).toBe(false); // The outer level is optional, not array
    });

    it("should generate proper documentation", () => {
      const literal = createStringLiteral("test", '"');
      const result = engine.inferExpressionType(literal);

      expect(result.documentation).toContain("String literal");
      expect(result.documentation).toContain("test");
    });

    it("should handle unknown rule references gracefully", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createIdentifier("unknownRule"))],
      );

      const result = engine.inferGrammarTypes(grammar);

      expect(result.ruleTypes.get("test")?.typeString).toBe("unknown");
      expect(result.ruleTypes.get("test")?.documentation).toContain(
        "Unknown rule reference",
      );
    });
  });

  describe("Type Caching", () => {
    it("should cache identical expressions", () => {
      const literal1 = createStringLiteral("hello", '"');
      const literal2 = createStringLiteral("hello", '"');

      const result1 = engine.inferExpressionType(literal1);
      const result2 = engine.inferExpressionType(literal2);

      expect(result1).toBe(result2); // Should be the exact same object due to caching
    });
  });

  describe("Real-world Grammar Examples", () => {
    it("should handle JSON-like grammar", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "JSONGrammar",
        [],
        [
          createRuleDefinition(
            "string",
            createSequence([
              createStringLiteral('"', '"'),
              createStar(
                createCharacterClass([
                  createCharRange("a", "z"),
                  createCharRange("A", "Z"),
                ]),
              ),
              createStringLiteral('"', '"'),
            ]),
          ),
          createRuleDefinition(
            "number",
            createPlus(createCharacterClass([createCharRange("0", "9")])),
          ),
          createRuleDefinition(
            "value",
            createChoice([
              createIdentifier("string"),
              createIdentifier("number"),
            ]),
          ),
        ],
      );

      const result = engine.inferGrammarTypes(grammar);

      // Note: Complex escaping needed here - \\\" in TypeScript becomes \\\\\" in JavaScript test strings
      expect(result.ruleTypes.get("string")?.typeString).toBe(
        '["\\"", string[], "\\""]',
      );
      expect(result.ruleTypes.get("number")?.typeString).toBe("string[]");
      expect(result.ruleTypes.get("value")?.typeString).toBe(
        '(["\\"", string[], "\\""]) | (string[])',
      );
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle quantified expressions with min === max === 1", () => {
      const engine = new TypeInferenceEngine();
      const quantified = createQuantified(createStringLiteral("hello", '"'), 1, 1);
      
      const result = engine.inferExpressionType(quantified);
      
      expect(result.typeString).toBe('"hello"');
      expect(result.isArray).toBe(false);
    });

    it("should handle quantified expressions with min === 0", () => {
      const engine = new TypeInferenceEngine();
      const quantified = createQuantified(createStringLiteral("hello", '"'), 0, 1);
      
      const result = engine.inferExpressionType(quantified);
      
      expect(result.typeString).toBe('"hello"[] | undefined');
      expect(result.nullable).toBe(true);
    });

    it("should handle quantified expressions with array types disabled", () => {
      const engine = new TypeInferenceEngine({ inferArrayTypes: false });
      const quantified = createQuantified(createStringLiteral("hello", '"'), 0, 5);
      
      const result = engine.inferExpressionType(quantified);
      
      expect(result.typeString).toBe("string | undefined");
      expect(result.isArray).toBe(false);
    });

    it("should handle lookahead expressions correctly", () => {
      const engine = new TypeInferenceEngine();
      const positiveLookahead = createPositiveLookahead(createStringLiteral("hello", '"'));
      const negativeLookahead = createNegativeLookahead(createStringLiteral("world", '"'));
      
      const positiveResult = engine.inferExpressionType(positiveLookahead);
      const negativeResult = engine.inferExpressionType(negativeLookahead);
      
      expect(positiveResult.typeString).toBe("void");
      expect(positiveResult.baseType).toBe("void");
      expect(negativeResult.typeString).toBe("void");
      expect(negativeResult.baseType).toBe("void");
    });

    it("should handle labeled expressions correctly", () => {
      const engine = new TypeInferenceEngine();
      const labeled = createLabeledExpression("value", createStringLiteral("hello", '"'));
      
      const result = engine.inferExpressionType(labeled);
      
      expect(result.typeString).toBe('"hello"');
      expect(result.documentation).toContain("Labeled expression: value");
    });

    it("should apply custom type mappings", () => {
      const customMappings = new Map([
        ['"hello"', 'CustomHelloType'],
        ['string', 'CustomStringType']
      ]);
      
      const engine = new TypeInferenceEngine({
        customTypeMappings: customMappings
      });
      
      const stringLiteral = createStringLiteral("hello", '"');
      const charClass = createCharacterClass([createCharRange("0", "9")]);
      
      const literalResult = engine.inferExpressionType(stringLiteral);
      const charClassResult = engine.inferExpressionType(charClass);
      
      expect(literalResult.typeString).toBe('CustomHelloType');
      expect(charClassResult.typeString).toBe('CustomStringType');
    });

    it("should handle recursion depth limits", () => {
      const engine = new TypeInferenceEngine({ maxRecursionDepth: 1 });
      const grammar = createGrammarDefinition("TestGrammar", [], [
        createRuleDefinition("a", createIdentifier("b")),
        createRuleDefinition("b", createIdentifier("a")),
      ]);
      
      const result = engine.inferGrammarTypes(grammar);
      
      // Should handle recursion gracefully
      expect(result.ruleTypes.size).toBe(2);
      expect(result.circularDependencies.length).toBeGreaterThan(0);
    });

    it("should handle unknown expression types gracefully", () => {
      const engine = new TypeInferenceEngine();
      
      // Create an invalid expression type
      const invalidExpression = {
        type: "InvalidType" as any,
        value: "test"
      };
      
      // This should not throw but return a default type
      expect(() => {
        engine.inferExpressionType(invalidExpression as any);
      }).not.toThrow();
    });
  });

  describe("Performance and Caching", () => {
    it("should cache identical expressions", () => {
      const engine = new TypeInferenceEngine({ enableCaching: true });
      const expression = createStringLiteral("hello", '"');
      
      const result1 = engine.inferExpressionType(expression);
      const result2 = engine.inferExpressionType(expression);
      
      expect(result1).toEqual(result2);
    });

    it("should handle cache key generation correctly", () => {
      const engine = new TypeInferenceEngine({ enableCaching: true });
      const expression1 = createStringLiteral("hello", '"');
      const expression2 = createStringLiteral("world", '"');
      
      const result1 = engine.inferExpressionType(expression1);
      const result2 = engine.inferExpressionType(expression2);
      
      expect(result1.typeString).toBe('"hello"');
      expect(result2.typeString).toBe('"world"');
    });
  });
});
