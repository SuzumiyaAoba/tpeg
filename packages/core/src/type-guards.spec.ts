import { describe, expect, it } from "bun:test";
import {
  type Expression,
  createAnyChar,
  createCharacterClass,
  createChoice,
  createGrammarDefinition,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createModularGrammarDefinition,
  createNegativeLookahead,
  createOptional,
  createPlus,
  createPositiveLookahead,
  createQualifiedIdentifier,
  createQuantified,
  createSequence,
  createStar,
  createStringLiteral,
  isAnyChar,
  isCharacterClass,
  isChoice,
  isGroup,
  isIdentifier,
  isLabeledExpression,
  isModularGrammarDefinition,
  isNegativeLookahead,
  isOptional,
  isPlus,
  isPositiveLookahead,
  isQualifiedIdentifier,
  isQuantified,
  isSequence,
  isStandardGrammarDefinition,
  isStar,
  isStringLiteral,
} from "./grammar-types";

describe("Type Guards", () => {
  describe("Expression Type Guards", () => {
    it("should correctly identify StringLiteral", () => {
      const expr = createStringLiteral("hello", '"');

      expect(isStringLiteral(expr)).toBe(true);
      expect(isCharacterClass(expr)).toBe(false);
      expect(isIdentifier(expr)).toBe(false);
      expect(isAnyChar(expr)).toBe(false);

      // Type narrowing test
      if (isStringLiteral(expr)) {
        expect(expr.value).toBe("hello");
        expect(expr.quote).toBe('"');
      }
    });

    it("should correctly identify CharacterClass", () => {
      const expr = createCharacterClass([{ start: "a", end: "z" }], false);

      expect(isCharacterClass(expr)).toBe(true);
      expect(isStringLiteral(expr)).toBe(false);
      expect(isIdentifier(expr)).toBe(false);

      // Type narrowing test
      if (isCharacterClass(expr)) {
        expect(expr.ranges).toHaveLength(1);
        expect(expr.negated).toBe(false);
      }
    });

    it("should correctly identify Identifier", () => {
      const expr = createIdentifier("myRule");

      expect(isIdentifier(expr)).toBe(true);
      expect(isStringLiteral(expr)).toBe(false);
      expect(isCharacterClass(expr)).toBe(false);

      // Type narrowing test
      if (isIdentifier(expr)) {
        expect(expr.name).toBe("myRule");
      }
    });

    it("should correctly identify QualifiedIdentifier", () => {
      const expr = createQualifiedIdentifier("module", "rule");

      expect(isQualifiedIdentifier(expr)).toBe(true);
      expect(isIdentifier(expr)).toBe(false);
      expect(isStringLiteral(expr)).toBe(false);

      // Type narrowing test
      if (isQualifiedIdentifier(expr)) {
        expect(expr.module).toBe("module");
        expect(expr.name).toBe("rule");
      }
    });

    it("should correctly identify AnyChar", () => {
      const expr = createAnyChar();

      expect(isAnyChar(expr)).toBe(true);
      expect(isStringLiteral(expr)).toBe(false);
      expect(isCharacterClass(expr)).toBe(false);
    });

    it("should correctly identify Sequence", () => {
      const expr = createSequence([
        createStringLiteral("hello", '"'),
        createIdentifier("world"),
      ]);

      expect(isSequence(expr)).toBe(true);
      expect(isStringLiteral(expr)).toBe(false);
      expect(isChoice(expr)).toBe(false);

      // Type narrowing test
      if (isSequence(expr)) {
        expect(expr.elements).toHaveLength(2);
        const [first, second] = expr.elements;
        expect(isStringLiteral(first)).toBe(true);
        expect(isIdentifier(second)).toBe(true);
      }
    });

    it("should correctly identify Choice", () => {
      const expr = createChoice([
        createStringLiteral("yes", '"'),
        createStringLiteral("no", '"'),
      ]);

      expect(isChoice(expr)).toBe(true);
      expect(isSequence(expr)).toBe(false);
      expect(isStringLiteral(expr)).toBe(false);

      // Type narrowing test
      if (isChoice(expr)) {
        expect(expr.alternatives).toHaveLength(2);
        const [alt1, alt2] = expr.alternatives;
        expect(isStringLiteral(alt1)).toBe(true);
        expect(isStringLiteral(alt2)).toBe(true);
      }
    });

    it("should correctly identify Group", () => {
      const innerExpr = createChoice([
        createStringLiteral("a", '"'),
        createStringLiteral("b", '"'),
      ]);
      const expr = createGroup(innerExpr);

      expect(isGroup(expr)).toBe(true);
      expect(isChoice(expr)).toBe(false);
      expect(isSequence(expr)).toBe(false);

      // Type narrowing test
      if (isGroup(expr)) {
        expect(isChoice(expr.expression)).toBe(true);
      }
    });

    it("should correctly identify Star", () => {
      const expr = createStar(createIdentifier("item"));

      expect(isStar(expr)).toBe(true);
      expect(isPlus(expr)).toBe(false);
      expect(isOptional(expr)).toBe(false);

      // Type narrowing test
      if (isStar(expr)) {
        expect(isIdentifier(expr.expression)).toBe(true);
      }
    });

    it("should correctly identify Plus", () => {
      const expr = createPlus(createIdentifier("item"));

      expect(isPlus(expr)).toBe(true);
      expect(isStar(expr)).toBe(false);
      expect(isOptional(expr)).toBe(false);

      // Type narrowing test
      if (isPlus(expr)) {
        expect(isIdentifier(expr.expression)).toBe(true);
      }
    });

    it("should correctly identify Optional", () => {
      const expr = createOptional(createIdentifier("item"));

      expect(isOptional(expr)).toBe(true);
      expect(isStar(expr)).toBe(false);
      expect(isPlus(expr)).toBe(false);

      // Type narrowing test
      if (isOptional(expr)) {
        expect(isIdentifier(expr.expression)).toBe(true);
      }
    });

    it("should correctly identify Quantified", () => {
      const expr = createQuantified(createIdentifier("item"), 2, 5);

      expect(isQuantified(expr)).toBe(true);
      expect(isStar(expr)).toBe(false);
      expect(isPlus(expr)).toBe(false);

      // Type narrowing test
      if (isQuantified(expr)) {
        expect(expr.min).toBe(2);
        expect(expr.max).toBe(5);
        expect(isIdentifier(expr.expression)).toBe(true);
      }
    });

    it("should correctly identify PositiveLookahead", () => {
      const expr = createPositiveLookahead(createIdentifier("condition"));

      expect(isPositiveLookahead(expr)).toBe(true);
      expect(isNegativeLookahead(expr)).toBe(false);
      expect(isSequence(expr)).toBe(false);

      // Type narrowing test
      if (isPositiveLookahead(expr)) {
        expect(isIdentifier(expr.expression)).toBe(true);
      }
    });

    it("should correctly identify NegativeLookahead", () => {
      const expr = createNegativeLookahead(createIdentifier("condition"));

      expect(isNegativeLookahead(expr)).toBe(true);
      expect(isPositiveLookahead(expr)).toBe(false);
      expect(isSequence(expr)).toBe(false);

      // Type narrowing test
      if (isNegativeLookahead(expr)) {
        expect(isIdentifier(expr.expression)).toBe(true);
      }
    });

    it("should correctly identify LabeledExpression", () => {
      const expr = createLabeledExpression("name", createIdentifier("value"));

      expect(isLabeledExpression(expr)).toBe(true);
      expect(isIdentifier(expr)).toBe(false);
      expect(isStringLiteral(expr)).toBe(false);

      // Type narrowing test
      if (isLabeledExpression(expr)) {
        expect(expr.label).toBe("name");
        expect(isIdentifier(expr.expression)).toBe(true);
      }
    });
  });

  describe("Grammar Definition Type Guards", () => {
    it("should correctly identify standard GrammarDefinition", () => {
      const grammar = createGrammarDefinition("TestGrammar");

      expect(isStandardGrammarDefinition(grammar)).toBe(true);
      expect(isModularGrammarDefinition(grammar)).toBe(false);

      // Type narrowing test
      if (isStandardGrammarDefinition(grammar)) {
        expect(grammar.name).toBe("TestGrammar");
        expect(grammar.type).toBe("GrammarDefinition");
      }
    });

    it("should correctly identify ModularGrammarDefinition", () => {
      const grammar = createModularGrammarDefinition("TestGrammar");

      expect(isModularGrammarDefinition(grammar)).toBe(true);
      expect(isStandardGrammarDefinition(grammar)).toBe(false);

      // Type narrowing test
      if (isModularGrammarDefinition(grammar)) {
        expect(grammar.name).toBe("TestGrammar");
        expect(grammar.type).toBe("ModularGrammarDefinition");
      }
    });
  });

  describe("Type Guard Edge Cases", () => {
    it("should handle null and undefined inputs", () => {
      expect(isStringLiteral(null)).toBe(false);
      expect(isCharacterClass(undefined)).toBe(false);
      expect(isIdentifier({})).toBe(false);
    });

    it("should handle malformed expression objects", () => {
      const malformed = { type: "InvalidType" } as unknown;

      expect(isStringLiteral(malformed)).toBe(false);
      expect(isCharacterClass(malformed)).toBe(false);
      expect(isIdentifier(malformed)).toBe(false);
    });

    it("should handle expressions with wrong type property", () => {
      const wrongType = { type: "StringLiteral", value: "hello" } as
        | {
            type: string;
            value: string;
          }
        | unknown;
      if (typeof wrongType === "object" && wrongType !== null) {
        (wrongType as { type: string }).type = "CharacterClass";
      }

      expect(isStringLiteral(wrongType)).toBe(false);
      expect(isCharacterClass(wrongType)).toBe(true);
    });
  });

  describe("Type Guard Performance", () => {
    it("should perform type checks efficiently", () => {
      const expressions: Expression[] = [
        createStringLiteral("hello", '"'),
        createCharacterClass([{ start: "a", end: "z" }]),
        createIdentifier("test"),
        createAnyChar(),
        createSequence([createStringLiteral("a", '"')]),
        createChoice([createStringLiteral("a", '"')]),
        createGroup(createStringLiteral("a", '"')),
        createStar(createStringLiteral("a", '"')),
        createPlus(createStringLiteral("a", '"')),
        createOptional(createStringLiteral("a", '"')),
        createQuantified(createStringLiteral("a", '"'), 2, 5),
        createPositiveLookahead(createStringLiteral("a", '"')),
        createNegativeLookahead(createStringLiteral("a", '"')),
        createLabeledExpression("name", createStringLiteral("a", '"')),
      ];

      const startTime = performance.now();

      // Perform many type checks
      for (let i = 0; i < 10000; i++) {
        const expr = expressions[i % expressions.length];

        isStringLiteral(expr);
        isCharacterClass(expr);
        isIdentifier(expr);
        isAnyChar(expr);
        isSequence(expr);
        isChoice(expr);
        isGroup(expr);
        isStar(expr);
        isPlus(expr);
        isOptional(expr);
        isQuantified(expr);
        isPositiveLookahead(expr);
        isNegativeLookahead(expr);
        isLabeledExpression(expr);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(100);
    });
  });

  describe("Type Guard Integration", () => {
    it("should work with complex nested expressions", () => {
      const complexExpr = createSequence([
        createStringLiteral("function", '"'),
        createGroup(
          createChoice([
            createIdentifier("name"),
            createStringLiteral("anonymous", '"'),
          ]),
        ),
        createStar(createCharacterClass([{ start: "a", end: "z" }])),
        createOptional(createStringLiteral(";", '"')),
      ]);

      expect(isSequence(complexExpr)).toBe(true);

      if (isSequence(complexExpr)) {
        expect(complexExpr.elements).toHaveLength(4);

        // Check first element
        const e0 = complexExpr.elements[0];
        expect(e0 !== undefined && isStringLiteral(e0)).toBe(true);

        // Check second element (group)
        const e1 = complexExpr.elements[1];
        expect(e1 !== undefined && isGroup(e1)).toBe(true);
        if (e1 !== undefined && isGroup(e1)) {
          expect(isChoice(e1.expression)).toBe(true);
        }

        // Check third element (star)
        const e2 = complexExpr.elements[2];
        expect(e2 !== undefined && isStar(e2)).toBe(true);

        // Check fourth element (optional)
        const e3 = complexExpr.elements[3];
        expect(e3 !== undefined && isOptional(e3)).toBe(true);
      }
    });

    it("should work with factory functions", () => {
      const expr = createStringLiteral("test", '"');

      // Type guard should work with factory-created expressions
      expect(isStringLiteral(expr)).toBe(true);

      if (isStringLiteral(expr)) {
        expect(expr.value).toBe("test");
        expect(expr.quote).toBe('"');
      }
    });
  });
});
