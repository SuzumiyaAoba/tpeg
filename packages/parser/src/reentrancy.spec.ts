import { describe, expect, it } from "bun:test";
import { grammarDefinition } from "./grammar";
import { analyzeReentrancy } from "./reentrancy";
import {
  createChoice,
  createGrammarDefinition,
  createIdentifier,
  createNegativeLookahead,
  createOptional,
  createPositiveLookahead,
  createRuleDefinition,
  createSequence,
  createStringLiteral,
} from "./types";

const ORIGIN = 0;

// Mirrors of the three grammars in `packages/parser/bench/grammars.ts`
// (`BENCH_ACYCLIC_CHAIN_GRAMMAR`, `BENCH_UNFACTORED_ARITHMETIC_GRAMMAR`,
// `BENCH_JSON_GRAMMAR`). Duplicated by value rather than imported: `src/`
// and `bench/` are compiled under separate `tsconfig`s (`bench/` isn't
// part of `src`'s `rootDir`, and is deliberately excluded from `bun
// test`'s scan -- see `bench/run.ts`'s module doc comment), so a
// cross-directory import doesn't typecheck. If the bench grammars change,
// keep these in sync -- the point of this spec is that the analysis's
// predictions match the exact grammars the bench's own docstrings and
// measurements were made against.
const ACYCLIC_CHAIN_GRAMMAR = `
grammar BenchAcyclicChain {
  a0 = a1 "x" / a1 "y" / a1
  a1 = a2 "x" / a2 "y" / a2
  a2 = a3 "x" / a3 "y" / a3
  a3 = a4 "x" / a4 "y" / a4
  a4 = a5 "x" / a5 "y" / a5
  a5 = a6 "x" / a6 "y" / a6
  a6 = a7 "x" / a7 "y" / a7
  a7 = a8 "x" / a8 "y" / a8
  a8 = a9 "x" / a9 "y" / a9
  a9 = [0-9]+
}
`;

const UNFACTORED_ARITHMETIC_GRAMMAR = `
grammar BenchUnfactoredArithmetic {
  expr = sum
  sum = product "+" sum / product "-" sum / product
  product = atom "*" product / atom "/" product / atom
  atom = "(" sum ")" / number
  number = [0-9]+
}
`;

const JSON_GRAMMAR = `
grammar BenchJson {
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

/** Parses `src` (must succeed) and returns its `GrammarDefinition`. */
function parse(src: string) {
  const result = grammarDefinition(src, ORIGIN);
  if (!result.success) {
    throw new Error(
      `test grammar failed to parse: ${result.error.message} at offset ${result.error.pos}`,
    );
  }
  return result.val;
}

describe("analyzeReentrancy", () => {
  // These three are the exact grammars from `packages/parser/bench/
  // grammars.ts`, empirically measured while designing this analysis --
  // this spec is the acceptance test for the algorithm's guarantees, not
  // just illustrative examples.

  it("flags every non-root rule of an acyclic unfactored chain (BENCH_ACYCLIC_CHAIN_GRAMMAR)", () => {
    // 10 levels of unfactored 3-way choice, none of them recursive --
    // the case the old hasRecursion/complexity heuristic memoized NONE
    // of (see bench/grammars.ts's docstring) despite it being
    // exponential (3^9 redundant reparses of a9 for a single call to
    // a0). a1..a9 are each reachable from more than one alternative of
    // their caller's Choice; a0 itself is the entry point, never
    // re-invoked within a single parse, so it's correctly excluded.
    //
    // Also the deliberate negative control for dominance minimization
    // (reentrancy.ts's `minimizeByDominance`): a1..a9 each have exactly
    // one caller (a(N-1)), so a naive "unique caller" check alone might
    // seem to license dropping most of them -- but every one of those
    // chains resolves to a0, which is NOT itself in the raw reentrant
    // set (it's the sole entry point, never re-invoked), so NONE of
    // a1..a9 are dominated. All nine keep their own memo table, exactly
    // as this test asserts -- the pillar this module exists for must
    // not regress.
    const grammar = parse(ACYCLIC_CHAIN_GRAMMAR);
    const { reentrantRules } = analyzeReentrancy(grammar);
    expect([...reentrantRules].sort()).toEqual([
      "a1",
      "a2",
      "a3",
      "a4",
      "a5",
      "a6",
      "a7",
      "a8",
      "a9",
    ]);
  });

  it("flags product alone (not atom/number/sum) for the unfactored arithmetic grammar, once dominance minimization is applied", () => {
    // sum = product "+" sum / product "-" sum / product
    // product = atom "*" product / atom "/" product / atom
    // atom = "(" sum ")" / number
    //
    // Raw overlap detection flags `product` (shared by all 3 alternatives
    // of `sum`'s choice), `atom` (shared by all 3 alternatives of
    // `product`'s choice), and `number` (transitively, only reachable
    // through `atom`). `atom`'s only caller in the whole grammar is
    // `product`; `number`'s only caller is `atom`; walking that chain
    // resolves to `product`, which IS itself raw-reentrant and has no
    // sole caller of its own (`sum` calls it 3 times, so `product`'s
    // caller set is {sum} ∪ {product} (self-recursive) -- size 2, not
    // unique) -- so `product` survives as the chain's root and both
    // `atom`/`number` are dominated by it (see reentrancy.ts's
    // "Dominance-based minimization" section for the soundness argument
    // and an empirical validation that memoizing `product` alone
    // produces the identical `leafInvocationsPerParse` as memoizing all
    // three). `sum` itself is the entry point (never re-invoked in this
    // grammar), so it was never in the raw set to begin with.
    const grammar = parse(UNFACTORED_ARITHMETIC_GRAMMAR);
    const { reentrantRules } = analyzeReentrancy(grammar);
    expect([...reentrantRules]).toEqual(["product"]);
  });

  it("flags nothing for JSON's FIRST-disjoint value choice", () => {
    // value = string / number / boolean / nullLiteral / object / array
    // Every alternative is a different rule with a distinguishing
    // leading literal/char-class, so none of them share a rule
    // invocation at offset 0 -- memoizing any of them would be pure
    // overhead (0% cache hit rate; see bench/run.ts's JSON section
    // docstring). This is the case the OLD heuristic got right only by
    // accident (JSON's `value` rule doesn't cross the
    // depth/node-count/recursion thresholds either) -- included here so
    // a future change to the analysis can't silently start
    // over-memoizing this grammar without a test noticing.
    const grammar = parse(JSON_GRAMMAR);
    const { reentrantRules } = analyzeReentrancy(grammar);
    expect([...reentrantRules]).toEqual([]);
  });

  // The decisive case distinguishing a sound analysis from one that only
  // handles Choice-level backtracking (source (a) in reentrancy.ts's
  // module doc comment): `A` appears both inside a failing/empty
  // `Optional` and again as the very next element of the same Sequence.
  // If `B` doesn't match, `(A B)?` yields an empty match without
  // re-invoking `A`, and the parse falls through to the bare `A` right
  // after it -- a second invocation of `A` at the exact same offset,
  // with no Choice node involved at all.
  it("flags A for `s = (a b)? a c` via optional-fallthrough, not just choice backtracking", () => {
    const grammar = createGrammarDefinition(
      "OptCont",
      [],
      [
        createRuleDefinition(
          "s",
          createSequence([
            createOptional(
              createSequence([createIdentifier("a"), createIdentifier("b")]),
            ),
            createIdentifier("a"),
            createIdentifier("c"),
          ]),
        ),
        createRuleDefinition("a", createStringLiteral("a", '"')),
        createRuleDefinition("b", createStringLiteral("b", '"')),
        createRuleDefinition("c", createStringLiteral("c", '"')),
      ],
    );
    const { reentrantRules } = analyzeReentrancy(grammar);
    expect([...reentrantRules]).toEqual(["a"]);
  });

  // Source (3): a lookahead invokes its inner expression at the same
  // offset even though it consumes nothing, so `&r r` re-invokes `r`
  // just as surely as an ordered-choice backtrack would.
  it("flags R for `s = &r r` (positive lookahead followed by the same rule)", () => {
    const grammar = createGrammarDefinition(
      "LookCont",
      [],
      [
        createRuleDefinition(
          "s",
          createSequence([
            createPositiveLookahead(createIdentifier("r")),
            createIdentifier("r"),
          ]),
        ),
        createRuleDefinition("r", createStringLiteral("x", '"')),
      ],
    );
    const { reentrantRules } = analyzeReentrancy(grammar);
    expect([...reentrantRules]).toEqual(["r"]);
  });

  it("flags R for `s = !r r2` when the negative lookahead's target overlaps the continuation", () => {
    const grammar = createGrammarDefinition(
      "NegLookCont",
      [],
      [
        createRuleDefinition(
          "s",
          createSequence([
            createNegativeLookahead(createIdentifier("r")),
            createIdentifier("r"),
          ]),
        ),
        createRuleDefinition("r", createStringLiteral("x", '"')),
      ],
    );
    const { reentrantRules } = analyzeReentrancy(grammar);
    expect([...reentrantRules]).toEqual(["r"]);
  });

  it("does not flag rules that are never reachable from more than one point", () => {
    const grammar = createGrammarDefinition(
      "NoSharing",
      [],
      [
        createRuleDefinition(
          "s",
          createChoice([createIdentifier("a"), createIdentifier("b")]),
        ),
        createRuleDefinition("a", createStringLiteral("a", '"')),
        createRuleDefinition("b", createStringLiteral("b", '"')),
      ],
    );
    const { reentrantRules } = analyzeReentrancy(grammar);
    expect([...reentrantRules]).toEqual([]);
  });

  it("does not flag a rule made unreachable-twice by a non-nullable element in between", () => {
    // `s = a "x" a` -- `a` appears twice, but the literal "x" between
    // them is non-nullable, so the second `a` is never at the same
    // offset as the first: no reentrancy, unlike `(a)? a` where the
    // gap is nullable.
    const grammar = createGrammarDefinition(
      "SeparatedByNonNullable",
      [],
      [
        createRuleDefinition(
          "s",
          createSequence([
            createIdentifier("a"),
            createStringLiteral("x", '"'),
            createIdentifier("a"),
          ]),
        ),
        createRuleDefinition("a", createStringLiteral("a", '"')),
      ],
    );
    const { reentrantRules } = analyzeReentrancy(grammar);
    expect([...reentrantRules]).toEqual([]);
  });

  // Dominance minimization (`minimizeByDominance`) must only remove a
  // rule whose EVERY caller resolves, via a chain of unique-caller
  // edges, up to one already-reentrant ancestor. This is the negative
  // case: `leaf` is reachable from two textually distinct rules (`x`
  // and `y`), so no single ancestor's memoization can be relied on to
  // bound every path to it -- `y`'s own invocation of `leaf` is entirely
  // outside whatever redundancy `x`'s local optional-fallthrough
  // (`(leaf)? leaf`) would shield.
  it("does not dominate (and does not remove) a rule reachable from two distinct callers", () => {
    const grammar = createGrammarDefinition(
      "TwoCallers",
      [],
      [
        createRuleDefinition(
          "s",
          createChoice([createIdentifier("x"), createIdentifier("y")]),
        ),
        createRuleDefinition(
          "x",
          createSequence([
            createOptional(createIdentifier("leaf")),
            createIdentifier("leaf"),
            createStringLiteral("a", '"'),
          ]),
        ),
        createRuleDefinition(
          "y",
          createSequence([
            createIdentifier("leaf"),
            createStringLiteral("b", '"'),
          ]),
        ),
        createRuleDefinition("leaf", createStringLiteral("L", '"')),
      ],
    );
    const { reentrantRules } = analyzeReentrancy(grammar);
    expect([...reentrantRules]).toEqual(["leaf"]);
  });

  // Cut-aware suppression (`preCutOnlyTotal`, consulted by `walkChoice`).
  // A NULLABLE element must precede the cut for this to have anything to
  // suppress at all -- `walkSequence`'s existing non-nullable early-break
  // already stops before reaching a cut preceded by, e.g., a keyword
  // literal, which is why `"key"?` (not `"key"`) appears before `~`
  // below.
  it("suppresses a reentrancy finding for a rule invoked only AFTER a cut in an earlier alternative, once a later alternative also invokes it", () => {
    const grammar = parse(`
      grammar G {
        r = "key"? ~ shared / shared "other"
        shared = "x"
      }
    `);
    const { reentrantRules } = analyzeReentrancy(grammar);
    // Once `r`'s first alternative reaches the cut (guaranteed, since
    // "key"? always succeeds), the second alternative can never run --
    // so `shared`'s two textual occurrences can never both execute in
    // one parse attempt.
    expect([...reentrantRules]).toEqual([]);
  });

  it("does NOT suppress the same pairing when the cut sits in the LATER alternative instead -- ordered choice tries the earlier one first, unprotected by a cut that hasn't been reached yet", () => {
    const grammar = parse(`
      grammar G {
        r = shared "other" / "key"? ~ shared
        shared = "x"
      }
    `);
    const { reentrantRules } = analyzeReentrancy(grammar);
    // The first alternative's invocation of `shared` happens (and may
    // fail, backtracking into the second alternative) BEFORE the second
    // alternative's cut could ever fire -- a cut can only protect
    // alternatives that come AFTER it textually, never ones that were
    // already tried and failed first.
    expect([...reentrantRules]).toEqual(["shared"]);
  });

  it('is a no-op (nothing to suppress) when a non-nullable element already precedes the cut -- the common `"keyword" ~ body` shape', () => {
    const grammar = parse(`
      grammar G {
        r = "key" ~ shared / shared "other"
        shared = "x"
      }
    `);
    const { reentrantRules } = analyzeReentrancy(grammar);
    // `walkSequence`'s existing non-nullable early-break already stops
    // at "key", before ever reaching the cut or `shared` -- this finding
    // was never made in the first place, cut-awareness or not.
    expect([...reentrantRules]).toEqual([]);
  });
});
