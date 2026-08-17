/**
 * Tests for Eta Template Engine Based Code Generator
 */

import { describe, expect, it } from "bun:test";
import {
  EtaTPEGCodeGenerator,
  generateEtaTypeScriptParser,
} from "./eta-generator";

// Import test utilities from core
import type {
  CharacterClass,
  Choice,
  Expression,
  GrammarAnnotation,
  GrammarDefinition,
  Identifier,
  LabeledExpression,
  NegativeLookahead,
  Optional,
  Plus,
  PositiveLookahead,
  QualifiedIdentifier,
  Quantified,
  RuleDefinition,
  Sequence,
  Star,
  StringLiteral,
} from "./types";

// Simple test helper functions
function createGrammarDefinition(
  name: string,
  annotations: GrammarAnnotation[],
  rules: RuleDefinition[],
  transforms?: GrammarDefinition["transforms"],
): GrammarDefinition {
  return {
    type: "GrammarDefinition",
    name,
    annotations,
    rules,
    ...(transforms !== undefined ? { transforms } : {}),
  };
}

function createRuleDefinition(
  name: string,
  pattern: Expression,
): RuleDefinition {
  return {
    type: "RuleDefinition",
    name,
    pattern,
  };
}

function createStringLiteral(
  value: string,
  quote: '"' | "'" = '"',
): StringLiteral {
  return {
    type: "StringLiteral",
    value,
    quote,
  };
}

function createCharacterClass(
  ranges: Array<{ start: string; end?: string }>,
  negated: boolean,
): CharacterClass {
  return {
    type: "CharacterClass",
    ranges,
    negated,
  };
}

function createCharRange(start: string, end: string) {
  return { start, end };
}

function createSequence(elements: Expression[]): Sequence {
  return {
    type: "Sequence",
    elements,
  };
}

function createChoice(alternatives: Expression[]): Choice {
  return {
    type: "Choice",
    alternatives,
  };
}

function createStar(expression: Expression): Star {
  return {
    type: "Star",
    expression,
  };
}

function createPlus(expression: Expression): Plus {
  return {
    type: "Plus",
    expression,
  };
}

function createLabeledExpression(
  label: string,
  expression: Expression,
): LabeledExpression {
  return {
    type: "LabeledExpression",
    label,
    expression,
  };
}

function createOptional(expression: Expression): Optional {
  return {
    type: "Optional",
    expression,
  };
}

function createQuantified(
  expression: Expression,
  min: number,
  max?: number,
): Quantified {
  return {
    type: "Quantified",
    expression,
    min,
    ...(max !== undefined ? { max } : {}),
  };
}

function createIdentifier(name: string): Identifier {
  return {
    type: "Identifier",
    name,
  };
}

function createQualifiedIdentifier(
  module: string,
  name: string,
): QualifiedIdentifier {
  return {
    type: "QualifiedIdentifier",
    module,
    name,
  };
}

describe("EtaTPEGCodeGenerator", () => {
  describe("Basic Code Generation", () => {
    it("should generate simple rule with string literal", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("hello", createStringLiteral("world"))],
      );

      const generator = new EtaTPEGCodeGenerator({
        language: "typescript",
        namePrefix: "test_",
        includeTypes: true,
      });

      const result = await generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'import type { Parser } from "@suzumiyaaoba/tpeg-core";',
      );
      expect(result.code).toContain(
        'import { literal } from "@suzumiyaaoba/tpeg-core";',
      );
      expect(result.code).toContain(
        'export const test_hello: Parser<any> = literal("world");',
      );
      expect(result.performance.templateEngine).toBe("eta");
    });

    it("should generate rule with character class", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "letter",
            createCharacterClass([createCharRange("a", "z")], false),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "test_",
        includeTypes: true,
      });

      expect(result.code).toContain("charClass");
      expect(result.code).toContain("export const test_letter: Parser<any>");
      expect(result.code).toContain('["a", "z"]');
    });

    it("should generate a negated character class parser", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "notDigit",
            createCharacterClass([createCharRange("0", "9")], true),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "test_",
        includeTypes: true,
      });

      expect(result.code).toContain('negatedCharClass(["0", "9"])');
      expect(result.code).toContain(
        'import { negatedCharClass } from "@suzumiyaaoba/tpeg-core";',
      );
    });

    it("should generate character class / negated character class / AnyChar code that actually parses input", async () => {
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
          createRuleDefinition("anything", { type: "AnyChar" }),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        includeTypes: true,
      });

      const body = result.code
        .replace(/import\s*(?:type\s*)?\{[^}]*\}\s*from\s*"[^"]*";/g, "")
        .replace(/^export const (\w+): Parser<[^>]*>/gm, "const $1");
      const moduleFactory = new Function(
        ...Object.keys(core),
        `${body}\nreturn { letter, notDigit, anything };`,
      );
      const { letter, notDigit, anything } = moduleFactory(
        ...Object.values(core),
      );

      const pos = 0;
      expect(letter("m", pos).success).toBe(true);
      expect(notDigit("m", pos).success).toBe(true);
      expect(notDigit("5", pos).success).toBe(false);
      expect(anything("x", pos).success).toBe(true);
    });

    it("should generate multiple rules", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("hello", createStringLiteral("hello")),
          createRuleDefinition("world", createStringLiteral("world")),
          createRuleDefinition(
            "greeting",
            createSequence([
              createIdentifier("hello"),
              createStringLiteral(" "),
              createIdentifier("world"),
            ]),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "test_",
        includeTypes: true,
      });

      expect(result.code).toContain("export const test_hello: Parser<any>");
      expect(result.code).toContain("export const test_world: Parser<any>");
      expect(result.code).toContain("export const test_greeting: Parser<any>");
      expect(result.code).toContain(
        'sequence(test_hello, literal(" "), test_world)',
      );
      expect(result.exports).toEqual([
        "test_hello",
        "test_world",
        "test_greeting",
      ]);
    });

    it("should generate a namespaced reference for a qualified (cross-module) identifier", async () => {
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

      const result = await generateEtaTypeScriptParser(grammar, {
        includeTypes: true,
      });

      expect(result.code).toContain(
        "export const main: Parser<any> = math.expr;",
      );
    });
  });

  describe("transform integration", () => {
    it("applies a matching TypeScript transform function to a rule's parse result", async () => {
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
          {
            type: "TransformDefinition",
            transformSet: {
              name: "Evaluator",
              targetLanguage: "typescript",
              functions: [
                {
                  name: "number",
                  parameters: [
                    { name: "captures", type: "{ digits: string[] }" },
                  ],
                  returnType: { type: "Result", generic: "number" },
                  body: `
    const value = parseInt(captures.digits.join(""), 10);
    if (isNaN(value)) {
      return { success: false, error: "Invalid number format" };
    }
    return { success: true, value };
  `,
                },
              ],
            },
          },
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        includeImports: false,
      });

      const body = result.code.replace(
        /^export const (\w+): Parser<[^>]*>/gm,
        "const $1",
      );
      const moduleFactory = new Function(
        ...Object.keys(core),
        `${body}\nreturn { number };`,
      );
      const { number } = moduleFactory(...Object.values(core));

      const pos = 0;
      expect(number("123abc", pos)).toEqual({
        success: true,
        val: 123,
        current: 0,
        next: 3,
      });
      expect(number("abc", pos).success).toBe(false);
    });
  });

  describe("Advanced Expressions", () => {
    it("should generate sequence expressions", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "sequence",
            createSequence([
              createStringLiteral("a"),
              createStringLiteral("b"),
              createStringLiteral("c"),
            ]),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.code).toContain(
        'sequence(literal("a"), literal("b"), literal("c"))',
      );
    });

    it("emits captureSequence (not sequence) for a Sequence with labeled elements, so labels merge into a named-field object instead of an unmerged positional tuple", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "pair",
            createSequence([
              createLabeledExpression("key", createStringLiteral("k")),
              createStringLiteral("="),
              createLabeledExpression("value", createStringLiteral("v")),
            ]),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.code).toContain(
        'captureSequence(capture("key", literal("k")), literal("="), capture("value", literal("v")))',
      );
      expect(result.code).not.toContain("sequence(capture(");
    });

    it("resolves a multi-label sequence's captures to a named-field object at runtime (regression: previously produced a positional tuple of still-tagged capture() objects instead of {key, value})", async () => {
      const core = await import("@suzumiyaaoba/tpeg-core");
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "pair",
            createSequence([
              createLabeledExpression("key", createStringLiteral("k")),
              createStringLiteral("="),
              createLabeledExpression("value", createStringLiteral("v")),
            ]),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        includeTypes: false,
        includeImports: false,
      });
      const body = result.code.replace(/^export const (\w+)/gm, "const $1");
      const moduleFactory = new Function(
        ...Object.keys(core),
        `${body}\nreturn { pair };`,
      );
      const { pair } = moduleFactory(...Object.values(core));

      const parsed = pair("k=v", 0);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.val).toEqual({ key: "k", value: "v" });
      }
    });

    it("should generate choice expressions", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "choice",
            createChoice([
              createStringLiteral("true"),
              createStringLiteral("false"),
            ]),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.code).toContain(
        'choice(literal("true"), literal("false"))',
      );
    });

    it("should generate repetition expressions", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("star", createStar(createStringLiteral("a"))),
          createRuleDefinition("plus", createPlus(createStringLiteral("b"))),
          createRuleDefinition(
            "optional",
            createOptional(createStringLiteral("c")),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.code).toContain('zeroOrMore(literal("a"))');
      expect(result.code).toContain('oneOrMore(literal("b"))');
      expect(result.code).toContain('optional(literal("c"))');
    });

    it("should generate quantified expressions", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "exactly3",
            createQuantified(createStringLiteral("a"), 3, 3),
          ),
          createRuleDefinition(
            "range2to5",
            createQuantified(createStringLiteral("b"), 2, 5),
          ),
          createRuleDefinition(
            "minimum3",
            createQuantified(createStringLiteral("c"), 3),
          ),
          createRuleDefinition(
            "zero0",
            createQuantified(createStringLiteral("d"), 0, 0),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.code).toContain('quantified(literal("a"), 3, 3)');
      expect(result.code).toContain('quantified(literal("b"), 2, 5)');
      expect(result.code).toContain('quantified(literal("c"), 3)');
      expect(result.code).toContain('quantified(literal("d"), 0, 0)');
    });
  });

  describe("Type Generation Options", () => {
    it("should generate without types when includeTypes is false", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("hello", createStringLiteral("world"))],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        includeTypes: false,
      });

      expect(result.code).toContain('export const hello = literal("world");');
      expect(result.code).not.toContain(": Parser<any>");
    });

    it("should generate with custom name prefix", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("rule", createStringLiteral("value"))],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "custom_",
      });

      expect(result.code).toContain("export const custom_rule");
    });

    it("should skip imports when includeImports is false", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("hello", createStringLiteral("world"))],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        includeImports: false,
      });

      expect(result.code).not.toContain("import");
      expect(result.code).toContain("export const hello");
    });
  });

  describe("Performance Analysis", () => {
    it("should include performance metadata", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("simple", createStringLiteral("hello"))],
      );

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.performance).toBeDefined();
      expect(result.performance.templateEngine).toBe("eta");
      expect(result.performance.estimatedComplexity).toBe("low");
      expect(typeof result.performance.generationTime).toBe("number");
      expect(Array.isArray(result.performance.optimizationSuggestions)).toBe(
        true,
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle empty grammar", async () => {
      const grammar = createGrammarDefinition("EmptyGrammar", [], []);

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.code).toContain("import type { Parser }");
      expect(result.exports).toEqual([]);
    });

    it("should handle invalid template directory gracefully", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("rule", createStringLiteral("value"))],
      );

      const generator = new EtaTPEGCodeGenerator({
        language: "typescript",
        templatesDir: "/nonexistent/path",
        cache: false,
      });

      // Should still attempt to generate, even if templates are missing
      // The actual error handling depends on Eta's behavior
      await expect(generator.generateGrammar(grammar)).rejects.toThrow();
    });
  });

  describe("Snapshot Tests", () => {
    it("should generate consistent code for simple grammar", async () => {
      const grammar = createGrammarDefinition(
        "SimpleGrammar",
        [],
        [
          createRuleDefinition("hello", createStringLiteral("world")),
          createRuleDefinition(
            "number",
            createCharacterClass([createCharRange("0", "9")], false),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "test_",
        includeTypes: true,
        optimize: false,
      });

      // Snapshot test: Verify the complete generated code
      expect(result.code).toMatchSnapshot();
      expect(result.imports).toMatchSnapshot();
      expect(result.exports).toMatchSnapshot();

      // Verify performance information excluding generation time
      const { generationTime, ...performanceWithoutTime } = result.performance;
      expect(performanceWithoutTime).toMatchSnapshot();
      expect(typeof generationTime).toBe("number");
      expect(generationTime).toBeGreaterThan(0);
    });

    it("should generate consistent code for complex grammar", async () => {
      const grammar = createGrammarDefinition(
        "ComplexGrammar",
        [],
        [
          createRuleDefinition(
            "digit",
            createCharacterClass([createCharRange("0", "9")], false),
          ),
          createRuleDefinition(
            "letter",
            createCharacterClass([createCharRange("a", "z")], false),
          ),
          createRuleDefinition(
            "word",
            createPlus(
              createCharacterClass([createCharRange("a", "z")], false),
            ),
          ),
          createRuleDefinition(
            "expression",
            createSequence([
              createIdentifier("word"),
              createOptional(createStringLiteral(" ")),
              createIdentifier("word"),
            ]),
          ),
          createRuleDefinition(
            "number",
            createChoice([
              createPlus(
                createCharacterClass([createCharRange("0", "9")], false),
              ),
              createSequence([
                createPlus(
                  createCharacterClass([createCharRange("0", "9")], false),
                ),
                createStringLiteral("."),
                createPlus(
                  createCharacterClass([createCharRange("0", "9")], false),
                ),
              ]),
            ]),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "complex_",
        includeTypes: true,
        optimize: true,
        enableMemoization: true,
      });

      // Snapshot test: Verify complex grammar generated code
      expect(result.code).toMatchSnapshot();
      expect(result.imports).toMatchSnapshot();
      expect(result.exports).toMatchSnapshot();

      // Verify performance information excluding generation time
      const { generationTime, ...performanceWithoutTime } = result.performance;
      expect(performanceWithoutTime).toMatchSnapshot();
      expect(typeof generationTime).toBe("number");
      expect(generationTime).toBeGreaterThan(0);
    });

    it("should generate consistent optimized code", async () => {
      const grammar = createGrammarDefinition(
        "OptimizedGrammar",
        [],
        [
          createRuleDefinition(
            "recursive",
            createChoice([
              createStringLiteral("a"),
              createSequence([
                createStringLiteral("("),
                createIdentifier("recursive"),
                createStringLiteral(")"),
              ]),
            ]),
          ),
          createRuleDefinition(
            "highComplexity",
            createStar(
              createChoice([
                createStringLiteral("x"),
                createStringLiteral("y"),
                createStringLiteral("z"),
              ]),
            ),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "opt_",
        includeTypes: true,
        optimize: true,
        enableMemoization: true,
        includeMonitoring: true,
      });

      // Snapshot test: Verify optimized code
      expect(result.code).toMatchSnapshot();
      expect(result.imports).toMatchSnapshot();
      expect(result.exports).toMatchSnapshot();

      // Verify performance information excluding generation time
      const { generationTime, ...performanceWithoutTime } = result.performance;
      expect(performanceWithoutTime).toMatchSnapshot();
      expect(typeof generationTime).toBe("number");
      expect(generationTime).toBeGreaterThan(0);
    });

    it("should generate consistent code without types", async () => {
      const grammar = createGrammarDefinition(
        "NoTypesGrammar",
        [],
        [
          createRuleDefinition("simple", createStringLiteral("value")),
          createRuleDefinition(
            "choice",
            createChoice([createStringLiteral("a"), createStringLiteral("b")]),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "notypes_",
        includeTypes: false,
        optimize: false,
      });

      // Snapshot test: Verify code without types
      expect(result.code).toMatchSnapshot();
      expect(result.imports).toMatchSnapshot();
      expect(result.exports).toMatchSnapshot();

      // Verify performance information excluding generation time
      const { generationTime, ...performanceWithoutTime } = result.performance;
      expect(performanceWithoutTime).toMatchSnapshot();
      expect(typeof generationTime).toBe("number");
      expect(generationTime).toBeGreaterThan(0);
    });

    it("should generate consistent code without imports", async () => {
      const grammar = createGrammarDefinition(
        "NoImportsGrammar",
        [],
        [createRuleDefinition("basic", createStringLiteral("test"))],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "noimports_",
        includeImports: false,
        includeTypes: true,
        optimize: false,
      });

      // Snapshot test: Verify code without imports
      expect(result.code).toMatchSnapshot();
      expect(result.imports).toMatchSnapshot();
      expect(result.exports).toMatchSnapshot();

      // Verify performance information excluding generation time
      const { generationTime, ...performanceWithoutTime } = result.performance;
      expect(performanceWithoutTime).toMatchSnapshot();
      expect(typeof generationTime).toBe("number");
      expect(generationTime).toBeGreaterThan(0);
    });

    it("should generate consistent code with custom name prefix", async () => {
      const grammar = createGrammarDefinition(
        "CustomPrefixGrammar",
        [],
        [
          createRuleDefinition("rule1", createStringLiteral("value1")),
          createRuleDefinition("rule2", createStringLiteral("value2")),
          createRuleDefinition(
            "rule3",
            createSequence([
              createIdentifier("rule1"),
              createStringLiteral(" "),
              createIdentifier("rule2"),
            ]),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "custom_prefix_",
        includeTypes: true,
        optimize: false,
      });

      // Snapshot test: Verify code with custom name prefix
      expect(result.code).toMatchSnapshot();
      expect(result.imports).toMatchSnapshot();
      expect(result.exports).toMatchSnapshot();

      // Verify performance information excluding generation time
      const { generationTime, ...performanceWithoutTime } = result.performance;
      expect(performanceWithoutTime).toMatchSnapshot();
      expect(typeof generationTime).toBe("number");
      expect(generationTime).toBeGreaterThan(0);
    });

    it("should generate consistent code with quantified expressions", async () => {
      const grammar = createGrammarDefinition(
        "QuantifiedGrammar",
        [],
        [
          createRuleDefinition(
            "exactly3",
            createQuantified(createStringLiteral("a"), 3, 3),
          ),
          createRuleDefinition(
            "range2to5",
            createQuantified(createStringLiteral("b"), 2, 5),
          ),
          createRuleDefinition(
            "minimum3",
            createQuantified(createStringLiteral("c"), 3),
          ),
          createRuleDefinition(
            "optional",
            createQuantified(createStringLiteral("d"), 0, 1),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "quant_",
        includeTypes: true,
        optimize: false,
      });

      // Snapshot test: Verify quantified expressions code
      expect(result.code).toMatchSnapshot();
      expect(result.imports).toMatchSnapshot();
      expect(result.exports).toMatchSnapshot();

      // Verify performance information excluding generation time
      const { generationTime, ...performanceWithoutTime } = result.performance;
      expect(performanceWithoutTime).toMatchSnapshot();
      expect(typeof generationTime).toBe("number");
      expect(generationTime).toBeGreaterThan(0);
    });

    it("should generate consistent code with lookahead expressions", async () => {
      const grammar = createGrammarDefinition(
        "LookaheadGrammar",
        [],
        [
          createRuleDefinition("positive", {
            type: "PositiveLookahead" as const,
            expression: createStringLiteral("a"),
          } as PositiveLookahead),
          createRuleDefinition("negative", {
            type: "NegativeLookahead" as const,
            expression: createStringLiteral("b"),
          } as NegativeLookahead),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "lookahead_",
        includeTypes: true,
        optimize: false,
      });

      // Snapshot test: Verify lookahead expressions code
      expect(result.code).toMatchSnapshot();
      expect(result.imports).toMatchSnapshot();
      expect(result.exports).toMatchSnapshot();

      // Verify performance information excluding generation time
      const { generationTime, ...performanceWithoutTime } = result.performance;
      expect(performanceWithoutTime).toMatchSnapshot();
      expect(typeof generationTime).toBe("number");
      expect(generationTime).toBeGreaterThan(0);
    });

    it("should generate consistent code with labeled expressions", async () => {
      const grammar = createGrammarDefinition(
        "LabeledGrammar",
        [],
        [
          createRuleDefinition("labeled", {
            type: "LabeledExpression" as const,
            label: "test_label",
            expression: createStringLiteral("value"),
          } as LabeledExpression),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: "labeled_",
        includeTypes: true,
        optimize: false,
      });

      // Snapshot test: Verify labeled expressions code
      expect(result.code).toMatchSnapshot();
      expect(result.imports).toMatchSnapshot();
      expect(result.exports).toMatchSnapshot();

      // Verify performance information excluding generation time
      const { generationTime, ...performanceWithoutTime } = result.performance;
      expect(performanceWithoutTime).toMatchSnapshot();
      expect(typeof generationTime).toBe("number");
      expect(generationTime).toBeGreaterThan(0);
    });
  });
});

// `generateGrammar` now runs `validateGrammarForEtaGenerator`
// (`grammar-validation.ts`) before generating any code -- previously this
// generator ran no structural validation at all, so a left-recursive
// grammar compiled to a parser that stack-overflowed at runtime, a
// duplicate rule name silently let the later declaration win, an
// unbounded repetition over a nullable body compiled to a parser that
// threw an infinite-loop error at runtime instead of being rejected at
// generation time, and a cut-only rule body (`~` on its own) compiled
// successfully to a parser that matched nothing. See that module's doc
// comment for why this is a duplicate of
// `packages/parser/src/grammar-validation.ts` rather than a shared import.
describe("EtaTPEGCodeGenerator: grammar validation", () => {
  it("rejects a left-recursive rule instead of generating a stack-overflowing parser", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createSequence([
              createIdentifier("start"),
              createStringLiteral("a"),
            ]),
            createStringLiteral("b"),
          ]),
        ),
      ],
    );

    await expect(generateEtaTypeScriptParser(grammar)).rejects.toThrow(
      /left-recursive/i,
    );
  });

  it("rejects duplicate rule names", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition("start", createStringLiteral("a")),
        createRuleDefinition("start", createStringLiteral("b")),
      ],
    );

    await expect(generateEtaTypeScriptParser(grammar)).rejects.toThrow(
      /duplicate rule/i,
    );
  });

  it("rejects an unbounded repetition over a nullable body", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "start",
          createStar(createOptional(createStringLiteral("a"))),
        ),
      ],
    );

    await expect(generateEtaTypeScriptParser(grammar)).rejects.toThrow(
      /unbounded repetition/i,
    );
  });

  it("rejects a rule body that is nothing but `~`", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [createRuleDefinition("start", { type: "Cut" } as Expression)],
    );

    await expect(generateEtaTypeScriptParser(grammar)).rejects.toThrow(
      /cannot be a rule body/i,
    );
  });

  it("does NOT reject an ordinary grammar", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createSequence([
              createStringLiteral("a"),
              createStringLiteral("b"),
            ]),
            createStringLiteral("c"),
          ]),
        ),
      ],
    );

    const result = await generateEtaTypeScriptParser(grammar, {
      includeImports: false,
      includeTypes: false,
    });
    expect(result.code).toContain("choice(");
  });
});
