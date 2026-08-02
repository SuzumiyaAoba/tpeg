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
  createAnyChar,
  createCharRange,
  createCharacterClass,
  createChoice,
  createGrammarDefinition,
  createIdentifier,
  createLabeledExpression,
  createPlus,
  createQualifiedIdentifier,
  createRuleDefinition,
  createSequence,
  createStringLiteral,
  createTransformDefinition,
  createTransformFunction,
  createTransformParameter,
  createTransformReturnType,
  createTransformSet,
} from "./types";

/**
 * A minimal grammar where `shared` is reachable from every alternative of
 * `big`'s Choice -- the canonical reentrant shape (see
 * `packages/parser/src/reentrancy.ts`), used below wherever a test needs
 * *some* rule the current memoization trigger will flag, without the test
 * itself being about which shapes get flagged.
 */
function reentrantSharedRuleGrammar() {
  return createGrammarDefinition(
    "Test",
    [],
    [
      createRuleDefinition(
        "big",
        createChoice([
          createSequence([
            createIdentifier("shared"),
            createStringLiteral("x", '"'),
          ]),
          createSequence([
            createIdentifier("shared"),
            createStringLiteral("y", '"'),
          ]),
          createIdentifier("shared"),
        ]),
      ),
      createRuleDefinition("shared", createStringLiteral("a", '"')),
    ],
  );
}

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
    // `shared` is invoked from all 3 alternatives of `big`'s Choice, so
    // `reentrancy.ts`'s analysis flags it for memoization (see
    // `packages/parser/src/reentrancy.ts` and its spec for the algorithm
    // this replaced `estimatedComplexity === "high" || hasRecursion`
    // with). A single large, non-alternated Sequence -- what this test
    // used before -- no longer triggers memoization at all under the new
    // analysis, correctly: nothing in a straight-line sequence of
    // distinct literals is ever re-invoked at the same offset, so
    // memoizing it would be pure overhead.
    const grammar = reentrantSharedRuleGrammar();

    const result = generateOptimizedTypeScriptParser(grammar);

    expect(result.code).toContain("memoize(");
    expect(result.code).not.toContain("memoize(memoize(");
  });

  it("imports memoize exactly once, from tpeg-combinator, never from tpeg-core", () => {
    const grammar = reentrantSharedRuleGrammar();

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

  it("generates character class / negated character class / AnyChar code that actually parses input", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");

    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "letter",
          createCharacterClass([createCharRange("a", "z")], false),
        ),
        createRuleDefinition(
          "notDigit",
          createCharacterClass([createCharRange("0", "9")], true),
        ),
        createRuleDefinition("anything", createAnyChar()),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: true,
    });

    expect(result.code).toContain('charClass(["a", "z"])');
    expect(result.code).toContain('negatedCharClass(["0", "9"])');
    expect(result.code).toContain("anyChar()");

    const body = result.code
      .replace(/^import[^\n]*\n?/gm, "")
      .replace(/^export const (\w+): Parser<[^>]*>/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      `${body}\nreturn { letter, notDigit, anything };`,
    );
    const { letter, notDigit, anything } = moduleFactory(
      ...Object.values(core),
    );

    const pos = 0;
    expect(letter("m", pos).success).toBe(true);
    expect(notDigit("m", pos).success).toBe(true);
    expect(notDigit("5", pos).success).toBe(false);
    expect(anything("x", pos).success).toBe(true);
  });

  it("generates a namespaced reference for a qualified (cross-module) identifier", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [createRuleDefinition("main", createQualifiedIdentifier("math", "expr"))],
    );

    const result = generateOptimizedTypeScriptParser(grammar);

    expect(result.code).toContain(
      "export const main: Parser<any> = math.expr;",
    );
  });

  it("applies a matching TypeScript transform function to a rule's parse result", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");

    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "number",
          createLabeledExpression(
            "digits",
            createPlus(
              createCharacterClass([createCharRange("0", "9")], false),
            ),
          ),
        ),
      ],
      [
        createTransformDefinition(
          createTransformSet("Evaluator", "typescript", [
            createTransformFunction(
              "number",
              [createTransformParameter("captures", "{ digits: string[] }")],
              createTransformReturnType("Result", "number"),
              `
    const value = parseInt(captures.digits.join(""), 10);
    if (isNaN(value)) {
      return { success: false, error: "Invalid number format" };
    }
    return { success: true, value };
  `,
            ),
          ]),
        ),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: true,
    });

    const body = result.code
      .replace(/^import[^\n]*\n?/gm, "")
      .replace(/^export const (\w+): Parser<[^>]*>/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      `${body}\nreturn { number };`,
    );
    const { number } = moduleFactory(...Object.values(core));

    const pos = 0;
    expect(number("123abc", pos)).toEqual({
      success: true,
      val: 123,
      current: 0,
      next: 3,
    });
    expect(number("abc", pos).success).toBe(false);
  });

  it("preserves declaration order of Choice alternatives instead of sorting by AST size", async () => {
    // PEG's ordered choice (`/`) is defined by "first alternative that
    // matches wins" -- declaration order is part of the grammar's
    // semantics. This pins the fix for a bug where the optimized
    // generator sorted `choice()` arguments by AST node count ("simple
    // first"), which silently changes which language is accepted: a
    // grammar for `"==" / "="` (modeled here as `seq("=", "=") / "="`, so
    // the two alternatives have different node counts) would have its
    // alternatives reordered to `"=" / "=="`, making `==` unmatchable --
    // the shorter alternative would now be tried, and would succeed,
    // before the longer one ever got a chance.
    const core = await import("@suzumiyaaoba/tpeg-core");

    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "op",
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

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: true,
      optimize: true,
    });

    const body = result.code
      .replace(/^import[^\n]*\n?/gm, "")
      .replace(/^export const (\w+): Parser<[^>]*>/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      `${body}\nreturn { op };`,
    );
    const { op } = moduleFactory(...Object.values(core));

    const pos = 0;
    const parsed = op("==", pos);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Must consume both "=" characters (the first, longer alternative),
      // not just one (which the buggy nodeCount-ascending sort would try
      // first since a single StringLiteral has a smaller AST than the
      // Sequence).
      expect(parsed.next).toBe(2);
    }
  });

  it("compiles a `~` cut marker into commit(...)-wrapped elements after it", () => {
    // `ifStmt` is deliberately NOT the grammar's start rule (index 0)
    // here -- see the dedicated `commitAtTopLevel` tests below for that
    // case, which compiles a top-level cut differently.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("stmt", createIdentifier("ifStmt")),
        createRuleDefinition(
          "ifStmt",
          createSequence([
            createStringLiteral("if", '"'),
            { type: "Cut" },
            createStringLiteral("cond", '"'),
            createStringLiteral("then", '"'),
          ]),
        ),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: true,
    });

    expect(result.code).toContain(
      'sequence(literal("if"), commit(literal("cond")), commit(literal("then")))',
    );
    const coreImportLine = result.code
      .split("\n")
      .find(
        (line) =>
          line.startsWith("import {") &&
          line.includes("@suzumiyaaoba/tpeg-core"),
      );
    expect(coreImportLine).toContain("commit");
  });

  it("unwraps a cut sequence down to its single committed element, same as an ordinary single-element sequence", () => {
    // `r` is deliberately NOT the start rule -- see the dedicated
    // `commitAtTopLevel` tests below for the start-rule case.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("stmt", createIdentifier("r")),
        createRuleDefinition(
          "r",
          createSequence([{ type: "Cut" }, createStringLiteral("b", '"')]),
        ),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar);

    expect(result.code).toContain(
      'export const r: Parser<any> = commit(literal("b"));',
    );
  });

  it("compiles a top-level `~` cut in the start rule's own pattern into commitAtTopLevel(...)-wrapped elements", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "ifStmt",
          createSequence([
            createStringLiteral("if", '"'),
            { type: "Cut" },
            createStringLiteral("cond", '"'),
            createStringLiteral("then", '"'),
          ]),
        ),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: true,
    });

    expect(result.code).toContain(
      'sequence(literal("if"), commitAtTopLevel(literal("cond")), commitAtTopLevel(literal("then")))',
    );
    expect(result.code).not.toContain("commit(literal");
    expect(result.code).toContain(
      'import { commitAtTopLevel } from "@suzumiyaaoba/tpeg-combinator";',
    );
  });

  it("unwraps a top-level cut sequence in the start rule down to its single commitAtTopLevel-wrapped element", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createSequence([{ type: "Cut" }, createStringLiteral("b", '"')]),
        ),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar);

    expect(result.code).toContain(
      'export const r: Parser<any> = commitAtTopLevel(literal("b"));',
    );
  });

  it("wraps a rule carrying an explicit `@memoize: N` annotation with maxCacheSize, independent of enableMemoization", () => {
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("expr", createStringLiteral("x", '"'), undefined, [
          { type: "GrammarAnnotation", key: "memoize", value: "128" },
        ]),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: true,
      enableMemoization: false,
    });

    expect(result.code).toContain(
      'export const expr: Parser<any> = memoize(literal("x"), { maxCacheSize: 128 });',
    );
    expect(result.code).toContain(
      'import { memoize } from "@suzumiyaaoba/tpeg-combinator";',
    );
  });

  it("does not double-wrap a rule that both carries @memoize and trips the automatic complexity heuristic", () => {
    const bigSequence = {
      type: "Sequence" as const,
      elements: Array.from({ length: 60 }, () => createStringLiteral("a", '"')),
    };
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition("big", bigSequence, undefined, [
          { type: "GrammarAnnotation", key: "memoize", value: "" },
        ]),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar);

    expect(result.code).toContain("memoize(");
    expect(result.code).not.toContain("memoize(memoize(");
  });
});

describe("enablePredictiveDispatch", () => {
  const JSON_LIKE_GRAMMAR = createGrammarDefinition(
    "Test",
    [],
    [
      createRuleDefinition(
        "value",
        createChoice([
          createIdentifier("str"),
          createIdentifier("num"),
          createIdentifier("bool"),
        ]),
      ),
      createRuleDefinition(
        "str",
        createSequence([
          createStringLiteral('"', '"'),
          createStringLiteral('"', '"'),
        ]),
      ),
      createRuleDefinition(
        "num",
        createCharacterClass([createCharRange("0", "9")], false),
      ),
      createRuleDefinition(
        "bool",
        createChoice([
          createStringLiteral("true", '"'),
          createStringLiteral("false", '"'),
        ]),
      ),
    ],
  );

  it("emits predictiveChoice by default (Phase 0 of the perf plan: on unless explicitly disabled)", () => {
    const result = generateOptimizedTypeScriptParser(JSON_LIKE_GRAMMAR, {
      enableMemoization: false,
    });
    expect(result.code).toContain("predictiveChoice(");
  });

  it("does not emit predictiveChoice when explicitly disabled", () => {
    const result = generateOptimizedTypeScriptParser(JSON_LIKE_GRAMMAR, {
      enableMemoization: false,
      enablePredictiveDispatch: false,
    });
    expect(result.code).not.toContain("predictiveChoice(");
    expect(result.code).toContain("choice(");
  });

  it("emits predictiveChoice with the correct per-alternative FIRST-char filters for a FIRST-disjoint Choice", () => {
    const result = generateOptimizedTypeScriptParser(JSON_LIKE_GRAMMAR, {
      enableMemoization: false,
      enablePredictiveDispatch: true,
    });
    expect(result.code).toContain("predictiveChoice([");
    // `FirstCharFilter` (packages/core/src/combinators.ts) is now
    // rendered as code-point intervals -- '"' is U+0022, and "f"/"t"
    // (from `bool`'s "false"/"true") sort ascending by code point
    // (0x66 < 0x74) regardless of the grammar's declaration order.
    expect(result.code).toContain("{ ranges: [{ lo: 34, hi: 34 }] }");
    expect(result.code).toContain(
      "{ ranges: [{ lo: 102, hi: 102 }, { lo: 116, hi: 116 }] }",
    );
    // `num`'s filter is a single [0-9] range, not discrete code points.
    expect(result.code).toContain("{ ranges: [{ lo: 48, hi: 57 }] }");
  });

  it("falls back to plain choice() for a Choice with no computable, non-nullable FIRST set on any alternative", () => {
    // AnyChar is no longer a case that forces this fallback (Pillar 1:
    // its FIRST set is now the exact universal set, not `unknown`) --
    // a cross-module QualifiedIdentifier is still genuinely unresolvable
    // here, so it's the regression case for this fallback path now.
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createQualifiedIdentifier("math", "expr"),
            createQualifiedIdentifier("math", "expr"),
          ]),
        ),
      ],
    );
    const result = generateOptimizedTypeScriptParser(grammar, {
      enableMemoization: false,
      enablePredictiveDispatch: true,
    });
    expect(result.code).not.toContain("predictiveChoice(");
    expect(result.code).toContain("choice(math.expr, math.expr)");
  });

  it("produces code that parses identically to enablePredictiveDispatch:false for a battery of inputs", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");

    const compileValue = (enablePredictiveDispatch: boolean) => {
      const result = generateOptimizedTypeScriptParser(JSON_LIKE_GRAMMAR, {
        includeImports: false,
        includeTypes: false,
        enableMemoization: false,
        enablePredictiveDispatch,
      });
      const ruleNames = [...result.code.matchAll(/^export const (\w+)/gm)].map(
        (m) => m[1] as string,
      );
      const body = result.code.replace(/^export const (\w+)/gm, "const $1");
      const factory = new Function(
        ...Object.keys(core),
        `${body}\nreturn { ${ruleNames.join(", ")} };`,
      );
      const built = factory(...Object.values(core)) as Record<
        string,
        (typeof core)["choice"]
      >;
      return built["value"] as unknown as (
        input: string,
        pos: number,
      ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;
    };

    const plain = compileValue(false);
    const predictive = compileValue(true);
    const pos = 0;

    for (const input of ['""', "5", "true", "false", "x", "", '"a']) {
      const plainResult = plain(input, pos);
      const predictiveResult = predictive(input, pos);
      expect(predictiveResult.success).toBe(plainResult.success);
      if (plainResult.success && predictiveResult.success) {
        expect(predictiveResult.next).toEqual(plainResult.next);
      }
    }
  });

  it("regression: predictively dispatches correctly on a Choice alternative starting with an astral (surrogate-pair) StringLiteral", async () => {
    // `r = "😀x" / "y"` -- U+1F600 is 2 UTF-16 code units. Both the FIRST
    // set computed for this alternative and `predictiveChoice`'s runtime
    // filter check must agree on treating it as one code point, or the
    // "😀x" alternative gets predictively (and wrongly) excluded even
    // when the input actually starts with it.
    const core = await import("@suzumiyaaoba/tpeg-core");
    const astral = "\u{1F600}";

    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createStringLiteral(`${astral}x`, '"'),
            createStringLiteral("y", '"'),
          ]),
        ),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: false,
      includeTypes: false,
      enableMemoization: false,
      enablePredictiveDispatch: true,
    });
    expect(result.code).toContain("predictiveChoice([");

    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const factory = new Function(
      ...Object.keys(core),
      `${body}\nreturn { r };`,
    );
    const built = factory(...Object.values(core)) as {
      r: (
        input: string,
        pos: number,
      ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;
    };

    const pos = 0;
    const result1 = built.r(`${astral}x`, pos);
    expect(result1.success).toBe(true);
    const result2 = built.r("y", pos);
    expect(result2.success).toBe(true);
  });

  it("regression: never predictively dispatches on a Choice alternative that starts with an externally-supplied rule reference", async () => {
    // `r = ext "x" / "y"`, where `ext` is NOT a rule of this grammar --
    // codegen emits it as a bare, unresolved identifier (an externally
    // injected parser, same as e.g. `math.expr` minus the qualifier).
    // Its FIRST set is unknowable from this grammar alone; predictively
    // filtering alternative 0 by `{"x"}` would be unsound the moment
    // `ext` can start with something other than what makes `"x"` follow.
    const core = await import("@suzumiyaaoba/tpeg-core");

    const grammar = createGrammarDefinition(
      "Test",
      [],
      [
        createRuleDefinition(
          "r",
          createChoice([
            createSequence([
              createIdentifier("ext"),
              createStringLiteral("x", '"'),
            ]),
            createStringLiteral("y", '"'),
          ]),
        ),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: false,
      includeTypes: false,
      enableMemoization: false,
      enablePredictiveDispatch: true,
    });

    // `ext` matches a single "a" and nothing else.
    const ext = (input: string, pos: number) =>
      input[pos] === "a"
        ? {
            success: true as const,
            val: "a",
            current: pos,
            next: pos + 1,
          }
        : { success: false as const, error: { message: "not a", pos } };

    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const factory = new Function(
      ...Object.keys(core),
      "ext",
      `${body}\nreturn { r };`,
    );
    const { r } = factory(...Object.values(core), ext) as {
      r: (
        input: string,
        pos: number,
      ) => import("@suzumiyaaoba/tpeg-core").ParseResult<unknown>;
    };

    const pos = 0;
    // "ax": ext consumes "a", then "x" matches -- alternative 0 must
    // still be attempted even though the *first* character is "a", not
    // "x". A buggy `{chars: {"x"}}` filter on alternative 0 would skip
    // it here and wrongly fail (or wrongly fall through if "a" happened
    // to also start alternative 1, which it doesn't in this grammar).
    expect(r("ax", pos).success).toBe(true);
  });
});
