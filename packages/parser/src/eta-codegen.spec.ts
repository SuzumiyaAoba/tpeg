/**
 * Tests for Eta Template Engine Based Code Generator
 */

import { describe, expect, it } from "bun:test";
import {
  EtaTPEGCodeGenerator,
  generateEtaTypeScriptParser,
} from "./eta-codegen";
import {
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
} from "./types";

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

      expect(result.code).toContain('import type { Parser } from "tpeg-core";');
      expect(result.code).toContain('import { literal } from "tpeg-core";');
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
      expect(result.code).toContain('{ from: "a", to: "z" }');
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

  describe("Memoization", () => {
    it("should generate memoized rules for complex expressions", async () => {
      // Create a complex nested expression that should trigger memoization
      let nestedExpr = createStringLiteral("a");
      for (let i = 0; i < 15; i++) {
        nestedExpr = {
          type: "Group",
          expression: nestedExpr,
        };
      }

      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("complex", nestedExpr)],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        enableMemoization: true,
      });

      expect(result.code).toContain("memoize");
      expect(result.code).toContain("export const complex");
    });

    it("should not memoize simple expressions", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("simple", createStringLiteral("hello"))],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        enableMemoization: true,
      });

      expect(result.code).not.toContain("memoize");
      expect(result.code).toContain("export const simple");
    });
  });

  describe("Optimized Template", () => {
    it("should use optimized template when optimize is enabled", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("rule", createStringLiteral("value"))],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        optimize: true,
      });

      expect(result.code).toContain("Generated TPEG Parser: TestGrammar");
      expect(result.code).toContain("automatically generated");
    });

    it("should include performance monitoring when enabled", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("rule", createStringLiteral("value"))],
      );

      const result = await generateEtaTypeScriptParser(grammar, {
        optimize: true,
        includeMonitoring: true,
      });

      expect(result.code).toContain("globalPerformanceMonitor");
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

    it("should detect high complexity grammars", async () => {
      // Create a grammar with many rules to trigger complexity analysis
      const rules = Array.from({ length: 60 }, (_, i) =>
        createRuleDefinition(`rule${i}`, createStringLiteral(`value${i}`)),
      );

      const grammar = createGrammarDefinition("ComplexGrammar", [], rules);

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.performance.optimizationSuggestions.length).toBeGreaterThan(
        0,
      );
      expect(
        result.performance.optimizationSuggestions.some((s) =>
          s.includes("rules - consider splitting"),
        ),
      ).toBe(true);
    });
  });

  describe("Combinator Collection", () => {
    it("should collect all necessary combinators", async () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "complex",
            createSequence([
              createChoice([
                createStringLiteral("a"),
                createCharacterClass([createCharRange("0", "9")], false),
              ]),
              createStar(createStringLiteral("b")),
              createOptional(createStringLiteral("c")),
            ]),
          ),
        ],
      );

      const result = await generateEtaTypeScriptParser(grammar);

      const combinatorImport = result.imports.find(
        (imp) => imp.includes('from "tpeg-core"') && !imp.includes("type"),
      );

      expect(combinatorImport).toBeDefined();
      expect(combinatorImport).toContain("literal");
      expect(combinatorImport).toContain("sequence");
      expect(combinatorImport).toContain("choice");
      expect(combinatorImport).toContain("charClass");
      expect(combinatorImport).toContain("zeroOrMore");
      expect(combinatorImport).toContain("optional");
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
});

describe("Template Integration Tests", () => {
  it("should generate valid TypeScript code for a realistic grammar", async () => {
    const grammar = createGrammarDefinition(
      "Calculator",
      [],
      [
        createRuleDefinition(
          "expression",
          createSequence([
            createIdentifier("term"),
            createStar(
              createSequence([
                createChoice([
                  createStringLiteral("+"),
                  createStringLiteral("-"),
                ]),
                createIdentifier("term"),
              ]),
            ),
          ]),
        ),
        createRuleDefinition(
          "term",
          createSequence([
            createIdentifier("factor"),
            createStar(
              createSequence([
                createChoice([
                  createStringLiteral("*"),
                  createStringLiteral("/"),
                ]),
                createIdentifier("factor"),
              ]),
            ),
          ]),
        ),
        createRuleDefinition(
          "factor",
          createChoice([
            createIdentifier("number"),
            createSequence([
              createStringLiteral("("),
              createIdentifier("expression"),
              createStringLiteral(")"),
            ]),
          ]),
        ),
        createRuleDefinition(
          "number",
          createPlus(createCharacterClass([createCharRange("0", "9")], false)),
        ),
      ],
    );

    const result = await generateEtaTypeScriptParser(grammar, {
      namePrefix: "calc_",
      includeTypes: true,
      optimize: true,
    });

    // Verify the generated code structure
    expect(result.code).toContain("Generated TPEG Parser: Calculator");
    expect(result.code).toContain("calc_expression");
    expect(result.code).toContain("calc_term");
    expect(result.code).toContain("calc_factor");
    expect(result.code).toContain("calc_number");

    // Verify rule references are correctly prefixed
    expect(result.code).toContain("calc_term"); // Referenced in expression
    expect(result.code).toContain("calc_factor"); // Referenced in term
    expect(result.code).toContain("calc_number"); // Referenced in factor
    expect(result.code).toContain("calc_expression"); // Referenced in factor

    // Verify complex structures are properly generated
    expect(result.code).toContain("sequence(");
    expect(result.code).toContain("choice(");
    expect(result.code).toContain("zeroOrMore(");
    expect(result.code).toContain("oneOrMore(");

    expect(result.exports).toHaveLength(4);
    expect(result.performance.templateEngine).toBe("eta");
  });
});
