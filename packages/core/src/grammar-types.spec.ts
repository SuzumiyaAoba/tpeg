import { describe, expect, it } from "bun:test";
import {
  createAnyChar,
  createCharacterClass,
  createCharRange,
  createChoice,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createNegativeLookahead,
  createOptional,
  createPlus,
  createPositiveLookahead,
  createQualifiedIdentifier,
  createQuantified,
  createSequence,
  createStar,
  createStringLiteral,
} from "./grammar-types";

describe("Grammar Types Factory Functions", () => {
  describe("createStringLiteral", () => {
    it("should create a string literal with double quotes", () => {
      const node = createStringLiteral("hello", '"');
      expect(node).toEqual({
        type: "StringLiteral",
        value: "hello",
        quote: '"',
      });
    });

    it("should create a string literal with single quotes", () => {
      const node = createStringLiteral("world", "'");
      expect(node).toEqual({
        type: "StringLiteral",
        value: "world",
        quote: "'",
      });
    });
  });

  describe("createCharacterClass", () => {
    it("should create a character class", () => {
      const ranges = [createCharRange("a", "z")];
      const node = createCharacterClass(ranges);
      expect(node).toEqual({
        type: "CharacterClass",
        ranges,
        negated: false,
      });
    });

    it("should create a negated character class", () => {
      const ranges = [createCharRange("0", "9")];
      const node = createCharacterClass(ranges, true);
      expect(node).toEqual({
        type: "CharacterClass",
        ranges,
        negated: true,
      });
    });
  });

  describe("createCharRange", () => {
    it("should create a single character range", () => {
      const node = createCharRange("a");
      expect(node).toEqual({
        start: "a",
      });
    });

    it("should create a start-end character range", () => {
      const node = createCharRange("a", "z");
      expect(node).toEqual({
        start: "a",
        end: "z",
      });
    });
  });

  describe("createIdentifier", () => {
    it("should create an identifier", () => {
      const node = createIdentifier("myRule");
      expect(node).toEqual({
        type: "Identifier",
        name: "myRule",
      });
    });
  });

  describe("createQualifiedIdentifier", () => {
    it("should create a qualified identifier", () => {
      const node = createQualifiedIdentifier("MyModule", "myRule");
      expect(node).toEqual({
        type: "QualifiedIdentifier",
        module: "MyModule",
        name: "myRule",
      });
    });
  });

  describe("createAnyChar", () => {
    it("should create an any char node", () => {
      const node = createAnyChar();
      expect(node).toEqual({
        type: "AnyChar",
      });
    });
  });

  describe("createSequence", () => {
    it("should create a sequence", () => {
      const elements = [
        createStringLiteral("a", '"'),
        createStringLiteral("b", '"'),
      ];
      const node = createSequence(elements);
      expect(node).toEqual({
        type: "Sequence",
        elements,
      });
    });
  });

  describe("createChoice", () => {
    it("should create a choice", () => {
      const alternatives = [
        createStringLiteral("a", '"'),
        createStringLiteral("b", '"'),
      ];
      const node = createChoice(alternatives);
      expect(node).toEqual({
        type: "Choice",
        alternatives,
      });
    });
  });

  describe("createGroup", () => {
    it("should create a group", () => {
      const expr = createStringLiteral("a", '"');
      const node = createGroup(expr);
      expect(node).toEqual({
        type: "Group",
        expression: expr,
      });
    });
  });

  describe("createStar", () => {
    it("should create a star repetition", () => {
      const expr = createStringLiteral("a", '"');
      const node = createStar(expr);
      expect(node).toEqual({
        type: "Star",
        expression: expr,
      });
    });
  });

  describe("createPlus", () => {
    it("should create a plus repetition", () => {
      const expr = createStringLiteral("a", '"');
      const node = createPlus(expr);
      expect(node).toEqual({
        type: "Plus",
        expression: expr,
      });
    });
  });

  describe("createOptional", () => {
    it("should create an optional node", () => {
      const expr = createStringLiteral("a", '"');
      const node = createOptional(expr);
      expect(node).toEqual({
        type: "Optional",
        expression: expr,
      });
    });
  });

  describe("createQuantified", () => {
    it("should create a quantified node with min only", () => {
      const expr = createStringLiteral("a", '"');
      const node = createQuantified(expr, 3);
      expect(node).toEqual({
        type: "Quantified",
        expression: expr,
        min: 3,
      });
    });

    it("should create a quantified node with min and max", () => {
      const expr = createStringLiteral("a", '"');
      const node = createQuantified(expr, 3, 5);
      expect(node).toEqual({
        type: "Quantified",
        expression: expr,
        min: 3,
        max: 5,
      });
    });
  });

  describe("createPositiveLookahead", () => {
    it("should create a positive lookahead", () => {
      const expr = createStringLiteral("a", '"');
      const node = createPositiveLookahead(expr);
      expect(node).toEqual({
        type: "PositiveLookahead",
        expression: expr,
      });
    });
  });

  describe("createNegativeLookahead", () => {
    it("should create a negative lookahead", () => {
      const expr = createStringLiteral("a", '"');
      const node = createNegativeLookahead(expr);
      expect(node).toEqual({
        type: "NegativeLookahead",
        expression: expr,
      });
    });
  });

  describe("createLabeledExpression", () => {
    it("should create a labeled expression", () => {
      const expr = createStringLiteral("a", '"');
      const node = createLabeledExpression("label", expr);
      expect(node).toEqual({
        type: "LabeledExpression",
        label: "label",
        expression: expr,
      });
    });
  });
});
