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
// this plan's Phase 1 measurements were made against.
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
  // grammars.ts`, empirically measured while designing this analysis
  // (see the plan's Phase 1 section) -- this spec is the acceptance test
  // for the algorithm the plan promised, not just illustrative examples.

  it("flags every non-root rule of an acyclic unfactored chain (BENCH_ACYCLIC_CHAIN_GRAMMAR)", () => {
    // 10 levels of unfactored 3-way choice, none of them recursive --
    // the case the old hasRecursion/complexity heuristic memoized NONE
    // of (see bench/grammars.ts's docstring) despite it being
    // exponential (3^9 redundant reparses of a9 for a single call to
    // a0). a1..a9 are each reachable from more than one alternative of
    // their caller's Choice; a0 itself is the entry point, never
    // re-invoked within a single parse, so it's correctly excluded.
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

  it("flags product/atom/number (not sum) for the unfactored arithmetic grammar", () => {
    // sum = product "+" sum / product "-" sum / product
    // product = atom "*" product / atom "/" product / atom
    // atom = "(" sum ")" / number
    // `product` is shared by all 3 alternatives of `sum`'s choice --
    // reentrant. `atom` is shared by all 3 alternatives of `product`'s
    // choice -- reentrant. `number` is only reachable through `atom`
    // (transitively), so it also shows up: this analysis deliberately
    // does not try to prove `number`'s redundancy is fully absorbed by
    // memoizing `atom` alone (see reentrancy.ts's module doc comment --
    // over-inclusion here is a safe, minor cost, not a soundness bug).
    // `sum` itself is the entry point (never re-invoked in this
    // grammar), so it's excluded.
    const grammar = parse(UNFACTORED_ARITHMETIC_GRAMMAR);
    const { reentrantRules } = analyzeReentrancy(grammar);
    expect([...reentrantRules].sort()).toEqual(["atom", "number", "product"]);
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
});
