import { describe, expect, it } from "bun:test";
import {
  type CharSet,
  complement,
  contains,
  difference,
  fromChar,
  fromCodePointRange,
  union,
} from "./char-set";
import {
  type FirstSet,
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
  createNegativeLookahead,
  createOptional,
  createQualifiedIdentifier,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "./types";

const ORIGIN = 0;

/** `true` iff `c` (a 1-code-point JS string) is a member of `fs`'s set.
 * Asserts `fs` isn't `unknown` first, since `.set` is meaningless there. */
const hasChar = (fs: FirstSet | undefined, c: string): boolean => {
  expect(fs?.unknown).toBe(false);
  return contains((fs as FirstSet).set, c.codePointAt(0) as number);
};

/** Same, for a bare `CharSet` (e.g. a `predictiveFilterForExpression`
 * result, which returns `CharSet | null` rather than a whole `FirstSet`). */
const setHasChar = (set: CharSet | null, c: string): boolean =>
  set !== null && contains(set, c.codePointAt(0) as number);

describe("computeFirstSets", () => {
  it("computes a single-character FIRST set for a StringLiteral rule", () => {
    const grammar = createGrammarDefinition(
      "T",
      [],
      [createRuleDefinition("r", createStringLiteral("abc", '"'))],
    );
    const fs = computeFirstSets(grammar).get("r");
    expect(fs?.unknown).toBe(false);
    expect(fs?.set).toEqual(fromChar("a"));
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
    expect(fs?.set).toEqual(fromCodePointRange("0", "9"));
  });

  it("computes the exact complement for a negated CharacterClass (no longer bails to unknown)", () => {
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
    const fs = computeFirstSets(grammar).get("notDigit");
    expect(fs?.unknown).toBe(false);
    expect(fs?.set).toEqual(complement(fromCodePointRange("0", "9")));
    expect(hasChar(fs, "a")).toBe(true);
    expect(hasChar(fs, "0")).toBe(false);
  });

  it("computes an exact code-point range for a CharacterClass with a non-BMP (astral) endpoint (no longer bails to unknown)", () => {
    // "\u{1F600}" (😀) is a surrogate pair in UTF-16, but `CharSet` works
    // over code points, so this is just another interval -- no special
    // casing needed, unlike the old UTF-16-code-unit-comparison scheme.
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
    const fs = computeFirstSets(grammar).get("emoji");
    expect(fs?.unknown).toBe(false);
    expect(fs?.set).toEqual(fromChar(astral));
    expect(hasChar(fs, astral)).toBe(true);
  });

  it("regression: a StringLiteral starting with an astral character gets the FULL code point, not just its lead surrogate", () => {
    // `expr.value[0]` (a single UTF-16 code unit) would give the lone
    // lead surrogate of "😀x" -- a different, invalid code point from
    // what `predictiveChoice`'s runtime check now compares against
    // (`input.codePointAt(offset)`, which decodes the whole pair). Using
    // that half-value here would make a `predictiveChoice`-dispatched
    // alternative starting with an astral character never match.
    const astral = "\u{1F600}";
    const grammar = createGrammarDefinition(
      "T",
      [],
      [createRuleDefinition("r", createStringLiteral(`${astral}x`, '"'))],
    );
    const fs = computeFirstSets(grammar).get("r");
    expect(fs?.unknown).toBe(false);
    expect(fs?.set).toEqual(fromChar(astral));
    expect(hasChar(fs, astral)).toBe(true);
    // The lone lead surrogate on its own is NOT what's in the set --
    // confirms this isn't accidentally passing via a code-unit match.
    expect(contains((fs as FirstSet).set, astral.charCodeAt(0))).toBe(false);
  });

  it("computes the universal set (⊤) for AnyChar, exactly -- not unknown", () => {
    const grammar = createGrammarDefinition(
      "T",
      [],
      [createRuleDefinition("r", createAnyChar())],
    );
    const fs = computeFirstSets(grammar).get("r");
    expect(fs?.unknown).toBe(false);
    expect(hasChar(fs, "a")).toBe(true);
    expect(hasChar(fs, "\u{1F600}")).toBe(true);
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
    expect(firstSets.get("a")?.set).toEqual(fromChar("x"));
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
    expect(fs?.set).toEqual(union(fromChar("a"), fromChar("b")));
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
    expect(fs?.set).toEqual(fromChar("a"));
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
    expect(fs?.set).toEqual(union(fromChar("-"), fromCodePointRange("0", "9")));
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
    expect(fs?.set).toEqual(union(fromChar("x"), fromChar("y")));
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
    expect(firstSets.get("value")?.set).toEqual(
      union(union(fromChar('"'), fromChar("[")), fromChar("{")),
    );
  });
});

describe("negative-lookahead subtraction (ALWAYS_FIRST)", () => {
  it('FIRST(!"x" [a-z]) excludes "x" -- the one character guaranteed to make the lookahead fail the sequence', () => {
    const seq = createSequence([
      createNegativeLookahead(createStringLiteral("x", '"')),
      createCharacterClass([createCharRange("a", "z")], false),
    ]);
    const grammar = createGrammarDefinition(
      "T",
      [],
      [createRuleDefinition("r", seq)],
    );
    const fs = computeFirstSets(grammar).get("r");
    expect(fs?.unknown).toBe(false);
    expect(hasChar(fs, "x")).toBe(false);
    expect(hasChar(fs, "a")).toBe(true);
    expect(hasChar(fs, "w")).toBe(true);
    expect(hasChar(fs, "y")).toBe(true);
    expect(hasChar(fs, "z")).toBe(true);
    expect(fs?.set).toEqual(
      difference(fromCodePointRange("a", "z"), fromChar("x")),
    );
  });

  it("does not subtract anything when the negated expression isn't a single-char class/literal (safe default: no-op)", () => {
    // `!(\"ab\") .` -- a multi-character literal isn't in
    // `alwaysMatchesSet`'s exact-cases list, so the subtrahend is empty
    // and FIRST is unaffected (still the full AnyChar set here).
    const seq = createSequence([
      createNegativeLookahead(createStringLiteral("ab", '"')),
      createAnyChar(),
    ]);
    const grammar = createGrammarDefinition(
      "T",
      [],
      [createRuleDefinition("r", seq)],
    );
    const fs = computeFirstSets(grammar).get("r");
    expect(fs?.unknown).toBe(false);
    expect(hasChar(fs, "a")).toBe(true);
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

  it("regression: memoization must not leak stale results into computeNullableRules's own mutating fixpoint", () => {
    // `r = s t`, `s = ""`, `t = ""` -- declared in this order so `r`'s
    // Identifier lookups for `s`/`t` are checked on pass 1, before `s`
    // and `t` themselves converge to nullable (which only happens once
    // their own rules are visited later in that same pass). If
    // `isNullable`'s memoization ever caches a sub-expression result
    // against the same (still-mutating) `nullableRules` map instance
    // `computeNullableRules` uses internally, `r`'s cached "s is not
    // (yet) nullable" verdict would stick even after `s` and `t` flip to
    // `true` -- an unsound *under*-approximation. `computeNullableRules`
    // must reach convergence using only the uncached recursive walk.
    const grammar = createGrammarDefinition(
      "T",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([createIdentifier("s"), createIdentifier("t")]),
        ),
        createRuleDefinition("s", createStringLiteral("", '"')),
        createRuleDefinition("t", createStringLiteral("", '"')),
      ],
    );
    const { nullableRules } = analyzeFirstSets(grammar);
    expect(nullableRules.get("s")).toBe(true);
    expect(nullableRules.get("t")).toBe(true);
    expect(nullableRules.get("r")).toBe(true);
  });

  it("caching the same expression against two different nullableRules maps never collides", () => {
    // Two independent analyses of grammars that happen to reuse the same
    // sub-expression object identity (e.g. two rules with structurally
    // identical, separately-constructed patterns don't collide either,
    // but this directly exercises the WeakMap-of-WeakMap keying: the same
    // `expr` object queried against two different map instances must not
    // read back the other map's cached answer).
    const expr = createIdentifier("x");
    const mapA = new Map<string, boolean>([["x", true]]);
    const mapB = new Map<string, boolean>([["x", false]]);
    expect(isNullable(expr, mapA)).toBe(true);
    expect(isNullable(expr, mapB)).toBe(false);
    // Re-check in reverse order too, to rule out call-order sensitivity.
    expect(isNullable(expr, mapB)).toBe(false);
    expect(isNullable(expr, mapA)).toBe(true);
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
    expect(setHasChar(filter, "a")).toBe(true);
    expect(filter).toEqual(fromChar("a"));
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

  it("returns null for an alternative whose FIRST set is unknown (e.g. a cross-module QualifiedIdentifier)", () => {
    const grammar = createGrammarDefinition("T", [], []);
    const analysis = analyzeFirstSets(grammar);
    expect(
      predictiveFilterForExpression(
        createQualifiedIdentifier("other", "rule"),
        analysis,
      ),
    ).toBeNull();
  });

  it("returns a concrete (universal) filter for AnyChar, not null -- '.' is now exact (⊤), not unknown", () => {
    // Doesn't change predictiveChoice's runtime behavior (a filter that
    // matches every character filters nothing, same net effect as a
    // `null`/"always attempt" filter), but is the more principled result:
    // `.` really does match everything, so there is no reason to fall
    // back to "couldn't determine" for it now that the CharSet
    // representation can say ⊤ exactly.
    const grammar = createGrammarDefinition("T", [], []);
    const analysis = analyzeFirstSets(grammar);
    const filter = predictiveFilterForExpression(createAnyChar(), analysis);
    expect(filter).not.toBeNull();
    expect(setHasChar(filter, "a")).toBe(true);
    expect(setHasChar(filter, "\u{1F600}")).toBe(true);
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
