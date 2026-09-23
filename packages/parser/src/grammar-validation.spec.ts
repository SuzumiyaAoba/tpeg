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

import { describe, expect, it } from "vite-plus/test";
import { createSkip, parse } from "@suzumiyaaoba/tpeg-core";
import { generateTypeScriptParser } from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { grammarDefinition } from "./grammar";
import {
  findQualifiedIdentifierReferences,
  findUnreachableAlternatives,
  validateGeneratedIdentifiers,
  validateGrammar,
} from "./grammar-validation";
import {
  createActionExpression,
  createChoice,
  createCut,
  createGrammarDefinition,
  createIdentifier,
  createLabeledExpression,
  createNegativeLookahead,
  createOptional,
  createQualifiedIdentifier,
  createQuantified,
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

  it("a long non-recursive reference chain is validated in linear time (regression: the per-rule reachability DFS was O(rules x edges))", () => {
    // `findLeftRecursiveRules` used to run a fresh DFS from EVERY rule --
    // a 50,000-rule reference chain made `validateGrammar` quadratic
    // (~minutes) inside both generators. The Tarjan SCC pass now used is
    // O(rules + edges); this grammar must validate quickly AND be
    // accepted, since a chain is not a cycle.
    const chainLength = 50_000;
    const rules = [];
    for (let i = 0; i < chainLength; i++) {
      rules.push(createRuleDefinition(`r${i}`, createIdentifier(`r${i + 1}`)));
    }
    rules.push(
      createRuleDefinition(`r${chainLength}`, createStringLiteral("z", '"')),
    );
    const grammar = createGrammarDefinition("Big", [], rules);

    expect(() => validateGrammar(grammar)).not.toThrow();
  });
});

// A `QualifiedIdentifier` (`module.name`) whose `module` part collides
// with a rule actually declared in THIS grammar can never have been an
// intentional cross-module reference -- see
// `grammar-validation.ts`'s `collectQualifiedIdentifierCollisions` doc
// comment for the concrete mistake this catches: `start = word.suffix`
// with both `word` and `suffix` declared as ordinary local rules, where
// `composition.ts`'s `basicSyntax` (trying `qualifiedIdentifier` before
// `identifier`) silently combines what the author meant as two separate
// tokens into one `QualifiedIdentifier` node.
describe("validateGrammar: QualifiedIdentifier / local-rule-name collisions", () => {
  it("rejects a QualifiedIdentifier whose module part is a locally-declared rule", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "start",
          createQualifiedIdentifier("word", "suffix"),
        ),
        createRuleDefinition("word", createStringLiteral("a", '"')),
        createRuleDefinition("suffix", createStringLiteral("b", '"')),
      ],
    );

    expect(() => validateGrammar(grammar)).toThrow(/undefined rule/i);
  });

  it("does not reject a QualifiedIdentifier whose module part names no local rule (a genuine cross-module reference)", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "start",
          createQualifiedIdentifier("math", "expr"),
        ),
      ],
    );

    expect(() => validateGrammar(grammar)).not.toThrow();
  });

  it("end-to-end: word.suffix mis-tokenization is rejected via real .tpeg source", () => {
    const grammar = grammarFromSource(
      'start = word.suffix\n  word = "a"\n  suffix = "b"',
    );
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      }),
    ).toThrow(/undefined rule/i);
  });
});

// `findQualifiedIdentifierReferences` backs the non-fatal generation
// warning codegen emits for a genuine (non-colliding) `QualifiedIdentifier`
// reference -- unlike `collectQualifiedIdentifierCollisions` above, it
// reports EVERY reference, not just ones colliding with a local rule name.
describe("findQualifiedIdentifierReferences", () => {
  it("finds a QualifiedIdentifier reference nested inside a sequence/choice/group", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createStringLiteral("a", '"'),
            createQualifiedIdentifier("math", "expr"),
          ]),
        ),
      ],
    );

    expect(findQualifiedIdentifierReferences(grammar)).toEqual([
      { ruleName: "start", module: "math", name: "expr" },
    ]);
  });

  it("returns an empty array for a grammar with no QualifiedIdentifier reference", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [createRuleDefinition("start", createStringLiteral("a", '"'))],
    );

    expect(findQualifiedIdentifierReferences(grammar)).toEqual([]);
  });

  it("does not filter out a QualifiedIdentifier whose module collides with a local rule name", () => {
    // Collision filtering is `collectQualifiedIdentifierCollisions`'s job
    // (feeding `validateGrammar`'s throw) -- this function reports every
    // reference unconditionally, since it backs a non-fatal warning, not
    // a hard rejection.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "start",
          createQualifiedIdentifier("word", "suffix"),
        ),
        createRuleDefinition("word", createStringLiteral("a", '"')),
        createRuleDefinition("suffix", createStringLiteral("b", '"')),
      ],
    );

    expect(findQualifiedIdentifierReferences(grammar)).toEqual([
      { ruleName: "start", module: "word", name: "suffix" },
    ]);
  });
});

// `~` cannot be a rule body (or sub-expression) on its own: it only has
// meaning as one of several elements of a sequence. See
// `grammar-validation.ts`'s `isCutOnlyPattern`/`containsCutOnlyPattern` doc
// comments for why both a bare `Cut` node and an all-`Cut` `Sequence` are
// reachable from ordinary `.tpeg` source text once `composition.ts`
// unwraps a single-element sequence.
describe("validateGrammar: cut-only patterns", () => {
  it("rejects a rule body that is nothing but `~`", () => {
    const grammar = grammarFromSource("start = ~");
    expect(() => validateGrammar(grammar)).toThrow(/cannot be a rule body/i);
    expect(() => validateGrammar(grammar)).toThrow(/start/);
  });

  it("rejects a rule body that is nothing but repeated `~`", () => {
    const grammar = grammarFromSource("start = ~ ~");
    expect(() => validateGrammar(grammar)).toThrow(/cannot be a rule body/i);
  });

  it("rejects a group whose entire content is `~`", () => {
    const grammar = grammarFromSource('start = (~) "b"');
    expect(() => validateGrammar(grammar)).toThrow(/cannot be a rule body/i);
  });

  it("rejects a group whose entire content is repeated `~`", () => {
    const grammar = grammarFromSource('start = (~ ~) "b"');
    expect(() => validateGrammar(grammar)).toThrow(/cannot be a rule body/i);
  });

  it("rejects a choice alternative that is nothing but `~`", () => {
    const grammar = grammarFromSource('start = ~ / "a"');
    expect(() => validateGrammar(grammar)).toThrow(/cannot be a rule body/i);
  });

  it("does NOT reject `~` used as one of several sequence elements", () => {
    const grammar = grammarFromSource('start = "a" ~ "b"');
    expect(() => validateGrammar(grammar)).not.toThrow();
  });

  it("does NOT reject `~` nested inside a group alongside a real match", () => {
    const grammar = grammarFromSource('start = ("a" ~ "b") "c"');
    expect(() => validateGrammar(grammar)).not.toThrow();
  });

  it("does NOT reject a leading or trailing `~` that still shares its sequence with a real match", () => {
    const grammar = grammarFromSource('start = "a" "b" ~');
    expect(() => validateGrammar(grammar)).not.toThrow();
  });

  it("end-to-end: both generators reject a cut-only rule instead of throwing an internal codegen error", () => {
    const grammar = grammarFromSource("start = ~");
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      }),
    ).toThrow(/cannot be a rule body/i);
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
      }),
    ).toThrow(/cannot be a rule body/i);
  });
});

describe("findUnreachableAlternatives: infallible earlier alternatives", () => {
  // An earlier alternative that can never fail at all leaves every later
  // alternative unmatchable on every input -- PEG's ordered choice takes
  // the first success, and this one always succeeds.

  it("flags an optional (`?`) first alternative", () => {
    const grammar = grammarFromSource('start = "a"? / "b"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "infallible",
      },
    ]);
  });

  it("flags a `*` repetition first alternative", () => {
    const grammar = grammarFromSource('start = "a"* / "b"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "infallible",
      },
    ]);
  });

  it("flags a `{0,..}` quantified first alternative", () => {
    const grammar = grammarFromSource('start = "a"{0,3} / "b"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "infallible",
      },
    ]);
  });

  it('flags an empty-string-literal first alternative (hand-built AST -- `~`-adjacent trivia keeps `start = "" / "b"` ambiguous in source)', () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createStringLiteral("", '"'),
            createStringLiteral("b", '"'),
          ]),
        ),
      ],
    );
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "infallible",
      },
    ]);
  });

  it("flags an inner Choice that is itself infallible", () => {
    const grammar = grammarFromSource('start = ("a" / "b"?) / "c"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "infallible",
      },
    ]);
  });

  it("flags every alternative after the cause, not just the next one", () => {
    const grammar = grammarFromSource('start = "a"? / "b" / "c" / "d"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2, 3, 4],
        causeAlternative: 1,
        causeKind: "infallible",
      },
    ]);
  });

  it("flags alternatives after a NON-first infallible alternative, pointing at the right cause", () => {
    const grammar = grammarFromSource('start = "a" / "b"? / "c"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [3],
        causeAlternative: 2,
        causeKind: "infallible",
      },
    ]);
  });

  it("sees through transparent wrappers: label, action, span, group", () => {
    for (const body of [
      'start = x:"a"? / "b"',
      'start = "a"? { return 1; } / "b"',
      'start = @"a"? / "b"',
      'start = ("a"?) / "b"',
    ]) {
      const issues = findUnreachableAlternatives(grammarFromSource(body));
      expect(issues).toHaveLength(1);
      expect(issues[0]?.deadAlternatives).toEqual([2]);
      expect(issues[0]?.causeKind).toBe("infallible");
    }
  });

  it('flags a repetition of an infallible expression -- `("a"?){2}` can never fail either', () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createQuantified(createOptional(createStringLiteral("a", '"')), 2),
            createStringLiteral("b", '"'),
          ]),
        ),
      ],
    );
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "infallible",
      },
    ]);
  });
});

describe("findUnreachableAlternatives: committed (fatal-only) earlier alternatives", () => {
  // An alternative whose every possible failure arrives `fatal` (it can
  // only fail PAST a `~`) also makes the choice unable to fall through:
  // on success it wins, on failure it aborts the whole choice. The
  // distinction from "infallible" matters to the author reading the
  // error -- a misplaced `~` vs a misplaced `?` -- so `causeKind`
  // reports it separately.

  it("flags an alternative that can only fail past a `~` after an infallible prefix", () => {
    const grammar = grammarFromSource('start = ("a"? ~ "b") / "c"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "committed",
      },
    ]);
  });

  it("flags a leading `~` alternative -- it commits before anything can fail ordinarily", () => {
    const grammar = grammarFromSource('start = (~ "a") / "b"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "committed",
      },
    ]);
  });

  it("flags an `Optional`/`Star` wrapper around a commit-only expression -- the wrapper re-raises the `fatal`, it does not add a non-fatal mode", () => {
    for (const body of [
      'start = ("a" ~ "b")? / "c"',
      'start = ("a" ~ "b")* / "c"',
    ]) {
      const issues = findUnreachableAlternatives(grammarFromSource(body));
      expect(issues).toHaveLength(1);
      expect(issues[0]?.causeKind).toBe("committed");
    }
  });

  it("flags a `+`/`{1,..}` wrapper around a commit-only expression -- the first iteration's fatal failure passes straight through", () => {
    // The child must be commit-ONLY (`"a"? ~ "b"`): a child that can
    // also fail ordinarily (`"a" ~ "b"`) keeps that non-fatal mode
    // through `+`, since the first iteration can still fail pre-cut.
    const grammar = grammarFromSource('start = ("a"? ~ "b")+ / "c"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "committed",
      },
    ]);
  });

  it("flags a `Skip` alternative whose referenced rule can fail fatally -- `ignore(optional(ref))` re-raises `fatal`, so it is `committed`, not `infallible`", () => {
    // `Skip` compiles to `ignore(optional(<ref>))`: the ref's ordinary
    // failure becomes an empty match, but a `fatal` one propagates
    // (`repetition.ts`). A `Skip` node can therefore still make later
    // alternatives unreachable -- and the correct `causeKind` is
    // "committed" (it CAN fail, just never non-fatally), which the
    // analysis only gets right if `Skip` resolves its reference's
    // modes instead of reporting `NO_FAILURE`.
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createSkip(createIdentifier("ws")),
            createStringLiteral("b", '"'),
          ]),
        ),
        // `ws` can only fail fatally (it commits unconditionally via
        // the nullable `" "?` prefix before `~`), so `Skip(ws)` is
        // fatal-capable -- and can never fail non-fatally either way.
        createRuleDefinition(
          "ws",
          createSequence([
            createOptional(createStringLiteral(" ", '"')),
            createCut(),
            createStringLiteral("x", '"'),
          ]),
        ),
      ],
    );
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "committed",
      },
    ]);
  });
});

describe("findUnreachableAlternatives: alternatives that stay reachable", () => {
  it("does NOT flag ordinary failable alternatives", () => {
    const grammar = grammarFromSource('start = "a" / "b"');
    expect(findUnreachableAlternatives(grammar)).toEqual([]);
  });

  it("does NOT flag a committed alternative when its pre-cut prefix can still fail ordinarily", () => {
    // `"a"` can fail before `~` is ever reached -- on that input the
    // choice falls through to `"c"` normally.
    const grammar = grammarFromSource('start = ("a" ~ "b") / "c"');
    expect(findUnreachableAlternatives(grammar)).toEqual([]);
  });

  it("does NOT flag a sequence whose failable element comes AFTER the infallible one", () => {
    const grammar = grammarFromSource('start = "a"? "b" / "c"');
    expect(findUnreachableAlternatives(grammar)).toEqual([]);
  });

  it("does NOT flag `+`/`{1,..}` of an expression that can still fail ordinarily -- the first iteration preserves the child's non-fatal mode", () => {
    for (const body of [
      'start = "a"+ / "b"',
      'start = "a"{1,3} / "b"',
      'start = ("a" ~ "b")+ / "c"',
    ]) {
      expect(findUnreachableAlternatives(grammarFromSource(body))).toEqual([]);
    }
  });

  it("does NOT flag lookahead alternatives: `&` absorbs even a `fatal` into an ordinary failure, `!` can only ever fail ordinarily", () => {
    for (const body of [
      'start = &"a" / "b"',
      'start = !"a" / "b"',
      'start = &("a" ~ "b") / "c"',
      'start = !("a" ~ "b") / "c"',
    ]) {
      expect(findUnreachableAlternatives(grammarFromSource(body))).toEqual([]);
    }
  });

  it("does NOT flag boundary assertions, character classes, `.`, or `@` on a failable expression", () => {
    for (const body of [
      'start = \\b "a" / "b"',
      'start = [a-z] / "b"',
      'start = . / "b"',
      'start = @"a" / "b"',
    ]) {
      expect(findUnreachableAlternatives(grammarFromSource(body))).toEqual([]);
    }
  });

  it("does NOT flag a trailing `~` with no element after it (nothing is wrapped in `commit`) -- hand-built AST", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createSequence([createStringLiteral("a", '"'), createCut()]),
            createStringLiteral("b", '"'),
          ]),
        ),
      ],
    );
    expect(findUnreachableAlternatives(grammar)).toEqual([]);
  });

  it("does NOT flag a nested Choice whose pre-cut element can fail", () => {
    // `("b" ~ "c" / "d")`: the inner choice can fail non-fatally at "b"
    // before its `~` is reached.
    const grammar = grammarFromSource('start = ("a" ("b" ~ "c" / "d")) / "e"');
    expect(findUnreachableAlternatives(grammar)).toEqual([]);
  });

  it("does NOT flag an alternative after a Choice whose every alternative can only fail fatally -- the choice ABSORBS the fatal and itself fails non-fatally", () => {
    // `(~"a") / (~"b")` -- each inner alternative commits
    // unconditionally, so whichever runs first either succeeds or fails
    // `fatal` and the INNER choice absorbs that flag at its own boundary
    // (`tryOrderedCandidates`), emitting an ordinary failure. The inner
    // choice can therefore never fail fatally itself -- an outer
    // alternative after it (`"c"` in `start`) stays reachable. (The inner
    // choices' own second alternatives ARE genuinely dead -- each first
    // inner alternative can never fail non-fatally -- and are still
    // reported.)
    const grammar = grammarFromSource(
      'start = inner / "c"\ninner = (~ "a") / (~ "b")\ninner2 = (~ "x") / "b"',
    );
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "inner",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "committed",
      },
      {
        ruleName: "inner2",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "committed",
      },
    ]);
  });

  it("does NOT flag a nested Choice used directly as an alternative -- same absorption, one level down", () => {
    const grammar = grammarFromSource('start = ((~ "a") / (~ "b")) / "c"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      // Only the INNER choice's second alternative is genuinely dead.
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "committed",
      },
    ]);
  });

  it("does NOT flag an alternative after a nested Choice whose infallible alternative is shadowed by a fatal-capable earlier one", () => {
    // `("a" ~ "b") / "c"?`: "c"? is infallible, but the inner choice is
    // NOT -- on "ax" the committed "b" failure is absorbed at the inner
    // choice's boundary and the inner choice fails ordinarily, so the
    // outer choice DOES fall through to "d". The old
    // `altModes.some(infallible)` check marked the inner choice
    // `NO_FAILURE` by counting "c"? without noticing the fatal-capable
    // alternative before it -- reporting "d" as dead and making
    // `validateGrammar` reject a valid grammar.
    const grammar = grammarFromSource('start = (("a" ~ "b") / "c"?) / "d"');
    expect(findUnreachableAlternatives(grammar)).toEqual([]);
  });

  it("does NOT flag through a rule reference either -- the same wrong modes used to propagate through `ruleModes`", () => {
    const grammar = grammarFromSource(
      'start = inner / "d"\ninner = ("a" ~ "b") / "c"?\n',
    );
    expect(findUnreachableAlternatives(grammar)).toEqual([]);
  });

  it("does NOT flag on a dead infallible alternative's account either -- an infallible alternative AFTER a fatal-only boundary never runs", () => {
    // `inner = ("a" ~ "b")* / "c"?`: the `*` alternative can only fail
    // fatally, so "c"? is genuinely dead -- but the inner choice's own
    // modes must still be NONFATAL (it can fail on "ax"), which is what
    // an enclosing context sees. A `NO_FAILURE` here would wrongly flag
    // "e" in `start = inner / "e"` as dead too.
    const grammar = grammarFromSource(
      'start = inner / "e"\ninner = ("a" ~ "b")* / "c"?\n',
    );
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "inner",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "committed",
      },
    ]);
  });

  it("still flags alternatives after a genuinely reachable infallible boundary", () => {
    // `("a" ~ "b")` can fail non-fatally at "a", so "c"? IS reachable --
    // and since it always succeeds when reached, "d" is truly dead.
    const grammar = grammarFromSource('start = ("a" ~ "b") / "c"? / "d"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [3],
        causeAlternative: 2,
        causeKind: "infallible",
      },
    ]);
  });

  it("does NOT flag an unresolvable (external) Identifier -- conservatively assumed able to fail ordinarily", () => {
    // A bare `Identifier` naming no local rule is the deliberate escape
    // hatch for binding a hand-written parser; it is opaque to this
    // analysis, and assuming it can fail non-fatally is the direction
    // that can only ever under-report (never wrongly flag live code).
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "start",
          createChoice([
            createIdentifier("external"),
            createStringLiteral("b", '"'),
          ]),
        ),
      ],
    );
    expect(findUnreachableAlternatives(grammar)).toEqual([]);
  });
});

describe("findUnreachableAlternatives: rule references and fixpoint", () => {
  it("flags an alternative referencing an infallible rule", () => {
    const grammar = grammarFromSource('start = a / "b"\na = "x"?');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "infallible",
      },
    ]);
  });

  it("resolves infallibility transitively through a reference chain", () => {
    const grammar = grammarFromSource('start = a / "b"\na = c\nc = "x"?');
    expect(findUnreachableAlternatives(grammar)).toHaveLength(1);
    expect(findUnreachableAlternatives(grammar)[0]?.causeKind).toBe(
      "infallible",
    );
  });

  it("flags an alternative referencing a rule that can only fail fatally", () => {
    const grammar = grammarFromSource('start = tok / "x"\ntok = "a"? ~ "b"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "committed",
      },
    ]);
  });

  it("does NOT flag an alternative referencing a rule whose pre-cut prefix can fail", () => {
    const grammar = grammarFromSource('start = tok / "x"\ntok = "a" ~ "b"');
    expect(findUnreachableAlternatives(grammar)).toEqual([]);
  });

  it("converges on a mutually recursive cut-free cycle without false positives", () => {
    const grammar = grammarFromSource(
      'start = expr\nexpr = term ("+" term)*\nterm = "n" / "(" expr ")"',
    );
    expect(findUnreachableAlternatives(grammar)).toEqual([]);
  });
});

describe("findUnreachableAlternatives: nested choices and issue shape", () => {
  it("finds a dead alternative inside a nested Choice (not just a rule's top-level pattern)", () => {
    const grammar = grammarFromSource('start = "x" ("a"? / "b") "y"');
    expect(findUnreachableAlternatives(grammar)).toEqual([
      {
        ruleName: "start",
        deadAlternatives: [2],
        causeAlternative: 1,
        causeKind: "infallible",
      },
    ]);
  });

  it("reports issues in every rule that has them, naming each rule", () => {
    const grammar = grammarFromSource('start = "a"? / "b"\nother = "x"* / "y"');
    const issues = findUnreachableAlternatives(grammar);
    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.ruleName)).toEqual(["start", "other"]);
  });

  it("reports two dead Choice nodes in one rule as two issues", () => {
    const grammar = grammarFromSource('start = ("a"? / "b") ("c"? / "d")');
    expect(findUnreachableAlternatives(grammar)).toHaveLength(2);
  });

  it("does NOT flag a `Skip` node desugaring inserted as a sequence element (it is infallible but never a choice alternative)", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "start",
          createSequence([
            createSkip(createIdentifier("ws")),
            createStringLiteral("a", '"'),
          ]),
        ),
      ],
    );
    expect(findUnreachableAlternatives(grammar)).toEqual([]);
  });
});

describe("validateGrammar: unreachable ordered-choice alternatives", () => {
  it("rejects with the rule name, dead positions, cause position, and cause kind", () => {
    const grammar = grammarFromSource('start = "a"? / "b" / "c"');
    expect(() => validateGrammar(grammar)).toThrow(
      /unreachable ordered-choice alternative\(s\)/i,
    );
    expect(() => validateGrammar(grammar)).toThrow(/rule "start"/);
    expect(() => validateGrammar(grammar)).toThrow(
      /alternative\(s\) 2, 3 unreachable because alternative 1 always succeeds/,
    );
  });

  it("describes a committed cause differently from an infallible one", () => {
    const grammar = grammarFromSource('start = ("a"? ~ "b") / "c"');
    expect(() => validateGrammar(grammar)).toThrow(
      /alternative 1 commits via `~` before it can produce an ordinary failure/,
    );
  });

  it("end-to-end: both generators reject dead alternatives instead of emitting a parser that can never match them", () => {
    const grammar = grammarFromSource('start = "a"? / "b"');
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      }),
    ).toThrow(/unreachable/i);
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
      }),
    ).toThrow(/unreachable/i);
  });

  it("does NOT reject a choice whose infallible alternative is shadowed by a fatal-capable earlier one", () => {
    // `(("a" ~ "b") / "c"?) / "d"`: the inner choice CAN still fail
    // (its committed alternative's `fatal` is absorbed into an ordinary
    // failure before "c"? ever runs), so "d" is live -- the old
    // `NO_FAILURE` mis-analysis rejected this grammar outright.
    const grammar = grammarFromSource('start = (("a" ~ "b") / "c"?) / "d"');
    expect(() => validateGrammar(grammar)).not.toThrow();
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      }),
    ).not.toThrow();
  });
});

describe("validateGrammar: @start annotations", () => {
  it("accepts `@start: <name>` naming a declared rule", () => {
    const grammar = grammarFromSource('@start: main\nmain = "m"\nhelper = "h"');
    expect(() => validateGrammar(grammar)).not.toThrow();
  });

  it("rejects `@start` naming a rule the grammar does not declare", () => {
    const grammar = grammarFromSource('@start: missing\nmain = "m"');
    expect(() => validateGrammar(grammar)).toThrow(/@start.*missing/);
  });

  it("rejects a bare `@start` flag with no rule name", () => {
    const grammar = grammarFromSource('@start\nmain = "m"');
    expect(() => validateGrammar(grammar)).toThrow(
      /@start requires a rule name/,
    );
  });

  it("rejects duplicate `@start` annotations", () => {
    const grammar = grammarFromSource(
      '@start: main\n@start: helper\nmain = "m"\nhelper = "h"',
    );
    expect(() => validateGrammar(grammar)).toThrow(/duplicate @start/i);
  });

  it("accepts `@start` naming the first rule too (not just a later one)", () => {
    const grammar = grammarFromSource('@start: main\nmain = "m"\nhelper = "h"');
    expect(() => validateGrammar(grammar)).not.toThrow();
  });

  it("end-to-end: both generators reject a `@start` naming a missing rule", () => {
    const grammar = grammarFromSource('@start: missing\nmain = "m"');
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      }),
    ).toThrow(/@start.*missing/);
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
      }),
    ).toThrow(/@start.*missing/);
  });
});

/**
 * `validateGeneratedIdentifiers` rejects a rule name, capture label, or
 * transform-parameter name that would generate to a JS reserved word, an
 * import the grammar's own generated code needs, or one of the fixed
 * internal names `wrapWithAction`/`wrapWithTransform` declare inside a
 * rule's body -- see that function's doc comment (`grammar-validation.ts`)
 * for concrete failure modes (a `SyntaxError`, a duplicate-declaration
 * `TS2395`, or a self-referential TDZ `ReferenceError`), each verified by
 * hand against `tsc`/Node before this check was added. Exercised both
 * directly (unit-level, via `validateGeneratedIdentifiers` itself with a
 * minimal `importedBindings` list) and end-to-end through both real
 * generators, which is what actually determines `importedBindings` in
 * practice.
 */
describe("validateGeneratedIdentifiers: reserved words and import collisions", () => {
  it("rejects a rule name that is a JS reserved word", () => {
    const grammar = grammarFromSource('class = "a"');
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).toThrow(/reserved word "class"/);
  });

  it("rejects a rule name that is reserved only in a module/strict context (let/static/yield/await/...)", () => {
    for (const name of ["let", "static", "yield", "await", "interface"]) {
      const grammar = grammarFromSource(`${name} = "a"`);
      expect(() =>
        validateGeneratedIdentifiers(grammar, {
          namePrefix: "",
          importedBindings: [],
        }),
      ).toThrow(new RegExp(`reserved word "${name}"`));
    }
  });

  it("does NOT reject words that merely look reserved but compile fine as a const name", () => {
    for (const name of ["as", "async", "from", "get", "of", "set", "type"]) {
      const grammar = grammarFromSource(`${name} = "a"`);
      expect(() =>
        validateGeneratedIdentifiers(grammar, {
          namePrefix: "",
          importedBindings: [],
        }),
      ).not.toThrow();
    }
  });

  it("checks the PREFIXED name, so --name-prefix is a real escape hatch for a reserved word", () => {
    const grammar = grammarFromSource('class = "a"');
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "g_",
        importedBindings: [],
      }),
    ).not.toThrow();
    // ... but a prefix that itself lands on a reserved word is still caught.
    expect(() =>
      validateGeneratedIdentifiers(grammarFromSource('const = "a"'), {
        namePrefix: "",
        importedBindings: [],
      }),
    ).toThrow(/reserved word "const"/);
  });

  it("rejects a rule name that collides with a binding the grammar's own generated code imports", () => {
    const grammar = grammarFromSource('literal = "a"');
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: ["Parser", "literal"],
      }),
    ).toThrow(/collides with a runtime import/);
  });

  it("does NOT reject a rule name absent from the actual import set (no static list)", () => {
    const grammar = grammarFromSource('literal = "a"');
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        // "literal" the combinator isn't imported by THIS (hypothetical)
        // grammar's generated code, so the name is safe.
        importedBindings: ["Parser"],
      }),
    ).not.toThrow();
  });

  it("rejects a rule name that collides with an internal codegen name (__base/__result/__transformed/__val), regardless of imports", () => {
    for (const name of ["__base", "__result", "__transformed", "__val"]) {
      const grammar = grammarFromSource(`${name} = "a"`);
      expect(() =>
        validateGeneratedIdentifiers(grammar, {
          namePrefix: "",
          importedBindings: [],
        }),
      ).toThrow(/code generator itself uses internally/);
    }
  });

  it("rejects a rule name that collides with the (input, pos) parameters wrapWithAction/wrapWithTransform/wrapWithMonitoring declare, regardless of imports", () => {
    // Distinct failure mode from __base/__result/__transformed/__val
    // above: `input`/`pos` collide with those wrappers' own function
    // PARAMETERS, not a sibling `const` -- a rule named `input` referenced
    // from inside an action/transform-wrapped rule silently resolves to
    // the wrapper's own string/number parameter instead of the top-level
    // rule (a runtime TypeError, not a TDZ ReferenceError), so it must be
    // rejected the same unconditional way.
    for (const name of ["input", "pos"]) {
      const grammar = grammarFromSource(`${name} = "a"`);
      expect(() =>
        validateGeneratedIdentifiers(grammar, {
          namePrefix: "",
          importedBindings: [],
        }),
      ).toThrow(/code generator itself uses internally/);
    }
  });

  it("rejects a capture label that is a reserved word, even when the enclosing action never references it by name", () => {
    const grammar = grammarFromSource('start = new:"a" { return $$; }');
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).toThrow(/capture label named "new"/);
  });

  it("does NOT reject an ordinary label name", () => {
    const grammar = grammarFromSource('start = value:"a" { return value; }');
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).not.toThrow();
  });

  it("does NOT reject a capture label named like an internal codegen binding -- it is destructured inside the action IIFE, where shadowing is legal (#115)", () => {
    // `RESERVED_INTERNAL_RULE_NAMES`'s own doc comment says it does not
    // apply to labels: `const { __base } = $$` sits inside the inner
    // `(() => { ... })()` scope, legally shadowing the wrapper's
    // `const __base` rather than colliding with it.
    for (const name of ["__base", "__result", "__transformed", "__val"]) {
      const grammar = grammarFromSource(
        `start = ${name}:"a" { return ${name}; }`,
      );
      expect(() =>
        validateGeneratedIdentifiers(grammar, {
          namePrefix: "",
          importedBindings: [],
        }),
      ).not.toThrow();
    }
  });

  it("does NOT reject a capture label named `input`/`pos` -- it is destructured inside the action IIFE, where shadowing the wrapper's own parameter is legal", () => {
    for (const name of ["input", "pos"]) {
      const grammar = grammarFromSource(
        `start = ${name}:"a" { return ${name}; }`,
      );
      expect(() =>
        validateGeneratedIdentifiers(grammar, {
          namePrefix: "",
          importedBindings: [],
        }),
      ).not.toThrow();
    }
  });

  it("does NOT reject a transform parameter named like an internal codegen binding (#115)", () => {
    const result = parse(grammarDefinition)(`grammar G {
      start = digits:[0-9]+
    }`);
    if (!result.success) throw new Error("test fixture failed to parse");
    const grammar = {
      ...result.val,
      transforms: [
        {
          type: "TransformDefinition" as const,
          transformSet: {
            name: "X",
            targetLanguage: "typescript",
            functions: [
              {
                name: "start",
                // Arrow-function parameter inside wrapWithTransform's
                // emitted wrapper -- legal shadowing, like a label.
                parameters: [{ name: "__result", type: "string" }],
                returnType: { type: "Result", generic: "number" },
                body: "return { success: true, value: 1 };",
              },
            ],
          },
        },
      ],
    };
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).not.toThrow();
  });

  it("rejects a transform function's parameter name when it is a reserved word", () => {
    const result = parse(grammarDefinition)(`grammar G {
      start = digits:[0-9]+
    }

    transforms X@typescript {
      start(new: string) -> Result<number> { return { success: true, value: 1 }; }
    }`);
    if (!result.success) throw new Error("test fixture failed to parse");
    // Only the grammar half is parsed by `grammarDefinition` above --
    // attach the transforms block by hand the way `tpegFile` would.
    const grammar = {
      ...result.val,
      transforms: [
        {
          type: "TransformDefinition" as const,
          transformSet: {
            name: "X",
            targetLanguage: "typescript",
            functions: [
              {
                name: "start",
                parameters: [{ name: "new", type: "string" }],
                returnType: { type: "Result", generic: "number" },
                body: "return { success: true, value: 1 };",
              },
            ],
          },
        },
      ],
    };
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).toThrow(/parameter named "new"/);
  });

  it("end-to-end: both generators reject a rule name colliding with its own required import", () => {
    const grammar = grammarFromSource('start = literal\nliteral = "a"');
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: true,
        includeTypes: true,
      }),
    ).toThrow(/collides with a runtime import/);
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, {
        language: "typescript",
        includeImports: true,
        includeTypes: true,
        optimize: true,
      }),
    ).toThrow(/collides with a runtime import/);
  });

  it("end-to-end: a rule name that collides with a referenced combinator is rejected even with includeImports: false", () => {
    // `includeImports: false` suppresses the `import` lines, not the
    // combinator calls: `literal = "a"` still emits `literal("a")`, so
    // `export const literal = ...literal("a")` would be a TDZ
    // `ReferenceError` at module evaluation. This used to be accepted --
    // the collision check looked only at the (empty) emitted import list.
    const grammar = grammarFromSource('start = literal\nliteral = "a"');
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      }),
    ).toThrow(/collides with a runtime import/);
  });

  it("end-to-end: a rule name matching an UNREFERENCED combinator is still accepted with includeImports: false", () => {
    // The check is against names the emitted code actually references,
    // not every name tpeg-core exports: `literal = [a-z]+` emits
    // `charClass`/`plus` but never `literal(...)`, so `const literal`
    // collides with nothing and must keep generating.
    const grammar = grammarFromSource("start = literal\nliteral = [a-z]+");
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      }),
    ).not.toThrow();
  });

  it("end-to-end: --name-prefix (namePrefix option) makes an otherwise-reserved rule name safe in real generated code", () => {
    const grammar = grammarFromSource('class = "a"');
    const result = generateTypeScriptParser(grammar, {
      includeImports: true,
      includeTypes: true,
      namePrefix: "g_",
    });
    expect(result.code).toContain("export const g_class");
  });

  it("rejects a QualifiedIdentifier whose module part is a JS reserved word (regression: `function.foo` was emitted verbatim into expression position -- a SyntaxError)", () => {
    const grammar = grammarFromSource("start = function.foo");
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).toThrow(/module part "function" is a JavaScript reserved word/);
  });

  it("does NOT reject a QualifiedIdentifier whose PROPERTY part is a reserved word (`m.class` is legal)", () => {
    const grammar = grammarFromSource("start = m.class");
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).not.toThrow();
  });

  it("rejects a QualifiedIdentifier whose module part collides with a runtime import (`literal.foo` reads a property off the imported combinator)", () => {
    const grammar = grammarFromSource("start = literal.foo");
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: ["Parser", "literal"],
      }),
    ).toThrow(/module part "literal" collides with a runtime import/);
  });

  it("accepts a QualifiedIdentifier whose module part merely MATCHES a combinator's name when nothing imports it", () => {
    const grammar = grammarFromSource("start = literal.foo");
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: ["Parser"],
      }),
    ).not.toThrow();
  });
});

describe("validateGeneratedIdentifiers: namePrefix shape (regression)", () => {
  // `namePrefix + rule.name` is emitted verbatim as a `const` name, so a
  // prefix that isn't identifier-shaped produces a declaration like
  // `export const my-start` -- a SyntaxError, previously undiagnosed.
  it.each(["my-", "123", "a b", "-x", "foo.bar"])(
    "rejects a non-identifier-shaped namePrefix %j",
    (namePrefix) => {
      const grammar = grammarFromSource('start = "a"');
      expect(() =>
        validateGeneratedIdentifiers(grammar, {
          namePrefix,
          importedBindings: [],
        }),
      ).toThrow(/not a valid JavaScript identifier prefix/);
    },
  );

  it.each(["my_", "$", "_", "g1", "myPrefix"])(
    "accepts an identifier-shaped namePrefix %j",
    (namePrefix) => {
      const grammar = grammarFromSource('start = "a"');
      expect(() =>
        validateGeneratedIdentifiers(grammar, {
          namePrefix,
          importedBindings: [],
        }),
      ).not.toThrow();
    },
  );

  it("end-to-end: both generators reject a non-identifier namePrefix before emitting any code", () => {
    const grammar = grammarFromSource('start = "a"');
    expect(() =>
      generateTypeScriptParser(grammar, { namePrefix: "my-" }),
    ).toThrow(/not a valid JavaScript identifier prefix/);
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, { namePrefix: "my-" }),
    ).toThrow(/not a valid JavaScript identifier prefix/);
  });
});

describe("validateGrammar: transform function names (issues #65/#66)", () => {
  // A transform function binds to a rule BY NAME: a name matching no
  // rule is dead code silently dropped from generated output, and a
  // duplicate name within one set silently overwrites the earlier
  // function -- both are now generation-time errors, the same class of
  // authoring mistake a duplicate rule name already was.
  it("rejects a transform function matching no declared rule", () => {
    const grammar = grammarFromSource(`r = "a"
  transforms X@typescript {
    nonexistent(c: string) -> R { return { success: true, value: c }; }
  }`);
    expect(() => validateGrammar(grammar)).toThrow(
      /Transform function\(s\) matching no declared rule: "nonexistent"/,
    );
  });

  it("rejects duplicate function names within one transform set", () => {
    const grammar = grammarFromSource(`r = "a"
  transforms X@typescript {
    r(c: string) -> R { return { success: true, value: 1 }; }
    r(c: string) -> R { return { success: true, value: 2 }; }
  }`);
    expect(() => validateGrammar(grammar)).toThrow(
      /Duplicate transform function\(s\).* "r"/,
    );
  });

  it("accepts the same function name in two DIFFERENT transform sets (each binds its own target)", () => {
    const grammar = grammarFromSource(`r = "a"
  transforms X@typescript {
    r(c: string) -> R { return { success: true, value: c }; }
  }
  transforms Y@python {
    r(c: string) -> R { return { success: true, value: c }; }
  }`);
    expect(() => validateGrammar(grammar)).not.toThrow();
  });

  it("accepts a transform set whose function names all match rules", () => {
    const grammar = grammarFromSource(`r = "a"
  s = "b"
  transforms X@typescript {
    r(c: string) -> R { return { success: true, value: c }; }
    s(c: string) -> R { return { success: true, value: c }; }
  }`);
    expect(() => validateGrammar(grammar)).not.toThrow();
  });

  it("end-to-end: the base and optimized generators both reject an unmatched transform function", () => {
    const grammar = grammarFromSource(`r = "a"
  transforms X@typescript {
    nonexistent(c: string) -> R { return { success: true, value: c }; }
  }`);
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      }),
    ).toThrow(/matching no declared rule/);
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
      }),
    ).toThrow(/matching no declared rule/);
  });

  it("rejects a multi-parameter transform function -- parameters 2+ have no runtime value to bind (#108)", () => {
    // `wrapWithTransform` binds only the rule's parse result to
    // `parameters[0]`; a second parameter previously compiled to an
    // unbound identifier (`ReferenceError` at first invocation).
    const grammar = grammarFromSource(`r = "a"
  transforms X@typescript {
    r(a: number, second: number) -> R { return { success: true, value: a }; }
  }`);
    expect(() => validateGrammar(grammar)).toThrow(/declares 2 parameters/);
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      }),
    ).toThrow(/declares 2 parameters/);
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
      }),
    ).toThrow(/declares 2 parameters/);
  });
});

/**
 * Everything `validateGeneratedIdentifiers` checks beyond name-vs-name
 * collisions: (a) the emitted name must itself be a well-formed JS
 * identifier -- the grammar parser can only produce identifier-shaped
 * names, but `generateTypeScriptParser` also accepts a hand-built
 * `GrammarDefinition`, where "my-rule" used to emit `export const
 * my-rule` (a SyntaxError) with no diagnostic; and (b) a bare
 * `Identifier` resolving to NO local rule -- the external-parser escape
 * hatch, emitted verbatim -- must not land on a reserved word, an
 * internal `__*` codegen binding, or a runtime import, where it could
 * never mean "the caller's parser" (an import collision binds the
 * reference to the combinator itself: `literal(input, pos)` returns a
 * `Parser`, not a `ParseResult`).
 */
describe("validateGeneratedIdentifiers: emitted-name shape and external references", () => {
  it.each(["my-rule", "123abc", "foo bar", "a.b"])(
    "rejects a non-identifier-shaped rule name %j (hand-built AST)",
    (name) => {
      const grammar = createGrammarDefinition(
        "G",
        [],
        [createRuleDefinition(name, createStringLiteral("a", '"'))],
      );
      expect(() =>
        validateGeneratedIdentifiers(grammar, {
          namePrefix: "",
          importedBindings: [],
        }),
      ).toThrow(/not a valid JavaScript identifier/);
    },
  );

  it("accepts a rule name that only becomes identifier-shaped through the prefix", () => {
    // `g` + `123` emits `export const g123` -- perfectly valid, so the
    // check must look at the EMITTED name, not the raw rule name.
    const grammar = createGrammarDefinition(
      "G",
      [],
      [createRuleDefinition("123", createStringLiteral("a", '"'))],
    );
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "g",
        importedBindings: [],
      }),
    ).not.toThrow();
  });

  it("end-to-end: both generators reject a malformed rule name from a hand-built AST", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [createRuleDefinition("my-rule", createStringLiteral("a", '"'))],
    );
    expect(() => generateTypeScriptParser(grammar)).toThrow(
      /not a valid JavaScript identifier/,
    );
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, { optimize: true }),
    ).toThrow(/not a valid JavaScript identifier/);
  });

  it("rejects a non-identifier-shaped capture label (hand-built AST)", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "start",
          createLabeledExpression("my-label", createStringLiteral("a", '"')),
        ),
      ],
    );
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).toThrow(
      /capture label named "my-label".*not a valid JavaScript identifier/,
    );
  });

  it('rejects a capture label named "$$" -- collides with wrapWithAction\'s own `const $$` in the same scope (duplicate lexical declaration)', () => {
    // `$$` IS identifier-shaped (JS_IDENTIFIER_FULL admits `$`), so it
    // passes the shape/reserved-word checks -- but `wrapWithAction` emits
    // `const $$ = __result.val;` and `const { $$ } = ($$ ?? {});` in the
    // SAME IIFE scope: a duplicate `const $$`, a SyntaxError in the
    // generated file. Reachable only from a hand-built AST (the grammar
    // parser's identifier rule can't produce a `$`).
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "start",
          createActionExpression(
            createSequence([
              createLabeledExpression("$$", createStringLiteral("a", '"')),
            ]),
            "return $$;",
          ),
        ),
      ],
    );
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).toThrow(/capture label named "\$\$"/);
  });

  it("rejects a QualifiedIdentifier with a non-identifier module part (emits `foo-bar.baz` -> `(foo - bar).baz` mis-parse)", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [
        createRuleDefinition(
          "start",
          createQualifiedIdentifier("foo-bar", "baz"),
        ),
      ],
    );
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).toThrow(/module part "foo-bar" is not a valid JavaScript identifier/);
  });

  it("rejects a QualifiedIdentifier with a non-identifier NAME part (`a.b-c` parses as `(a.b) - c`)", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [createRuleDefinition("start", createQualifiedIdentifier("a", "b-c"))],
    );
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).toThrow(/name part "b-c" is not a valid JavaScript identifier/);
  });

  it("rejects a transform parameter that isn't identifier-shaped (hand-built AST)", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [createRuleDefinition("start", createStringLiteral("a", '"'))],
      [
        createTransformDefinition(
          createTransformSet("X", "typescript", [
            createTransformFunction(
              "start",
              [createTransformParameter("foo-bar", "string")],
              createTransformReturnType("R"),
              "return r;",
            ),
          ]),
        ),
      ],
    );
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).toThrow(/parameter named "foo-bar".*not a valid JavaScript identifier/);
  });

  it("rejects an external parser reference colliding with a runtime import (silent mis-binding to the combinator)", () => {
    // `literal` resolves to no local rule, so it's emitted verbatim --
    // where the string literal in the same grammar forces
    // `import { literal }`, binding the reference to the COMBINATOR
    // (`literal(input, pos)` returns a `Parser`, not a `ParseResult`).
    const grammar = grammarFromSource('start = "x" literal');
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: ["Parser", "literal", "sequence", "untagCapture"],
      }),
    ).toThrow(/external parser "literal".*collides with a runtime import/);
  });

  it("accepts an external parser reference when nothing imports that name (the escape hatch still works)", () => {
    const grammar = grammarFromSource("start = myExternal");
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: ["Parser", "untagCapture"],
      }),
    ).not.toThrow();
  });

  it("rejects an external parser reference that is a reserved word (`sequence(..., function)` is a SyntaxError)", () => {
    const grammar = grammarFromSource("start = function");
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).toThrow(/external parser "function".*reserved word/);
  });

  it("rejects an external parser reference named like an internal `__*` binding", () => {
    for (const name of ["__base", "__result", "__transformed"]) {
      const grammar = grammarFromSource(`start = ${name}`);
      expect(() =>
        validateGeneratedIdentifiers(grammar, {
          namePrefix: "",
          importedBindings: [],
        }),
      ).toThrow(/code generator itself declares/);
    }
  });

  it("rejects a non-identifier-shaped external reference (hand-built AST -- `foo-bar` parses as `foo - bar`)", () => {
    const grammar = createGrammarDefinition(
      "G",
      [],
      [createRuleDefinition("start", createIdentifier("foo-bar"))],
    );
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "",
        importedBindings: [],
      }),
    ).toThrow(/external parser "foo-bar".*not a valid JavaScript identifier/);
  });

  it("does NOT check LOCAL rule references against the bare name -- `namePrefix + name` is what gets emitted", () => {
    // `b` IS a local rule, so `start = b` emits the prefixed name --
    // the bare-identifier checks (reserved word, imports) must not fire
    // on `b` itself even if `b` were an import name.
    const grammar = grammarFromSource('start = b\nb = "a"');
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "g_",
        importedBindings: ["b"],
      }),
    ).not.toThrow();
  });

  it("rejects an external parser reference colliding with a local rule's PREFIXED emitted name (silent mis-binding)", () => {
    // `p_x` resolves to no local rule, so it's emitted verbatim -- but
    // `namePrefix: "p_"` emits `export const p_x` for local rule `x`,
    // which the reference then binds to (and a caller-supplied `p_x`
    // binding would be shadowed by): the same silent mis-binding the
    // import-collision check above guards, via a generated const.
    const grammar = grammarFromSource('start = p_x\nx = "a"');
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "p_",
        importedBindings: ["Parser", "literal", "untagCapture"],
      }),
    ).toThrow(
      /external parser "p_x".*collides with the declaration.*local rule "x"/,
    );
  });

  it("accepts an external parser reference that only PREFIX-MATCHES a local rule name without being the full emitted name", () => {
    // `p_x` with `namePrefix: "x_"` emits nothing named `p_x` (rule `x`
    // emits `x_x`), so the external reference stays genuinely external.
    const grammar = grammarFromSource('start = p_x\nx = "a"');
    expect(() =>
      validateGeneratedIdentifiers(grammar, {
        namePrefix: "x_",
        importedBindings: [],
      }),
    ).not.toThrow();
  });

  it("end-to-end: both generators reject an external reference colliding with a prefixed local-rule declaration", () => {
    const grammar = grammarFromSource('start = p_x\nx = "a"');
    expect(() =>
      generateTypeScriptParser(grammar, {
        namePrefix: "p_",
        includeImports: true,
        includeTypes: true,
      }),
    ).toThrow(/collides with the declaration/);
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, {
        namePrefix: "p_",
        language: "typescript",
        includeImports: true,
        includeTypes: true,
        optimize: true,
      }),
    ).toThrow(/collides with the declaration/);
  });

  it("end-to-end: both generators reject an external reference colliding with an emitted import", () => {
    const grammar = grammarFromSource('start = "x" literal');
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: true,
        includeTypes: true,
      }),
    ).toThrow(/collides with a runtime import/);
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, {
        language: "typescript",
        includeImports: true,
        includeTypes: true,
        optimize: true,
      }),
    ).toThrow(/collides with a runtime import/);
  });
});

describe("validateGeneratedIdentifiers: binding collisions with includeImports: false (regression)", () => {
  // `includeImports: false` suppresses the `import` statements, not the
  // combinator CALLS -- the emitted code still references `sequence`,
  // `untagCapture`, `literal`, etc. and expects the caller to bind them.
  // A rule whose name collides with one of those references therefore
  // emits `export const sequence = sequence(...)` -- a TDZ
  // `ReferenceError` at module evaluation. The collision check used to
  // run only against the emitted import list (empty in this mode), so
  // such grammars passed validation and produced broken code.
  const collidingCases: ReadonlyArray<readonly [string, string]> = [
    ["sequence", 'start = sequence\nsequence = "a" "b"'],
    ["untagCapture", 'start = untagCapture\nuntagCapture = "a"'],
    ["literal", 'start = literal "x"\nliteral = "a"'],
  ];

  it.each(collidingCases)(
    "end-to-end: both generators reject rule `%s` even with includeImports: false",
    (_name, source) => {
      const grammar = grammarFromSource(source);
      expect(() =>
        generateTypeScriptParser(grammar, {
          includeImports: false,
          includeTypes: false,
        }),
      ).toThrow(/collides with a runtime import/);
      expect(() =>
        generateOptimizedTypeScriptParser(grammar, {
          language: "typescript",
          includeImports: false,
          includeTypes: false,
          optimize: true,
        }),
      ).toThrow(/collides with a runtime import/);
    },
  );

  it("end-to-end: an @memoize rule named `memoize` is rejected even with includeImports: false", () => {
    // `memoize` lives in tpeg-combinator, so it is never in the tpeg-core
    // combinator set -- but an `@memoize` rule emits a `memoize(...)`
    // wrap, making the name a real reference the collision check must
    // still cover.
    const grammar = grammarFromSource(
      'start = memoize\n@memoize\nmemoize = "a"',
    );
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      }),
    ).toThrow(/collides with a runtime import/);
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
      }),
    ).toThrow(/collides with a runtime import/);
  });
});
