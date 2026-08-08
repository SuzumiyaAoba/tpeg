/**
 * Correctness tests for regex fusion: `isRuleFusable`'s two
 * gates (structural + determinism) and `emitFusedRule`'s shape
 * reconstruction, exercised both at the unit level and end-to-end
 * through `generateOptimizedTypeScriptParser({ enableRegexFusion: true })`.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { analyzeFirstSets } from "./first-sets";
import { grammarDefinition } from "./grammar";
import { isRuleFusable, planFusion } from "./regex-fusion";
import {
  createActionExpression,
  createAnyChar,
  createCharRange,
  createCharacterClass,
  createChoice,
  createGrammarDefinition,
  createIdentifier,
  createLabeledExpression,
  createOptional,
  createPlus,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "./types";
import type { GrammarDefinition } from "./types";

const ORIGIN = 0;

/** Parses `src`, computes FIRST-set analysis, and returns a lookup from
 * rule name to `isRuleFusable`'s verdict -- the shape most tests below
 * want to assert against. */
function fusabilityByRule(src: string): Record<string, boolean> {
  const parsed = grammarDefinition(src, ORIGIN);
  if (!parsed.success) {
    throw new Error(`test grammar failed to parse: ${parsed.error.message}`);
  }
  const analysis = analyzeFirstSets(parsed.val);
  const result: Record<string, boolean> = {};
  for (const rule of parsed.val.rules) {
    result[rule.name] = isRuleFusable(rule, analysis);
  }
  return result;
}

async function compileRuleFor(grammar: GrammarDefinition, ruleName: string) {
  const core = await import("@suzumiyaaoba/tpeg-core");
  const generated = generateOptimizedTypeScriptParser(grammar, {
    includeImports: false,
    includeTypes: false,
    optimize: true,
    enableRegexFusion: true,
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

const JSON_LIKE_GRAMMAR = `
grammar JsonLike {
  value = string / number / boolean / nullLiteral / object / array
  string = "\\"" [^"]* "\\""
  number = "-"? [0-9]+ ("." [0-9]+)?
  boolean = "true" / "false"
  nullLiteral = "null"
  object = "{" (pair ("," pair)*)? "}"
  pair = string ":" value
  array = "[" (value ("," value)*)? "]"
}
`;

describe("isRuleFusable: structural + determinism gates", () => {
  it("marks every non-terminal-free rule of a JSON-like grammar fusable, and every rule referencing another rule not", () => {
    const fusable = fusabilityByRule(JSON_LIKE_GRAMMAR);
    expect(fusable["string"]).toBe(true);
    expect(fusable["number"]).toBe(true);
    expect(fusable["boolean"]).toBe(true);
    expect(fusable["nullLiteral"]).toBe(true);
    expect(fusable["value"]).toBe(false);
    expect(fusable["object"]).toBe(false);
    expect(fusable["pair"]).toBe(false);
    expect(fusable["array"]).toBe(false);
  });

  it('rejects the classic possessive-vs-backtracking counterexample: "[a-z]* \\"x\\"" is NOT fusable, because FIRST([a-z]) and FIRST("x") are not disjoint', () => {
    const fusable = fusabilityByRule(`
      grammar G {
        r = [a-z]* "x"
      }
    `);
    expect(fusable["r"]).toBe(false);
  });

  it("accepts a repetition at the trailing edge of the fused region (nothing follows within the pattern), even though the same repetition's inner FIRST set is non-empty", () => {
    const fusable = fusabilityByRule(`
      grammar G {
        r = [a-z]*
      }
    `);
    expect(fusable["r"]).toBe(true);
  });

  it('accepts a repetition whose immediate follower is nullable but whose PROPERLY COMPOSED tail is disjoint: number = "-"? [0-9]+ ("." [0-9]+)?', () => {
    // This is the case the original two-clause condition
    // ("FIRST(e) ∩ FIRST(next) = ∅ AND next non-nullable") would have
    // wrongly rejected: `("." [0-9]+)?` immediately after the first
    // `[0-9]+` IS nullable. The refined condition (composing the FIRST
    // of everything remaining in the fused region, folding through
    // nullable elements) correctly finds this safe: with nothing after
    // the trailing optional group, its "follow" collapses to empty, and
    // an empty first-set is disjoint from anything.
    const fusable = fusabilityByRule(`
      grammar G {
        number = "-"? [0-9]+ ("." [0-9]+)?
      }
    `);
    expect(fusable["number"]).toBe(true);
  });

  it("accepts a Choice with overlapping (non-FIRST-disjoint) alternatives when nothing follows it in the fused region (trailing edge -- no downstream requirement can ever trigger alternation backtracking), and produces correct output on inputs that would discriminate a wrong implementation", async () => {
    const fusable = fusabilityByRule(`
      grammar G {
        r = "ab" / "ac"
      }
    `);
    expect(fusable["r"]).toBe(true);

    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createStringLiteral("ab", '"'),
            createStringLiteral("ac", '"'),
          ]),
        ),
      ],
    );
    const r = await compileRuleFor(grammar, "r");
    const ab = r("ab", ORIGIN);
    expect(ab.success).toBe(true);
    if (ab.success) {
      expect(ab.val).toBe("ab");
      expect(ab.next).toBe(2);
    }
    const ac = r("ac", ORIGIN);
    expect(ac.success).toBe(true);
    if (ac.success) {
      expect(ac.val).toBe("ac");
      expect(ac.next).toBe(2);
    }
    // "a" alone: neither alternative fully matches ("ab"/"ac" both need
    // a 2nd character) -- must fail, not partially match "a".
    expect(r("a", ORIGIN).success).toBe(false);
    // "ax": same reasoning -- no alternative matches "ax" in full.
    expect(r("ax", ORIGIN).success).toBe(false);
  });

  it('rejects a Choice with overlapping alternatives when something DOES follow it: "ab" / "a", then "b" -- PEG commits to "ab" on input "ab" and then fails to find "b", never backtracking into "a"; a naive `/(?:ab|a)b/` WOULD backtrack into "a" and incorrectly succeed', () => {
    const fusable = fusabilityByRule(`
      grammar G {
        r = ("ab" / "a") "b"
      }
    `);
    expect(fusable["r"]).toBe(false);
  });

  it("rejects a Choice with a nullable alternative when something follows the Choice within the fused region", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createChoice([
              createOptional(createStringLiteral("a", '"')),
              createStringLiteral("b", '"'),
            ]),
            createStringLiteral("c", '"'),
          ]),
        ),
      ],
    );
    const analysis = analyzeFirstSets(grammar);
    const rule = grammar.rules[0];
    if (!rule) throw new Error("expected rule");
    expect(isRuleFusable(rule, analysis)).toBe(false);
  });

  it("accepts the same nullable-alternative Choice when it sits at the trailing edge (nothing follows it), and produces output identical to the unfused combinator tree across discriminating inputs", async () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createOptional(createStringLiteral("a", '"')),
            createStringLiteral("b", '"'),
          ]),
        ),
      ],
    );
    const analysis = analyzeFirstSets(grammar);
    const rule = grammar.rules[0];
    if (!rule) throw new Error("expected rule");
    expect(isRuleFusable(rule, analysis)).toBe(true);

    const core = await import("@suzumiyaaoba/tpeg-core");
    const compile = (enableRegexFusion: boolean) => {
      const generated = generateOptimizedTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
        optimize: true,
        enableRegexFusion,
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
      return built["r"] as (
        input: string,
        pos: number,
      ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;
    };

    const unfused = compile(false);
    const fused = compile(true);

    // "a" matches the first (nullable) alternative's non-empty branch;
    // "b" and "z" and "" all take the first alternative's EMPTY branch
    // (Optional always succeeds, PEG's ordered choice never reaches the
    // second alternative once the first has "matched" at all, even
    // trivially) -- these inputs are chosen to discriminate a wrong
    // fusion (e.g. one that let the second alternative win instead).
    for (const input of ["a", "b", "z", ""]) {
      const unfusedResult = unfused(input, ORIGIN);
      const fusedResult = fused(input, ORIGIN);
      expect(fusedResult.success).toBe(unfusedResult.success);
      if (unfusedResult.success && fusedResult.success) {
        expect(fusedResult.val).toEqual(unfusedResult.val);
        expect(fusedResult.next).toEqual(unfusedResult.next);
      }
    }
  });

  it("rejects Optional when its inner FIRST set overlaps what follows it in the fused region (regression: Optional was wrongly treated as a transparent Group, letting the emitted `(?:(X))?` backtrack to empty where PEG's possessive optional never would)", () => {
    for (const src of [
      `grammar G { r = "a"? "ab" }`,
      `grammar G { r = ("a" "b")? "ab" }`,
      `grammar G { r = [a-z]? [a-z] "x" }`,
      `grammar G { r = "a"? "a"? "ab" }`,
      `grammar G { r = "a"? [a-b] "b" }`,
    ]) {
      const fusable = fusabilityByRule(src);
      expect(fusable["r"]).toBe(false);
    }
  });

  it('produces output identical to the unfused combinator tree for "a"? "ab" across inputs that distinguish possessive (PEG) from backtracking (naive regex) optional semantics -- before the fix, "ab" and "aba" wrongly succeeded when fused', async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createOptional(createStringLiteral("a", '"')),
            createStringLiteral("ab", '"'),
          ]),
        ),
      ],
    );
    const analysis = analyzeFirstSets(grammar);
    const rule = grammar.rules[0];
    if (!rule) throw new Error("expected rule");
    // The fix must make this rule ineligible for fusion in the first
    // place -- if it were still marked fusable, `emitFusedRule` would
    // reintroduce the divergence this test guards against.
    expect(isRuleFusable(rule, analysis)).toBe(false);

    const compile = (enableRegexFusion: boolean) => {
      const generated = generateOptimizedTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
        optimize: true,
        enableRegexFusion,
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
      return built["r"] as (
        input: string,
        pos: number,
      ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;
    };

    const unfused = compile(false);
    // With the fix, `enableRegexFusion: true` on this grammar never
    // fuses `r` at all (isRuleFusable is false), so "fused" here means
    // "codegen ran with the flag on, and correctly declined to fuse."
    const fused = compile(true);

    for (const input of ["ab", "aab", "aba"]) {
      const unfusedResult = unfused(input, ORIGIN);
      const fusedResult = fused(input, ORIGIN);
      expect(fusedResult.success).toBe(unfusedResult.success);
      if (unfusedResult.success && fusedResult.success) {
        expect(fusedResult.val).toEqual(unfusedResult.val);
        expect(fusedResult.next).toEqual(unfusedResult.next);
      }
    }
    // Spell out the specific regression directly: "ab" and "aba" must
    // FAIL (the leading "a"? consumes "a" possessively, leaving only
    // "b"/"ba" for the required "ab" literal, which cannot match).
    expect(unfused("ab", ORIGIN).success).toBe(false);
    expect(fused("ab", ORIGIN).success).toBe(false);
    expect(unfused("aba", ORIGIN).success).toBe(false);
    expect(fused("aba", ORIGIN).success).toBe(false);
  });

  it("rejects a Star wrapping a multi-character StringLiteral (Array.from(run) can't recover per-iteration chunks)", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [createRuleDefinition("r", createStar(createStringLiteral("ab", '"')))],
    );
    const analysis = analyzeFirstSets(grammar);
    const rule = grammar.rules[0];
    if (!rule) throw new Error("expected rule");
    expect(isRuleFusable(rule, analysis)).toBe(false);
  });

  it("rejects a Star wrapping a compound Sequence (regex has no way to capture per-iteration submatches from a repeated group)", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "r",
          createStar(
            createSequence([
              createStringLiteral("a", '"'),
              createStringLiteral("b", '"'),
            ]),
          ),
        ),
      ],
    );
    const analysis = analyzeFirstSets(grammar);
    const rule = grammar.rules[0];
    if (!rule) throw new Error("expected rule");
    expect(isRuleFusable(rule, analysis)).toBe(false);
  });

  it("rejects a rule containing an ActionExpression, a LabeledExpression, or an Identifier reference", () => {
    const withAction = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "r",
          createActionExpression(createStringLiteral("a", '"'), "return 1;"),
        ),
      ],
    );
    const withLabel = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "r",
          createLabeledExpression("x", createStringLiteral("a", '"')),
        ),
      ],
    );
    const withIdentifier = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition("r", createIdentifier("other")),
        createRuleDefinition("other", createStringLiteral("a", '"')),
      ],
    );
    for (const grammar of [withAction, withLabel, withIdentifier]) {
      const analysis = analyzeFirstSets(grammar);
      const rule = grammar.rules[0];
      if (!rule) throw new Error("expected rule");
      expect(isRuleFusable(rule, analysis)).toBe(false);
    }
  });
});

describe("generateOptimizedTypeScriptParser({ enableRegexFusion: true, includeImports: true }): import generation", () => {
  it("imports regexFusedMap from tpeg-core when at least one rule is fused, alongside the combinators non-fused rules still need", () => {
    const parsed = grammarDefinition(JSON_LIKE_GRAMMAR, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const generated = generateOptimizedTypeScriptParser(parsed.val, {
      includeImports: true,
      includeTypes: false,
      optimize: true,
      enableRegexFusion: true,
    });

    const coreImportLine = generated.code
      .split("\n")
      .find(
        (line) =>
          line.startsWith("import {") &&
          line.includes('from "@suzumiyaaoba/tpeg-core"'),
      );
    expect(coreImportLine).toBeDefined();
    // A fused rule compiles to a single `regexFusedMap(...)` call
    // (`packages/core/src/regex-fused.ts`) rather than `map(regexFused(
    // ...), ...)` -- see `regex-fusion.ts`'s `emit`/`emitFusedExpression`
    // doc comments for why this collapses the fixed
    // per-match allocation count.
    expect(coreImportLine).toContain("regexFusedMap");
    // `object`/`pair`/`array`/`value` reference other rules and stay
    // unfused -- their combinators must still be imported (this is the
    // exact shape of bug the module doc comment on
    // `generateOptimizedImports` warns about: a combinator emitted in a
    // rule body without a matching import is a ReferenceError at
    // runtime, not a compile error, since generated code is untyped
    // when `includeTypes: false`).
    expect(coreImportLine).toContain("sequence");
    expect(coreImportLine).toContain("choice");
  });

  it("compiles and runs correctly end to end with includeImports: true (imports actually resolve, not just textually present)", async () => {
    const parsed = grammarDefinition(JSON_LIKE_GRAMMAR, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const generated = generateOptimizedTypeScriptParser(parsed.val, {
      includeImports: true,
      includeTypes: false,
      optimize: true,
      enableRegexFusion: true,
    });

    const core = await import("@suzumiyaaoba/tpeg-core");
    const body = generated.code
      .replace(/^import[^\n]*\n?/gm, "")
      .replace(/^export const (\w+)/gm, "const $1");
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
    const value = built["value"] as (
      input: string,
      pos: number,
    ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;

    const result = value('{"a":1}', ORIGIN);
    expect(result.success).toBe(true);
  });
});

describe("emitFusedRule + generateOptimizedTypeScriptParser({ enableRegexFusion: true }): end-to-end shape preservation", () => {
  it("produces a rule whose compiled output is identical (.success, .val, .next) to the unfused codegen path, across a battery of JSON inputs", async () => {
    const parsed = grammarDefinition(JSON_LIKE_GRAMMAR, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const core = await import("@suzumiyaaoba/tpeg-core");
    const compile = (enableRegexFusion: boolean) => {
      const generated = generateOptimizedTypeScriptParser(parsed.val, {
        includeImports: false,
        includeTypes: false,
        optimize: true,
        enableMemoization: true,
        enablePredictiveDispatch: true,
        enableRegexFusion,
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
      return built["value"] as (
        input: string,
        pos: number,
      ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;
    };

    const unfused = compile(false);
    const fused = compile(true);

    const inputs = [
      '"hello"',
      '""',
      '"with \\\\ backslash-escaped text"',
      "123",
      "-123",
      "3.14",
      "-0.5",
      "true",
      "false",
      "null",
      '{"a":1,"b":[1,2,3]}',
      "{}",
      "[]",
      '["x","y"]',
      "not valid json",
      "",
    ];

    for (const input of inputs) {
      const unfusedResult = unfused(input, ORIGIN);
      const fusedResult = fused(input, ORIGIN);
      expect(fusedResult.success).toBe(unfusedResult.success);
      if (unfusedResult.success && fusedResult.success) {
        expect(fusedResult.val).toEqual(unfusedResult.val);
        expect(fusedResult.next).toEqual(unfusedResult.next);
      }
    }
  });

  it("reconstructs a Star run's array shape exactly, including the zero-repetition empty-array case", async () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "r",
          createStar(createCharacterClass([createCharRange("0", "9")], false)),
        ),
      ],
    );
    const rule = grammar.rules[0];
    if (!rule) throw new Error("expected rule");
    const analysis = analyzeFirstSets(grammar);
    expect(isRuleFusable(rule, analysis)).toBe(true);

    const r = await compileRuleFor(grammar, "r");
    const nonEmpty = r("123x", ORIGIN);
    expect(nonEmpty.success).toBe(true);
    if (nonEmpty.success) {
      expect(nonEmpty.val).toEqual(["1", "2", "3"]);
      expect(nonEmpty.next).toBe(3);
    }
    const empty = r("x", ORIGIN);
    expect(empty.success).toBe(true);
    if (empty.success) {
      expect(empty.val).toEqual([]);
      expect(empty.next).toBe(0);
    }
  });

  it("reconstructs an Optional's [T] | [] shape exactly (not T | null)", async () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([
            createOptional(createStringLiteral("-", '"')),
            createPlus(
              createCharacterClass([createCharRange("0", "9")], false),
            ),
          ]),
        ),
      ],
    );
    const rule = grammar.rules[0];
    if (!rule) throw new Error("expected rule");
    const analysis = analyzeFirstSets(grammar);
    expect(isRuleFusable(rule, analysis)).toBe(true);

    const r = await compileRuleFor(grammar, "r");
    const withSign = r("-42", ORIGIN);
    expect(withSign.success).toBe(true);
    if (withSign.success) expect(withSign.val).toEqual([["-"], ["4", "2"]]);

    const withoutSign = r("42", ORIGIN);
    expect(withoutSign.success).toBe(true);
    if (withoutSign.success) expect(withoutSign.val).toEqual([[], ["4", "2"]]);
  });

  it("reconstructs a Choice's value as whichever alternative matched, using AnyChar and multi-alternative markers", async () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createStringLiteral("true", '"'),
            createStringLiteral("false", '"'),
            createAnyChar(),
          ]),
        ),
      ],
    );
    const rule = grammar.rules[0];
    if (!rule) throw new Error("expected rule");
    const analysis = analyzeFirstSets(grammar);
    expect(isRuleFusable(rule, analysis)).toBe(true);

    const r = await compileRuleFor(grammar, "r");
    const t = r("true", ORIGIN);
    expect(t.success).toBe(true);
    if (t.success) expect(t.val).toBe("true");

    const f = r("false", ORIGIN);
    expect(f.success).toBe(true);
    if (f.success) expect(f.val).toBe("false");

    const other = r("z", ORIGIN);
    expect(other.success).toBe(true);
    if (other.success) expect(other.val).toBe("z");
  });

  it("emitFusedRule's regex source correctly matches an astral (surrogate-pair) character class range", async () => {
    // U+1F600 (😀) .. U+1F64F, expressed via the AST's raw code-point
    // strings the same way the grammar parser would produce them.
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "r",
          createPlus(
            createCharacterClass(
              [createCharRange("\u{1F600}", "\u{1F64F}")],
              false,
            ),
          ),
        ),
      ],
    );
    const rule = grammar.rules[0];
    if (!rule) throw new Error("expected rule");
    const analysis = analyzeFirstSets(grammar);
    expect(isRuleFusable(rule, analysis)).toBe(true);

    const r = await compileRuleFor(grammar, "r");
    const result = r("\u{1F600}\u{1F601}x", ORIGIN);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["\u{1F600}", "\u{1F601}"]);
      expect(result.next).toBe(4); // 2 astral chars = 4 UTF-16 code units
    }
  });

  it("does not fuse a rule that another rule's ActionExpression destructures positionally -- shape is preserved end to end regardless (no cross-rule analysis needed)", async () => {
    // `pair` (with an action) references `digits` (a fused rule) as a
    // Sequence element. Since `emitFusedRule` reconstructs the ORIGINAL
    // array shape, `pair`'s action sees the exact same array shape
    // whether or not `digits` was internally compiled via a regex.
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "pair",
          createActionExpression(
            createSequence([
              createIdentifier("digits"),
              createStringLiteral(":", '"'),
              createIdentifier("digits"),
            ]),
            "return $$[0].length + $$[2].length;",
          ),
        ),
        createRuleDefinition(
          "digits",
          createPlus(createCharacterClass([createCharRange("0", "9")], false)),
        ),
      ],
    );
    const analysis = analyzeFirstSets(grammar);
    const digitsRule = grammar.rules[1];
    if (!digitsRule) throw new Error("expected digits rule");
    expect(isRuleFusable(digitsRule, analysis)).toBe(true);
    const pairRule = grammar.rules[0];
    if (!pairRule) throw new Error("expected pair rule");
    expect(isRuleFusable(pairRule, analysis)).toBe(false);

    const generated = generateOptimizedTypeScriptParser(grammar, {
      includeImports: false,
      includeTypes: false,
      optimize: true,
      enableRegexFusion: true,
    });
    // `digits` compiled via regexFusedMap; `pair` did not (it has an
    // ActionExpression, structurally disqualifying).
    expect(generated.code).toContain("regexFusedMap(");
    const digitsBlock = generated.code
      .split("\n\n")
      .find((block) => block.startsWith("export const digits"));
    expect(digitsBlock).toContain("regexFusedMap(");

    const core = await import("@suzumiyaaoba/tpeg-core");
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
    const pair = built["pair"] as (
      input: string,
      pos: number,
    ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;

    const result = pair("123:45", ORIGIN);
    expect(result.success).toBe(true);
    if (result.success) {
      // `digits`'s reconstructed value is `["1","2","3"]` and `["4","5"]`
      // -- exactly the array shape `oneOrMore(charClass(...))` would
      // have produced -- so the action's `.length` reads are correct
      // (3 + 2 = 5), proving the fused rule's value reached the action
      // with its original shape intact.
      expect(result.val).toBe(5);
    }
  });

  it("produces identical results to the unfused path on the real calculator.tpeg example grammar (packages/parser-sample/examples/calculator.tpeg), across a battery of arithmetic inputs", async () => {
    const calculatorSrc = readFileSync(
      join(
        import.meta.dir,
        "..",
        "..",
        "parser-sample",
        "examples",
        "calculator.tpeg",
      ),
      "utf8",
    );
    // The file is a full module (with @-annotations); extract just the
    // `grammar Calculator { ... }` block the same way this package's
    // other real-file-based tests do, since `grammarDefinition` (unlike
    // `tpegModuleFile`) parses a single grammar block, not a module.
    const grammarMatch = calculatorSrc.match(/grammar[\s\S]*\n}/);
    expect(grammarMatch).not.toBeNull();
    const parsed = grammarDefinition(grammarMatch?.[0] ?? "", ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // `number`'s pattern (`[0-9]+ ("." [0-9]+)?`) and `whitespace`'s
    // (`[ \t\n\r]*`) are wholly non-terminal-free; the rest of the
    // grammar (`expression`/`term`/`factor`) references them via
    // Identifier and so stays unfused.
    const analysis = analyzeFirstSets(parsed.val);
    const numberRule = parsed.val.rules.find((r) => r.name === "number");
    expect(numberRule).toBeDefined();
    if (numberRule) expect(isRuleFusable(numberRule, analysis)).toBe(true);

    const core = await import("@suzumiyaaoba/tpeg-core");
    const compile = (enableRegexFusion: boolean) => {
      const generated = generateOptimizedTypeScriptParser(parsed.val, {
        includeImports: false,
        includeTypes: false,
        optimize: true,
        enableMemoization: true,
        enablePredictiveDispatch: true,
        enableRegexFusion,
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
      return built["expression"] as (
        input: string,
        pos: number,
      ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;
    };

    const unfused = compile(false);
    const fused = compile(true);

    const inputs = [
      "1",
      "1+2",
      "1 + 2",
      "1+2*3",
      "(1+2)*3",
      "3.14+2.71",
      "1*2*3*4",
      "(((1)))",
      "1+",
      "",
      "abc",
    ];
    for (const input of inputs) {
      const unfusedResult = unfused(input, ORIGIN);
      const fusedResult = fused(input, ORIGIN);
      expect(fusedResult.success).toBe(unfusedResult.success);
      if (unfusedResult.success && fusedResult.success) {
        expect(fusedResult.val).toEqual(unfusedResult.val);
        expect(fusedResult.next).toEqual(unfusedResult.next);
      }
    }
  });

  it("advances line/column correctly across a fused match that spans a newline -- regexFused's single advancePos(text, pos) call must agree with per-character nextPos, exercised via calculator.tpeg's own whitespace = [ \\t\\n\\r]*", async () => {
    const calculatorSrc = readFileSync(
      join(
        import.meta.dir,
        "..",
        "..",
        "parser-sample",
        "examples",
        "calculator.tpeg",
      ),
      "utf8",
    );
    const grammarMatch = calculatorSrc.match(/grammar[\s\S]*\n}/);
    const parsed = grammarDefinition(grammarMatch?.[0] ?? "", ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const analysis = analyzeFirstSets(parsed.val);
    const whitespaceRule = parsed.val.rules.find(
      (r) => r.name === "whitespace",
    );
    expect(whitespaceRule).toBeDefined();
    if (whitespaceRule) {
      expect(isRuleFusable(whitespaceRule, analysis)).toBe(true);
    }

    const core = await import("@suzumiyaaoba/tpeg-core");
    const compile = (enableRegexFusion: boolean) => {
      const generated = generateOptimizedTypeScriptParser(parsed.val, {
        includeImports: false,
        includeTypes: false,
        optimize: true,
        enableRegexFusion,
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
      return built["whitespace"] as (
        input: string,
        pos: number,
      ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;
    };

    const unfused = compile(false);
    const fused = compile(true);

    for (const input of [" \t\n\n  \r\n", "\n\n\nx", "no whitespace here"]) {
      const unfusedResult = unfused(input, ORIGIN);
      const fusedResult = fused(input, ORIGIN);
      expect(fusedResult.success).toBe(unfusedResult.success);
      if (unfusedResult.success && fusedResult.success) {
        expect(fusedResult.val).toEqual(unfusedResult.val);
        // The assertion this test exists for: line/column, not just
        // offset, must agree after consuming embedded newlines.
        expect(fusedResult.next).toEqual(unfusedResult.next);
      }
    }
  });

  it('produces identical results to the unfused path when a fused rule is referenced through a LABEL and consumed by an ActionExpression (docs/peg-grammar.md\'s label-capture idiom: `left:number "+" right:number { return left + right; }`)', async () => {
    const src = `
      grammar LabelAction {
        number = [0-9]+
        sum = left:number "+" right:number { return left.length + right.length; }
      }
    `;
    const parsed = grammarDefinition(src, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const analysis = analyzeFirstSets(parsed.val);
    const numberRule = parsed.val.rules.find((r) => r.name === "number");
    const sumRule = parsed.val.rules.find((r) => r.name === "sum");
    expect(numberRule).toBeDefined();
    expect(sumRule).toBeDefined();
    if (numberRule) expect(isRuleFusable(numberRule, analysis)).toBe(true);
    // `sum` contains LabeledExpression + ActionExpression -- structurally
    // disqualified regardless of what it references.
    if (sumRule) expect(isRuleFusable(sumRule, analysis)).toBe(false);

    const core = await import("@suzumiyaaoba/tpeg-core");
    const compile = (enableRegexFusion: boolean) => {
      const generated = generateOptimizedTypeScriptParser(parsed.val, {
        includeImports: false,
        includeTypes: false,
        optimize: true,
        enableRegexFusion,
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
      return built["sum"] as (
        input: string,
        pos: number,
      ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;
    };

    const unfused = compile(false);
    const fused = compile(true);

    for (const input of ["12+345", "0+0", "1+", "+1", ""]) {
      const unfusedResult = unfused(input, ORIGIN);
      const fusedResult = fused(input, ORIGIN);
      expect(fusedResult.success).toBe(unfusedResult.success);
      if (unfusedResult.success && fusedResult.success) {
        expect(fusedResult.val).toEqual(unfusedResult.val);
        expect(fusedResult.next).toEqual(unfusedResult.next);
      }
    }
    // "12+345" -> left="12" (length 2), right="345" (length 3) -> 5.
    // Pins that the label destructure sees the fused `number` rule's
    // reconstructed array (`["1","2"]`), not something regex-shaped.
    const result = fused("12+345", ORIGIN);
    expect(result.success).toBe(true);
    if (result.success) expect(result.val).toBe(5);
  });
});

/** Parses `src`, generates it with `enableRegexFusion: true` and the
 * given `scope`, and returns the compiled parser for `ruleName` -- the
 * sub-expression-fusion counterpart of `compileRuleFor` above (which is
 * always whole-rule scope). Parses TPEG source text directly rather than
 * building an AST by hand, since the grammars below (labels, actions,
 * lookaheads, cuts) are much more readable written out. */
async function compileScopedRule(
  src: string,
  ruleName: string,
  scope: "rule" | "subtree",
) {
  const parsed = grammarDefinition(src, ORIGIN);
  if (!parsed.success) {
    throw new Error(`test grammar failed to parse: ${parsed.error.message}`);
  }
  const core = await import("@suzumiyaaoba/tpeg-core");
  const generated = generateOptimizedTypeScriptParser(parsed.val, {
    includeImports: false,
    includeTypes: false,
    optimize: true,
    enableRegexFusion: true,
    regexFusionScope: scope,
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
  return {
    parser: built[ruleName] as (
      input: string,
      pos: number,
    ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>,
    code: generated.code,
  };
}

/** Runs `input` through both `unfused` and `fused` and asserts they agree
 * on success, stop offset, and value -- the standard differential shape
 * every test below uses to check a fusion decision is semantics-
 * preserving, not just "compiles." */
async function expectSameResult(
  unfused: (
    input: string,
    pos: number,
  ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>,
  fused: (
    input: string,
    pos: number,
  ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>,
  input: string,
) {
  const unfusedResult = unfused(input, ORIGIN);
  const fusedResult = fused(input, ORIGIN);
  expect(fusedResult.success).toBe(unfusedResult.success);
  if (unfusedResult.success && fusedResult.success) {
    expect(fusedResult.val).toEqual(unfusedResult.val);
    expect(fusedResult.next).toEqual(unfusedResult.next);
  }
}

describe("planFusion: sub-expression fusion", () => {
  it("does not treat a bare CharacterClass/StringLiteral as a fusion root under scope: subtree (weight 1 < MIN_FUSION_WEIGHT) -- fusing it would be a pessimization relative to charClass/literal's own zero-allocation success path", () => {
    const parsed = grammarDefinition(
      `grammar G { r = [a-z] "x" other \n other = "y" }`,
      ORIGIN,
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const analysis = analyzeFirstSets(parsed.val);
    const plan = planFusion(parsed.val, analysis, { scope: "subtree" });
    expect(plan.roots.size).toBe(0);
  });

  it("treats a Sequence of 3+ leaves as a fusion root under scope: subtree (weight 3 clears MIN_FUSION_WEIGHT), and always treats an unbounded repetition as one regardless of weight", () => {
    // `seq3` and `other` are each their OWN rule (rather than `seq3`'s
    // elements sitting directly inside `r`'s own Sequence alongside an
    // `Identifier`) deliberately: mixing a disqualifying `Identifier`
    // into the SAME `Sequence` as `seq3`'s leaves would disqualify that
    // whole `Sequence`, and `planFusion` does not attempt to fuse a
    // partial PREFIX run of an otherwise-disqualified `Sequence` (see
    // `planFusion`'s doc comment's "explicit non-goal" -- fusing only
    // `[A,B]` out of `[A,B,C]` would change `sequence()`'s tuple arity).
    // Each rule's OWN pattern is a separate, independently-evaluated
    // root candidate (`planFusion` visits every rule's pattern, not just
    // the start rule's).
    const parsed = grammarDefinition(
      `grammar G {
        r = seq3 other
        seq3 = [a-z] "x" [0-9]
        other = [a-z]+
      }`,
      ORIGIN,
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const analysis = analyzeFirstSets(parsed.val);
    const plan = planFusion(parsed.val, analysis, { scope: "subtree" });
    // Two roots expected: `seq3`'s whole pattern (weight 3), and
    // `other`'s whole `[a-z]+` pattern (weight Infinity). `r` itself
    // contributes none -- both its elements are `Identifier`s.
    expect(plan.roots.size).toBe(2);
    const weights = plan.sites.map((s) => s.weight).sort();
    expect(weights[0]).toBe(3);
    expect(weights[1]).toBe(Number.POSITIVE_INFINITY);
  });

  it('fuses only the trailing repetition of `[a-z]* "x"`, not the whole rule (the classic possessive-vs-backtracking counterexample) -- and produces output identical to the unfused path across discriminating inputs', async () => {
    const src = `grammar G { r = [a-z]* "x" }`;
    const parsed = grammarDefinition(src, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const analysis = analyzeFirstSets(parsed.val);

    // Whole-rule fusion correctly refuses `r` (the classic
    // [a-z]* "x" counterexample); subtree fusion must ALSO refuse `r`
    // as a whole, but should find the Star alone (trailing edge within
    // the Sequence, so its own `tail` is empty) fusable and profitable.
    expect(isRuleFusable(parsed.val.rules[0] as never, analysis)).toBe(false);
    const plan = planFusion(parsed.val, analysis, { scope: "subtree" });
    expect(plan.roots.size).toBe(1);
    const [site] = plan.sites;
    expect(site?.expr.type).toBe("Star");

    const unfusedResult = await compileScopedRule(src, "r", "rule");
    const fusedResult = await compileScopedRule(src, "r", "subtree");
    // scope: "rule" leaves `r` entirely unfused (isRuleFusable is false).
    expect(unfusedResult.code).not.toContain("regexFusedMap(");
    // scope: "subtree" fuses the Star alone.
    expect(fusedResult.code).toContain("regexFusedMap(");

    for (const input of ["x", "abcx", "abc", "", "abcxyz", "abcxx"]) {
      await expectSameResult(unfusedResult.parser, fusedResult.parser, input);
    }
  });

  it('fuses the compound repeated body of `("ab" "cd" "ef")* "!"` -- Star itself stays unfused (isSimpleRepeatable rejects a Sequence body), but the Sequence it wraps becomes its own fusion root, reached by recursing INTO the Star -- one `zeroOrMore(regexFusedMap(...))` call per iteration instead of a chain of literal() calls per iteration', async () => {
    const src = `grammar G { r = ("ab" "cd" "ef")* "!" }`;
    const parsed = grammarDefinition(src, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const analysis = analyzeFirstSets(parsed.val);
    const plan = planFusion(parsed.val, analysis, { scope: "subtree" });
    expect(plan.roots.size).toBe(1);
    const [site] = plan.sites;
    // TPEG's `(...)` produces a `Group` node wrapping the inner
    // Sequence, not the Sequence directly -- `Star`'s `.expression` IS
    // that Group. `tryRoot` fuses the Group as-is (its structural/
    // determinism checks and `weight` both delegate transparently to the
    // inner Sequence, and `emit`'s `Group` case likewise emits the
    // inner's pattern/valueExpr with no wrapping capture group), so
    // fusing the Group is byte-identical to fusing the Sequence would
    // have been.
    expect(site?.expr.type).toBe("Group");
    expect(site?.weight).toBe(3);

    const unfusedResult = await compileScopedRule(src, "r", "rule");
    const fusedResult = await compileScopedRule(src, "r", "subtree");
    expect(fusedResult.code).toContain("zeroOrMore(regexFusedMap(");

    for (const input of [
      "!",
      "abcdef!",
      "abcdefabcdef!",
      "abcdefabcd!",
      "xyz!",
      "abcdef",
    ]) {
      await expectSameResult(unfusedResult.parser, fusedResult.parser, input);
    }
  });

  it("reaches a fusion root through a LabeledExpression and an ActionExpression -- the headline sub-expression-fusion capability whole-rule fusion structurally can never reach (an ActionExpression anywhere disqualifies the whole rule under scope: rule), verified end to end with the exact idiom BENCH_INLINE_REGULAR_GRAMMAR uses", async () => {
    const src = `grammar G {
      key = h:[a-zA-Z_] t:[a-zA-Z0-9_]* { return h + t.join(""); }
    }`;
    const parsed = grammarDefinition(src, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const analysis = analyzeFirstSets(parsed.val);

    // Whole rule is structurally disqualified (ActionExpression).
    expect(isRuleFusable(parsed.val.rules[0] as never, analysis)).toBe(false);
    const plan = planFusion(parsed.val, analysis, { scope: "subtree" });
    expect(plan.roots.size).toBe(1);
    const [site] = plan.sites;
    expect(site?.expr.type).toBe("Star");

    const unfusedResult = await compileScopedRule(src, "key", "rule");
    const fusedResult = await compileScopedRule(src, "key", "subtree");
    expect(unfusedResult.code).not.toContain("regexFusedMap(");
    expect(fusedResult.code).toContain("regexFusedMap(");

    for (const input of ["a", "abc123", "z_9", "hello_world_42", "a1b2c3"]) {
      await expectSameResult(unfusedResult.parser, fusedResult.parser, input);
    }
    // Pin the actual reconstructed value once, directly: the fused `t`
    // must still be exactly the `string[]` `t.join("")` expects.
    const result = fusedResult.parser("hello_world", ORIGIN);
    expect(result.success).toBe(true);
    if (result.success) expect(result.val).toBe("hello_world");
  });

  it("fuses a subtree reached through a PositiveLookahead without corrupting the lookahead's own non-consuming, value-discarding semantics", async () => {
    // Explicit parens: `&[a-z]+` alone parses as `(&[a-z])+` (`+` binds
    // to the WHOLE lookahead, not the class inside it) -- degenerate
    // (`oneOrMore` over a zero-width, never-advancing assertion hits its
    // own infinite-loop guard after one iteration) and not what this
    // test wants to exercise: a Plus INSIDE a lookahead becoming its own
    // fusion root.
    const src = "grammar G { r = &([a-z]+) [a-z]+ [0-9] }";
    const parsed = grammarDefinition(src, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const analysis = analyzeFirstSets(parsed.val);
    const plan = planFusion(parsed.val, analysis, { scope: "subtree" });
    // Two independent roots: the `[a-z]+` INSIDE the lookahead, and the
    // separate `[a-z]+` that does the actual consuming match -- distinct
    // Expression objects even though structurally identical.
    expect(plan.roots.size).toBe(2);

    const unfusedResult = await compileScopedRule(src, "r", "rule");
    const fusedResult = await compileScopedRule(src, "r", "subtree");
    expect(unfusedResult.code).not.toContain("regexFusedMap(");
    expect(fusedResult.code).toContain("regexFusedMap(");

    for (const input of ["abc1", "a1", "1", "abc", "ABC1", ""]) {
      await expectSameResult(unfusedResult.parser, fusedResult.parser, input);
    }
  });

  it("fuses a subtree sitting after a Cut without disturbing commit's fatal-failure propagation -- once the cut fires, a failure in the fused node must fail the WHOLE rule, never fall through to the next alternative", async () => {
    const src = `grammar G { r = "key" ~ [a-z]+ / "other" }`;
    const parsed = grammarDefinition(src, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const analysis = analyzeFirstSets(parsed.val);
    const plan = planFusion(parsed.val, analysis, { scope: "subtree" });
    expect(plan.roots.size).toBe(1);
    const [site] = plan.sites;
    expect(site?.expr.type).toBe("Plus");

    const unfusedResult = await compileScopedRule(src, "r", "rule");
    const fusedResult = await compileScopedRule(src, "r", "subtree");
    expect(fusedResult.code).toContain("regexFusedMap(");

    for (const input of [
      "keyabc", // cut fires, [a-z]+ matches -- success
      "key123", // cut fires, [a-z]+ fails on "1" -- must FAIL, not fall through to "other"
      "other", // cut never fires -- second alternative matches normally
      "key", // cut fires, [a-z]+ has nothing to match -- must fail
      "",
    ]) {
      await expectSameResult(unfusedResult.parser, fusedResult.parser, input);
    }
    // Spell out the specific cut-interaction regression directly:
    // "key123" must fail for BOTH (never silently succeed by falling
    // through to "other", which "key123" doesn't match either, so a
    // fusion bug that dropped the cut's fatal flag would show up as an
    // incorrect .success rather than merely a different .next).
    expect(unfusedResult.parser("key123", ORIGIN).success).toBe(false);
    expect(fusedResult.parser("key123", ORIGIN).success).toBe(false);
  });

  it("regexFusionScope: 'rule' (the default) is unaffected by planFusion's subtree machinery -- byte-identical set of roots to isRuleFusable's own per-rule verdicts, on a grammar mixing fusable and unfusable rules", () => {
    const src = `
      grammar G {
        value = string / number / ref
        string = "\\"" [^"]* "\\""
        number = [0-9]+
        ref = identifier
        identifier = [a-z]+
      }
    `;
    const parsed = grammarDefinition(src, ORIGIN);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const analysis = analyzeFirstSets(parsed.val);

    const plan = planFusion(parsed.val, analysis, { scope: "rule" });
    const fusedNames = parsed.val.rules
      .filter((r) => plan.roots.has(r.pattern))
      .map((r) => r.name)
      .sort();
    const expectedNames = parsed.val.rules
      .filter((r) => isRuleFusable(r, analysis))
      .map((r) => r.name)
      .sort();
    expect(fusedNames).toEqual(expectedNames);
    expect(fusedNames).toEqual(["identifier", "number", "string"]);
  });
});
