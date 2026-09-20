/**
 * Tests for Eta Template Engine Based Code Generator
 */

import { describe, expect, it } from "vite-plus/test";
import {
  EtaTPEGCodeGenerator,
  generateEtaTypeScriptParser,
} from "./eta-generator";

// Import test utilities from core
import type { Cut } from "@suzumiyaaoba/tpeg-core";
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

function createCut(): Cut {
  return { type: "Cut" };
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
        'import { literal, untagCapture } from "@suzumiyaaoba/tpeg-core";',
      );
      expect(result.code).toContain(
        'export const test_hello: Parser<any> = untagCapture(literal("world"));',
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
        'import { negatedCharClass, untagCapture } from "@suzumiyaaoba/tpeg-core";',
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
        "export const main: Parser<any> = untagCapture(math.expr);",
      );
      expect(result.warnings).toEqual([
        expect.stringContaining('"main" references "math.expr"'),
      ]);
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
            // Not named "sequence": that's the actual `tpeg-core` import
            // this rule's own generated code needs, and `validateGeneratedIdentifiers`
            // (`packages/parser/src/grammar-validation.ts`) now rejects a
            // rule name that collides with it.
            "sequenceRule",
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
            // Not named "choice": see "sequenceRule"'s comment above --
            // same collision, this time with the `choice` import.
            "choiceRule",
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
            // Not named "optional": `Optional` generates to an `optional(...)`
            // call, so this rule name would collide with that import too
            // (unlike "star"/"plus", which generate to `zeroOrMore`/
            // `oneOrMore` -- no collision for those two names).
            "optionalRule",
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

      expect(result.code).toContain(
        'export const hello = untagCapture(literal("world"));',
      );
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

  it("rejects a rule named after the monitoring import instead of generating a duplicate-export SyntaxError (regression: validateGeneratedIdentifiers ran before generatePerformanceImports contributed its binding)", async () => {
    // `optimize: true` + `includeMonitoring: true` emits both
    // `import { globalPerformanceMonitor } from "@suzumiyaaoba/tpeg-
    // generator";` and, at the end, `export { globalPerformanceMonitor };`
    // (see `generatePerformanceImports`/`generateFooter`). A rule
    // literally named `globalPerformanceMonitor` used to slip past
    // `validateGeneratedIdentifiers` (which only saw `generateImports`'s
    // bindings, computed and checked before the performance import
    // existed) and generate a file `export const
    // globalPerformanceMonitor = ...;` colliding with both the import and
    // the later re-export -- a duplicate-declaration/duplicate-export
    // error from `tsc`/any bundler, not caught at generation time.
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "globalPerformanceMonitor",
          createStringLiteral("x"),
        ),
      ],
    );

    await expect(
      generateEtaTypeScriptParser(grammar, {
        optimize: true,
        includeMonitoring: true,
      }),
    ).rejects.toThrow(/globalPerformanceMonitor/);
  });

  it("includeMonitoring actually wraps each rule with a start/end-timing call (regression: the monitor was imported and re-exported but no rule ever invoked it)", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition("start", createIdentifier("word")),
        createRuleDefinition(
          "word",
          createPlus(createCharacterClass([createCharRange("a", "z")], false)),
        ),
      ],
    );

    for (const optimize of [false, true]) {
      const result = await generateEtaTypeScriptParser(grammar, {
        optimize,
        includeMonitoring: true,
        includeTypes: false,
      });

      expect(result.code).toContain(
        'import { globalPerformanceMonitor } from "@suzumiyaaoba/tpeg-generator";',
      );
      expect(result.code).toContain("export { globalPerformanceMonitor };");
      // Each rule is wrapped in the monitoring IIFE -- `__monitored`
      // holds the (possibly memoized/transformed) inner parser and the
      // returned arrow times every invocation.
      expect(result.code).toContain('globalPerformanceMonitor.start("start")');
      expect(result.code).toContain('globalPerformanceMonitor.start("word")');
      expect(result.code).toContain("const __monitored =");
    }
  });

  it("includeMonitoring: false emits no monitor references at all", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [createRuleDefinition("start", createStringLiteral("x"))],
    );

    const result = await generateEtaTypeScriptParser(grammar, {
      optimize: true,
      includeMonitoring: false,
    });

    expect(result.code).not.toContain("globalPerformanceMonitor");
    expect(result.code).not.toContain("__monitored");
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

  it("rejects a rule name that is a JS reserved word", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [createRuleDefinition("class", createStringLiteral("a"))],
    );

    await expect(generateEtaTypeScriptParser(grammar)).rejects.toThrow(
      /reserved word "class"/,
    );
  });

  it("rejects a rule name that collides with a combinator its own generated code imports", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition("main", createIdentifier("literal")),
        createRuleDefinition("literal", createStringLiteral("a")),
      ],
    );

    await expect(
      generateEtaTypeScriptParser(grammar, { includeImports: true }),
    ).rejects.toThrow(/collides with a runtime import/);
  });

  it("rejects a rule name colliding with an internal codegen name (__base/__result/__val)", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [createRuleDefinition("__base", createStringLiteral("a"))],
    );

    await expect(generateEtaTypeScriptParser(grammar)).rejects.toThrow(
      /code generator itself uses internally/,
    );
  });

  it("namePrefix makes an otherwise-reserved rule name safe", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [createRuleDefinition("class", createStringLiteral("a"))],
    );

    const result = await generateEtaTypeScriptParser(grammar, {
      includeImports: true,
      namePrefix: "g_",
    });
    expect(result.code).toContain("g_class");
  });
});

/**
 * `collectUsedCombinators` must import exactly the combinators
 * `generateExpressionCode`'s own generated code actually calls -- see
 * the identical regression coverage in `packages/parser/src/codegen.spec.ts`
 * for the shapes this targets (a Cut-then-single-element Sequence and a
 * single-alternative Choice, both bare passthroughs with no matching
 * combinator call; and a grammar with no `tpeg-core` combinator usage at
 * all, which used to emit an empty `import {  } from ...` line).
 */
describe("EtaTPEGCodeGenerator: import precision (regression)", () => {
  it("a Cut-then-single-element sequence does not import 'sequence' (bare passthrough)", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "start",
          createSequence([createCut(), createStringLiteral("a")]),
        ),
      ],
    );

    const result = await generateEtaTypeScriptParser(grammar, {
      includeImports: true,
      optimize: false,
    });
    expect(result.imports.join(" ")).not.toMatch(/\bsequence\b/);
    expect(result.code).toContain("commit(literal");
  });

  it("a single-alternative choice does not import 'choice' (bare passthrough)", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [createRuleDefinition("start", createChoice([createStringLiteral("a")]))],
    );

    const result = await generateEtaTypeScriptParser(grammar, {
      includeImports: true,
      optimize: false,
    });
    expect(result.imports.join(" ")).not.toMatch(/\bchoice\b/);
  });

  it("a trailing Cut with nothing after it (\"a\" ~) does not import 'commit' (regression: the import was keyed on a Cut existing, not on a commit() call being emitted)", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "start",
          createSequence([createStringLiteral("a"), createCut()]),
        ),
      ],
    );

    const result = await generateEtaTypeScriptParser(grammar, {
      includeImports: true,
      optimize: false,
    });
    expect(result.imports.join(" ")).not.toMatch(/\bcommit\b/);
    expect(result.code).not.toContain("commit(");
  });

  it("a mid-sequence Cut still imports 'commit' (control case)", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "start",
          createSequence([
            createStringLiteral("a"),
            createCut(),
            createStringLiteral("b"),
          ]),
        ),
      ],
    );

    const result = await generateEtaTypeScriptParser(grammar, {
      includeImports: true,
      optimize: false,
    });
    expect(result.imports.join(" ")).toMatch(/\bcommit\b/);
    expect(result.code).toContain('commit(literal("b"))');
  });

  it("emits each import statement on its own line (regression: Eta's nl autoTrim ate the newline after each `<%= imp %>`)", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [createRuleDefinition("start", createStringLiteral("a"))],
    );

    const result = await generateEtaTypeScriptParser(grammar, {
      includeImports: true,
      optimize: false,
    });
    const lines = result.code.split("\n");
    expect(lines[0]).toBe(
      'import type { Parser } from "@suzumiyaaoba/tpeg-core";',
    );
    expect(lines[1]).toBe(
      'import { literal, untagCapture } from "@suzumiyaaoba/tpeg-core";',
    );
  });

  it("a grammar with no tpeg-core combinator usage emits no empty tpeg-core import line", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [createRuleDefinition("start", createIdentifier("externalParser"))],
    );

    const result = await generateEtaTypeScriptParser(grammar, {
      includeImports: true,
      optimize: false,
    });
    expect(result.code).not.toContain("import {  }");
    // `untagCapture` is always imported -- every rule's exported parser is
    // wrapped to strip a residual CAPTURE_TAG at the rule boundary, and a
    // bare external-parser reference could itself return a tagged value.
    expect(
      result.imports.filter(
        (line) =>
          !line.startsWith("import type") &&
          line.includes('from "@suzumiyaaoba/tpeg-core";'),
      ),
    ).toEqual(['import { untagCapture } from "@suzumiyaaoba/tpeg-core";']);
  });

  it("rejects a rule name colliding with a referenced combinator even with includeImports: false", async () => {
    // `includeImports: false` suppresses the `import` lines, not the
    // combinator calls -- `sequence = "a" "b"` still emits
    // `sequence(literal("a"), literal("b"))`, so
    // `export const sequence = ...sequence(...)` would be a TDZ
    // `ReferenceError` at module evaluation. The collision check used to
    // look only at the (empty) emitted import list in this mode.
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "start",
          createSequence([
            createIdentifier("sequence"),
            createStringLiteral("x"),
          ]),
        ),
        createRuleDefinition(
          "sequence",
          createSequence([createStringLiteral("a"), createStringLiteral("b")]),
        ),
      ],
    );

    await expect(
      generateEtaTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
        optimize: false,
      }),
    ).rejects.toThrow(/collides with a runtime import/);
  });

  it("accepts a rule name matching an UNREFERENCED combinator with includeImports: false", async () => {
    // The check is against names the emitted code actually references:
    // `literal = [a-z]+` emits `charClass`/`plus` but never `literal(...)`,
    // so `const literal` collides with nothing and must keep generating.
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition("start", createIdentifier("literal")),
        createRuleDefinition(
          "literal",
          createPlus(createCharacterClass([createCharRange("a", "z")], false)),
        ),
      ],
    );

    await expect(
      generateEtaTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
        optimize: false,
      }),
    ).resolves.toBeDefined();
  });
});

describe("EtaTPEGCodeGenerator: @memoize annotation (regression)", () => {
  // Previously this generator never consulted `rule.annotations` at
  // all -- `shouldMemoize(_rule, complexity)` ignored its `_rule`
  // parameter -- so `@memoize` on a low-complexity, non-recursive rule
  // emitted no `memoize(...)` at all, silently ignoring the documented
  // annotation both parser-package generators honor.
  const annotatedGrammar = (value = "") =>
    createGrammarDefinition(
      "TestGrammar",
      [],
      [
        {
          ...createRuleDefinition("start", createStringLiteral("a")),
          annotations: [{ type: "GrammarAnnotation", key: "memoize", value }],
        },
      ],
    );

  it("a bare @memoize wraps a low-complexity rule AND imports memoize, on both templates", async () => {
    for (const optimize of [false, true]) {
      const result = await generateEtaTypeScriptParser(annotatedGrammar(), {
        includeImports: true,
        optimize,
      });
      expect(result.code).toContain("memoize(");
      expect(result.imports.join(" ")).toMatch(/\bmemoize\b/);
    }
  });

  it("@memoize applies even when enableMemoization: false (explicit annotation wins)", async () => {
    const result = await generateEtaTypeScriptParser(annotatedGrammar(), {
      includeImports: true,
      optimize: false,
      enableMemoization: false,
    });
    expect(result.code).toContain("memoize(");
    expect(result.imports.join(" ")).toMatch(/\bmemoize\b/);
  });

  it("@memoize: N bakes { maxCacheSize: N } into the wrap", async () => {
    const result = await generateEtaTypeScriptParser(annotatedGrammar("64"), {
      includeImports: false,
      optimize: false,
    });
    expect(result.code).toContain("{ maxCacheSize: 64 }");
  });

  it("generated code with an annotated rule compiles and parses", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");

    const result = await generateEtaTypeScriptParser(annotatedGrammar("8"), {
      includeImports: false,
      includeTypes: false,
      optimize: true,
    });
    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const scope = { ...combinator, ...core };
    const moduleFactory = new Function(
      ...Object.keys(scope),
      `${body}\nreturn { start };`,
    );
    const { start } = moduleFactory(...Object.values(scope)) as {
      start: import("@suzumiyaaoba/tpeg-core").Parser<unknown>;
    };
    const ok = start("a", 0);
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.next).toBe(1);
    expect(start("b", 0).success).toBe(false);
  });
});

describe("EtaTPEGCodeGenerator: @skip automatic whitespace", () => {
  // The `@skip: <name>` block annotation desugars sequence boundaries
  // into `ignore(optional(<skipRule>))` (see
  // `packages/parser/src/skip-desugar.ts`) -- the same shape both
  // parser-package generators emit. `ws` is declared AFTER the rules
  // that skip it so the generated `lazy(() => ws)` forward reference
  // is exercised too.
  const skipGrammar = () =>
    createGrammarDefinition(
      "TestGrammar",
      [{ type: "GrammarAnnotation", key: "skip", value: "ws" }],
      [
        createRuleDefinition(
          "start",
          createSequence([createStringLiteral("a"), createStringLiteral("b")]),
        ),
        {
          ...createRuleDefinition(
            "lexeme",
            createSequence([
              createStringLiteral("a"),
              createStringLiteral("b"),
            ]),
          ),
          annotations: [
            { type: "GrammarAnnotation", key: "noskip", value: "" },
          ],
        },
        createRuleDefinition(
          "ws",
          createStar(
            createCharacterClass(
              [createCharRange(" ", " "), createCharRange("\t", "\t")],
              false,
            ),
          ),
        ),
      ],
    );

  // Returns a `Record` keyed by the literal `ruleNames` (a generic
  // mapped type, so `mod.start` is a concrete `Parser`, not
  // `Parser | undefined` the way a `Record<string, _>` index lookup is
  // under `noUncheckedIndexedAccess`) -- verifying each name produced a
  // function along the way.
  const evalGenerated = async <N extends string>(
    code: string,
    ruleNames: readonly N[],
  ): Promise<Record<N, import("@suzumiyaaoba/tpeg-core").Parser<unknown>>> => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");
    const scope = { ...combinator, ...core };
    const body = code
      .replace(/^import[^\n]*\n?/gm, "")
      .replace(/^export const (\w+)(: Parser<[^>]*>)?/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(scope),
      `${body}\nreturn { ${ruleNames.join(", ")} };`,
    );
    const mod = moduleFactory(...Object.values(scope)) as Record<
      string,
      unknown
    >;
    const out = {} as Record<
      N,
      import("@suzumiyaaoba/tpeg-core").Parser<unknown>
    >;
    for (const name of ruleNames) {
      const parser = mod[name];
      if (typeof parser !== "function") {
        throw new Error(`generated module did not produce rule "${name}"`);
      }
      out[name] = parser as import("@suzumiyaaoba/tpeg-core").Parser<unknown>;
    }
    return out;
  };

  for (const optimize of [false, true]) {
    it(`emits ignore(optional(...)) boundary skips and imports them (optimize: ${optimize})`, async () => {
      const result = await generateEtaTypeScriptParser(skipGrammar(), {
        includeImports: true,
        optimize,
      });
      expect(result.code).toContain("ignore(optional(");
      expect(result.imports.join(" ")).toMatch(/\bignore\b/);
      expect(result.imports.join(" ")).toMatch(/\boptional\b/);
    });

    it(`generated parser skips whitespace at sequence boundaries, unchanged value shape (optimize: ${optimize})`, async () => {
      const result = await generateEtaTypeScriptParser(skipGrammar(), {
        includeImports: true,
        includeTypes: false,
        optimize,
      });
      const { start, lexeme } = await evalGenerated(result.code, [
        "start",
        "lexeme",
      ]);
      for (const input of ["ab", " ab", "a b", "ab ", "  a   b  ", "a\tb"]) {
        const parsed = start(input, 0);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          // Boundary skips contribute no slots to the result tuple.
          expect(parsed.val).toEqual(["a", "b"]);
          expect(parsed.next).toBe(input.length);
        }
      }
      expect(start("a  x", 0).success).toBe(false);
      // The @noskip rule skips nothing inside its own pattern.
      expect(lexeme("ab", 0).success).toBe(true);
      expect(lexeme("a b", 0).success).toBe(false);
    });
  }

  it("a single-element sequence keeps its bare value via map(...) unwrap", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [{ type: "GrammarAnnotation", key: "skip", value: "ws" }],
      [
        createRuleDefinition("start", createStringLiteral("x")),
        createRuleDefinition("ws", createStar(createStringLiteral(" "))),
      ],
    );
    const result = await generateEtaTypeScriptParser(grammar, {
      includeImports: true,
      includeTypes: false,
      optimize: false,
    });
    expect(result.code).toContain("map(sequence(");
    expect(result.imports.join(" ")).toMatch(/\bmap\b/);
    const { start } = await evalGenerated(result.code, ["start"]);
    const parsed = start("  x  ", 0);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.val).toBe("x");
      expect(parsed.next).toBe(5);
    }
  });

  it("a labeled sequence keeps its merged-capture object shape", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [{ type: "GrammarAnnotation", key: "skip", value: "ws" }],
      [
        createRuleDefinition(
          "start",
          createSequence([
            createLabeledExpression("x", createStringLiteral("a")),
            createLabeledExpression("y", createStringLiteral("b")),
          ]),
        ),
        createRuleDefinition("ws", createStar(createStringLiteral(" "))),
      ],
    );
    const result = await generateEtaTypeScriptParser(grammar, {
      includeImports: true,
      includeTypes: false,
      optimize: false,
    });
    const { start } = await evalGenerated(result.code, ["start"]);
    const parsed = start(" a  b ", 0);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.val).toEqual({ x: "a", y: "b" });
    }
  });
});

describe("EtaTPEGCodeGenerator: @expr span and \\b boundary", () => {
  // `Span` (`@expr`, source-text extraction) and `WordBoundary`
  // (`\b`/`\B`, zero-width assertion) -- the Eta generator emits the
  // same `span(child)` / bare `wordBoundary`/`nonWordBoundary` shapes
  // as `codegen.ts`'s `Span`/`WordBoundary` cases (see
  // `packages/parser/src/span-boundary.spec.ts` for the parse-side
  // coverage and the base/optimized generator parity checks).
  const evalGenerated = async <N extends string>(
    code: string,
    ruleNames: readonly N[],
  ): Promise<Record<N, import("@suzumiyaaoba/tpeg-core").Parser<unknown>>> => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");
    const scope = { ...combinator, ...core };
    const body = code
      .replace(/^import[^\n]*\n?/gm, "")
      .replace(/^export const (\w+)(: Parser<[^>]*>)?/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(scope),
      `${body}\nreturn { ${ruleNames.join(", ")} };`,
    );
    const mod = moduleFactory(...Object.values(scope)) as Record<
      string,
      unknown
    >;
    const out = {} as Record<
      N,
      import("@suzumiyaaoba/tpeg-core").Parser<unknown>
    >;
    for (const name of ruleNames) {
      const parser = mod[name];
      if (typeof parser !== "function") {
        throw new Error(`generated module did not produce rule "${name}"`);
      }
      out[name] = parser as import("@suzumiyaaoba/tpeg-core").Parser<unknown>;
    }
    return out;
  };

  const wordGrammar = () =>
    createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition("start", {
          type: "Sequence",
          elements: [
            { type: "WordBoundary", negated: false },
            {
              type: "LabeledExpression",
              label: "w",
              expression: {
                type: "Span",
                expression: {
                  type: "Plus",
                  expression: createCharacterClass(
                    [createCharRange("a", "z")],
                    false,
                  ),
                },
              },
            },
            { type: "WordBoundary", negated: false },
          ],
        }),
      ],
    );

  for (const optimize of [false, true]) {
    it(`emits span()/wordBoundary and imports them (optimize: ${optimize})`, async () => {
      const result = await generateEtaTypeScriptParser(wordGrammar(), {
        includeImports: true,
        includeTypes: false,
        optimize,
      });
      expect(result.code).toContain("span(");
      expect(result.code).toContain("wordBoundary");
      expect(result.imports.join(" ")).toMatch(/\bspan\b/);
      expect(result.imports.join(" ")).toMatch(/\bwordBoundary\b/);
    });

    it(`generated parser extracts text and asserts boundaries (optimize: ${optimize})`, async () => {
      const result = await generateEtaTypeScriptParser(wordGrammar(), {
        includeImports: true,
        includeTypes: false,
        optimize,
      });
      const { start } = await evalGenerated(result.code, ["start"]);
      const ok = start("hello", 0);
      expect(ok.success).toBe(true);
      if (ok.success) {
        expect(ok.val).toEqual({ w: "hello" });
        expect(ok.next).toBe(5);
      }
      expect(start("hello_world", 0).success).toBe(false);
      const bang = start("hello!", 0);
      expect(bang.success).toBe(true);
      if (bang.success) expect(bang.next).toBe(5);
    });
  }

  it("emits nonWordBoundary for \\B", async () => {
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition("start", {
          type: "Sequence",
          elements: [
            createStringLiteral("a"),
            { type: "WordBoundary", negated: true },
            createStringLiteral("b"),
          ],
        }),
      ],
    );
    const result = await generateEtaTypeScriptParser(grammar, {
      includeImports: true,
      includeTypes: false,
      optimize: false,
    });
    expect(result.code).toContain("nonWordBoundary");
    expect(result.imports.join(" ")).toMatch(/\bnonWordBoundary\b/);
  });
});
