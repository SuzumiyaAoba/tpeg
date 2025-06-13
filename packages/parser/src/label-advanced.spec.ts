/**
 * TPEG Label Advanced Tests
 *
 * Advanced edge cases and comprehensive test coverage for labeled expressions
 */

import { describe, expect, test } from "bun:test";
import type { Pos } from "tpeg-core";
import { characterClass } from "./character-class";
import { expression } from "./composition";
import { withOptionalLabel } from "./label";
import { stringLiteral } from "./string-literal";
import type {
  Choice,
  Group,
  LabeledExpression,
  NegativeLookahead,
  Optional,
  Plus,
  PositiveLookahead,
  Quantified,
  Sequence,
  Star,
} from "./types";

const createPosition = (offset = 0, line = 1, column = 1): Pos => ({
  offset,
  line,
  column,
});

describe("Label Advanced Tests", () => {
  describe("complex label patterns", () => {
    test("multiple nested labels with different operators", () => {
      const parser = expression();
      const result = parser('outer:(inner:"hello"+)*', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const outerLabeled = result.val as LabeledExpression;
        expect(outerLabeled.type).toBe("LabeledExpression");
        expect(outerLabeled.label).toBe("outer");

        const star = outerLabeled.expression as Star;
        expect(star.type).toBe("Star");

        // The expression inside the star is the group, not the labeled expression
        expect(star.expression.type).toBe("Group");
        const group = star.expression as Group;

        const innerLabeled = group.expression as LabeledExpression;
        expect(innerLabeled.type).toBe("LabeledExpression");
        expect(innerLabeled.label).toBe("inner");

        const plus = innerLabeled.expression as Plus;
        expect(plus.type).toBe("Plus");
        expect(plus.expression.type).toBe("StringLiteral");
      }
    });

    test("labels with quantified expressions", () => {
      const parser = expression();
      const result = parser("digits:[0-9]{3,6}", createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const digitsLabeled = result.val as LabeledExpression;
        expect(digitsLabeled.label).toBe("digits");

        const quantified = digitsLabeled.expression as Quantified;
        expect(quantified.type).toBe("Quantified");
        expect(quantified.min).toBe(3);
        expect(quantified.max).toBe(6);
      }
    });

    test("labels with lookahead expressions", () => {
      const parser = expression();
      const result = parser('check:&"hello"', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const checkLabeled = result.val as LabeledExpression;
        expect(checkLabeled.label).toBe("check");

        const lookahead = checkLabeled.expression as PositiveLookahead;
        expect(lookahead.type).toBe("PositiveLookahead");
        expect(lookahead.expression.type).toBe("StringLiteral");
      }
    });

    test("multiple choice branches with labels", () => {
      const parser = expression();
      const result = parser(
        'value:(str:"string" / num:[0-9]+ / bool:("true" / "false"))',
        createPosition(),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const valueLabeled = result.val as LabeledExpression;
        expect(valueLabeled.label).toBe("value");
        expect(valueLabeled.expression.type).toBe("Group");

        const group = valueLabeled.expression as Group;
        const choice = group.expression as Choice;
        expect(choice.type).toBe("Choice");
        expect(choice.alternatives).toHaveLength(3);

        // All alternatives should be labeled
        expect(choice.alternatives[0].type).toBe("LabeledExpression");
        expect(choice.alternatives[1].type).toBe("LabeledExpression");
        expect(choice.alternatives[2].type).toBe("LabeledExpression");
      }
    });
  });

  describe("label whitespace handling", () => {
    test("strict whitespace rules around labels", () => {
      const parser = expression();

      // No space before colon (should work)
      const result1 = parser('name:"value"', createPosition());
      expect(result1.success).toBe(true);

      // No space after colon (should work)
      const result2 = parser('name:"value"', createPosition());
      expect(result2.success).toBe(true);

      // Space before colon (should not parse as labeled expression)
      const result3 = parser('name :"value"', createPosition());
      expect(result3.success).toBe(true);
      if (result3.success) {
        expect(result3.val.type).not.toBe("LabeledExpression");
      }

      // Space after colon (should fail or not parse as labeled expression)
      const result4 = parser('name: "value"', createPosition());
      if (result4.success) {
        expect(result4.val.type).not.toBe("LabeledExpression");
      } else {
        // It's also acceptable for this to fail completely
        expect(result4.success).toBe(false);
      }
    });

    test("labels in sequences with various whitespace", () => {
      const parser = expression();
      const result = parser(
        'first:"a"    second:"b"\t\tthird:"c"',
        createPosition(),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const sequence = result.val as Sequence;
        expect(sequence.type).toBe("Sequence");
        expect(sequence.elements).toHaveLength(3);

        sequence.elements.forEach((element, index) => {
          expect(element.type).toBe("LabeledExpression");
          const labeled = element as LabeledExpression;
          expect(labeled.label).toBe(["first", "second", "third"][index]);
        });
      }
    });
  });

  describe("label validation edge cases", () => {
    test("various valid label identifiers", () => {
      const parser = withOptionalLabel(stringLiteral);

      // Valid cases
      const validLabels = [
        'a:"test"',
        'A:"test"',
        '_:"test"',
        'a1:"test"',
        'camelCase:"test"',
        'snake_case:"test"',
        'PascalCase:"test"',
        'UPPERCASE:"test"',
        'a1b2c3:"test"',
        '_underscore_:"test"',
      ];

      for (const input of validLabels) {
        const result = parser(input, createPosition());
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe("LabeledExpression");
        }
      }
    });

    test("invalid label identifiers", () => {
      const parser = withOptionalLabel(stringLiteral);

      // These should fail to parse as labeled expressions
      const invalidLabels = [
        '1name:"test"', // starts with number
        '-name:"test"', // starts with dash
        '+name:"test"', // starts with plus
      ];

      for (const input of invalidLabels) {
        const result = parser(input, createPosition());
        // Should either fail completely or not parse as labeled expression
        if (result.success) {
          expect(result.val.type).not.toBe("LabeledExpression");
        }
      }
    });

    test("empty and minimal labels", () => {
      const parser = withOptionalLabel(stringLiteral);

      // Single character labels
      const result1 = parser('a:"test"', createPosition());
      expect(result1.success).toBe(true);
      if (result1.success) {
        const labeled = result1.val as LabeledExpression;
        expect(labeled.label).toBe("a");
      }

      // Underscore only
      const result2 = parser('_:"test"', createPosition());
      expect(result2.success).toBe(true);
      if (result2.success) {
        const labeled = result2.val as LabeledExpression;
        expect(labeled.label).toBe("_");
      }
    });
  });

  describe("label performance and limits", () => {
    test("deeply nested labeled expressions", () => {
      const parser = expression();
      // Create a deeply nested structure
      const deepNesting = 'a:(b:(c:(d:(e:"value"))))';
      const result = parser(deepNesting, createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        let current = result.val as LabeledExpression;
        const expectedLabels = ["a", "b", "c", "d", "e"];

        expectedLabels.forEach((expectedLabel, index) => {
          expect(current.type).toBe("LabeledExpression");
          expect(current.label).toBe(expectedLabel);

          if (index < expectedLabels.length - 1) {
            expect(current.expression.type).toBe("Group");
            const group = current.expression as Group;
            current = group.expression;
          } else {
            expect(current.expression.type).toBe("StringLiteral");
          }
        });
      }
    });

    test("long label names", () => {
      const parser = withOptionalLabel(stringLiteral);
      const longLabel = "thisIsAVeryLongLabelNameThatShouldStillWorkCorrectly";
      const input = `${longLabel}:"test"`;

      const result = parser(input, createPosition());
      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.label).toBe(longLabel);
      }
    });

    test("many sequential labeled expressions", () => {
      const parser = expression();
      const manyLabels = Array.from(
        { length: 10 },
        (_, i) => `label${i}:"value${i}"`,
      ).join(" ");

      const result = parser(manyLabels, createPosition());
      expect(result.success).toBe(true);
      if (result.success) {
        const sequence = result.val as Sequence;
        expect(sequence.type).toBe("Sequence");
        expect(sequence.elements).toHaveLength(10);

        sequence.elements.forEach((element, index) => {
          expect(element.type).toBe("LabeledExpression");
          const labeled = element as LabeledExpression;
          expect(labeled.label).toBe(`label${index}`);
        });
      }
    });
  });

  describe("label interaction with all operators", () => {
    test("labels with all repetition operators", () => {
      const parser = expression();

      const testCases = [
        { input: 'star:"a"*', operatorType: "Star" },
        { input: 'plus:"a"+', operatorType: "Plus" },
        { input: 'optional:"a"?', operatorType: "Optional" },
        { input: 'exact:"a"{3}', operatorType: "Quantified" },
        { input: 'range:"a"{2,5}', operatorType: "Quantified" },
        { input: 'minimum:"a"{3,}', operatorType: "Quantified" },
      ];

      for (const { input, operatorType } of testCases) {
        const result = parser(input, createPosition());
        expect(result.success).toBe(true);
        if (result.success) {
          const labeled = result.val as LabeledExpression;
          expect(labeled.type).toBe("LabeledExpression");
          expect(labeled.expression.type).toBe(operatorType);
        }
      }
    });

    test("labels with all lookahead operators", () => {
      const parser = expression();

      const testCases = [
        { input: 'positive:&"test"', operatorType: "PositiveLookahead" },
        { input: 'negative:!"test"', operatorType: "NegativeLookahead" },
      ];

      for (const { input, operatorType } of testCases) {
        const result = parser(input, createPosition());
        expect(result.success).toBe(true);
        if (result.success) {
          const labeled = result.val as LabeledExpression;
          expect(labeled.type).toBe("LabeledExpression");
          expect(labeled.expression.type).toBe(operatorType);
        }
      }
    });

    test("labels with all basic syntax elements", () => {
      const parser = expression();

      const testCases = [
        { input: 'str:"hello"', syntaxType: "StringLiteral" },
        { input: "chars:[a-z]", syntaxType: "CharacterClass" },
        { input: "ref:identifier", syntaxType: "Identifier" },
      ];

      for (const { input, syntaxType } of testCases) {
        const result = parser(input, createPosition());
        expect(result.success).toBe(true);
        if (result.success) {
          const labeled = result.val as LabeledExpression;
          expect(labeled.type).toBe("LabeledExpression");
          expect(labeled.expression.type).toBe(syntaxType);
        }
      }
    });
  });

  describe("realistic complex grammar patterns", () => {
    test("JSON-like structure with labels", () => {
      const parser = expression();
      const jsonPattern =
        'obj:("{" pairs:(key:"string" ":" value:"value")* "}")';

      const result = parser(jsonPattern, createPosition());
      expect(result.success).toBe(true);
      if (result.success) {
        const objLabeled = result.val as LabeledExpression;
        expect(objLabeled.label).toBe("obj");
        expect(objLabeled.expression.type).toBe("Group");
      }
    });

    test("function definition pattern with labels", () => {
      const parser = expression();
      const funcPattern =
        'func:(name:identifier "(" params:(param:identifier ("," param:identifier)*)? ")")';

      const result = parser(funcPattern, createPosition());
      expect(result.success).toBe(true);
      if (result.success) {
        const funcLabeled = result.val as LabeledExpression;
        expect(funcLabeled.label).toBe("func");
        expect(funcLabeled.expression.type).toBe("Group");
      }
    });

    test("conditional expression pattern with labels", () => {
      const parser = expression();
      const condPattern =
        'cond:(condition:expression "?" then:expression ":" else:expression)';

      const result = parser(condPattern, createPosition());
      expect(result.success).toBe(true);
      if (result.success) {
        const condLabeled = result.val as LabeledExpression;
        expect(condLabeled.label).toBe("cond");
        expect(condLabeled.expression.type).toBe("Group");
      }
    });
  });
});
