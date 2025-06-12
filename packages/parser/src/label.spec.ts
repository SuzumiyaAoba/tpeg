/**
 * TPEG Label Parser Tests
 *
 * Tests for parsing labeled expressions: name:expr
 */

import { describe, expect, test } from "bun:test";
import type { Pos } from "tpeg-core";
import { characterClass } from "./character-class";
import { identifier } from "./identifier";
import {
  createLabeledExpression,
  labeledExpression,
  withOptionalLabel,
} from "./label";
import { stringLiteral } from "./string-literal";
import type { Expression, LabeledExpression } from "./types";

const createPosition = (offset = 0, line = 1, column = 1): Pos => ({
  offset,
  line,
  column,
});

describe("createLabeledExpression", () => {
  test("creates labeled expression AST node", () => {
    const expr: Expression = {
      type: "StringLiteral",
      value: "hello",
      quote: '"',
    };

    const result = createLabeledExpression("name", expr);

    expect(result).toEqual({
      type: "LabeledExpression",
      label: "name",
      expression: expr,
    });
  });
});

describe("labeledExpression", () => {
  test("parses simple labeled string literal", () => {
    const parser = labeledExpression(() => stringLiteral());
    const result = parser('name:"hello"', createPosition());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual({
        type: "LabeledExpression",
        label: "name",
        expression: {
          type: "StringLiteral",
          value: "hello",
          quote: '"',
        },
      });
      expect(result.next.offset).toBe(12); // 'name:"hello"' length
    }
  });

  test("parses labeled character class", () => {
    const parser = labeledExpression(() => characterClass());
    const result = parser("digits:[0-9]", createPosition());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual({
        type: "LabeledExpression",
        label: "digits",
        expression: {
          type: "CharacterClass",
          ranges: [
            {
              start: "0",
              end: "9",
            },
          ],
          negated: false,
        },
      });
      expect(result.next.offset).toBe(12); // 'digits:[0-9]' length
    }
  });

  test("parses labeled identifier reference", () => {
    const parser = labeledExpression(() => identifier());
    const result = parser("left:expression", createPosition());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual({
        type: "LabeledExpression",
        label: "left",
        expression: {
          type: "Identifier",
          name: "expression",
        },
      });
      expect(result.next.offset).toBe(15); // 'left:expression' length
    }
  });

  test("parses complex label names", () => {
    const parser = labeledExpression(() => stringLiteral());

    // Underscore in label
    const result1 = parser('first_name:"John"', createPosition());
    expect(result1.success).toBe(true);
    if (result1.success) {
      expect(result1.val.label).toBe("first_name");
    }

    // Number in label
    const result2 = parser('item1:"value"', createPosition());
    expect(result2.success).toBe(true);
    if (result2.success) {
      expect(result2.val.label).toBe("item1");
    }

    // CamelCase label
    const result3 = parser('userName:"alice"', createPosition());
    expect(result3.success).toBe(true);
    if (result3.success) {
      expect(result3.val.label).toBe("userName");
    }
  });

  test("handles whitespace around colon", () => {
    const parser = labeledExpression(() => stringLiteral());

    // No spaces (should work)
    const result1 = parser('name:"hello"', createPosition());
    expect(result1.success).toBe(true);

    // Spaces around colon should fail (strict parsing)
    const result2 = parser('name : "hello"', createPosition());
    expect(result2.success).toBe(false);

    const result3 = parser('name: "hello"', createPosition());
    expect(result3.success).toBe(false);
  });

  test("fails when label is invalid", () => {
    const parser = labeledExpression(() => stringLiteral());

    // Label starting with number
    const result1 = parser('1name:"hello"', createPosition());
    expect(result1.success).toBe(false);

    // Empty label
    const result2 = parser(':"hello"', createPosition());
    expect(result2.success).toBe(false);

    // Special characters in label
    const result3 = parser('na-me:"hello"', createPosition());
    expect(result3.success).toBe(false);
  });

  test("fails when colon is missing", () => {
    const parser = labeledExpression(() => stringLiteral());
    const result = parser('name"hello"', createPosition());

    expect(result.success).toBe(false);
  });

  test("fails when expression is invalid", () => {
    const parser = labeledExpression(() => stringLiteral());
    const result = parser("name:[invalid]", createPosition());

    expect(result.success).toBe(false);
  });
});

describe("withOptionalLabel", () => {
  test("parses labeled expression when label is present", () => {
    const parser = withOptionalLabel(stringLiteral());
    const result = parser('name:"hello"', createPosition());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("LabeledExpression");
      const labeled = result.val as LabeledExpression;
      expect(labeled.label).toBe("name");
      expect(labeled.expression).toEqual({
        type: "StringLiteral",
        value: "hello",
        quote: '"',
      });
    }
  });

  test("parses unlabeled expression when no label is present", () => {
    const parser = withOptionalLabel(stringLiteral());
    const result = parser('"hello"', createPosition());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual({
        type: "StringLiteral",
        value: "hello",
        quote: '"',
      });
    }
  });

  test("prefers labeled over unlabeled when both could match", () => {
    // This test ensures that the choice prioritizes labeled expressions
    const parser = withOptionalLabel(identifier());
    const result = parser("name:value", createPosition());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("LabeledExpression");
      const labeled = result.val as LabeledExpression;
      expect(labeled.label).toBe("name");
      expect(labeled.expression).toEqual({
        type: "Identifier",
        name: "value",
      });
    }
  });

  test("falls back to unlabeled when label parsing fails", () => {
    const parser = withOptionalLabel(stringLiteral());
    const result = parser('"no_label"', createPosition());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("StringLiteral");
    }
  });

  test("handles complex expressions", () => {
    const parser = withOptionalLabel(characterClass());

    // Labeled character class
    const result1 = parser("chars:[a-zA-Z]", createPosition());
    expect(result1.success).toBe(true);
    if (result1.success) {
      expect(result1.val.type).toBe("LabeledExpression");
    }

    // Unlabeled character class
    const result2 = parser("[a-zA-Z]", createPosition());
    expect(result2.success).toBe(true);
    if (result2.success) {
      expect(result2.val.type).toBe("CharacterClass");
    }
  });
});

describe("label precedence and associativity", () => {
  test("labels have correct precedence in expression hierarchy", () => {
    // Labels should bind more tightly than sequences but less than atoms
    const parser = withOptionalLabel(stringLiteral());
    const result = parser('name:"hello"', createPosition());

    expect(result.success).toBe(true);
    if (result.success) {
      const labeled = result.val as LabeledExpression;
      expect(labeled.type).toBe("LabeledExpression");
      expect(labeled.label).toBe("name");
      expect(labeled.expression.type).toBe("StringLiteral");
    }
  });
});
