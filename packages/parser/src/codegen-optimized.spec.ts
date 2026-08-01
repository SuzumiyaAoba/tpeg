/**
 * Optimized Code Generator Structural Correctness Tests
 *
 * These pin bugs found in `OptimizedTPEGCodeGenerator` that only show up
 * with more than one rule (the template cache was keyed without the rule
 * name, so every rule after the first got the first rule's name), with
 * memoized rules (double-wrapped `memoize(memoize(...))`), with import
 * generation (a duplicate/wrong `memoize` import from tpeg-core), and with
 * instance reuse across multiple `generateGrammar` calls.
 */

import { describe, expect, it } from "bun:test";
import {
  OptimizedTPEGCodeGenerator,
  generateOptimizedTypeScriptParser,
} from "./codegen-optimized";
import {
  createAnyChar,
  createCharRange,
  createCharacterClass,
  createChoice,
  createGrammarDefinition,
  createIdentifier,
  createLabeledExpression,
  createPlus,
  createQualifiedIdentifier,
  createRuleDefinition,
  createSequence,
  createStringLiteral,
  createTransformDefinition,
  createTransformFunction,
  createTransformParameter,
  createTransformReturnType,
  createTransformSet,
} from "./types";

describe("OptimizedTPEGCodeGenerator structural correctness", () => {
  it("gives every rule its own name, even when several rules share the same memoization/type-annotation shape", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("ruleA", createStringLiteral("a", '"')),
        createRuleDefinition("ruleB", createStringLiteral("b", '"')),
        createRuleDefinition("ruleC", createStringLiteral("c", '"')),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar);

    expect(result.code).toContain("export const ruleA");
    expect(result.code).toContain("export const ruleB");
    expect(result.code).toContain("export const ruleC");
    expect(result.code).toContain('literal("a")');
    expect(result.code).toContain('literal("b")');
    expect(result.code).toContain('literal("c")');
  });

  it("never wraps a memoized rule in memoize() twice", () => {
    // A large Sequence pushes estimated complexity to "high", which is one
    // of the two conditions that trigger memoization.
    const bigSequence = {
      type: "Sequence" as const,
      elements: Array.from({ length: 60 }, () => createStringLiteral("a", '"')),
    };
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [createRuleDefinition("big", bigSequence)],
    );

    const result = generateOptimizedTypeScriptParser(grammar);

    expect(result.code).toContain("memoize(");
    expect(result.code).not.toContain("memoize(memoize(");
  });

  it("imports memoize exactly once, from tpeg-combinator, never from tpeg-core", () => {
    const bigSequence = {
      type: "Sequence" as const,
      elements: Array.from({ length: 60 }, () => createStringLiteral("a", '"')),
    };
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [createRuleDefinition("big", bigSequence)],
    );

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: true,
    });

    expect(result.code).toContain(
      'import { memoize } from "@suzumiyaaoba/tpeg-combinator";',
    );
    const coreImportLine = result.code
      .split("\n")
      .find(
        (line) =>
          line.startsWith("import {") &&
          line.includes("@suzumiyaaoba/tpeg-core"),
      );
    expect(coreImportLine).toBeDefined();
    expect(coreImportLine).not.toContain("memoize");
  });

  it("does not leak rule names or cached templates across generateGrammar calls on a reused instance", () => {
    const generator = new OptimizedTPEGCodeGenerator({
      language: "typescript",
    });

    const grammarOne = createGrammarDefinition(
      "First",
      [],
      [createRuleDefinition("firstRule", createStringLiteral("first", '"'))],
    );
    const grammarTwo = createGrammarDefinition(
      "Second",
      [],
      [createRuleDefinition("secondRule", createStringLiteral("second", '"'))],
    );

    const resultOne = generator.generateGrammar(grammarOne);
    const resultTwo = generator.generateGrammar(grammarTwo);

    expect(resultOne.code).toContain("export const firstRule");
    expect(resultTwo.code).toContain("export const secondRule");
    // The rule-shape template cache is keyed only on
    // (includeTypes, shouldMemoize), which is identical for both single,
    // non-memoized rules here -- a generator that leaks its cache across
    // calls would bake "firstRule" into the second grammar's output too.
    expect(resultTwo.code).not.toContain("firstRule");
  });

  it("does not leak which rule names are locally defined across generateGrammar calls", () => {
    const generator = new OptimizedTPEGCodeGenerator({
      language: "typescript",
      namePrefix: "g_",
    });

    // "foo" is a local rule here, so a reference to it must be prefixed.
    const grammarWithLocalFoo = createGrammarDefinition(
      "One",
      [],
      [
        createRuleDefinition("foo", createStringLiteral("x", '"')),
        createRuleDefinition("bar", createIdentifier("foo")),
      ],
    );
    // "foo" is NOT defined here, so a reference to it must stay bare --
    // if the first call's ruleNames leaked into this one, it would be
    // wrongly prefixed as if it were local.
    const grammarWithExternalFoo = createGrammarDefinition(
      "Two",
      [],
      [createRuleDefinition("baz", createIdentifier("foo"))],
    );

    generator.generateGrammar(grammarWithLocalFoo);
    const result = generator.generateGrammar(grammarWithExternalFoo);

    expect(result.code).toContain("export const g_baz");
    expect(result.code).toContain("= foo;");
    expect(result.code).not.toContain("g_foo");
  });

  it("generates character class / negated character class / AnyChar code that actually parses input", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");

    const grammar = createGrammarDefinition(
      "Test",
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
    );

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: true,
    });

    expect(result.code).toContain('charClass(["a", "z"])');
    expect(result.code).toContain('negatedCharClass(["0", "9"])');
    expect(result.code).toContain("anyChar()");

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

  it("generates a namespaced reference for a qualified (cross-module) identifier", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [createRuleDefinition("main", createQualifiedIdentifier("math", "expr"))],
    );

    const result = generateOptimizedTypeScriptParser(grammar);

    expect(result.code).toContain(
      "export const main: Parser<any> = math.expr;",
    );
  });

  it("applies a matching TypeScript transform function to a rule's parse result", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");

    const grammar = createGrammarDefinition(
      "Test",
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

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: true,
    });

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

  it("preserves declaration order of Choice alternatives instead of sorting by AST size", async () => {
    // PEG's ordered choice (`/`) is defined by "first alternative that
    // matches wins" -- declaration order is part of the grammar's
    // semantics. This pins the fix for a bug where the optimized
    // generator sorted `choice()` arguments by AST node count ("simple
    // first"), which silently changes which language is accepted: a
    // grammar for `"==" / "="` (modeled here as `seq("=", "=") / "="`, so
    // the two alternatives have different node counts) would have its
    // alternatives reordered to `"=" / "=="`, making `==` unmatchable --
    // the shorter alternative would now be tried, and would succeed,
    // before the longer one ever got a chance.
    const core = await import("@suzumiyaaoba/tpeg-core");

    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "op",
          createChoice([
            createSequence([
              createStringLiteral("=", '"'),
              createStringLiteral("=", '"'),
            ]),
            createStringLiteral("=", '"'),
          ]),
        ),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: true,
      optimize: true,
    });

    const body = result.code
      .replace(/^import[^\n]*\n?/gm, "")
      .replace(/^export const (\w+): Parser<[^>]*>/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      `${body}\nreturn { op };`,
    );
    const { op } = moduleFactory(...Object.values(core));

    const pos = { offset: 0, column: 0, line: 1 };
    const parsed = op("==", pos);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Must consume both "=" characters (the first, longer alternative),
      // not just one (which the buggy nodeCount-ascending sort would try
      // first since a single StringLiteral has a smaller AST than the
      // Sequence).
      expect(parsed.next.offset).toBe(2);
    }
  });
});
