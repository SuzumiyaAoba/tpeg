/**
 * TPEG Label Integration Tests
 *
 * Tests integration of labeled expressions with other TPEG operators
 * including repetition, lookahead, composition, and groups.
 */

import { describe, expect, test } from "bun:test";
import type { Pos } from "tpeg-core";
import { expression } from "./composition";
import type {
  Choice,
  Group,
  LabeledExpression,
  NegativeLookahead,
  Optional,
  Plus,
  PositiveLookahead,
  Sequence,
  Star,
} from "./types";

const createPosition = (offset = 0, line = 1, column = 1): Pos => ({
  offset,
  line,
  column,
});

describe("Label Integration Tests", () => {
  describe("labels with basic syntax", () => {
    test("labeled string literal", () => {
      const parser = expression();
      const result = parser('name:"hello"', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("name");
        expect(labeled.expression).toEqual({
          type: "StringLiteral",
          value: "hello",
          quote: '"',
        });
      }
    });

    test("labeled character class", () => {
      const parser = expression();
      const result = parser("digits:[0-9]", createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("digits");
        expect(labeled.expression.type).toBe("CharacterClass");
      }
    });

    test("labeled identifier", () => {
      const parser = expression();
      const result = parser("left:expression", createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("left");
        expect(labeled.expression.type).toBe("Identifier");
      }
    });
  });

  describe("labels with repetition operators", () => {
    test("labeled star repetition", () => {
      const parser = expression();
      const result = parser('items:"hello"*', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("items");

        const star = labeled.expression as Star;
        expect(star.type).toBe("Star");
        expect(star.expression.type).toBe("StringLiteral");
      }
    });

    test("labeled plus repetition", () => {
      const parser = expression();
      const result = parser("numbers:[0-9]+", createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("numbers");

        const plus = labeled.expression as Plus;
        expect(plus.type).toBe("Plus");
        expect(plus.expression.type).toBe("CharacterClass");
      }
    });

    test("labeled optional", () => {
      const parser = expression();
      const result = parser('sign:"+"?', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("sign");

        const optional = labeled.expression as Optional;
        expect(optional.type).toBe("Optional");
        expect(optional.expression.type).toBe("StringLiteral");
      }
    });

    test("labeled quantified repetition", () => {
      const parser = expression();
      const result = parser("hex:[0-9a-f]{2,8}", createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("hex");
        expect(labeled.expression.type).toBe("Quantified");
      }
    });

    test("repetition of labeled expression", () => {
      const parser = expression();
      const result = parser('(name:"hello")*', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const star = result.val as Star;
        expect(star.type).toBe("Star");

        const group = star.expression as Group;
        expect(group.type).toBe("Group");

        const labeled = group.expression as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("name");
      }
    });
  });

  describe("labels with lookahead operators", () => {
    test("labeled positive lookahead", () => {
      const parser = expression();
      const result = parser('check:&"hello"', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("check");

        const lookahead = labeled.expression as PositiveLookahead;
        expect(lookahead.type).toBe("PositiveLookahead");
        expect(lookahead.expression.type).toBe("StringLiteral");
      }
    });

    test("labeled negative lookahead", () => {
      const parser = expression();
      const result = parser("notNumber:![0-9]", createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("notNumber");
        expect(labeled.expression.type).toBe("NegativeLookahead");
      }
    });

    test("lookahead of labeled expression", () => {
      const parser = expression();
      const result = parser('&(name:"hello")', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const lookahead = result.val as PositiveLookahead;
        expect(lookahead.type).toBe("PositiveLookahead");

        const group = lookahead.expression as Group;
        expect(group.type).toBe("Group");

        const labeled = group.expression as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("name");
      }
    });
  });

  describe("labels with composition operators", () => {
    test("labeled sequence elements", () => {
      const parser = expression();
      const result = parser('left:"hello" right:"world"', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const sequence = result.val as Sequence;
        expect(sequence.type).toBe("Sequence");
        expect(sequence.elements).toHaveLength(2);

        const leftLabeled = sequence.elements[0] as LabeledExpression;
        expect(leftLabeled.type).toBe("LabeledExpression");
        expect(leftLabeled.label).toBe("left");

        const rightLabeled = sequence.elements[1] as LabeledExpression;
        expect(rightLabeled.type).toBe("LabeledExpression");
        expect(rightLabeled.label).toBe("right");
      }
    });

    test("mixed labeled and unlabeled in sequence", () => {
      const parser = expression();
      const result = parser('name:"hello" " " "world"', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const sequence = result.val as Sequence;
        expect(sequence.type).toBe("Sequence");
        expect(sequence.elements).toHaveLength(3);

        expect(sequence.elements[0].type).toBe("LabeledExpression");
        expect(sequence.elements[1].type).toBe("StringLiteral");
        expect(sequence.elements[2].type).toBe("StringLiteral");
      }
    });

    test("labeled choice alternatives", () => {
      const parser = expression();
      const result = parser('str:"hello" / num:[0-9]+', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const choice = result.val as Choice;
        expect(choice.type).toBe("Choice");
        expect(choice.alternatives).toHaveLength(2);

        const strLabeled = choice.alternatives[0] as LabeledExpression;
        expect(strLabeled.type).toBe("LabeledExpression");
        expect(strLabeled.label).toBe("str");

        const numLabeled = choice.alternatives[1] as LabeledExpression;
        expect(numLabeled.type).toBe("LabeledExpression");
        expect(numLabeled.label).toBe("num");
      }
    });

    test("labeled group", () => {
      const parser = expression();
      const result = parser('expr:("hello" / "world")', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("expr");

        const group = labeled.expression as Group;
        expect(group.type).toBe("Group");
        expect(group.expression.type).toBe("Choice");
      }
    });
  });

  describe("complex operator precedence with labels", () => {
    test("label + repetition + sequence precedence", () => {
      const parser = expression();
      const result = parser('items:"hello"* "world"', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        // Should parse as: (items:("hello"*)) "world"
        const sequence = result.val as Sequence;
        expect(sequence.type).toBe("Sequence");
        expect(sequence.elements).toHaveLength(2);

        const labeledStar = sequence.elements[0] as LabeledExpression;
        expect(labeledStar.type).toBe("LabeledExpression");
        expect(labeledStar.label).toBe("items");
        expect(labeledStar.expression.type).toBe("Star");

        expect(sequence.elements[1].type).toBe("StringLiteral");
      }
    });

    test("label + lookahead + repetition precedence", () => {
      const parser = expression();
      const result = parser('check:&"hello"*', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        // Should parse as: check:((&"hello")*)
        const labeled = result.val as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("check");

        const star = labeled.expression as Star;
        expect(star.type).toBe("Star");
        expect(star.expression.type).toBe("PositiveLookahead");
      }
    });

    test("grouped label with complex expression", () => {
      const parser = expression();
      const result = parser('(name:"hello" / value:[0-9]+)*', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const star = result.val as Star;
        expect(star.type).toBe("Star");

        const group = star.expression as Group;
        expect(group.type).toBe("Group");

        const choice = group.expression as Choice;
        expect(choice.type).toBe("Choice");
        expect(choice.alternatives).toHaveLength(2);

        expect(choice.alternatives[0].type).toBe("LabeledExpression");
        expect(choice.alternatives[1].type).toBe("LabeledExpression");
      }
    });
  });

  describe("realistic grammar patterns with labels", () => {
    test("arithmetic expression with labels", () => {
      const parser = expression();
      const result = parser(
        'left:[0-9]+ op:"+" right:[0-9]+',
        createPosition(),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const sequence = result.val as Sequence;
        expect(sequence.type).toBe("Sequence");
        expect(sequence.elements).toHaveLength(3);

        const leftLabeled = sequence.elements[0] as LabeledExpression;
        expect(leftLabeled.label).toBe("left");
        expect(leftLabeled.expression.type).toBe("Plus");

        const opLabeled = sequence.elements[1] as LabeledExpression;
        expect(opLabeled.label).toBe("op");
        expect(opLabeled.expression.type).toBe("StringLiteral");

        const rightLabeled = sequence.elements[2] as LabeledExpression;
        expect(rightLabeled.label).toBe("right");
        expect(rightLabeled.expression.type).toBe("Plus");
      }
    });

    test("function call pattern with labels", () => {
      const parser = expression();
      const result = parser(
        'func:identifier "(" args:(expr ("," expr)*)? ")"',
        createPosition(),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const sequence = result.val as Sequence;
        expect(sequence.type).toBe("Sequence");
        expect(sequence.elements).toHaveLength(4);

        const funcLabeled = sequence.elements[0] as LabeledExpression;
        expect(funcLabeled.label).toBe("func");
        expect(funcLabeled.expression.type).toBe("Identifier");

        const argsLabeled = sequence.elements[2] as LabeledExpression;
        expect(argsLabeled.label).toBe("args");
        expect(argsLabeled.expression.type).toBe("Optional");
      }
    });

    test("assignment statement with labels", () => {
      const parser = expression();
      const result = parser(
        'target:identifier "=" value:"hello"',
        createPosition(),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const sequence = result.val as Sequence;
        expect(sequence.type).toBe("Sequence");
        expect(sequence.elements).toHaveLength(3);

        const targetLabeled = sequence.elements[0] as LabeledExpression;
        expect(targetLabeled.label).toBe("target");
        expect(targetLabeled.expression.type).toBe("Identifier");

        const valueLabeled = sequence.elements[2] as LabeledExpression;
        expect(valueLabeled.label).toBe("value");
        expect(valueLabeled.expression.type).toBe("StringLiteral");
      }
    });
  });

  describe("edge cases and error conditions", () => {
    test("nested labels create proper AST structure", () => {
      const parser = expression();
      const result = parser('outer:(inner:"value")', createPosition());

      expect(result.success).toBe(true);
      if (result.success) {
        const outerLabeled = result.val as LabeledExpression;
        expect(outerLabeled.label).toBe("outer");

        const group = outerLabeled.expression as Group;
        expect(group.type).toBe("Group");

        const innerLabeled = group.expression as LabeledExpression;
        expect(innerLabeled.label).toBe("inner");
        expect(innerLabeled.expression.type).toBe("StringLiteral");
      }
    });

    test("labels work with complex repetition patterns", () => {
      const parser = expression();
      const result = parser(
        'items:(name:"hello" / count:[0-9]+){2,5}',
        createPosition(),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.label).toBe("items");
        expect(labeled.expression.type).toBe("Quantified");
      }
    });

    test("empty label should fail gracefully", () => {
      const parser = expression();
      const result = parser(':"value"', createPosition());

      expect(result.success).toBe(false);
    });

    test("malformed label syntax fails appropriately", () => {
      const parser = expression();

      // name"value" is actually valid syntax but parses as just the identifier 'name'
      const result1 = parser('name"value"', createPosition());
      expect(result1.success).toBe(true);
      if (result1.success) {
        expect(result1.val.type).toBe("Identifier");
      }

      // Invalid label characters - this should still parse as an identifier (partial)
      const result2 = parser('na-me:"value"', createPosition());
      expect(result2.success).toBe(true); // 'na' parses as identifier, then fails on '-'

      // Label starting with number - this should fail
      const result3 = parser('1name:"value"', createPosition());
      expect(result3.success).toBe(false);
    });
  });
});
