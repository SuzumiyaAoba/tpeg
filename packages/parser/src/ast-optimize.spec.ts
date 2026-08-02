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
import type { Pos } from "@suzumiyaaoba/tpeg-core";
import {
  applyAstOptimizations,
  degenerateNegativeLookaheads,
  insertAutomaticCuts,
  leftFactorChoices,
  mergeCharacterClasses,
} from "./ast-optimize";
import { generateTypeScriptParser } from "./codegen";
import { grammarDefinition } from "./grammar";
import {
  createActionExpression,
  createAnyChar,
  createCharRange,
  createCharacterClass,
  createChoice,
  createGrammarDefinition,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createNegativeLookahead,
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

const ORIGIN: Pos = { offset: 0, column: 0, line: 1 };

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
      pos: Pos,
    ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>
  >;
  return built[ruleName] as (
    input: string,
    pos: Pos,
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
          pos: Pos,
        ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>
      >;
      return built["expr"] as (
        input: string,
        pos: Pos,
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
      pos: Pos,
    ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>
  >;
  return built[ruleName] as (
    input: string,
    pos: Pos,
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

  it("does not degenerate when NegativeLookahead isn't immediately followed by AnyChar", () => {
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
    expect(result.rules[0]?.pattern).toEqual(
      grammar.rules[0]?.pattern as Expression,
    );
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
});
