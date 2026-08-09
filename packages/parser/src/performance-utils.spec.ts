/**
 * Recursion Detection Tests
 *
 * `analyzeExpressionComplexity` cannot tell on its own whether a rule is
 * recursive -- a genuinely recursive PEG rule refers to itself (or a rule
 * that refers back to it) by name through an Identifier node, which looks
 * identical to any other rule reference from inside a single expression
 * tree. Real recursion can only be determined from the whole grammar's
 * rule dependency graph, which is what `analyzeGrammarPerformance` builds.
 */

import { describe, expect, it } from "bun:test";
import { analyzeGrammarPerformance } from "./performance-utils";
import {
  createChoice,
  createGrammarDefinition,
  createIdentifier,
  createRuleDefinition,
  createSequence,
  createStringLiteral,
} from "./types";

describe("analyzeGrammarPerformance recursion detection", () => {
  it("flags a directly self-referential rule as recursive", () => {
    // Expr = "a" | ("a" Expr)  -- classic right recursion
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "Expr",
          createChoice([
            createStringLiteral("a", '"'),
            createSequence([
              createStringLiteral("a", '"'),
              createIdentifier("Expr"),
            ]),
          ]),
        ),
      ],
    );

    const analysis = analyzeGrammarPerformance(grammar);
    const complexity = analysis.ruleComplexity.get("Expr");

    expect(complexity?.hasRecursion).toBe(true);
  });

  it("flags indirect (A -> B -> A) recursion, not just direct self-reference", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("A", createIdentifier("B")),
        createRuleDefinition("B", createIdentifier("A")),
      ],
    );

    const analysis = analyzeGrammarPerformance(grammar);

    expect(analysis.ruleComplexity.get("A")?.hasRecursion).toBe(true);
    expect(analysis.ruleComplexity.get("B")?.hasRecursion).toBe(true);
  });

  it("does not flag an ordinary, non-recursive reference to another rule", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("Digit", createStringLiteral("0", '"')),
        createRuleDefinition("Number", createIdentifier("Digit")),
      ],
    );

    const analysis = analyzeGrammarPerformance(grammar);

    expect(analysis.ruleComplexity.get("Digit")?.hasRecursion).toBe(false);
    expect(analysis.ruleComplexity.get("Number")?.hasRecursion).toBe(false);
  });

  it("surfaces a memoization suggestion only for the genuinely recursive rule", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("Digit", createStringLiteral("0", '"')),
        createRuleDefinition(
          "Expr",
          createChoice([
            createIdentifier("Digit"),
            createSequence([
              createIdentifier("Digit"),
              createIdentifier("Expr"),
            ]),
          ]),
        ),
      ],
    );

    const analysis = analyzeGrammarPerformance(grammar);

    expect(
      analysis.optimizationSuggestions.some((s) =>
        s.includes("'Expr' contains recursion"),
      ),
    ).toBe(true);
    expect(
      analysis.optimizationSuggestions.some((s) => s.includes("'Digit'")),
    ).toBe(false);
  });

  it("does not warn about left recursion for an ordinary right-recursive rule", () => {
    // Expr = "a" Expr / "a"  -- the self-reference only occurs after "a" has
    // already been consumed, so this is safe right recursion, not left
    // recursion.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "Expr",
          createChoice([
            createSequence([
              createStringLiteral("a", '"'),
              createIdentifier("Expr"),
            ]),
            createStringLiteral("a", '"'),
          ]),
        ),
      ],
    );

    const analysis = analyzeGrammarPerformance(grammar);

    expect(
      analysis.optimizationSuggestions.some((s) =>
        s.includes("left recursion"),
      ),
    ).toBe(false);
  });

  it("warns about left recursion when a rule references itself before consuming any input", () => {
    // Expr = Expr "a" / "a"  -- the self-reference is the first element of
    // the sequence, so it's tried at the same position with nothing
    // consumed: classic left recursion, which loops forever in a PEG parser.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "Expr",
          createChoice([
            createSequence([
              createIdentifier("Expr"),
              createStringLiteral("a", '"'),
            ]),
            createStringLiteral("a", '"'),
          ]),
        ),
      ],
    );

    const analysis = analyzeGrammarPerformance(grammar);

    expect(
      analysis.optimizationSuggestions.some(
        (s) => s.includes("'Expr'") && s.includes("left recursion"),
      ),
    ).toBe(true);
  });
});

describe("left recursion: end-to-end behavior", () => {
  // `analyzeGrammarPerformance`'s left-recursion check (above) is advisory
  // only -- a plain string in `optimizationSuggestions`. The actual gate is
  // `./grammar-validation.ts`'s `validateGrammar`, which both
  // `codegen.ts`/`codegen-optimized.ts` now call before doing anything
  // else: a left-recursive grammar is rejected with a synchronous `Error`
  // at GENERATION time, not compiled successfully only to overflow the
  // call stack once actually parsed against input (the previous behavior --
  // see git history for the version of this test that pinned that).
  //
  // Neither this project's PEG combinators (`packages/core/src/
  // combinators.ts`) nor `reference-interpreter.ts` (the differential-
  // fuzzing oracle, which guards against left recursion with its own
  // recursion-depth ceiling -- see `ReferenceInterpreterLimitError`)
  // implement Warth et al.'s bounded-growth left-recursion support, so
  // rejection (rather than silently accepting and mis-handling it) is the
  // correct behavior here.
  it("a left-recursive rule is rejected at generation time, before any code is produced", async () => {
    const { parse } = await import("@suzumiyaaoba/tpeg-core");
    const { grammarDefinition } = await import("./grammar");
    const { generateTypeScriptParser } = await import("./codegen");

    // Expr = Expr "+" [0-9]+ / [0-9]+ -- classic left recursion, flagged by
    // `analyzeGrammarPerformance` above AND hard-rejected by codegen.
    const source =
      'grammar G {\n  start = expr\n  expr = expr "+" [0-9]+ / [0-9]+\n}';
    const parsed = parse(grammarDefinition)(source);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(() =>
      generateTypeScriptParser(parsed.val, {
        includeImports: false,
        includeTypes: false,
      }),
    ).toThrow(/left-recursive/i);
  });
});
