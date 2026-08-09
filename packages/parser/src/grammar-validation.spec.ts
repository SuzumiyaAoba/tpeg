/**
 * Tests for `validateGrammar` (see that module's doc comment for why
 * duplicate rule names and left recursion are rejected here rather than
 * left to `analyzeFirstSets`/codegen/runtime to discover). Two forms per
 * case: a hand-built AST (via `createGrammarDefinition` and friends, for
 * precision) and, where it clarifies intent, the same grammar as real
 * `.tpeg` source text parsed through `grammarDefinition` -- exercising
 * the full parse -> validate pipeline the way a `.tpeg` file actually
 * would.
 */

import { describe, expect, it } from "bun:test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { generateTypeScriptParser } from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { grammarDefinition } from "./grammar";
import { validateGrammar } from "./grammar-validation";
import {
  createChoice,
  createGrammarDefinition,
  createIdentifier,
  createNegativeLookahead,
  createOptional,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "./types";

/** Parses `.tpeg` source text (wrapped in a `grammar G { ... }` block) and
 * returns its `GrammarDefinition` -- fails the test immediately if the
 * SOURCE TEXT itself doesn't parse, so a malformed test fixture is never
 * silently mistaken for a `validateGrammar` rejection. */
const grammarFromSource = (body: string) => {
  const result = parse(grammarDefinition)(`grammar G {\n  ${body}\n}`);
  if (!result.success) {
    throw new Error(`test fixture failed to parse: ${result.error.message}`);
  }
  return result.val;
};

describe("validateGrammar: duplicate rule names", () => {
  it("rejects two rules sharing the same name", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("start", createStringLiteral("a", '"')),
        createRuleDefinition("start", createStringLiteral("b", '"')),
      ],
    );

    expect(() => validateGrammar(grammar)).toThrow(/duplicate rule/i);
    expect(() => validateGrammar(grammar)).toThrow(/start/);
  });

  it("lists every duplicated name, not just the first", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("a", createStringLiteral("x", '"')),
        createRuleDefinition("a", createStringLiteral("y", '"')),
        createRuleDefinition("b", createStringLiteral("z", '"')),
        createRuleDefinition("b", createStringLiteral("w", '"')),
      ],
    );

    try {
      validateGrammar(grammar);
      throw new Error("expected validateGrammar to throw");
    } catch (error) {
      expect((error as Error).message).toContain("a");
      expect((error as Error).message).toContain("b");
    }
  });

  it("accepts a grammar with no duplicate names", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("start", createIdentifier("rest")),
        createRuleDefinition("rest", createStringLiteral("a", '"')),
      ],
    );

    expect(() => validateGrammar(grammar)).not.toThrow();
  });

  it("does not hang: a duplicate-named grammar is rejected well within a test timeout", () => {
    // The actual regression this guards: `analyzeFirstSets`'s FIRST-set
    // fixpoint used to oscillate forever on a duplicate rule name instead
    // of converging (two `RuleDefinition`s overwriting the same map entry
    // every pass) -- `generateTypeScriptParser`/
    // `generateOptimizedTypeScriptParser` would never return. `bun test`
    // has no built-in per-test timeout here, so this doesn't merely
    // assert a synchronous throw (any of the tests above already do
    // that) -- it specifically exercises the FULL codegen entry points
    // that used to hang, standing in as a regression guard against that
    // failure mode coming back.
    const source = 'grammar G {\n  start = "a"\n  start = "b"\n}';
    const parsed = parse(grammarDefinition)(source);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(() =>
      generateTypeScriptParser(parsed.val, {
        includeImports: false,
        includeTypes: false,
      }),
    ).toThrow(/duplicate rule/i);
    expect(() =>
      generateOptimizedTypeScriptParser(parsed.val, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
      }),
    ).toThrow(/duplicate rule/i);
  });
});

describe("validateGrammar: left recursion", () => {
  it('rejects direct left recursion (rule = rule "x" / "y")', () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createSequence([
              createIdentifier("start"),
              createStringLiteral("a", '"'),
            ]),
            createStringLiteral("b", '"'),
          ]),
        ),
      ],
    );

    expect(() => validateGrammar(grammar)).toThrow(/left-recursive/i);
    expect(() => validateGrammar(grammar)).toThrow(/start/);
  });

  it("rejects indirect left recursion (start -> x -> start)", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createSequence([
              createIdentifier("x"),
              createStringLiteral("a", '"'),
            ]),
            createStringLiteral("b", '"'),
          ]),
        ),
        createRuleDefinition("x", createIdentifier("start")),
      ],
    );

    try {
      validateGrammar(grammar);
      throw new Error("expected validateGrammar to throw");
    } catch (error) {
      expect((error as Error).message).toMatch(/left-recursive/i);
      expect((error as Error).message).toContain("start");
      expect((error as Error).message).toContain("x");
    }
  });

  it('rejects left recursion hidden behind a nullable prefix ("a"? e "b" / "c")', () => {
    // The leading `"a"?` can match zero characters, so `e` can reach
    // itself without consuming anything -- invisible to a check that only
    // looks at a sequence's literal first element (the gap
    // `performance-utils.ts`'s advisory-only heuristic has -- see
    // `grammar-validation.ts`'s doc comment).
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "e",
          createChoice([
            createSequence([
              createOptional(createStringLiteral("a", '"')),
              createIdentifier("e"),
              createStringLiteral("b", '"'),
            ]),
            createStringLiteral("c", '"'),
          ]),
        ),
      ],
    );

    expect(() => validateGrammar(grammar)).toThrow(/left-recursive/i);
    expect(() => validateGrammar(grammar)).toThrow(/e/);
  });

  it('rejects left recursion hidden behind a Star prefix ("a"* start / "b")', () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createSequence([
              createStar(createStringLiteral("a", '"')),
              createIdentifier("start"),
            ]),
            createStringLiteral("b", '"'),
          ]),
        ),
      ],
    );

    expect(() => validateGrammar(grammar)).toThrow(/left-recursive/i);
  });

  it('rejects left recursion reached through a NegativeLookahead (!start "x")', () => {
    // The probe inside `!e` is a real invocation of `e` at the current
    // position, even though its outcome is inverted -- see
    // `zeroOffsetRuleRefs`'s doc comment.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createSequence([
              createNegativeLookahead(createIdentifier("start")),
              createStringLiteral("x", '"'),
            ]),
            createStringLiteral("y", '"'),
          ]),
        ),
      ],
    );

    expect(() => validateGrammar(grammar)).toThrow(/left-recursive/i);
  });

  it('does NOT reject ordinary right recursion ("a" start / "b")', () => {
    // The leading `"a"` always consumes a character before `start` is
    // ever reached again -- this is exactly the shape `zeroOrMore`/
    // `oneOrMore`-style repetition compiles down to, and must keep
    // generating.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createSequence([
              createStringLiteral("a", '"'),
              createIdentifier("start"),
            ]),
            createStringLiteral("b", '"'),
          ]),
        ),
      ],
    );

    expect(() => validateGrammar(grammar)).not.toThrow();
  });

  it("does not reject a rule referencing an externally-supplied parser", () => {
    // An `Identifier` naming something that isn't a rule of this grammar
    // is a deliberate escape hatch (see `codegen.ts`'s
    // `generateIdentifierCode` and its own tests, e.g.
    // `codegen.spec.ts`'s "an @memoize-annotated rule actually reuses a
    // cached result..." test) for binding a hand-written parser into
    // generated code -- not a grammar-authoring mistake, and must never
    // be flagged.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "counted",
          createSequence([
            createIdentifier("tick"),
            createStringLiteral("x", '"'),
          ]),
        ),
      ],
    );

    expect(() => validateGrammar(grammar)).not.toThrow();
  });

  it("end-to-end: every left-recursive shape is rejected via real .tpeg source, through both generators", () => {
    const shapes = [
      'start = start "a" / "b"', // direct
      'start = x "a" / "b"\n  x = start', // indirect
      'start = e\n  e = "a"? e "b" / "c"', // hidden behind Optional
      'start = "a"* start / "b"', // hidden behind Star
    ];

    for (const body of shapes) {
      const grammar = grammarFromSource(body);
      expect(() =>
        generateTypeScriptParser(grammar, {
          includeImports: false,
          includeTypes: false,
        }),
      ).toThrow(/left-recursive/i);
      expect(() =>
        generateOptimizedTypeScriptParser(grammar, {
          language: "typescript",
          includeImports: false,
          includeTypes: false,
          optimize: true,
        }),
      ).toThrow(/left-recursive/i);
    }
  });

  it("end-to-end: an ordinary grammar is unaffected by validateGrammar", () => {
    const grammar = grammarFromSource('start = "a" "b" / "c"\n  d = start*');
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      }),
    ).not.toThrow();
  });
});
