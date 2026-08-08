/**
 * Correctness tests for the AST rewrites in `ast-optimize.ts`:
 * `leftFactorChoices`, `mergeCharacterClasses`, and
 * `degenerateNegativeLookaheads`.
 *
 * The core claim under test for each: the rewrite changes generated code
 * (fewer repeated sub-parses, or a cheaper node) without changing which
 * inputs are accepted or where a successful parse stops. `.val` shape is
 * explicitly NOT compared for `leftFactorChoices`/
 * `degenerateNegativeLookaheads` output (see ast-optimize.ts's module doc
 * comment for why that's an accepted, documented difference);
 * `mergeCharacterClasses` never changes `.val` shape, so its equivalence
 * test does compare `.val`.
 */

import { describe, expect, it } from "bun:test";
import {
  applyAstOptimizations,
  degenerateNegativeLookaheads,
  insertAutomaticCuts,
  leftFactorChoices,
  mergeCharacterClasses,
  promoteGlobalCuts,
} from "./ast-optimize";
import { generateTypeScriptParser } from "./codegen";
import { analyzeFirstSets } from "./first-sets";
import { grammarDefinition } from "./grammar";
import {
  createActionExpression,
  createAnyChar,
  createCharRange,
  createCharacterClass,
  createChoice,
  createCut,
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
import type { Expression, GrammarDefinition } from "./types";

const ORIGIN = 0;

/** Compiles `grammar` to a runnable parser bound to `ruleName`, the same
 * `new Function`-based pattern `leftFactorChoices`'s differential test
 * below uses. Module-level (rather than redefined per test) since
 * `insertAutomaticCuts`'s tests need it in several places. */
async function compileRuleFor(grammar: GrammarDefinition, ruleName: string) {
  const core = await import("@suzumiyaaoba/tpeg-core");
  const generated = generateTypeScriptParser(grammar, {
    includeImports: false,
    includeTypes: false,
  });
  const body = generated.code.replace(/^export const (\w+)/gm, "const $1");
  const ruleNames = [...generated.code.matchAll(/^export const (\w+)/gm)].map(
    (m) => m[1] as string,
  );
  const factory = new Function(
    ...Object.keys(core),
    `${body}\nreturn { ${ruleNames.join(", ")} };`,
  );
  const built = factory(...Object.values(core)) as Record<
    string,
    (
      input: string,
      pos: number,
    ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>
  >;
  return built[ruleName] as (
    input: string,
    pos: number,
  ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;
}

const UNFACTORED_ARITHMETIC_GRAMMAR = `
grammar Arith {
  expr = sum
  sum = product "+" sum / product "-" sum / product
  product = atom "*" product / atom "/" product / atom
  atom = "(" sum ")" / number
  number = [0-9]+
}
`;

describe("leftFactorChoices", () => {
  it("factors a Choice whose alternatives share an Identifier prefix", () => {
    const parsed = grammarDefinition(UNFACTORED_ARITHMETIC_GRAMMAR, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const factored = leftFactorChoices(parsed.val);
    const sumRule = factored.rules.find((r) => r.name === "sum");
    expect(sumRule).toBeDefined();
    // Factored shape: Sequence[ product, Optional[ Choice[ Sequence["+",sum], Sequence["-",sum] ] ] ]
    // -- the trailing bare "product" alternative is folded into an
    // `Optional` around the inner choice rather than kept as a second
    // top-level alternative (see doc comment on tryLeftFactorChoice).
    expect(sumRule?.pattern.type).toBe("Sequence");
    if (sumRule?.pattern.type !== "Sequence") return;
    expect(sumRule.pattern.elements).toHaveLength(2);
    const [prefix, optionalPart] = sumRule.pattern.elements;
    expect(prefix).toEqual(createIdentifier("product"));
    expect(optionalPart?.type).toBe("Optional");
    if (optionalPart?.type === "Optional") {
      expect(optionalPart.expression.type).toBe("Choice");
    }
  });

  it("produces code that parses identically to the unfactored grammar for a battery of inputs", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");

    const parsed = grammarDefinition(UNFACTORED_ARITHMETIC_GRAMMAR, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const originalGrammar = parsed.val;
    const factoredGrammar = leftFactorChoices(originalGrammar);

    const compileExpr = (grammar: GrammarDefinition) => {
      const generated = generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      });
      const body = generated.code.replace(/^export const (\w+)/gm, "const $1");
      const ruleNames = [
        ...generated.code.matchAll(/^export const (\w+)/gm),
      ].map((m) => m[1] as string);
      const factory = new Function(
        ...Object.keys(core),
        `${body}\nreturn { ${ruleNames.join(", ")} };`,
      );
      const built = factory(...Object.values(core)) as Record<
        string,
        (
          input: string,
          pos: number,
        ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>
      >;
      return built["expr"] as (
        input: string,
        pos: number,
      ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;
    };

    const originalExpr = compileExpr(originalGrammar);
    const factoredExpr = compileExpr(factoredGrammar);

    const inputs = [
      "1",
      "12",
      "1+2",
      "1-2",
      "1*2",
      "1/2",
      "1+2*3",
      "(1+2)*3",
      "1*2*3*4",
      "1+2+3+4",
      "1*2+3*4-5/6",
      "(1)",
      "((1))",
      "(((1)))",
      "1+",
      "+1",
      "",
      "abc",
      "1+2*",
      "1+2+3*4*5-6/7+8",
    ];

    for (const input of inputs) {
      const originalResult = originalExpr(input, ORIGIN);
      const factoredResult = factoredExpr(input, ORIGIN);

      expect(factoredResult.success).toBe(originalResult.success);
      if (originalResult.success && factoredResult.success) {
        expect(factoredResult.next).toEqual(originalResult.next);
      }
    }
  });

  it("does not factor a Choice containing a LabeledExpression", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "sum",
          createChoice([
            createSequence([
              createLabeledExpression("p", createIdentifier("product")),
              createStringLiteral("+", '"'),
              createIdentifier("sum"),
            ]),
            createIdentifier("product"),
          ]),
        ),
      ],
    );

    const factored = leftFactorChoices(grammar);
    expect(factored.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("does not factor any choice in a rule containing an ActionExpression anywhere", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "sum",
          createActionExpression(
            createChoice([
              createSequence([
                createIdentifier("product"),
                createStringLiteral("+", '"'),
                createIdentifier("sum"),
              ]),
              createIdentifier("product"),
            ]),
            "return $$;",
          ),
        ),
      ],
    );

    const factored = leftFactorChoices(grammar);
    expect(factored.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("does not factor a rule with a matching transforms function", () => {
    const pattern = createChoice([
      createSequence([
        createIdentifier("product"),
        createStringLiteral("+", '"'),
        createIdentifier("sum"),
      ]),
      createIdentifier("product"),
    ]);
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [createRuleDefinition("sum", pattern)],
      [
        createTransformDefinition(
          createTransformSet("T", "typescript", [
            createTransformFunction(
              "sum",
              [createTransformParameter("captures", "unknown")],
              createTransformReturnType("Result", "unknown"),
              "return captures;",
            ),
          ]),
        ),
      ],
    );

    const factored = leftFactorChoices(grammar);
    expect(factored.rules[0]?.pattern).toEqual(pattern);
  });

  it("does not factor when a bare-prefix alternative isn't last", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "sum",
          createChoice([
            createIdentifier("product"),
            createSequence([
              createIdentifier("product"),
              createStringLiteral("+", '"'),
              createIdentifier("sum"),
            ]),
          ]),
        ),
      ],
    );

    const factored = leftFactorChoices(grammar);
    expect(factored.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("does not factor when more than one alternative is the bare prefix", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "sum",
          createChoice([
            createIdentifier("product"),
            createIdentifier("product"),
          ]),
        ),
      ],
    );

    const factored = leftFactorChoices(grammar);
    expect(factored.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("does not factor when prefixes differ", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "sum",
          createChoice([
            createSequence([
              createIdentifier("product"),
              createStringLiteral("+", '"'),
            ]),
            createSequence([
              createIdentifier("term"),
              createStringLiteral("-", '"'),
            ]),
          ]),
        ),
      ],
    );

    const factored = leftFactorChoices(grammar);
    expect(factored.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("does not treat a Sequence/Group/Choice as a factorable prefix even if structurally identical", () => {
    const sharedGroup = createGroup(createStringLiteral("x", '"'));
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createSequence([sharedGroup, createStringLiteral("a", '"')]),
            createSequence([
              createGroup(createStringLiteral("x", '"')),
              createStringLiteral("b", '"'),
            ]),
          ]),
        ),
      ],
    );

    const factored = leftFactorChoices(grammar);
    expect(factored.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("factors a CharacterClass shared prefix", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createSequence([
              createCharacterClass([createCharRange("a", "z")], false),
              createStringLiteral("1", '"'),
            ]),
            createSequence([
              createCharacterClass([createCharRange("a", "z")], false),
              createStringLiteral("2", '"'),
            ]),
          ]),
        ),
      ],
    );

    const factored = leftFactorChoices(grammar);
    const pattern = factored.rules[0]?.pattern;
    expect(pattern?.type).toBe("Sequence");
    if (pattern?.type === "Sequence") {
      expect(pattern.elements[0]?.type).toBe("CharacterClass");
      expect(pattern.elements[1]?.type).toBe("Choice");
    }
  });

  it("factors an AnyChar shared prefix", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createSequence([createAnyChar(), createStringLiteral("1", '"')]),
            createSequence([createAnyChar(), createStringLiteral("2", '"')]),
          ]),
        ),
      ],
    );

    const factored = leftFactorChoices(grammar);
    expect(factored.rules[0]?.pattern.type).toBe("Sequence");
  });

  it("factors a QualifiedIdentifier shared prefix", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createSequence([
              createQualifiedIdentifier("math", "expr"),
              createStringLiteral("1", '"'),
            ]),
            createSequence([
              createQualifiedIdentifier("math", "expr"),
              createStringLiteral("2", '"'),
            ]),
          ]),
        ),
      ],
    );

    const factored = leftFactorChoices(grammar);
    expect(factored.rules[0]?.pattern.type).toBe("Sequence");
  });

  it("recurses into nested expressions (e.g. inside a Star)", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createStar(
            createChoice([
              createSequence([
                createIdentifier("x"),
                createStringLiteral("1", '"'),
              ]),
              createSequence([
                createIdentifier("x"),
                createStringLiteral("2", '"'),
              ]),
            ]),
          ),
        ),
      ],
    );

    const factored = leftFactorChoices(grammar);
    const pattern = factored.rules[0]?.pattern;
    expect(pattern?.type).toBe("Star");
    if (pattern?.type === "Star") {
      expect(pattern.expression.type).toBe("Sequence");
    }
  });
});

/** Compiles `grammar`'s `ruleName` rule to a runnable parser via
 * `new Function`, the same pattern used throughout this file and
 * `codegen-optimized.spec.ts`. */
async function compileRuleForTest(
  grammar: GrammarDefinition,
  ruleName: string,
) {
  const core = await import("@suzumiyaaoba/tpeg-core");
  const generated = generateTypeScriptParser(grammar, {
    includeImports: false,
    includeTypes: false,
  });
  const body = generated.code.replace(/^export const (\w+)/gm, "const $1");
  const ruleNames = [...generated.code.matchAll(/^export const (\w+)/gm)].map(
    (m) => m[1] as string,
  );
  const factory = new Function(
    ...Object.keys(core),
    `${body}\nreturn { ${ruleNames.join(", ")} };`,
  );
  const built = factory(...Object.values(core)) as Record<
    string,
    (
      input: string,
      pos: number,
    ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>
  >;
  return built[ruleName] as (
    input: string,
    pos: number,
  ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;
}

describe("mergeCharacterClasses", () => {
  it("merges two adjacent non-negated CharacterClass alternatives into one", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createCharacterClass([createCharRange("a", "z")], false),
            createCharacterClass([createCharRange("A", "Z")], false),
          ]),
        ),
      ],
    );

    const merged = mergeCharacterClasses(grammar);
    const pattern = merged.rules[0]?.pattern;
    expect(pattern?.type).toBe("CharacterClass");
    if (pattern?.type === "CharacterClass") {
      expect(pattern.negated).toBe(false);
      expect(pattern.ranges).toEqual([
        createCharRange("a", "z"),
        createCharRange("A", "Z"),
      ]);
    }
  });

  it("merges a run of three, and folds in a single-character StringLiteral", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createCharacterClass([createCharRange("a", "z")], false),
            createCharacterClass([createCharRange("A", "Z")], false),
            createStringLiteral("_", '"'),
          ]),
        ),
      ],
    );

    const merged = mergeCharacterClasses(grammar);
    const pattern = merged.rules[0]?.pattern;
    expect(pattern?.type).toBe("CharacterClass");
    if (pattern?.type === "CharacterClass") {
      expect(pattern.ranges).toEqual([
        createCharRange("a", "z"),
        createCharRange("A", "Z"),
        { start: "_" },
      ]);
    }
  });

  it("leaves negated character classes untouched", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createCharacterClass([createCharRange("a", "z")], true),
            createCharacterClass([createCharRange("A", "Z")], true),
          ]),
        ),
      ],
    );

    const merged = mergeCharacterClasses(grammar);
    expect(merged.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("merges only the adjacent run, leaving an interleaved non-mergeable alternative and an isolated mergeable one in place", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createCharacterClass([createCharRange("a", "z")], false),
            createCharacterClass([createCharRange("A", "Z")], false),
            createIdentifier("other"),
            createCharacterClass([createCharRange("0", "9")], false),
          ]),
        ),
      ],
    );

    const merged = mergeCharacterClasses(grammar);
    const pattern = merged.rules[0]?.pattern;
    expect(pattern?.type).toBe("Choice");
    if (pattern?.type === "Choice") {
      expect(pattern.alternatives).toHaveLength(3);
      expect(pattern.alternatives[0]?.type).toBe("CharacterClass");
      if (pattern.alternatives[0]?.type === "CharacterClass") {
        expect(pattern.alternatives[0].ranges).toEqual([
          createCharRange("a", "z"),
          createCharRange("A", "Z"),
        ]);
      }
      expect(pattern.alternatives[1]).toEqual(createIdentifier("other"));
      // Lone mergeable alternative with no adjacent partner: left as the
      // original node, not converted into a trivial 1-range merge.
      expect(pattern.alternatives[2]).toEqual(
        createCharacterClass([createCharRange("0", "9")], false),
      );
    }
  });

  it("recurses into nested expressions (e.g. inside a Group)", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createGroup(
            createChoice([
              createCharacterClass([createCharRange("a", "z")], false),
              createCharacterClass([createCharRange("A", "Z")], false),
            ]),
          ),
        ),
      ],
    );

    const merged = mergeCharacterClasses(grammar);
    const pattern = merged.rules[0]?.pattern;
    expect(pattern?.type).toBe("Group");
    if (pattern?.type === "Group") {
      expect(pattern.expression.type).toBe("CharacterClass");
    }
  });

  it("produces code that parses identically on success -- same .val, same .next -- since this rewrite never changes value shape", async () => {
    // Failure *diagnostics* are allowed to differ (a `choice` of two
    // classes reports a different parserName/message/expected shape than
    // a single merged `charClass` does) -- only the success path's
    // outcome, and whether a given input succeeds at all, is the claim
    // this rewrite makes.
    const original = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "letter",
          createChoice([
            createCharacterClass([createCharRange("a", "z")], false),
            createCharacterClass([createCharRange("A", "Z")], false),
          ]),
        ),
      ],
    );
    const merged = mergeCharacterClasses(original);

    const originalParser = await compileRuleForTest(original, "letter");
    const mergedParser = await compileRuleForTest(merged, "letter");

    for (const input of ["a", "z", "A", "Z", "5", "_", ""]) {
      const originalResult = originalParser(input, ORIGIN);
      const mergedResult = mergedParser(input, ORIGIN);
      expect(mergedResult.success).toBe(originalResult.success);
      if (originalResult.success && mergedResult.success) {
        expect(mergedResult.val).toEqual(originalResult.val);
        expect(mergedResult.next).toEqual(originalResult.next);
      }
    }
  });
});

describe("degenerateNegativeLookaheads", () => {
  it("degenerates `!charClass .` into a negated CharacterClass", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(
              createCharacterClass([createCharRange("0", "9")], false),
            ),
            createAnyChar(),
          ]),
        ),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    const pattern = result.rules[0]?.pattern;
    expect(pattern?.type).toBe("CharacterClass");
    if (pattern?.type === "CharacterClass") {
      expect(pattern.negated).toBe(true);
      expect(pattern.ranges).toEqual([createCharRange("0", "9")]);
    }
  });

  it("degenerates `!singleCharLiteral .` into a negated single-character CharacterClass", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(createStringLiteral('"', '"')),
            createAnyChar(),
          ]),
        ),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    const pattern = result.rules[0]?.pattern;
    expect(pattern?.type).toBe("CharacterClass");
    if (pattern?.type === "CharacterClass") {
      expect(pattern.negated).toBe(true);
      expect(pattern.ranges).toEqual([{ start: '"' }]);
    }
  });

  it("does not degenerate a multi-character string literal lookahead", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(createStringLiteral("ab", '"')),
            createAnyChar(),
          ]),
        ),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    expect(result.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("does not degenerate when the following element is an external/undefined rule reference -- neither clause can prove anything about it", () => {
    // `other` is never defined in this grammar -- an unresolved
    // Identifier gets `unknown` FIRST-set treatment, and
    // `firstSetsDisjoint` always returns `false` when either side is
    // `unknown` (the safe direction), so clause 2 correctly declines.
    // Clause 1 doesn't apply either: an Identifier isn't a
    // single-code-point CharSet view.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(
              createCharacterClass([createCharRange("0", "9")], false),
            ),
            createIdentifier("other"),
          ]),
        ),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    expect(result.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("generalizes past AnyChar: `!charClass singleCharLiteral` also degenerates into a CharacterClass, since a 1-character StringLiteral is a single-code-point CharSet too", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(
              createCharacterClass([createCharRange("0", "9")], false),
            ),
            createStringLiteral("x", '"'),
          ]),
        ),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    const pattern = result.rules[0]?.pattern;
    expect(pattern?.type).toBe("CharacterClass");
    if (pattern?.type === "CharacterClass") {
      // "x" is not a digit, so the difference {x} \ digits is just {x}
      // unchanged -- semantically identical to the original literal "x",
      // just represented as a (non-negated, since that's the smaller
      // encoding) single-character class.
      expect(pattern.negated).toBe(false);
      expect(pattern.ranges).toEqual([{ start: "x" }]);
    }
  });

  it("degenerates via character-set difference even when the excluded and target sets OVERLAP -- a case FIRST-set disjointness alone could never simplify", () => {
    // !"\n" [^x]  ->  [^x\n]
    // Neither set is a subset of the other (both exclude different
    // things), so no "these are disjoint" argument applies -- this is
    // exactly the capability clause 1 has that a FIRST-set-only approach
    // doesn't.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(createStringLiteral("\n", '"')),
            createCharacterClass([createCharRange("x", "x")], true),
          ]),
        ),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    const pattern = result.rules[0]?.pattern;
    expect(pattern?.type).toBe("CharacterClass");
    if (pattern?.type === "CharacterClass") {
      expect(pattern.negated).toBe(true);
      expect(
        pattern.ranges.sort((a, b) => a.start.localeCompare(b.start)),
      ).toEqual(
        [{ start: "\n" }, { start: "x" }].sort((a, b) =>
          a.start.localeCompare(b.start),
        ),
      );
    }
  });

  it("does not degenerate via clause 1 when the resulting set would be empty -- the pattern can never match, and synthesizing a never-matching node isn't this pass's job", () => {
    // !"a" "a": excluding "a", then requiring exactly "a" -- provably
    // unsatisfiable. Left untouched rather than emitting a
    // CharacterClass with zero ranges (which downstream codegen, e.g.
    // charClass(...NonEmptyArray<...>), doesn't accept).
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(createStringLiteral("a", '"')),
            createStringLiteral("a", '"'),
          ]),
        ),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    expect(result.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("clause 2: deletes a redundant `!a` when `a`/`b` are both non-nullable and FIRST-disjoint, even though `b` isn't a single-code-point CharSet (a multi-character literal)", () => {
    // !"//" "/*"  ->  "/*"   (FIRST("//") = {/}, FIRST("/*") = {/} --
    // NOT disjoint by first character alone, so pick a pair that IS.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(createStringLiteral("ab", '"')),
            createStringLiteral("xy", '"'),
          ]),
        ),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    expect(result.rules[0]?.pattern).toEqual(createStringLiteral("xy", '"'));
  });

  it("clause 2 does not fire when FIRST sets are NOT disjoint", () => {
    // "ab" and "ac" both start with "a" -- FIRST sets overlap.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(createStringLiteral("ab", '"')),
            createStringLiteral("ac", '"'),
          ]),
        ),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    expect(result.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("clause 2 does not fire when either side is nullable", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(
              createOptional(createStringLiteral("ab", '"')),
            ),
            createStringLiteral("xy", '"'),
          ]),
        ),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    expect(result.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("produces code that parses identically to the un-degenerated grammar for the overlapping-sets case, across inputs that discriminate a wrong implementation", async () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(createStringLiteral("\n", '"')),
            createCharacterClass([createCharRange("x", "x")], true),
          ]),
        ),
      ],
    );
    const degenerated = degenerateNegativeLookaheads(grammar);

    const unfused = await compileRuleFor(grammar, "r");
    const fused = await compileRuleFor(degenerated, "r");

    // `.val` is NOT compared here -- see this file's header comment:
    // `degenerateNegativeLookaheads` deliberately changes value shape
    // (2 tuple slots -> 1), the same documented, accepted difference
    // `leftFactorChoices` has. Only accept/reject and stop position are
    // required to match.
    for (const input of ["a", "x", "\n", "", "y"]) {
      const unfusedResult = unfused(input, ORIGIN);
      const fusedResult = fused(input, ORIGIN);
      expect(fusedResult.success).toBe(unfusedResult.success);
      if (unfusedResult.success && fusedResult.success) {
        expect(fusedResult.next).toEqual(unfusedResult.next);
      }
    }
    // The degenerated shape itself: a single matched character, not a
    // `[undefined, char]` tuple.
    const degeneratedResult = fused("a", ORIGIN);
    expect(degeneratedResult.success).toBe(true);
    if (degeneratedResult.success) expect(degeneratedResult.val).toBe("a");
  });

  it("does not degenerate within a rule containing an ActionExpression anywhere", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createActionExpression(
            createSequence([
              createNegativeLookahead(
                createCharacterClass([createCharRange("0", "9")], false),
              ),
              createAnyChar(),
            ]),
            "return $$;",
          ),
        ),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    expect(result.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("does not degenerate a rule with a matching transforms function", () => {
    const pattern = createSequence([
      createNegativeLookahead(
        createCharacterClass([createCharRange("0", "9")], false),
      ),
      createAnyChar(),
    ]);
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [createRuleDefinition("r", pattern)],
      [
        createTransformDefinition(
          createTransformSet("T", "typescript", [
            createTransformFunction(
              "r",
              [createTransformParameter("captures", "unknown")],
              createTransformReturnType("Result", "unknown"),
              "return captures;",
            ),
          ]),
        ),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    expect(result.rules[0]?.pattern).toEqual(pattern);
  });

  it("recurses into nested expressions (e.g. inside a Plus)", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("r", {
          type: "Plus",
          expression: createSequence([
            createNegativeLookahead(createStringLiteral('"', '"')),
            createAnyChar(),
          ]),
        }),
      ],
    );

    const result = degenerateNegativeLookaheads(grammar);
    const pattern = result.rules[0]?.pattern;
    expect(pattern?.type).toBe("Plus");
    if (pattern?.type === "Plus") {
      expect(pattern.expression.type).toBe("CharacterClass");
    }
  });

  it("produces code that parses identically to `!a .` for a battery of inputs (accept/stop-position, not .val)", async () => {
    // `("\"" (!"\"" .)* "\"")` -- a classic quoted-string body written
    // with a negative lookahead instead of a negated character class.
    const original = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "quoted",
          createSequence([
            createStringLiteral('"', '"'),
            {
              type: "Star",
              expression: createSequence([
                createNegativeLookahead(createStringLiteral('"', '"')),
                createAnyChar(),
              ]),
            },
            createStringLiteral('"', '"'),
          ]),
        ),
      ],
    );
    const degenerated = degenerateNegativeLookaheads(original);

    const originalParser = await compileRuleForTest(original, "quoted");
    const degeneratedParser = await compileRuleForTest(degenerated, "quoted");

    for (const input of ['""', '"a"', '"abc"', '"ab', "abc", '"a"b"', ""]) {
      const originalResult = originalParser(input, ORIGIN);
      const degeneratedResult = degeneratedParser(input, ORIGIN);
      expect(degeneratedResult.success).toBe(originalResult.success);
      if (originalResult.success && degeneratedResult.success) {
        expect(degeneratedResult.next).toEqual(originalResult.next);
      }
    }
  });

  it("clause 1 (character-set difference) handles an astral (surrogate-pair) code point in the excluded set correctly", async () => {
    // `!"\u{1F600}" .` -- U+1F600 is 2 UTF-16 code units. `charSetView`
    // must treat it as ONE code point (not two), or the synthesized
    // `CharacterClass` would exclude/include the wrong set and disagree
    // with the un-degenerated `!a .` on inputs containing it.
    const astral = "\u{1F600}";
    const original = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(createStringLiteral(astral, '"')),
            createAnyChar(),
          ]),
        ),
      ],
    );
    const degenerated = degenerateNegativeLookaheads(original);
    const pattern = degenerated.rules[0]?.pattern;
    expect(pattern?.type).toBe("CharacterClass");

    const originalParser = await compileRuleForTest(original, "r");
    const degeneratedParser = await compileRuleForTest(degenerated, "r");

    for (const input of [astral, "a", "\u{1F601}", ""]) {
      const originalResult = originalParser(input, ORIGIN);
      const degeneratedResult = degeneratedParser(input, ORIGIN);
      expect(degeneratedResult.success).toBe(originalResult.success);
      if (originalResult.success && degeneratedResult.success) {
        expect(degeneratedResult.next).toEqual(originalResult.next);
      }
    }
  });

  it("clause 2 (FIRST-disjoint deletion) handles an astral (surrogate-pair) code point in the lookahead correctly", async () => {
    // `!"\u{1F600}" "xyz"` -- `b` ("xyz") isn't a single-code-point
    // CharSet, so clause 1 can't apply; clause 2 needs FIRST(a) (the
    // astral code point) and FIRST(b) ('x') to be correctly computed as
    // disjoint -- if the astral character were mishandled as 2 UTF-16
    // code units instead of 1 code point, this FIRST-set computation
    // could go wrong.
    const astral = "\u{1F600}";
    const original = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createNegativeLookahead(createStringLiteral(astral, '"')),
            createStringLiteral("xyz", '"'),
          ]),
        ),
      ],
    );
    const degenerated = degenerateNegativeLookaheads(original);
    const pattern = degenerated.rules[0]?.pattern;
    // Clause 2 deletes the lookahead entirely -- left with bare "xyz".
    expect(pattern?.type).toBe("StringLiteral");

    const originalParser = await compileRuleForTest(original, "r");
    const degeneratedParser = await compileRuleForTest(degenerated, "r");

    for (const input of ["xyz", astral, "abc", ""]) {
      const originalResult = originalParser(input, ORIGIN);
      const degeneratedResult = degeneratedParser(input, ORIGIN);
      expect(degeneratedResult.success).toBe(originalResult.success);
      if (originalResult.success && degeneratedResult.success) {
        expect(degeneratedResult.next).toEqual(originalResult.next);
      }
    }
  });
});

describe("applyAstOptimizations", () => {
  it("runs all three rewrites together without error on a grammar exercising each", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "sum",
          createChoice([
            createSequence([
              createIdentifier("product"),
              createStringLiteral("+", '"'),
              createIdentifier("sum"),
            ]),
            createIdentifier("product"),
          ]),
        ),
        createRuleDefinition(
          "letterOrDigit",
          createChoice([
            createCharacterClass([createCharRange("a", "z")], false),
            createCharacterClass([createCharRange("0", "9")], false),
          ]),
        ),
        createRuleDefinition(
          "quoted",
          createSequence([
            createStringLiteral('"', '"'),
            {
              type: "Star",
              expression: createSequence([
                createNegativeLookahead(createStringLiteral('"', '"')),
                createAnyChar(),
              ]),
            },
            createStringLiteral('"', '"'),
          ]),
        ),
      ],
    );

    const optimized = applyAstOptimizations(grammar);

    expect(optimized.rules[0]?.pattern.type).toBe("Choice"); // left-factored
    expect(optimized.rules[1]?.pattern.type).toBe("CharacterClass"); // merged
    const quotedStar = (
      optimized.rules[2]?.pattern as Extract<Expression, { type: "Sequence" }>
    ).elements[1];
    expect(quotedStar?.type).toBe("Star");
    if (quotedStar?.type === "Star") {
      expect(quotedStar.expression.type).toBe("CharacterClass"); // degenerated
    }
  });
});

describe("insertAutomaticCuts", () => {
  it("is NOT included in applyAstOptimizations's default chain", () => {
    // See ast-optimize.ts's module doc comment for why: unlike the three
    // rewrites above, this one changes runtime failure behavior (a
    // committed alternative's error becomes fatal), which is a bigger
    // behavioral surface than any of leftFactorChoices/
    // mergeCharacterClasses/degenerateNegativeLookaheads touch, so it
    // stays a separate, explicit opt-in.
    const grammar = createGrammarDefinition(
      "T",
      [],
      [
        createRuleDefinition(
          "stmt",
          createChoice([
            createSequence([
              createStringLiteral("if", '"'),
              createStringLiteral("x", '"'),
            ]),
            createStringLiteral("while", '"'),
          ]),
        ),
      ],
    );
    const optimized = applyAstOptimizations(grammar);
    expect(optimized.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("inserts a cut right after the first non-nullable element when the rest of the alternative is FIRST-disjoint from every later alternative", () => {
    const grammar = createGrammarDefinition(
      "Stmt",
      [],
      [
        createRuleDefinition(
          "stmt",
          createChoice([
            createSequence([
              createStringLiteral("if", '"'),
              createIdentifier("cond"),
              createStringLiteral("then", '"'),
              createIdentifier("body"),
            ]),
            createSequence([
              createStringLiteral("while", '"'),
              createIdentifier("cond"),
              createIdentifier("body"),
            ]),
            createIdentifier("exprStmt"),
          ]),
        ),
        createRuleDefinition("cond", createStringLiteral("c", '"')),
        createRuleDefinition("body", createStringLiteral("b", '"')),
        createRuleDefinition("exprStmt", createStringLiteral("e", '"')),
      ],
    );

    const withCuts = insertAutomaticCuts(grammar);
    const stmtPattern = withCuts.rules[0]?.pattern;
    expect(stmtPattern?.type).toBe("Choice");
    if (stmtPattern?.type !== "Choice") return;

    const [ifAlt, whileAlt, exprAlt] = stmtPattern.alternatives;
    expect(ifAlt?.type).toBe("Sequence");
    if (ifAlt?.type === "Sequence") {
      expect(ifAlt.elements.map((e) => e.type)).toEqual([
        "StringLiteral",
        "Cut",
        "Identifier",
        "StringLiteral",
        "Identifier",
      ]);
    }
    expect(whileAlt?.type).toBe("Sequence");
    if (whileAlt?.type === "Sequence") {
      expect(whileAlt.elements.map((e) => e.type)).toEqual([
        "StringLiteral",
        "Cut",
        "Identifier",
        "Identifier",
      ]);
    }
    // The last alternative is a bare Identifier (not a Sequence), so
    // there's no interior position to cut at all -- see
    // `findCutPosition`'s single-element guard.
    expect(exprAlt?.type).toBe("Identifier");
  });

  it('does NOT insert a cut into "==" based on a false claim that "=" is excluded (the reordering-bug danger class)', () => {
    // `codegen-optimized.ts` documents a real prior bug where sorting
    // choice alternatives made "==" permanently unmatchable once "="
    // came first. A false "these are disjoint" cut into the FIRST
    // alternative here would be the same failure mode: FIRST("=") and
    // FIRST("==") are NOT disjoint (both start with "="), so
    // `firstSetsDisjoint` must say so, and the "==" alternative must be
    // left untouched -- verified both structurally and by differential
    // parse below.
    //
    // The SECOND ("=") alternative, being last, legitimately gets a cut
    // via the vacuous "no later alternatives to exclude" case (see
    // `findCutPosition`'s comment on why that's safe) -- that's a
    // different, harmless mechanism, not the bug this test guards
    // against, so it's asserted separately below rather than folded into
    // an "unchanged" check on the whole pattern.
    const grammar = createGrammarDefinition(
      "Ops",
      [],
      [
        createRuleDefinition(
          "op",
          createChoice([
            createSequence([
              createStringLiteral("==", '"'),
              createStringLiteral(" ", '"'),
            ]),
            createSequence([
              createStringLiteral("=", '"'),
              createStringLiteral(" ", '"'),
            ]),
          ]),
        ),
      ],
    );

    const originalPattern = grammar.rules[0]?.pattern as Extract<
      Expression,
      { type: "Choice" }
    >;
    const withCuts = insertAutomaticCuts(grammar);
    const pattern = withCuts.rules[0]?.pattern;
    expect(pattern?.type).toBe("Choice");
    if (pattern?.type !== "Choice") return;

    const [eqEqAlt, eqAlt] = pattern.alternatives;
    expect(eqEqAlt).toEqual(originalPattern.alternatives[0] as Expression);
    expect(eqAlt?.type).toBe("Sequence");
    if (eqAlt?.type === "Sequence") {
      expect(eqAlt.elements.map((e) => e.type)).toEqual([
        "StringLiteral",
        "Cut",
        "StringLiteral",
      ]);
    }
  });

  it("does not see through a Group wrapper (a parenthesized alternative is left untouched)", () => {
    // Documented limitation, not a soundness gap: `findCutPosition`
    // requires the alternative node itself to be a `Sequence`. A
    // parenthesized alternative parses as `Group(Sequence(...))`, so it's
    // simply never a candidate -- conservative (misses an optimization
    // opportunity), never incorrect.
    const grammar = createGrammarDefinition(
      "T",
      [],
      [
        createRuleDefinition(
          "stmt",
          createChoice([
            createGroup(
              createSequence([
                createStringLiteral("if", '"'),
                createStringLiteral("x", '"'),
              ]),
            ),
            createStringLiteral("while", '"'),
          ]),
        ),
      ],
    );
    const withCuts = insertAutomaticCuts(grammar);
    expect(withCuts.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
  });

  it("a cut vacuously inserted into a Choice's last alternative does not suppress an ENCLOSING choice's fallback", () => {
    // Regression test mirroring `combinators.spec.ts`'s equivalent
    // hand-written-`~` test, but exercised through the actual
    // `insertAutomaticCuts` -> codegen -> parse pipeline. `stmt`'s second
    // (last) alternative gets a cut inserted with `laterAlternatives = []`
    // (vacuously "all excluded") -- safe only because `choice` absorbs
    // `fatal` at its own boundary (see `findCutPosition`'s comment on
    // this). Input "zbq" makes `stmt`'s committed alternative fail deep
    // (after matching "z" and "b"), so if the fix regressed, `grandouter`
    // would incorrectly reject this input instead of falling through to
    // `grandfallback`.
    const grammar = createGrammarDefinition(
      "LastAltLeak",
      [],
      [
        createRuleDefinition(
          "grandouter",
          createChoice([
            createIdentifier("stmt"),
            createIdentifier("grandfallback"),
          ]),
        ),
        createRuleDefinition(
          "stmt",
          createChoice([
            createSequence([
              createStringLiteral("y", '"'),
              createStringLiteral("p", '"'),
            ]),
            createSequence([
              createStringLiteral("z", '"'),
              createStringLiteral("b", '"'),
              createStringLiteral("c", '"'),
            ]),
          ]),
        ),
        createRuleDefinition(
          "grandfallback",
          createSequence([
            createStringLiteral("z", '"'),
            createStringLiteral("b", '"'),
            createStringLiteral("q", '"'),
          ]),
        ),
      ],
    );

    const withCuts = insertAutomaticCuts(grammar);
    // Confirm the vacuous cut really was inserted, so this test is
    // actually exercising the case it claims to.
    const stmtAlt2 = (
      withCuts.rules[1]?.pattern as Extract<Expression, { type: "Choice" }>
    ).alternatives[1];
    expect(stmtAlt2?.type).toBe("Sequence");
    if (stmtAlt2?.type === "Sequence") {
      expect(stmtAlt2.elements.map((e) => e.type)).toContain("Cut");
    }

    return compileRuleFor(withCuts, "grandouter").then((parser) => {
      const result = parser("zbq", ORIGIN);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["z", "b", "q"]);
      }
    });
  });

  it('produces code that parses identically to the un-cut grammar for a battery of inputs, including the "=="/"=" prefix-code case', async () => {
    const grammar = createGrammarDefinition(
      "Stmt",
      [],
      [
        createRuleDefinition(
          "stmt",
          createChoice([
            createSequence([
              createStringLiteral("if", '"'),
              createIdentifier("cond"),
              createStringLiteral("then", '"'),
              createIdentifier("body"),
            ]),
            createSequence([
              createStringLiteral("while", '"'),
              createIdentifier("cond"),
              createIdentifier("body"),
            ]),
            createIdentifier("exprStmt"),
          ]),
        ),
        createRuleDefinition("cond", createStringLiteral("c", '"')),
        createRuleDefinition("body", createStringLiteral("b", '"')),
        createRuleDefinition("exprStmt", createStringLiteral("e", '"')),
      ],
    );
    const withCuts = insertAutomaticCuts(grammar);

    const original = await compileRuleFor(grammar, "stmt");
    const cut = await compileRuleFor(withCuts, "stmt");

    const inputs = [
      "ifcthenb", // valid if
      "whilecb", // valid while
      "e", // valid exprStmt
      "ifcthen", // malformed if (missing body) -- must fail identically, not silently accept a shorter/different match
      "if", // malformed if, fails immediately after the committed prefix
      "whilec", // malformed while (missing body)
      "x", // matches nothing
      "", // empty input
    ];

    for (const input of inputs) {
      const originalResult = original(input, ORIGIN);
      const cutResult = cut(input, ORIGIN);
      expect(cutResult.success).toBe(originalResult.success);
      if (originalResult.success && cutResult.success) {
        expect(cutResult.next).toEqual(originalResult.next);
      }
    }

    // The prefix-code danger case, run through the full pipeline as well
    // as the structural check above.
    const opsGrammar = createGrammarDefinition(
      "Ops",
      [],
      [
        createRuleDefinition(
          "op",
          createChoice([
            createSequence([
              createStringLiteral("==", '"'),
              createStringLiteral(" ", '"'),
            ]),
            createSequence([
              createStringLiteral("=", '"'),
              createStringLiteral(" ", '"'),
            ]),
          ]),
        ),
      ],
    );
    const opsWithCuts = insertAutomaticCuts(opsGrammar);
    const opsOriginal = await compileRuleFor(opsGrammar, "op");
    const opsCut = await compileRuleFor(opsWithCuts, "op");
    for (const input of ["== ", "= ", "==", "=", ""]) {
      const originalResult = opsOriginal(input, ORIGIN);
      const cutResult = opsCut(input, ORIGIN);
      expect(cutResult.success).toBe(originalResult.success);
      if (originalResult.success && cutResult.success) {
        expect(cutResult.next).toEqual(originalResult.next);
      }
    }
  });

  describe("Partial exclusion via ordered-choice associativity", () => {
    /**
     * `r = "a" "1" / "b" / "c" / "a" "2"`. The first alternative's prefix
     * FIRST is {"a"}, which is disjoint from "b" and "c" but NOT from the
     * fourth alternative (also starting with "a") -- so the original
     * all-or-nothing check (`findCutPosition`) gets ZERO benefit here: one
     * non-excluded sibling (the fourth) means no cut at all, even though
     * the first alternative provably excludes its two immediate
     * neighbors. This is the exact "crossing" shape that needs its own
     * bench grammar to demonstrate the partial-exclusion behavior.
     */
    const crossingGrammar = () =>
      createGrammarDefinition(
        "Crossing",
        [],
        [
          createRuleDefinition(
            "r",
            createChoice([
              createSequence([
                createStringLiteral("a", '"'),
                createStringLiteral("1", '"'),
              ]),
              createStringLiteral("b", '"'),
              createStringLiteral("c", '"'),
              createSequence([
                createStringLiteral("a", '"'),
                createStringLiteral("2", '"'),
              ]),
            ]),
          ),
        ],
      );

    it("regroups a partially-excluding alternative into a nested Choice instead of inserting no cut at all", () => {
      const grammar = crossingGrammar();
      const withCuts = insertAutomaticCuts(grammar);
      const pattern = withCuts.rules[0]?.pattern;
      expect(pattern?.type).toBe("Choice");
      if (pattern?.type !== "Choice") return;

      // Top level: the excluded run [alt0, "b", "c"] regrouped into one
      // nested Choice, with the fourth alternative ("a" "2") left OUTSIDE
      // it -- exactly because it's the one sibling alt0 could NOT prove
      // excluded.
      expect(pattern.alternatives.length).toBe(2);
      const [innerGroup, lastAlt] = pattern.alternatives;
      expect(innerGroup?.type).toBe("Choice");
      expect(lastAlt?.type).toBe("Sequence");

      if (innerGroup?.type !== "Choice") return;
      expect(innerGroup.alternatives.length).toBe(3);
      const [cutAlt, bAlt, cAlt] = innerGroup.alternatives;
      expect(cutAlt?.type).toBe("Sequence");
      if (cutAlt?.type === "Sequence") {
        expect(cutAlt.elements.map((e) => e.type)).toEqual([
          "StringLiteral",
          "Cut",
          "StringLiteral",
        ]);
      }
      expect(bAlt?.type).toBe("StringLiteral");
      expect(cAlt?.type).toBe("StringLiteral");

      // The fourth alternative is NOT wrapped into the inner group (the
      // whole point of this test), but it IS independently the last
      // alternative at the top level once the first group is consumed,
      // so it still gets its own vacuous "nothing left to exclude" cut --
      // same mechanism as the original last-alternative case,
      // unrelated to the partial-exclusion grouping this test targets.
      if (lastAlt?.type === "Sequence") {
        expect(lastAlt.elements.map((e) => e.type)).toEqual([
          "StringLiteral",
          "Cut",
          "StringLiteral",
        ]);
      }
    });

    it('produces code that parses identically to the un-cut grammar, INCLUDING reaching the fourth alternative past the inner group\'s cut boundary ("a2")', async () => {
      const grammar = crossingGrammar();
      const withCuts = insertAutomaticCuts(grammar);

      const original = await compileRuleFor(grammar, "r");
      const cut = await compileRuleFor(withCuts, "r");

      const inputs = [
        "a1", // matches via the first (cut-protected) alternative
        "b", // matches via the second, inside the same inner group
        "c", // matches via the third, inside the same inner group
        // The critical case: "a" matches the first alternative's prefix,
        // triggering its cut, but "1" doesn't follow -- if the cut
        // incorrectly leaked past the inner group's boundary, "a2" would
        // now fail instead of falling through to the fourth alternative.
        "a2",
        "a3", // "a" matches, cut fires, everything after fails: no alternative matches "a3" either way
        "x", // matches nothing
        "", // empty input
      ];

      for (const input of inputs) {
        const originalResult = original(input, ORIGIN);
        const cutResult = cut(input, ORIGIN);
        expect(cutResult.success).toBe(originalResult.success);
        if (originalResult.success && cutResult.success) {
          expect(cutResult.next).toEqual(originalResult.next);
        }
      }
    });

    it('negative control: a bare top-level cut (the naive, non-nested placement the associativity-based restructuring above avoids) DOES incorrectly reject "a2", proving the nested Choice above is load-bearing rather than incidental', async () => {
      // Same crossing grammar, but this test does NOT call
      // `insertAutomaticCuts`. Instead it hand-builds the cut placement a
      // naive "runLength > 0 somewhere -> insert a cut" implementation
      // would produce if it DIDN'T wrap the excluded run in its own
      // nested Choice: the Cut spliced directly into the first
      // alternative at the TOP level of the outer Choice, sitting
      // alongside "b", "c", and the fourth alternative as flat siblings.
      //
      // Under `choice`'s cut semantics (packages/core/src/combinators.ts),
      // a fatal failure after this cut aborts the *entire* enclosing
      // choice -- there's no inner boundary to absorb it, so it also
      // takes out the fourth alternative ("a" "2"), even though nothing
      // about the fourth alternative was ever proven excluded. This is
      // exactly the bug the nested-Choice construction in
      // `buildCutGroups` exists to prevent.
      const grammar = crossingGrammar();
      const flatCutGrammar = createGrammarDefinition(
        "CrossingFlatCut",
        [],
        [
          createRuleDefinition(
            "r",
            createChoice([
              createSequence([
                createStringLiteral("a", '"'),
                createCut(),
                createStringLiteral("1", '"'),
              ]),
              createStringLiteral("b", '"'),
              createStringLiteral("c", '"'),
              createSequence([
                createStringLiteral("a", '"'),
                createStringLiteral("2", '"'),
              ]),
            ]),
          ),
        ],
      );

      const flatCut = await compileRuleFor(flatCutGrammar, "r");
      const properlyNested = await compileRuleFor(
        insertAutomaticCuts(grammar),
        "r",
      );

      // The naive flat placement: "a" matches, the cut commits, "1"
      // fails to match "2" -- and because there's no nested choice
      // boundary to absorb the resulting fatal failure, the whole rule
      // fails instead of falling through to the fourth alternative.
      const flatResult = flatCut("a2", ORIGIN);
      expect(flatResult.success).toBe(false);

      // The actual `insertAutomaticCuts` output, which nests [alt0, b, c]
      // inside their own Choice specifically so alt0's cut can't reach
      // past that boundary, correctly falls through to the fourth
      // alternative instead.
      const nestedResult = properlyNested("a2", ORIGIN);
      expect(nestedResult.success).toBe(true);
    });

    it("a run's own excluded members are truncated to that run's boundary -- a sibling further out never benefits from what an INNER member could have excluded on its own", () => {
      // `r = "a" "x" / "b" "y" / "c" "z" / "a" "w"`. alt0 ("a" "x") excludes
      // alt1 and alt2 (their FIRST sets {b}/{c} are disjoint from alt0's
      // {a}) but NOT alt3 ("a" "w"), which shares alt0's own prefix -- so
      // alt0's run stops at length 2, covering only [alt1, alt2].
      //
      // In isolation, alt1 ("b" "y") could ALSO exclude alt3 (FIRST {b} is
      // disjoint from FIRST {a}) -- but `buildCutGroups` never gives it
      // the chance: alt1's own candidate is computed via a recursive call
      // bounded to `alts.slice(i + 1, i + 1 + runLength)`, i.e. only
      // [alt2], never alt3, because alt3 already fell outside alt0's run
      // before alt1 is ever considered. This is the documented
      // under-delivery from the module doc comment ("never backtracks to
      // ask whether a different starting alternative would have excluded
      // strictly more") -- this test pins the resulting shape so a future
      // change to the grouping/tie-break strategy doesn't silently alter
      // it. It is NOT a soundness claim: alt3 sitting outside the inner
      // group is what's checked below, and per-alternative cut safety is
      // unaffected either way.
      const grammar = createGrammarDefinition(
        "Crossing2",
        [],
        [
          createRuleDefinition(
            "r",
            createChoice([
              createSequence([
                createStringLiteral("a", '"'),
                createStringLiteral("x", '"'),
              ]),
              createSequence([
                createStringLiteral("b", '"'),
                createStringLiteral("y", '"'),
              ]),
              createSequence([
                createStringLiteral("c", '"'),
                createStringLiteral("z", '"'),
              ]),
              createSequence([
                createStringLiteral("a", '"'),
                createStringLiteral("w", '"'),
              ]),
            ]),
          ),
        ],
      );

      const withCuts = insertAutomaticCuts(grammar);
      const pattern = withCuts.rules[0]?.pattern;
      expect(pattern?.type).toBe("Choice");
      if (pattern?.type !== "Choice") return;

      // Top level: [alt0, alt1, alt2] regrouped into one nested Choice
      // (alt0's own run, itself further regrouped so alt1 can exclude
      // alt2), with alt3 left outside it since alt0 never proved it
      // excluded.
      expect(pattern.alternatives.length).toBe(2);
      const [innerGroup, lastAlt] = pattern.alternatives;
      expect(innerGroup?.type).toBe("Choice");
      if (innerGroup?.type !== "Choice") return;
      expect(innerGroup.alternatives.length).toBe(3);
      const [cutA, cutB, cutC] = innerGroup.alternatives;
      for (const alt of [cutA, cutB, cutC]) {
        expect(alt?.type).toBe("Sequence");
        if (alt?.type === "Sequence") {
          expect(alt.elements.map((e) => e.type)).toEqual([
            "StringLiteral",
            "Cut",
            "StringLiteral",
          ]);
        }
      }

      // alt3, now the sole alternative outside the group, still gets its
      // own vacuous last-alternative cut -- unrelated to (and unaffected
      // by) the exclusion power alt1 was denied above.
      expect(lastAlt?.type).toBe("Sequence");
      if (lastAlt?.type === "Sequence") {
        expect(lastAlt.elements.map((e) => e.type)).toEqual([
          "StringLiteral",
          "Cut",
          "StringLiteral",
        ]);
      }
    });

    it('does not cut a Sequence alternative whose provable prefix is NOT disjoint from the very next alternative -- the "==" / "=" prefix-collision shape', () => {
      // `r = "=" "=" / "="`. alt0's provable prefix is just its first
      // element ("="), which is NOT disjoint from alt1's FIRST (also
      // "="): `computeCutCandidate` must return `null` for alt0 rather
      // than inserting an unsound cut that would fatal-stop the "="
      // alternative on backtrack. Guards against a regression where the
      // `runLength === 0 && laterAlternatives.length > 0 -> null` check
      // in `computeCutCandidate` gets weakened or bypassed.
      const grammar = createGrammarDefinition(
        "PrefixCollision",
        [],
        [
          createRuleDefinition(
            "r",
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

      const withCuts = insertAutomaticCuts(grammar);
      const pattern = withCuts.rules[0]?.pattern;
      expect(pattern?.type).toBe("Choice");
      if (pattern?.type !== "Choice") return;

      // No cut anywhere: both alternatives come back byte-for-byte
      // unchanged from the input grammar.
      expect(pattern.alternatives).toEqual(
        (grammar.rules[0]?.pattern as Extract<Expression, { type: "Choice" }>)
          .alternatives,
      );
    });

    it("a Sequence that receives a vacuous cut as the LAST member of a nested group is still safe when a later top-level alternative follows the group", async () => {
      // `r = "a" "1" / "b" "1" / "a" "2"`. alt0 excludes only alt1 (alt2
      // shares alt0's own prefix, so alt0's run stops there), producing a
      // nested group [alt0(cut), alt1(cut)] with alt2 left outside it.
      // alt1, now the LAST member of that inner group, gets its own
      // vacuous cut (nothing left inside the group to exclude) even
      // though alt2 still follows at the OUTER level -- this is safe
      // only because the inner Choice absorbs alt1's fatal failure at
      // its own boundary before it can reach the outer Choice and
      // wrongly take alt2 down with it. This exercises a case the
      // existing tests above don't: a NESTED (not top-level) member
      // itself receiving a vacuous cut while a sibling still follows one
      // level up.
      const grammar = createGrammarDefinition(
        "NestedVacuousCut",
        [],
        [
          createRuleDefinition(
            "r",
            createChoice([
              createSequence([
                createStringLiteral("a", '"'),
                createStringLiteral("1", '"'),
              ]),
              createSequence([
                createStringLiteral("b", '"'),
                createStringLiteral("1", '"'),
              ]),
              createSequence([
                createStringLiteral("a", '"'),
                createStringLiteral("2", '"'),
              ]),
            ]),
          ),
        ],
      );

      const withCuts = insertAutomaticCuts(grammar);
      const pattern = withCuts.rules[0]?.pattern;
      expect(pattern?.type).toBe("Choice");
      if (pattern?.type !== "Choice") return;
      expect(pattern.alternatives.length).toBe(2);
      const [innerGroup, lastAlt] = pattern.alternatives;
      expect(innerGroup?.type).toBe("Choice");
      if (innerGroup?.type === "Choice") {
        expect(innerGroup.alternatives.length).toBe(2);
        for (const alt of innerGroup.alternatives) {
          expect(alt.type).toBe("Sequence");
          if (alt.type === "Sequence") {
            expect(alt.elements.map((e) => e.type)).toEqual([
              "StringLiteral",
              "Cut",
              "StringLiteral",
            ]);
          }
        }
      }
      expect(lastAlt?.type).toBe("Sequence");

      const original = await compileRuleFor(grammar, "r");
      const cut = await compileRuleFor(withCuts, "r");
      for (const input of ["a1", "b1", "a2", "a3", "b2", "", "x"]) {
        const originalResult = original(input, ORIGIN);
        const cutResult = cut(input, ORIGIN);
        expect(cutResult.success).toBe(originalResult.success);
        if (originalResult.success && cutResult.success) {
          expect(cutResult.next).toEqual(originalResult.next);
        }
      }
    });

    it("does not restructure a Choice containing a LabeledExpression, falling back to the original all-or-nothing check instead", () => {
      // Same crossing shape as above, but the fourth alternative carries
      // a label -- `containsLabel` must make this Choice bail out of
      // regrouping entirely. Under the all-or-nothing fallback, the first
      // alternative gets NO cut (the fourth isn't excluded), while the
      // fourth alternative -- now the last one -- still gets its own
      // vacuous "nothing left to exclude" cut, exactly as it would have
      // before this restructuring logic existed.
      const grammar = createGrammarDefinition(
        "CrossingLabeled",
        [],
        [
          createRuleDefinition(
            "r",
            createChoice([
              createSequence([
                createStringLiteral("a", '"'),
                createStringLiteral("1", '"'),
              ]),
              createStringLiteral("b", '"'),
              createStringLiteral("c", '"'),
              createSequence([
                createLabeledExpression("x", createStringLiteral("a", '"')),
                createStringLiteral("2", '"'),
              ]),
            ]),
          ),
        ],
      );

      const withCuts = insertAutomaticCuts(grammar);
      const pattern = withCuts.rules[0]?.pattern;
      expect(pattern?.type).toBe("Choice");
      if (pattern?.type !== "Choice") return;

      // Flat, 4 alternatives -- no nesting at all.
      expect(pattern.alternatives.length).toBe(4);
      const [aAlt, bAlt, cAlt, labeledAlt] = pattern.alternatives;

      // The first alternative gets NO cut: it can't prove the (labeled)
      // fourth alternative excluded, and with the Choice bailed out of
      // regrouping, there's no nested boundary to protect a partial
      // exclusion with.
      expect(aAlt).toEqual(
        (grammar.rules[0]?.pattern as Extract<Expression, { type: "Choice" }>)
          .alternatives[0] as Expression,
      );
      expect(bAlt?.type).toBe("StringLiteral");
      expect(cAlt?.type).toBe("StringLiteral");

      // The (labeled) fourth alternative, now last, still gets its own
      // vacuous cut -- unaffected by the label, since that mechanism
      // never restructures the Choice.
      expect(labeledAlt?.type).toBe("Sequence");
      if (labeledAlt?.type === "Sequence") {
        expect(labeledAlt.elements.map((e) => e.type)).toEqual([
          "LabeledExpression",
          "Cut",
          "StringLiteral",
        ]);
      }
    });
  });
});

describe("promoteGlobalCuts", () => {
  /** Every `Cut` reachable from `expr`, in encounter order. */
  const collectCuts = (expr: Expression): Expression[] => {
    switch (expr.type) {
      case "Cut":
        return [expr];
      case "Sequence":
        return expr.elements.flatMap(collectCuts);
      case "Choice":
        return expr.alternatives.flatMap(collectCuts);
      case "Group":
      case "Star":
      case "Plus":
      case "Optional":
      case "Quantified":
      case "PositiveLookahead":
      case "NegativeLookahead":
      case "LabeledExpression":
      case "ActionExpression":
        return collectCuts(expr.expression);
      default:
        return [];
    }
  };

  const promote = (grammar: GrammarDefinition) =>
    promoteGlobalCuts(grammar, analyzeFirstSets(grammar));

  it("promotes every cut in a rule referenced only through a Plus from the start rule, with no ancestor Choice anywhere", () => {
    // Mirrors packages/parser/bench/grammars.ts's BENCH_CUTTABLE_CONFIG_GRAMMAR:
    // doc = entry+; entry = "[" name "]" / name "=" value / "#" text
    const grammar = createGrammarDefinition(
      "Config",
      [],
      [
        createRuleDefinition("doc", createPlus(createIdentifier("entry"))),
        createRuleDefinition(
          "entry",
          createChoice([
            createSequence([
              createStringLiteral("[", '"'),
              createIdentifier("name"),
              createStringLiteral("]", '"'),
            ]),
            createSequence([
              createIdentifier("name"),
              createStringLiteral("=", '"'),
              createIdentifier("value"),
            ]),
            createSequence([
              createStringLiteral("#", '"'),
              createIdentifier("text"),
            ]),
          ]),
        ),
        createRuleDefinition(
          "name",
          createCharacterClass([createCharRange("a", "z")]),
        ),
        createRuleDefinition(
          "value",
          createCharacterClass([createCharRange("a", "z")]),
        ),
        createRuleDefinition(
          "text",
          createCharacterClass([createCharRange("a", "z")]),
        ),
      ],
    );

    const withCuts = insertAutomaticCuts(grammar);
    expect(collectCuts(withCuts.rules[1]?.pattern as Expression).length).toBe(
      3,
    );

    const { grammar: promoted, promotedCount } = promote(withCuts);
    expect(promotedCount).toBe(3);
    const cuts = collectCuts(promoted.rules[1]?.pattern as Expression);
    expect(cuts.length).toBe(3);
    expect(cuts.every((c) => c.type === "Cut" && c.global === true)).toBe(true);
  });

  it("refuses a cut whose rule is referenced from a Choice where a later alternative is NOT FIRST-disjoint from it", () => {
    // Exactly BENCH_UNFACTORED_ARITHMETIC_GRAMMAR's shape: atom's own
    // Choice ("(" product ")" / number) gets a cut after "(" (disjoint
    // from `number`'s FIRST set) -- but atom itself is referenced from
    // product's 3 alternatives, which all start with atom (NOT disjoint
    // from each other). If atom's cut fires then fails, atom's own Choice
    // absorbs the fatal to an ordinary FAIL; product's Choice would then
    // try ITS next alternative, which calls atom again from the SAME
    // position -- a real re-parse, not a trivial first-character
    // mismatch, so clause 2/3 must refuse promotion at this reference
    // site regardless of atom's own cut being locally sound.
    const grammar = createGrammarDefinition(
      "Arith",
      [],
      [
        createRuleDefinition(
          "product",
          createChoice([
            createSequence([
              createIdentifier("atom"),
              createStringLiteral("*", '"'),
              createIdentifier("product"),
            ]),
            createSequence([
              createIdentifier("atom"),
              createStringLiteral("/", '"'),
              createIdentifier("product"),
            ]),
            createIdentifier("atom"),
          ]),
        ),
        createRuleDefinition(
          "atom",
          createChoice([
            createSequence([
              createStringLiteral("(", '"'),
              createIdentifier("product"),
              createStringLiteral(")", '"'),
            ]),
            createIdentifier("number"),
          ]),
        ),
        createRuleDefinition(
          "number",
          createCharacterClass([createCharRange("0", "9")]),
        ),
      ],
    );

    const withCuts = insertAutomaticCuts(grammar);
    const atomCuts = collectCuts(withCuts.rules[1]?.pattern as Expression);
    expect(atomCuts.length).toBe(1); // after "(", excluding `number`

    const { grammar: promoted, promotedCount } = promote(withCuts);
    expect(promotedCount).toBe(0);
    const cuts = collectCuts(promoted.rules[1]?.pattern as Expression);
    expect(cuts.every((c) => c.type === "Cut" && c.global !== true)).toBe(true);
  });

  it("promotes transitively through two levels of plain (Choice-free) reference before reaching the start rule", () => {
    // start = top; top = mid; mid = entry+; entry = "[" name "]" / "#" text
    // No Choice/lookahead anywhere in the chain from entry's cuts up to
    // the start rule -- clause 3's walk has to actually recurse twice
    // (mid -> top -> start) rather than terminate at depth 0/1, unlike
    // BENCH_CUTTABLE_CONFIG_GRAMMAR's doc, which IS the start rule.
    const grammar = createGrammarDefinition(
      "Nested",
      [],
      [
        createRuleDefinition("start", createIdentifier("top")),
        createRuleDefinition("top", createIdentifier("mid")),
        createRuleDefinition("mid", createPlus(createIdentifier("entry"))),
        createRuleDefinition(
          "entry",
          createChoice([
            createSequence([
              createStringLiteral("[", '"'),
              createIdentifier("name"),
              createStringLiteral("]", '"'),
            ]),
            createSequence([
              createStringLiteral("#", '"'),
              createIdentifier("text"),
            ]),
          ]),
        ),
        createRuleDefinition(
          "name",
          createCharacterClass([createCharRange("a", "z")]),
        ),
        createRuleDefinition(
          "text",
          createCharacterClass([createCharRange("a", "z")]),
        ),
      ],
    );

    const withCuts = insertAutomaticCuts(grammar);
    const { grammar: promoted, promotedCount } = promote(withCuts);
    expect(promotedCount).toBe(2);
    const cuts = collectCuts(promoted.rules[3]?.pattern as Expression);
    expect(cuts.every((c) => c.type === "Cut" && c.global === true)).toBe(true);
  });

  it("refuses a cut reachable through a mutually-recursive reference cycle that never reaches the start rule", () => {
    // start = other (never references `entry`'s rule chain at all); a and
    // b reference each other, with a also referencing entry. entry's cut
    // reference chain is a -> b -> a -> ... forever -- the cycle guard
    // must refuse rather than loop.
    const grammar = createGrammarDefinition(
      "Cyclic",
      [],
      [
        createRuleDefinition("start", createStringLiteral("s", '"')),
        createRuleDefinition("a", createIdentifier("b")),
        createRuleDefinition("b", createIdentifier("a")),
        createRuleDefinition("mid", createPlus(createIdentifier("entry"))),
        createRuleDefinition(
          "entry",
          createChoice([
            createSequence([
              createStringLiteral("[", '"'),
              createIdentifier("name"),
              createStringLiteral("]", '"'),
            ]),
            createStringLiteral("#", '"'),
          ]),
        ),
        createRuleDefinition(
          "name",
          createCharacterClass([createCharRange("a", "z")]),
        ),
      ],
    );
    // Rewire `a` to also reference `mid`, creating entry -> mid -> a -> b
    // -> a -> ... (a cycle, and never reaching `start`).
    const withCycle: GrammarDefinition = {
      ...grammar,
      rules: grammar.rules.map((r) =>
        r.name === "a"
          ? {
              ...r,
              pattern: createSequence([
                createIdentifier("b"),
                createIdentifier("mid"),
              ]),
            }
          : r,
      ),
    };

    const withCuts = insertAutomaticCuts(withCycle);
    const { promotedCount } = promote(withCuts);
    expect(promotedCount).toBe(0);
  });

  it("refuses a cut under a lookahead ancestor, even with no enclosing Choice", () => {
    // top = &guarded; guarded = entry+; entry = "[" name "]" / "#" text
    // The lookahead always reverts position regardless of what happens
    // inside it, so any watermark advance during its attempt is provably
    // wrong -- refused independent of Choice-disjointness.
    const grammar = createGrammarDefinition(
      "Lookahead",
      [],
      [
        createRuleDefinition(
          "top",
          createPositiveLookahead(createIdentifier("guarded")),
        ),
        createRuleDefinition("guarded", createPlus(createIdentifier("entry"))),
        createRuleDefinition(
          "entry",
          createChoice([
            createSequence([
              createStringLiteral("[", '"'),
              createIdentifier("name"),
              createStringLiteral("]", '"'),
            ]),
            createStringLiteral("#", '"'),
          ]),
        ),
        createRuleDefinition(
          "name",
          createCharacterClass([createCharRange("a", "z")]),
        ),
      ],
    );

    const withCuts = insertAutomaticCuts(grammar);
    const { promotedCount } = promote(withCuts);
    expect(promotedCount).toBe(0);
  });

  it("refuses a cut directly under an Optional/Star in its own rule, as a stated conservatism", () => {
    // top = (entry)*; entry = "[" name "]" / "#" text -- entry itself has
    // no ancestor Choice/lookahead anywhere, but the guard in
    // ast-optimize.ts's module doc comment refuses promotion under a
    // zero-iteration-capable repetition regardless (documented as
    // conservatism, not a demonstrated unsoundness).
    const grammar = createGrammarDefinition(
      "Zeroable",
      [],
      [
        createRuleDefinition("top", createStar(createIdentifier("entry"))),
        createRuleDefinition(
          "entry",
          createChoice([
            createSequence([
              createStringLiteral("[", '"'),
              createIdentifier("name"),
              createStringLiteral("]", '"'),
            ]),
            createStringLiteral("#", '"'),
          ]),
        ),
        createRuleDefinition(
          "name",
          createCharacterClass([createCharRange("a", "z")]),
        ),
      ],
    );

    const withCuts = insertAutomaticCuts(grammar);
    const { promotedCount } = promote(withCuts);
    expect(promotedCount).toBe(0);
  });

  it("does NOT refuse a cut under a Plus/Quantified{min>=1} ancestor (required repetitions propagate fatal failure safely)", () => {
    const grammar = createGrammarDefinition(
      "Required",
      [],
      [
        createRuleDefinition("top", createPlus(createIdentifier("entry"))),
        createRuleDefinition(
          "entry",
          createChoice([
            createSequence([
              createStringLiteral("[", '"'),
              createIdentifier("name"),
              createStringLiteral("]", '"'),
            ]),
            createStringLiteral("#", '"'),
          ]),
        ),
        createRuleDefinition(
          "name",
          createCharacterClass([createCharRange("a", "z")]),
        ),
      ],
    );

    const withCuts = insertAutomaticCuts(grammar);
    const { promotedCount } = promote(withCuts);
    expect(promotedCount).toBe(1);
  });

  it("is a pure marking pass: never inserts, removes, or moves a Cut", () => {
    const grammar = createGrammarDefinition(
      "NoCuts",
      [],
      [
        createRuleDefinition(
          "top",
          createSequence([
            createStringLiteral("a", '"'),
            createIdentifier("rest"),
          ]),
        ),
        createRuleDefinition("rest", createStringLiteral("b", '"')),
      ],
    );
    const { grammar: promoted, promotedCount } = promote(grammar);
    expect(promotedCount).toBe(0);
    expect(promoted).toEqual(grammar);
  });

  it("does not promote a cut whose own alternative is not FIRST-disjoint from a nullable later sibling", () => {
    // entry references trailing, which has 2 alternatives: one starting
    // with the same character as entry's committed branch, and it's
    // nullable -- never treated as excluded regardless of disjointness.
    const grammar = createGrammarDefinition(
      "NullableSibling",
      [],
      [
        createRuleDefinition("doc", createPlus(createIdentifier("entry"))),
        createRuleDefinition(
          "entry",
          createChoice([
            createSequence([
              createStringLiteral("[", '"'),
              createIdentifier("name"),
              createStringLiteral("]", '"'),
            ]),
            createOptional(createStringLiteral("#", '"')),
          ]),
        ),
        createRuleDefinition(
          "name",
          createCharacterClass([createCharRange("a", "z")]),
        ),
      ],
    );

    const withCuts = insertAutomaticCuts(grammar);
    // insertAutomaticCuts itself already refuses this cut (nullable later
    // alternative), so there is nothing for promoteGlobalCuts to promote
    // -- this pins that promoteGlobalCuts doesn't somehow promote a cut
    // that was never inserted, and that the nullable-sibling reasoning is
    // consistent between insertion and promotion.
    expect(collectCuts(withCuts.rules[1]?.pattern as Expression).length).toBe(
      0,
    );
    const { promotedCount } = promote(withCuts);
    expect(promotedCount).toBe(0);
  });
});
