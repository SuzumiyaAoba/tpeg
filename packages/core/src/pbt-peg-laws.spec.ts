/**
 * Property-based (`fast-check`) tests of PEG's *semantic* operator algebra
 * -- see `packages/core/src/pbt-invariants.spec.ts`'s module doc comment for
 * the shared rationale with this repo's other `pbt-*.spec.ts` files. That
 * file covers *structural* invariants any parser tree satisfies (purity,
 * position monotonicity, lookahead non-consumption, `star`/`plus` totality
 * over a non-nullable leaf); this file covers the laws that distinguish PEG
 * from a CFG or a regex engine in the first place:
 *
 * - Ordered choice's deterministic, non-backtracking-into-a-winner
 *   semantics (`choice(a,b)`'s result literally IS whichever of `a`/`b`
 *   produced it).
 * - Possessive repetition: once `e*`/`e+` stops, the grammar can never
 *   backtrack into giving up one of its matches to let something after it
 *   succeed -- the actual PEG-vs-regex discriminator (a regex engine's `*`
 *   backtracks; PEG's does not).
 * - Associativity of `sequence`/`choice` (with `choice`'s cut/commit
 *   exception spelled out explicitly, not silently avoided).
 * - The `&`/`!` predicate algebra (`!!e ≡ &e`, `&e e ≡ e` positionally,
 *   `!e`/`e` mutual exclusion).
 * - Locality: a parser's behavior at offset `k` into `input` depends only on
 *   `input.slice(k)`, never on anything before `k`.
 *
 * ## Comparing outcomes across differently-shaped calls
 *
 * Every property below compares two `ParseResult`s that come from
 * DIFFERENT combinator expressions (unlike `combinator-laws.spec.ts`'s
 * `commit(commit(e))` vs. `commit(e)`, which are close enough to share
 * `toEqual`-able error objects) -- e.g. `choice(a,b)`'s result against `a`'s
 * own, computed independently. Their `error` objects can differ in
 * incidental ways (which `Expectation` a wrapper happened to forward into
 * the shared watermark) even when the outcome is semantically identical, so
 * `sameOutcome` below deliberately compares only `success`, `next`, `val`
 * (on success), and `error.fatal` (on failure) -- never the full `error`
 * object or its message/expected list.
 */

import { beforeEach, describe, expect, it } from "vite-plus/test";
import fc from "fast-check";
import { anyChar, literal } from "./basic";
import { charClass, negatedCharClass } from "./char-class";
import { choice, commit, sequence } from "./combinators";
import { isFatalFailure, resetFailureWatermark } from "./failure";
import { andPredicate, notPredicate } from "./lookahead";
import { oneOrMore, optional, zeroOrMore } from "./repetition";
import type { ParseResult, Parser } from "./types";

beforeEach(() => {
  resetFailureWatermark();
});

const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const FC_PARAMS = { seed: 20260908, numRuns: 200 * FUZZ_SCALE };

/** Compares two `ParseResult`s for semantic equivalence -- see the module
 * doc comment's "Comparing outcomes across differently-shaped calls" for
 * why this is narrower than `toEqual`. */
const expectSameOutcome = (
  a: ParseResult<unknown>,
  b: ParseResult<unknown>,
): void => {
  expect(a.success).toBe(b.success);
  if (a.success && b.success) {
    expect(a.next).toBe(b.next);
    expect(a.val).toEqual(b.val);
  } else if (!a.success && !b.success) {
    // `.error.fatal` is only ever SET when `true` (see `failure.ts`'s
    // `materializeParseError`) -- `undefined` and `false` both mean
    // "not fatal", so a raw `.fatal` comparison would spuriously fail
    // whenever one side is the `undefined` form and the other the
    // explicit `false` form. `isFatalFailure` is the canonical predicate
    // that already normalizes this (and handles the `FAIL`/`FAIL_FATAL`
    // singletons without touching `.error` at all).
    expect(isFatalFailure(a)).toBe(isFatalFailure(b));
  }
};

/** Like `expectSameOutcome`, but for two expressions that are expected to
 * nest their VALUE differently on success (e.g. `sequence`
 * re-associated) -- compares only success, final position, and fatality. */
const expectSamePositionAndFatality = (
  a: ParseResult<unknown>,
  b: ParseResult<unknown>,
): void => {
  expect(a.success).toBe(b.success);
  if (a.success && b.success) {
    expect(a.next).toBe(b.next);
  } else if (!a.success && !b.success) {
    expect(isFatalFailure(a)).toBe(isFatalFailure(b));
  }
};

interface Node {
  readonly label: string;
  readonly parser: Parser<unknown>;
}

const node = (label: string, parser: Parser<unknown>): Node => ({
  label,
  parser,
});

// Guaranteed non-nullable (always consumes exactly one code point on
// success) -- identical rationale to `pbt-invariants.spec.ts`'s `LEAVES`.
const EMOJI = String.fromCodePoint(0x1f600);
const LEAVES: readonly Node[] = [
  node("lit:a", literal("a")),
  node("lit:b", literal("b")),
  node("lit:ab", literal("ab")),
  node("cls:ab", charClass("a", "b")),
  node("cls:!a", negatedCharClass("a")),
  node("any", anyChar()),
  node("lit:emoji", literal(EMOJI)),
];
const leafArb = fc.constantFrom(...LEAVES);

/** Full tree, including `commit` -- fine for any property that doesn't
 * itself REGROUP a `choice`/`sequence` around the generated subtrees (see
 * the "no-cut" tree below for the one law where regrouping a `commit`-
 * bearing `choice` changes cut scope, and is therefore deliberately
 * excluded rather than silently avoided). */
const { tree } = fc.letrec<{ tree: Node; leaf: Node }>((tie) => ({
  leaf: leafArb,
  tree: fc.oneof(
    { maxDepth: 3, depthIdentifier: "tpeg-pbt-peg-laws-tree" },
    tie("leaf"),
    fc
      .tuple(tie("tree"), tie("tree"))
      .map(([a, b]) =>
        node(`seq(${a.label},${b.label})`, sequence(a.parser, b.parser)),
      ),
    fc
      .tuple(tie("tree"), tie("tree"))
      .map(([a, b]) =>
        node(`choice(${a.label},${b.label})`, choice(a.parser, b.parser)),
      ),
    tie("leaf").map((l) => node(`star(${l.label})`, zeroOrMore(l.parser))),
    tie("leaf").map((l) => node(`plus(${l.label})`, oneOrMore(l.parser))),
    tie("tree").map((t) => node(`opt(${t.label})`, optional(t.parser))),
    tie("tree").map((t) => node(`commit(${t.label})`, commit(t.parser))),
  ),
}));

/** Same shape as `tree`, minus `commit` -- see `commit`'s own doc comment
 * (`combinators.ts`): a cut is scoped to its OWN immediately-enclosing
 * `choice`, not forwarded further out. Re-associating nested `choice`s
 * moves that boundary, so `choice(choice(a,b),c)` and
 * `choice(a,choice(b,c))` are deliberately, DOCUMENTED-ly non-associative
 * whenever `a`/`b` can fail fatally -- asserting associativity over trees
 * that include `commit` would be asserting a law this codebase explicitly
 * does not hold, not exercising a gap in it. `sequence`'s associativity
 * property below uses the full `tree` (including `commit`) instead, since
 * `sequence` never absorbs or rescopes a fatal failure -- it only relays a
 * child's failure unchanged, so regrouping it changes nothing. */
const { tree: noCutTree } = fc.letrec<{ tree: Node; leaf: Node }>((tie) => ({
  leaf: leafArb,
  tree: fc.oneof(
    { maxDepth: 3, depthIdentifier: "tpeg-pbt-peg-laws-nocut-tree" },
    tie("leaf"),
    fc
      .tuple(tie("tree"), tie("tree"))
      .map(([a, b]) =>
        node(`seq(${a.label},${b.label})`, sequence(a.parser, b.parser)),
      ),
    fc
      .tuple(tie("tree"), tie("tree"))
      .map(([a, b]) =>
        node(`choice(${a.label},${b.label})`, choice(a.parser, b.parser)),
      ),
    tie("leaf").map((l) => node(`star(${l.label})`, zeroOrMore(l.parser))),
    tie("leaf").map((l) => node(`plus(${l.label})`, oneOrMore(l.parser))),
    tie("tree").map((t) => node(`opt(${t.label})`, optional(t.parser))),
  ),
}));

const ALPHABET = ["a", "b", "c", "x", "y", "z", EMOJI];
const inputArb = fc.string({
  unit: fc.constantFrom(...ALPHABET),
  maxLength: 8,
});

describe("PEG algebra (fast-check): ordered choice", () => {
  it("choice(a,b): if a succeeds, the result IS a's own result; if a fails non-fatally, choice(a,b) behaves exactly like choice(b) alone (a's own failure never affects how b's outcome -- including b's own fatal-absorption boundary -- is handled)", () => {
    fc.assert(
      fc.property(
        tree,
        tree,
        inputArb,
        ({ parser: a }, { parser: b }, input) => {
          const ra = a(input, 0);
          const rc = choice(a, b)(input, 0);
          if (ra.success) {
            expectSameOutcome(rc, ra);
          } else if (!isFatalFailure(ra)) {
            // Deliberately NOT compared against `b(input, 0)` directly: if
            // `b` itself fails fatally, `choice(a,b)` absorbs that at ITS
            // OWN boundary (same as `choice(b)` alone would) and surfaces
            // it as ordinary -- comparing against `b`'s raw (still-fatal)
            // result would spuriously fail on exactly that case. Reaching
            // `b` after `a`'s non-fatal failure runs the identical
            // candidate-handling code `choice(b)` alone would for `b`
            // (`tryOrderedCandidates` treats every candidate index the
            // same way), so this is the correct like-for-like comparison.
            expectSameOutcome(rc, choice(b)(input, 0));
          } else {
            // A fatal failure from `a` is absorbed at THIS choice's own
            // boundary (see `tryOrderedCandidates`'s doc comment): `b` is
            // never tried, and the failure surfaces as ordinary (non-fatal)
            // here, since the absorption happens at this exact call.
            expect(rc.success).toBe(false);
            if (!rc.success) expect(isFatalFailure(rc)).toBe(false);
          }
        },
      ),
      FC_PARAMS,
    );
  });
});

describe("PEG algebra (fast-check): possessive repetition (the PEG-vs-regex discriminator)", () => {
  it("sequence(zeroOrMore(e), e) never succeeds, for non-nullable e -- Star never backtracks into giving up one of its own matches", () => {
    fc.assert(
      fc.property(leafArb, inputArb, ({ parser: e }, input) => {
        expect(sequence(zeroOrMore(e), e)(input, 0).success).toBe(false);
      }),
      FC_PARAMS,
    );
  });

  it("sequence(oneOrMore(e), e) never succeeds, for non-nullable e -- same possessiveness for Plus", () => {
    fc.assert(
      fc.property(leafArb, inputArb, ({ parser: e }, input) => {
        expect(sequence(oneOrMore(e), e)(input, 0).success).toBe(false);
      }),
      FC_PARAMS,
    );
  });
});

describe("PEG algebra (fast-check): associativity", () => {
  it("sequence is associative in success/position (values nest differently, so only success/position/fatality are compared) -- holds even across a commit, since sequence never absorbs or rescopes a fatal failure", () => {
    fc.assert(
      fc.property(
        tree,
        tree,
        tree,
        inputArb,
        ({ parser: a }, { parser: b }, { parser: c }, input) => {
          const left = sequence(sequence(a, b), c)(input, 0);
          const right = sequence(a, sequence(b, c))(input, 0);
          expectSamePositionAndFatality(left, right);
        },
      ),
      FC_PARAMS,
    );
  });

  it("choice is associative in success/position/value, for cut-free alternatives -- see noCutTree's doc comment for why commit is deliberately excluded here rather than silently avoided", () => {
    fc.assert(
      fc.property(
        noCutTree,
        noCutTree,
        noCutTree,
        inputArb,
        ({ parser: a }, { parser: b }, { parser: c }, input) => {
          const left = choice(choice(a, b), c)(input, 0);
          const right = choice(a, choice(b, c))(input, 0);
          expectSameOutcome(left, right);
        },
      ),
      FC_PARAMS,
    );
  });
});

describe("PEG algebra (fast-check): predicate algebra", () => {
  it("!!e (notPredicate(notPredicate(e))) is observationally identical to &e (andPredicate(e))", () => {
    fc.assert(
      fc.property(tree, inputArb, ({ parser: e }, input) => {
        const doubleNot = notPredicate(notPredicate(e))(input, 0);
        const and = andPredicate(e)(input, 0);
        expectSameOutcome(doubleNot, and);
      }),
      FC_PARAMS,
    );
  });

  it("sequence(andPredicate(e), e) agrees with e on success and final position (the leading &e never advances, and never changes whether/where e itself succeeds)", () => {
    fc.assert(
      fc.property(tree, inputArb, ({ parser: e }, input) => {
        const withLookahead = sequence(andPredicate(e), e)(input, 0);
        const plain = e(input, 0);
        expect(withLookahead.success).toBe(plain.success);
        if (withLookahead.success && plain.success) {
          expect(withLookahead.next).toBe(plain.next);
        }
      }),
      FC_PARAMS,
    );
  });

  it("notPredicate(e) and e never both succeed at the same position", () => {
    fc.assert(
      fc.property(tree, inputArb, ({ parser: e }, input) => {
        const notResult = notPredicate(e)(input, 0);
        const plain = e(input, 0);
        expect(notResult.success && plain.success).toBe(false);
      }),
      FC_PARAMS,
    );
  });
});

describe("PEG algebra (fast-check): locality (no parser looks behind its own starting position)", () => {
  it("p(input, k) and p(input.slice(k), 0) agree on success, val, and consumed length", () => {
    fc.assert(
      fc.property(tree, inputArb, inputArb, ({ parser }, prefix, rest) => {
        const input = prefix + rest;
        const k = prefix.length;
        const shifted = parser(input, k);
        const fresh = parser(rest, 0);
        expect(shifted.success).toBe(fresh.success);
        if (shifted.success && fresh.success) {
          expect(shifted.next - k).toBe(fresh.next);
          expect(shifted.val).toEqual(fresh.val);
        } else if (!shifted.success && !fresh.success) {
          expect(shifted.error.fatal).toBe(fresh.error.fatal);
        }
      }),
      FC_PARAMS,
    );
  });
});
