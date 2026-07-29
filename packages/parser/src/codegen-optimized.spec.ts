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
  createGrammarDefinition,
  createIdentifier,
  createRuleDefinition,
  createStringLiteral,
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
});
