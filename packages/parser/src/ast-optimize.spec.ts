/**
 * Correctness tests for `leftFactorChoices`.
 *
 * The core claim under test: factoring changes the generated code (fewer
 * repeated sub-parses of a shared prefix) without changing which inputs
 * are accepted or where a successful parse stops. `.val` shape is
 * explicitly NOT compared for factored rules -- see ast-optimize.ts's
 * module doc comment for why that's an accepted, documented difference.
 */

import { describe, expect, it } from "bun:test";
import type { Pos } from "@suzumiyaaoba/tpeg-core";
import { leftFactorChoices } from "./ast-optimize";
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
    // Factored shape: Sequence[ product, Choice[ Sequence["+",sum], Sequence["-",sum] ] ]
    // with the trailing bare "product" alternative promoted to a second
    // top-level Choice alternative (see doc comment on tryLeftFactorChoice).
    expect(sumRule?.pattern.type).toBe("Choice");
    if (sumRule?.pattern.type !== "Choice") return;
    expect(sumRule.pattern.alternatives).toHaveLength(2);
    const [grouped, bare] = sumRule.pattern.alternatives;
    expect(grouped?.type).toBe("Sequence");
    expect(bare?.type).toBe("Identifier");
    if (bare?.type === "Identifier") {
      expect(bare.name).toBe("product");
    }
    if (grouped?.type === "Sequence") {
      expect(grouped.elements[0]).toEqual(createIdentifier("product"));
      expect(grouped.elements[1]?.type).toBe("Choice");
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
