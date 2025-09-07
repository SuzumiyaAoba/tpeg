import { describe, expect, it } from "bun:test";
import { generateTypeScriptParser } from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { expression } from "./composition";
import { createPositionAt } from "./test-utils";
import type { GrammarDefinition, LabeledExpression, Sequence } from "./types";

describe("Capture Integration Tests", () => {
  describe("parser label parsing", () => {
    it("should correctly parse labeled expressions", () => {
      const parser = expression();
      const result = parser('name:"hello"', createPositionAt(0));

      expect(result.success).toBe(true);
      if (result.success) {
        const labeled = result.val as LabeledExpression;
        expect(labeled.type).toBe("LabeledExpression");
        expect(labeled.label).toBe("name");
        expect(labeled.expression.type).toBe("StringLiteral");
      }
    });

    it("should parse sequences with multiple labels", () => {
      const parser = expression();
      const result = parser(
        'first:"a" second:"b" third:"c"',
        createPositionAt(0),
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

  describe("code generation with captures", () => {
    it("should generate capture calls for labeled expressions", () => {
      const grammar: GrammarDefinition = {
        type: "GrammarDefinition",
        name: "TestGrammar",
        annotations: [],
        rules: [
          {
            type: "RuleDefinition",
            name: "greeting",
            pattern: {
              type: "LabeledExpression",
              label: "message",
              expression: {
                type: "StringLiteral",
                value: "hello",
                quote: '"',
              },
            },
          },
        ],
      };

      const result = generateTypeScriptParser(grammar, {
        includeImports: true,
      });

      expect(result.code).toContain('capture("message"');
      expect(result.code).toContain('literal("hello")');
      expect(result.imports).toContain(
        'import { capture, literal } from "@suzumiyaaoba/tpeg-core";',
      );
    });

    it("should generate optimized code with captures", () => {
      const grammar: GrammarDefinition = {
        type: "GrammarDefinition",
        name: "TestGrammar",
        annotations: [],
        rules: [
          {
            type: "RuleDefinition",
            name: "userInfo",
            pattern: {
              type: "Sequence",
              elements: [
                {
                  type: "LabeledExpression",
                  label: "name",
                  expression: {
                    type: "StringLiteral",
                    value: "john",
                    quote: '"',
                  },
                },
                {
                  type: "StringLiteral",
                  value: " ",
                  quote: '"',
                },
                {
                  type: "LabeledExpression",
                  label: "age",
                  expression: {
                    type: "CharacterClass",
                    ranges: [{ start: "0", end: "9" }],
                    negated: false,
                  },
                },
              ],
            },
          },
        ],
      };

      const result = generateOptimizedTypeScriptParser(grammar, {
        includeImports: true,
      });

      expect(result.code).toContain('capture("name"');
      expect(result.code).toContain('capture("age"');
      expect(result.code).toContain("sequence(");
    });

    it("should handle nested labeled expressions", () => {
      const grammar: GrammarDefinition = {
        type: "GrammarDefinition",
        name: "TestGrammar",
        annotations: [],
        rules: [
          {
            type: "RuleDefinition",
            name: "complex",
            pattern: {
              type: "LabeledExpression",
              label: "outer",
              expression: {
                type: "Group",
                expression: {
                  type: "LabeledExpression",
                  label: "inner",
                  expression: {
                    type: "StringLiteral",
                    value: "value",
                    quote: '"',
                  },
                },
              },
            },
          },
        ],
      };

      const result = generateTypeScriptParser(grammar);

      expect(result.code).toContain('capture("outer"');
      expect(result.code).toContain('capture("inner"');
    });
  });

  describe("capture with different expression types", () => {
    it("should handle captures with character classes", () => {
      const grammar: GrammarDefinition = {
        type: "GrammarDefinition",
        name: "TestGrammar",
        annotations: [],
        rules: [
          {
            type: "RuleDefinition",
            name: "digit",
            pattern: {
              type: "LabeledExpression",
              label: "number",
              expression: {
                type: "CharacterClass",
                ranges: [{ start: "0", end: "9" }],
                negated: false,
              },
            },
          },
        ],
      };

      const result = generateTypeScriptParser(grammar);

      expect(result.code).toContain('capture("number"');
      expect(result.code).toContain("charClass");
    });

    it("should handle captures with repetition operators", () => {
      const grammar: GrammarDefinition = {
        type: "GrammarDefinition",
        name: "TestGrammar",
        annotations: [],
        rules: [
          {
            type: "RuleDefinition",
            name: "repeated",
            pattern: {
              type: "LabeledExpression",
              label: "items",
              expression: {
                type: "Star",
                expression: {
                  type: "StringLiteral",
                  value: "x",
                  quote: '"',
                },
              },
            },
          },
        ],
      };

      const result = generateTypeScriptParser(grammar);

      expect(result.code).toContain('capture("items"');
      expect(result.code).toContain("zeroOrMore");
    });

    it("should handle captures with choice expressions", () => {
      const grammar: GrammarDefinition = {
        type: "GrammarDefinition",
        name: "TestGrammar",
        annotations: [],
        rules: [
          {
            type: "RuleDefinition",
            name: "option",
            pattern: {
              type: "LabeledExpression",
              label: "choice",
              expression: {
                type: "Choice",
                alternatives: [
                  {
                    type: "StringLiteral",
                    value: "yes",
                    quote: '"',
                  },
                  {
                    type: "StringLiteral",
                    value: "no",
                    quote: '"',
                  },
                ],
              },
            },
          },
        ],
      };

      const result = generateTypeScriptParser(grammar);

      expect(result.code).toContain('capture("choice"');
      expect(result.code).toContain("choice");
    });
  });

  describe("capture import generation", () => {
    it("should include capture in imports when labeled expressions are present", () => {
      const grammar: GrammarDefinition = {
        type: "GrammarDefinition",
        name: "TestGrammar",
        annotations: [],
        rules: [
          {
            type: "RuleDefinition",
            name: "simple",
            pattern: {
              type: "LabeledExpression",
              label: "value",
              expression: {
                type: "StringLiteral",
                value: "test",
                quote: '"',
              },
            },
          },
        ],
      };

      const result = generateTypeScriptParser(grammar, {
        includeImports: true,
      });

      expect(result.imports).toContain(
        'import { capture, literal } from "@suzumiyaaoba/tpeg-core";',
      );
    });

    it("should not include capture in imports when no labeled expressions are present", () => {
      const grammar: GrammarDefinition = {
        type: "GrammarDefinition",
        name: "TestGrammar",
        annotations: [],
        rules: [
          {
            type: "RuleDefinition",
            name: "simple",
            pattern: {
              type: "StringLiteral",
              value: "test",
              quote: '"',
            },
          },
        ],
      };

      const result = generateTypeScriptParser(grammar, {
        includeImports: true,
      });

      expect(result.code).not.toContain("capture");
      expect(result.imports.join("")).not.toContain("capture");
    });
  });

  describe("complex capture scenarios", () => {
    it("should handle arithmetic expression with captures", () => {
      const grammar: GrammarDefinition = {
        type: "GrammarDefinition",
        name: "Calculator",
        annotations: [],
        rules: [
          {
            type: "RuleDefinition",
            name: "expression",
            pattern: {
              type: "Sequence",
              elements: [
                {
                  type: "LabeledExpression",
                  label: "left",
                  expression: {
                    type: "CharacterClass",
                    ranges: [{ start: "0", end: "9" }],
                    negated: false,
                  },
                },
                {
                  type: "LabeledExpression",
                  label: "operator",
                  expression: {
                    type: "Choice",
                    alternatives: [
                      {
                        type: "StringLiteral",
                        value: "+",
                        quote: '"',
                      },
                      {
                        type: "StringLiteral",
                        value: "-",
                        quote: '"',
                      },
                    ],
                  },
                },
                {
                  type: "LabeledExpression",
                  label: "right",
                  expression: {
                    type: "CharacterClass",
                    ranges: [{ start: "0", end: "9" }],
                    negated: false,
                  },
                },
              ],
            },
          },
        ],
      };

      const result = generateTypeScriptParser(grammar);

      expect(result.code).toContain('capture("left"');
      expect(result.code).toContain('capture("operator"');
      expect(result.code).toContain('capture("right"');
      expect(result.code).toContain("sequence(");
      expect(result.code).toContain("choice(");
      expect(result.code).toContain("charClass");
    });

    it("should handle URL parsing with captures", () => {
      const grammar: GrammarDefinition = {
        type: "GrammarDefinition",
        name: "URLParser",
        annotations: [],
        rules: [
          {
            type: "RuleDefinition",
            name: "url",
            pattern: {
              type: "Sequence",
              elements: [
                {
                  type: "LabeledExpression",
                  label: "protocol",
                  expression: {
                    type: "Choice",
                    alternatives: [
                      {
                        type: "StringLiteral",
                        value: "http",
                        quote: '"',
                      },
                      {
                        type: "StringLiteral",
                        value: "https",
                        quote: '"',
                      },
                    ],
                  },
                },
                {
                  type: "StringLiteral",
                  value: "://",
                  quote: '"',
                },
                {
                  type: "LabeledExpression",
                  label: "domain",
                  expression: {
                    type: "Plus",
                    expression: {
                      type: "CharacterClass",
                      ranges: [
                        { start: "a", end: "z" },
                        { start: "A", end: "Z" },
                        { start: "0", end: "9" },
                      ],
                      negated: false,
                    },
                  },
                },
              ],
            },
          },
        ],
      };

      const result = generateTypeScriptParser(grammar);

      expect(result.code).toContain('capture("protocol"');
      expect(result.code).toContain('capture("domain"');
      expect(result.code).toContain("oneOrMore");
    });
  });

  describe("performance considerations", () => {
    it("should generate efficient code for multiple captures", () => {
      const grammar: GrammarDefinition = {
        type: "GrammarDefinition",
        name: "MultiCapture",
        annotations: [],
        rules: [
          {
            type: "RuleDefinition",
            name: "multi",
            pattern: {
              type: "Sequence",
              elements: Array.from({ length: 10 }, (_, i) => ({
                type: "LabeledExpression" as const,
                label: `field${i}`,
                expression: {
                  type: "StringLiteral" as const,
                  value: `value${i}`,
                  quote: '"' as const,
                },
              })),
            },
          },
        ],
      };

      const result = generateOptimizedTypeScriptParser(grammar);

      // Should generate all captures
      for (let i = 0; i < 10; i++) {
        expect(result.code).toContain(`capture("field${i}"`);
      }

      // Should include proper imports
      expect(result.code).toContain("capture");
      expect(result.code).toContain("sequence");
    });
  });
});
