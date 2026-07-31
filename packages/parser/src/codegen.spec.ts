/**
 * Tests for TPEG Code Generation System
 */

import { describe, expect, test } from "bun:test";
import { TPEGCodeGenerator, generateTypeScriptParser } from "./codegen";
import {
  createAnyChar,
  createCharRange,
  createCharacterClass,
  createChoice,
  createGrammarDefinition,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createNegativeLookahead,
  createOptional,
  createPlus,
  createPositiveLookahead,
  createQualifiedIdentifier,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
  createTransformDefinition,
  createTransformFunction,
  createTransformParameter,
  createTransformReturnType,
  createTransformSet,
} from "./types";

describe("TPEG Code Generation", () => {
  describe("TPEGCodeGenerator", () => {
    test("should generate basic string literal parser", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("hello", createStringLiteral("hello"))],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'export const hello: Parser<any> = literal("hello");',
      );
      expect(result.exports).toEqual(["hello"]);
    });

    test("should generate character class parser", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "letter",
            createCharacterClass(
              [
                createCharRange("a"), // single character
                createCharRange("c", "z"), // range
              ],
              false,
            ),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain("charClass(");
      expect(result.exports).toEqual(["letter"]);
    });

    test("should generate negated character class parser", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "notDigit",
            createCharacterClass([createCharRange("0", "9")], true),
          ),
        ],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain('negatedCharClass(["0", "9"])');
      expect(result.imports.join("\n")).toContain("negatedCharClass");
    });

    test("should generate AnyChar parser with the anyChar import", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("anything", createAnyChar())],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain("anyChar()");
      expect(result.imports.join("\n")).toContain("anyChar");
    });

    test("generated character class / AnyChar code should actually parse input", async () => {
      const core = await import("@suzumiyaaoba/tpeg-core");

      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "letter",
            createCharacterClass([createCharRange("a", "z")], false),
          ),
          createRuleDefinition(
            "notDigit",
            createCharacterClass([createCharRange("0", "9")], true),
          ),
          createRuleDefinition("anything", createAnyChar()),
        ],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      // Evaluate the generated source directly against the real
      // @suzumiyaaoba/tpeg-core exports, exactly as the emitted `import`
      // statement expects, so a signature mismatch fails this test.
      const body = result.code
        .replace(/^import[^\n]*\n?/gm, "")
        .replace(/^export const (\w+): Parser<[^>]*>/gm, "const $1");
      const moduleFactory = new Function(
        ...Object.keys(core),
        `${body}\nreturn { letter, notDigit, anything };`,
      );
      const { letter, notDigit, anything } = moduleFactory(
        ...Object.values(core),
      );

      const pos = { offset: 0, column: 0, line: 1 };
      expect(letter("m", pos).success).toBe(true);
      expect(notDigit("m", pos).success).toBe(true);
      expect(notDigit("5", pos).success).toBe(false);
      expect(anything("x", pos).success).toBe(true);
    });

    test("should generate sequence parser", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "greeting",
            createSequence([
              createStringLiteral("hello"),
              createStringLiteral(" "),
              createStringLiteral("world"),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'sequence(literal("hello"), literal(" "), literal("world"))',
      );
    });

    test("should generate choice parser", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "bool",
            createChoice([
              createStringLiteral("true"),
              createStringLiteral("false"),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'choice(literal("true"), literal("false"))',
      );
    });

    test("should generate repetition parsers", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "letters",
            createStar(
              createCharacterClass([createCharRange("a", "z")], false),
            ),
          ),
          createRuleDefinition(
            "digits",
            createPlus(
              createCharacterClass([createCharRange("0", "9")], false),
            ),
          ),
          createRuleDefinition(
            "optionalSpace",
            createOptional(createStringLiteral(" ")),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain('zeroOrMore(charClass(["a", "z"]))');
      expect(result.code).toContain('oneOrMore(charClass(["0", "9"]))');
      expect(result.code).toContain('optional(literal(" "))');
    });

    test("should generate lookahead parsers", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "positiveCheck",
            createPositiveLookahead(createStringLiteral("test")),
          ),
          createRuleDefinition(
            "negativeCheck",
            createNegativeLookahead(createStringLiteral("test")),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain('andPredicate(literal("test"))');
      expect(result.code).toContain('notPredicate(literal("test"))');
    });

    test("should handle labeled expressions", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "namedValue",
            createLabeledExpression("value", createStringLiteral("test")),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain('capture("value", literal("test"))');
    });

    test("should handle rule references", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "number",
            createPlus(
              createCharacterClass([createCharRange("0", "9")], false),
            ),
          ),
          createRuleDefinition(
            "expression",
            createChoice([
              createIdentifier("number"),
              createStringLiteral("null"),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain('choice(number, literal("null"))');
      expect(result.exports).toEqual(["number", "expression"]);
    });

    test("should handle qualified (cross-module) rule references", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "main",
            createQualifiedIdentifier("math", "expr"),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        "export const main: Parser<any> = math.expr;",
      );
      expect(result.exports).toEqual(["main"]);
    });

    test("should handle complex nested expressions", () => {
      const grammar = createGrammarDefinition(
        "Calculator",
        [],
        [
          createRuleDefinition(
            "factor",
            createChoice([
              createPlus(
                createCharacterClass([createCharRange("0", "9")], false),
              ),
              createGroup(
                createSequence([
                  createStringLiteral("("),
                  createIdentifier("expression"),
                  createStringLiteral(")"),
                ]),
              ),
            ]),
          ),
          createRuleDefinition(
            "expression",
            createSequence([
              createIdentifier("factor"),
              createStar(
                createSequence([
                  createChoice([
                    createStringLiteral("+"),
                    createStringLiteral("-"),
                  ]),
                  createIdentifier("factor"),
                ]),
              ),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      // Should contain complex nested structure
      expect(result.code).toContain("choice(");
      expect(result.code).toContain("sequence(");
      expect(result.code).toContain("oneOrMore(");
      expect(result.code).toContain("zeroOrMore(");
      expect(result.exports).toEqual(["factor", "expression"]);
    });

    test("should include imports when enabled", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("test"))],
      );

      const generator = new TPEGCodeGenerator({
        language: "typescript",
        includeImports: true,
      });
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'import type { Parser } from "@suzumiyaaoba/tpeg-core"',
      );
      expect(result.code).toContain(
        'import { literal } from "@suzumiyaaoba/tpeg-core"',
      );
    });

    test("should exclude imports when disabled", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("test"))],
      );

      const generator = new TPEGCodeGenerator({
        language: "typescript",
        includeImports: false,
      });
      const result = generator.generateGrammar(grammar);

      expect(result.code).not.toContain("import");
    });

    test("should use name prefix when provided", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("test"))],
      );

      const generator = new TPEGCodeGenerator({
        language: "typescript",
        namePrefix: "my_",
      });
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain("export const my_test:");
    });
  });

  describe("generateTypeScriptParser", () => {
    test("should work as convenience function", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("hello", createStringLiteral("hello"))],
      );

      const result = generateTypeScriptParser(grammar);

      expect(result.code).toContain(
        'export const hello: Parser<any> = literal("hello");',
      );
      expect(result.imports.length).toBeGreaterThan(0);
      expect(result.exports).toEqual(["hello"]);
    });

    test("should accept options", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("test"))],
      );

      const result = generateTypeScriptParser(grammar, {
        namePrefix: "prefix_",
        includeTypes: false,
      });

      expect(result.code).toContain("export const prefix_test =");
      expect(result.code).not.toContain("Parser<any>");
    });
  });

  describe("escape handling", () => {
    test("should properly escape string literals", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "escaped",
            createStringLiteral('quotes"and\\backslashes'),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain('literal("quotes\\"and\\\\backslashes")');
    });
  });

  describe("transform integration", () => {
    test("should apply a matching TypeScript transform function to a rule's parse result", async () => {
      const core = await import("@suzumiyaaoba/tpeg-core");

      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "number",
            createLabeledExpression(
              "digits",
              createPlus(
                createCharacterClass([createCharRange("0", "9")], false),
              ),
            ),
          ),
        ],
        [
          createTransformDefinition(
            createTransformSet("Evaluator", "typescript", [
              createTransformFunction(
                "number",
                [createTransformParameter("captures", "{ digits: string[] }")],
                createTransformReturnType("Result", "number"),
                `
    const value = parseInt(captures.digits.join(""), 10);
    if (isNaN(value)) {
      return { success: false, error: "Invalid number format" };
    }
    return { success: true, value };
  `,
              ),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      const body = result.code
        .replace(/^import[^\n]*\n?/gm, "")
        .replace(/^export const (\w+): Parser<[^>]*>/gm, "const $1");
      const moduleFactory = new Function(
        ...Object.keys(core),
        `${body}\nreturn { number };`,
      );
      const { number } = moduleFactory(...Object.values(core));

      const pos = { offset: 0, column: 0, line: 1 };
      expect(number("123abc", pos)).toEqual({
        success: true,
        val: 123,
        current: { offset: 0, column: 0, line: 1 },
        next: { offset: 3, column: 3, line: 1 },
      });
      expect(number("abc", pos).success).toBe(false);
    });

    test("should leave a rule without a matching transform function unaffected", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("hello", createStringLiteral("hello"))],
        [
          createTransformDefinition(
            createTransformSet("Evaluator", "typescript", [
              createTransformFunction(
                "unrelatedRule",
                [createTransformParameter("captures", "string")],
                createTransformReturnType("Result", "string"),
                "return { success: true, value: captures };",
              ),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'export const hello: Parser<any> = literal("hello");',
      );
    });
  });
});
