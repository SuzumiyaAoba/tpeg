import { describe, expect, it } from "bun:test";
import type { Pos } from "@suzumiyaaoba/tpeg-core";
import {
  analyzeFirstSets,
  computeFirstSets,
  isNullable,
  predictiveFilterForExpression,
} from "./first-sets";
import { grammarDefinition } from "./grammar";
import {
  createAnyChar,
  createCharRange,
  createCharacterClass,
  createChoice,
  createGrammarDefinition,
  createIdentifier,
  createOptional,
  createQualifiedIdentifier,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "./types";

const ORIGIN: Pos = { offset: 0, column: 0, line: 1 };

describe("computeFirstSets", () => {
  it("computes a single-character FIRST set for a StringLiteral rule", () => {
    const grammar = createGrammarDefinition(
      "T",
      [],
      [createRuleDefinition("r", createStringLiteral("abc", '"'))],
    );
    const fs = computeFirstSets(grammar).get("r");
    expect(fs?.unknown).toBe(false);
    expect([...(fs?.chars ?? [])]).toEqual(["a"]);
  });

  it("computes a FIRST set for a CharacterClass rule", () => {
    const grammar = createGrammarDefinition(
      "T",
      [],
      [
        createRuleDefinition(
          "digit",
          createCharacterClass([createCharRange("0", "9")], false),
        ),
      ],
    );
    const fs = computeFirstSets(grammar).get("digit");
    expect(fs?.unknown).toBe(false);
    expect(fs?.ranges).toEqual([{ start: "0", end: "9" }]);
  });

  it("marks a negated CharacterClass as unknown (complement isn't representable)", () => {
    const grammar = createGrammarDefinition(
      "T",
      [],
      [
        createRuleDefinition(
          "notDigit",
          createCharacterClass([createCharRange("0", "9")], true),
        ),
      ],
    );
    expect(computeFirstSets(grammar).get("notDigit")?.unknown).toBe(true);
  });

  it("marks a CharacterClass with a non-BMP (astral) endpoint as unknown", () => {
    // "\u{1F600}" (😀) is a surrogate pair -- 2 UTF-16 code units -- but
    // `input[pos.offset]` at runtime is always exactly one. A range
    // boundary stored as that 2-unit string would be compared against a
    // 1-unit lone surrogate via plain string `<=`, which doesn't
    // correspond to code-point order.
    const astral = "\u{1F600}";
    const grammar = createGrammarDefinition(
      "T",
      [],
      [
        createRuleDefinition(
          "emoji",
          createCharacterClass([createCharRange(astral, astral)], false),
        ),
      ],
    );
    expect(computeFirstSets(grammar).get("emoji")?.unknown).toBe(true);
  });

  it("marks AnyChar as unknown", () => {
    const grammar = createGrammarDefinition(
      "T",
      [],
      [createRuleDefinition("r", createAnyChar())],
    );
    expect(computeFirstSets(grammar).get("r")?.unknown).toBe(true);
  });

  it("marks a QualifiedIdentifier as unknown (cross-module, not resolvable here)", () => {
    const grammar = createGrammarDefinition(
      "T",
      [],
      [createRuleDefinition("r", createQualifiedIdentifier("other", "rule"))],
    );
    expect(computeFirstSets(grammar).get("r")?.unknown).toBe(true);
  });

  it("resolves an Identifier reference to the referenced rule's FIRST set", () => {
    const grammar = createGrammarDefinition(
      "T",
      [],
      [
        createRuleDefinition("a", createIdentifier("b")),
        createRuleDefinition("b", createStringLiteral("x", '"')),
      ],
    );
    const firstSets = computeFirstSets(grammar);
    expect([...(firstSets.get("a")?.chars ?? [])]).toEqual(["x"]);
  });

  it("marks a reference to a name that isn't a rule of this grammar as unknown, not empty", () => {
    // `ext` is never defined here -- an externally-supplied parser
    // reference (what `codegen.ts`'s `generateIdentifier` emits as a bare
    // name for anything not in `ruleNames`). Falling back to an *empty*
    // FIRST set here would under-approximate ("this can never match
    // anything"), which is unsound -- must be `unknown`.
    const grammar = createGrammarDefinition(
      "T",
      [],
      [createRuleDefinition("a", createIdentifier("ext"))],
    );
    expect(computeFirstSets(grammar).get("a")?.unknown).toBe(true);
  });

  it("unions a Choice's alternatives' FIRST sets", () => {
    const grammar = createGrammarDefinition(
      "T",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createStringLiteral("a", '"'),
            createStringLiteral("b", '"'),
          ]),
        ),
      ],
    );
    const fs = computeFirstSets(grammar).get("r");
    expect(new Set(fs?.chars)).toEqual(new Set(["a", "b"]));
  });

  it("a Sequence's FIRST set stops at the first non-nullable element", () => {
    const grammar = createGrammarDefinition(
      "T",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createStringLiteral("a", '"'),
            createStringLiteral("b", '"'),
          ]),
        ),
      ],
    );
    const fs = computeFirstSets(grammar).get("r");
    // Only "a" -- "b" can never be the first character since "a" is
    // mandatory and non-nullable.
    expect([...(fs?.chars ?? [])]).toEqual(["a"]);
  });

  it("a Sequence's FIRST set unions in later elements past a nullable (Optional) one, without going unknown", () => {
    // Mirrors `number = "-"? [0-9]+ ...` in packages/parser/bench/grammars.ts.
    const grammar = createGrammarDefinition(
      "T",
      [],
      [
        createRuleDefinition(
          "number",
          createSequence([
            createOptional(createStringLiteral("-", '"')),
            createCharacterClass([createCharRange("0", "9")], false),
          ]),
        ),
      ],
    );
    const fs = computeFirstSets(grammar).get("number");
    expect(fs?.unknown).toBe(false);
    expect([...(fs?.chars ?? [])]).toEqual(["-"]);
    expect(fs?.ranges).toEqual([{ start: "0", end: "9" }]);
  });

  it("a Sequence's FIRST set unions in later elements past a nullable (Star) one", () => {
    const grammar = createGrammarDefinition(
      "T",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createStar(createStringLiteral("x", '"')),
            createStringLiteral("y", '"'),
          ]),
        ),
      ],
    );
    const fs = computeFirstSets(grammar).get("r");
    expect(fs?.unknown).toBe(false);
    expect(new Set(fs?.chars)).toEqual(new Set(["x", "y"]));
  });

  it("converges on a mutually recursive grammar without infinite-looping (JSON-shaped value/array/object cycle)", () => {
    const src = `
grammar J {
  value = string / array / object
  string = "\\"" [^"]* "\\""
  array = "[" value "]"
  object = "{" value "}"
}
`;
    const parsed = grammarDefinition(src, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const firstSets = computeFirstSets(parsed.val);
    expect(firstSets.get("value")?.unknown).toBe(false);
    expect(new Set(firstSets.get("value")?.chars)).toEqual(
      new Set(['"', "[", "{"]),
    );
  });
});

describe("isNullable", () => {
  it("is true for an empty StringLiteral and false for a non-empty one", () => {
    const nullableRules = new Map<string, boolean>();
    expect(isNullable(createStringLiteral("", '"'), nullableRules)).toBe(true);
    expect(isNullable(createStringLiteral("a", '"'), nullableRules)).toBe(
      false,
    );
  });

  it("is true for Star/Optional regardless of the wrapped expression", () => {
    const nullableRules = new Map<string, boolean>();
    expect(
      isNullable(createStar(createStringLiteral("a", '"')), nullableRules),
    ).toBe(true);
    expect(
      isNullable(createOptional(createStringLiteral("a", '"')), nullableRules),
    ).toBe(true);
  });

  it("is false for a Sequence with any non-nullable element", () => {
    const nullableRules = new Map<string, boolean>();
    const seq = createSequence([
      createOptional(createStringLiteral("-", '"')),
      createStringLiteral("a", '"'),
    ]);
    expect(isNullable(seq, nullableRules)).toBe(false);
  });
});

describe("predictiveFilterForExpression", () => {
  it("returns a concrete filter for a non-nullable, precisely-computable alternative", () => {
    const grammar = createGrammarDefinition(
      "T",
      [],
      [createRuleDefinition("r", createStringLiteral("a", '"'))],
    );
    const analysis = analyzeFirstSets(grammar);
    const filter = predictiveFilterForExpression(
      createStringLiteral("a", '"'),
      analysis,
    );
    expect(filter).not.toBeNull();
    expect([...(filter?.chars ?? [])]).toEqual(["a"]);
  });

  it("returns null for a nullable alternative even if its own FIRST set is computable", () => {
    const grammar = createGrammarDefinition("T", [], []);
    const analysis = analyzeFirstSets(grammar);
    const filter = predictiveFilterForExpression(
      createOptional(createStringLiteral("a", '"')),
      analysis,
    );
    expect(filter).toBeNull();
  });

  it("returns null for an alternative whose FIRST set is unknown (e.g. AnyChar)", () => {
    const grammar = createGrammarDefinition("T", [], []);
    const analysis = analyzeFirstSets(grammar);
    expect(predictiveFilterForExpression(createAnyChar(), analysis)).toBeNull();
  });

  it("returns null for a non-nullable Sequence that starts with an external (out-of-grammar) Identifier", () => {
    // Regression for the Identifier-fallback bug: `r = ext "x" / "y"`
    // must never be predictively dispatched on alternative 0, since
    // `ext`'s FIRST set is unknowable from this grammar alone -- it could
    // start with anything, including something other than what makes
    // `"x"` the deciding character.
    const grammar = createGrammarDefinition("T", [], []);
    const analysis = analyzeFirstSets(grammar);
    const alt0 = createSequence([
      createIdentifier("ext"),
      createStringLiteral("x", '"'),
    ]);
    expect(predictiveFilterForExpression(alt0, analysis)).toBeNull();
  });
});
