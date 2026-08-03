/**
 * End-to-end tests for the `~` cut/commit operator and the `@memoize` rule
 * annotation: parse a raw `.tpeg` grammar block through `grammarDefinition`,
 * compile it with the real code generator, and run the generated parser.
 */

import { describe, expect, test } from "bun:test";
import { type Parser, parse } from "@suzumiyaaoba/tpeg-core";
import { promoteGlobalCuts } from "./ast-optimize";
import { generateTypeScriptParser } from "./codegen";
import { analyzeFirstSets } from "./first-sets";
import { grammarDefinition } from "./grammar";

const testParse = <T>(parser: Parser<T>, input: string) => parse(parser)(input);

describe("`~` cut operator, parsed from grammar text", () => {
  test("commits an alternative once matched, instead of backtracking to a sibling", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");

    const source = `grammar Stmt {
      stmt = "i" ~ "f" / "i"
    }`;

    const parsed = testParse(grammarDefinition, source);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const result = generateTypeScriptParser(parsed.val, {
      includeImports: false,
      includeTypes: false,
    });
    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      `${body}\nreturn { stmt };`,
    );
    const { stmt } = moduleFactory(...Object.values(core));

    const pos = 0;
    expect(stmt("if", pos).success).toBe(true);
    // Without the cut, "ix" would fall through to the second alternative
    // and succeed by matching just "i".
    expect(stmt("ix", pos).success).toBe(false);
  });
});

describe("commitAtTopLevel (Phase 3: cut-driven memo table truncation), parsed from grammar text", () => {
  test("a cut directly in the start rule's own top-level sequence compiles to commitAtTopLevel and behaves like an ordinary cut", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");

    const source = `grammar Program {
      program = header ~ body
      header = "H"
      body = "B"
    }`;

    const parsed = testParse(grammarDefinition, source);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const result = generateTypeScriptParser(parsed.val, {
      includeImports: true,
      includeTypes: false,
    });
    expect(result.code).toContain("commitAtTopLevel(");
    expect(result.code).not.toContain("commit(");
    expect(result.imports.join("\n")).toContain(
      'import { commitAtTopLevel } from "@suzumiyaaoba/tpeg-combinator";',
    );

    const body = result.code
      .replace(/^import .+$/gm, "")
      .replace(/^export const (\w+)/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      ...Object.keys(combinator),
      `${body}\nreturn { program };`,
    );
    const { program } = moduleFactory(
      ...Object.values(core),
      ...Object.values(combinator),
    );

    const pos = 0;
    expect(program("HB", pos).success).toBe(true);
    expect(program("XB", pos).success).toBe(false); // fails before the cut
    const afterCommit = program("HX", pos);
    expect(afterCommit.success).toBe(false); // fails after the cut -- fatal
    if (!afterCommit.success) {
      expect(afterCommit.error.fatal).toBe(true);
    }
  });

  test("a cut nested inside a Choice within the start rule does NOT compile to commitAtTopLevel", () => {
    // Same source shape as the existing "commits an alternative..." test
    // above, restated here to pin that it specifically does NOT trigger
    // the Phase 3 path even though `stmt` is this grammar's only (and
    // therefore start) rule: the cut is nested inside `stmt`'s top-level
    // Choice, not a direct element of a top-level Sequence.
    const source = `grammar Stmt {
      stmt = "i" ~ "f" / "i"
    }`;

    const parsed = testParse(grammarDefinition, source);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const result = generateTypeScriptParser(parsed.val, {
      includeImports: true,
      includeTypes: false,
    });
    expect(result.code).not.toContain("commitAtTopLevel");
    expect(result.code).toContain("commit(");
    expect(result.imports.join("\n")).not.toContain("tpeg-combinator");
  });

  test("space claim: memo entries created before the top-level commit are gone afterward", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");

    // `shared` (explicitly `@memoize`d) is invoked at offsets 0 and 2
    // while `header`'s `(shared "x")*` backtracks through two
    // repetitions before `program`'s cut fires right after `header`
    // ends. Those two cache entries are exactly what the cut should
    // prove unreachable.
    const source = `grammar Program {
      program = header ~ body
      header = (shared "x")* "H"
      @memoize
      shared = "a"
      body = "B"
    }`;

    const parsed = testParse(grammarDefinition, source);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const result = generateTypeScriptParser(parsed.val, {
      includeImports: false,
      includeTypes: false,
    });
    expect(result.code).toContain("commitAtTopLevel(");
    expect(result.code).toContain("memoize(");

    // Wrap `literal("a")` so every REAL invocation (a cache miss inside
    // `shared`) is counted -- the same technique
    // `packages/parser/bench/harness.ts` uses for its leaf-invocation
    // counter. `shared`'s body is exactly `literal("a")`, so every call
    // to `shared` that isn't a cache hit shows up here.
    const counter = { count: 0 };
    const countingLiteral = (...args: Parameters<typeof core.literal>) => {
      const inner = core.literal(...args);
      const wrapped: Parser<unknown> = (input, p) => {
        if (args[0] === "a") counter.count++;
        return inner(input, p);
      };
      return wrapped;
    };

    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const scope = { ...core, ...combinator, literal: countingLiteral };
    const moduleFactory = new Function(
      ...Object.keys(scope),
      `${body}\nreturn { program, shared };`,
    );
    const { program, shared } = moduleFactory(...Object.values(scope));

    const pos = 0;
    // "axaxHB": header matches 2 reps of "a x" (offsets 0 and 2, each
    // caching a `shared` success entry) then "H" at offset 4; the cut
    // fires at offset 5, right where `body` ("B") starts.
    const parseResult = program("axaxHB", pos);
    expect(parseResult.success).toBe(true);
    const callsDuringParse = counter.count;
    expect(callsDuringParse).toBeGreaterThanOrEqual(2); // offsets 0 and 2

    // Re-invoking `shared` directly at offset 0 -- cached with a SUCCESS
    // entry during header's parse, and below the watermark (5) the
    // commit advanced it to -- must be a fresh call (counter increases),
    // not a cache hit. This is the space claim: the entry is gone, not
    // just unreachable through `program`'s own control flow.
    shared("axaxHB", pos);
    expect(counter.count).toBe(callsDuringParse + 1);
  });
});

describe("promoteGlobalCuts (Pillar 7: cut promotion beyond the start rule's own top-level sequence)", () => {
  test("a cut in a rule referenced only through a Plus from the start rule promotes to commitAtTopLevel and reproduces the same space claim as the Phase 3 case", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");

    // `one`'s cut is a direct element of `one`'s OWN top-level Sequence --
    // but `one` is not the start rule (`start = one+` is), so today's
    // `isStartRuleTopLevel` structural check does NOT catch it; without
    // `promoteGlobalCuts` this compiles to plain `commit(...)`. `one` has
    // no ancestor Choice or lookahead anywhere between its cut and
    // `start`, so the promotion predicate should mark it `global: true`.
    const source = `grammar Program {
      start = one+
      one = header ~ body
      header = (shared "x")* "H"
      @memoize
      shared = "a"
      body = "B"
    }`;

    const parsed = testParse(grammarDefinition, source);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const analysis = analyzeFirstSets(parsed.val);
    const { grammar: promoted, promotedCount } = promoteGlobalCuts(
      parsed.val,
      analysis,
    );
    expect(promotedCount).toBe(1);

    const result = generateTypeScriptParser(promoted, {
      includeImports: false,
      includeTypes: false,
    });
    expect(result.code).toContain("commitAtTopLevel(");
    expect(result.code).not.toContain("commit(");
    expect(result.code).toContain("memoize(");

    const counter = { count: 0 };
    const countingLiteral = (...args: Parameters<typeof core.literal>) => {
      const inner = core.literal(...args);
      const wrapped: Parser<unknown> = (input, p) => {
        if (args[0] === "a") counter.count++;
        return inner(input, p);
      };
      return wrapped;
    };

    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const scope = { ...core, ...combinator, literal: countingLiteral };
    const moduleFactory = new Function(
      ...Object.keys(scope),
      `${body}\nreturn { start, shared };`,
    );
    const { start, shared } = moduleFactory(...Object.values(scope));

    const pos = 0;
    // "axaxHB": header matches 2 reps of "a x" (offsets 0 and 2, each
    // caching a `shared` success entry) then "H" at offset 4; `one`'s cut
    // fires at offset 5, right where `body` ("B") starts.
    const parseResult = start("axaxHB", pos);
    expect(parseResult.success).toBe(true);
    const callsDuringParse = counter.count;
    expect(callsDuringParse).toBeGreaterThanOrEqual(2); // offsets 0 and 2

    // Same space claim as the Phase 3 test above, now through a cut that
    // ONLY reaches commitAtTopLevel because of promoteGlobalCuts: the
    // cached entry at offset 0 is gone, not just unreachable through
    // `start`'s own control flow.
    shared("axaxHB", pos);
    expect(counter.count).toBe(callsDuringParse + 1);
  });

  test("does NOT promote (and does not change generated code at all) when a later Choice sibling is not FIRST-disjoint", async () => {
    // Same shape as BENCH_UNFACTORED_ARITHMETIC_GRAMMAR's atom cut,
    // restated as a grammar-text differential: promoteGlobalCuts must
    // leave the AST (and therefore generated code) byte-identical when it
    // finds nothing safe to promote.
    const source = `grammar Arith {
      product = atom "*" product / atom "/" product / atom
      atom = "(" ~ product ")" / number
      number = [0-9]+
    }`;

    const parsed = testParse(grammarDefinition, source);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const before = generateTypeScriptParser(parsed.val, {
      includeImports: false,
      includeTypes: false,
    });

    const analysis = analyzeFirstSets(parsed.val);
    const { grammar: promoted, promotedCount } = promoteGlobalCuts(
      parsed.val,
      analysis,
    );
    expect(promotedCount).toBe(0);

    const after = generateTypeScriptParser(promoted, {
      includeImports: false,
      includeTypes: false,
    });
    expect(after.code).toBe(before.code);
    expect(after.code).toContain("commit(");
    expect(after.code).not.toContain("commitAtTopLevel");
  });
});

describe("`@memoize` annotation, parsed from grammar text", () => {
  test("bounds the generated rule's memo table via maxCacheSize", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");

    const source = `grammar Bounded {
      @memoize: 4
      digits = [0-9]+
    }`;

    const parsed = testParse(grammarDefinition, source);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.val.rules[0]?.annotations).toEqual([
      { type: "GrammarAnnotation", key: "memoize", value: "4" },
    ]);

    const result = generateTypeScriptParser(parsed.val, {
      includeImports: false,
      includeTypes: false,
    });
    expect(result.code).toContain("memoize(");
    expect(result.code).toContain("maxCacheSize: 4");

    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      ...Object.keys(combinator),
      `${body}\nreturn { digits };`,
    );
    const { digits } = moduleFactory(
      ...Object.values(core),
      ...Object.values(combinator),
    );

    const pos = 0;
    const parsedDigits = digits("12345x", pos);
    expect(parsedDigits.success).toBe(true);
    if (parsedDigits.success) {
      expect(parsedDigits.next).toBe(5);
    }
  });
});
