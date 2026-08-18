/**
 * Property-based tests, via `fast-check`, of PEG invariants that must hold
 * for EVERY parser tree buildable from this package's combinators,
 * regardless of shape -- unlike `combinator-laws.spec.ts` (equivalence
 * between two specific combinator forms) or `combinator-oracle.spec.ts`
 * (differential testing against `reference-eval.ts`), these are properties
 * a single parser must satisfy on its own.
 *
 * This complements rather than replaces this package's existing hand-rolled
 * LCG-based fuzzing (`combinator-laws.spec.ts`, `combinator-oracle.spec.ts`):
 * those fuzz random PARSER TREES against a fixed, hand-picked list of input
 * strings. `fast-check` generates BOTH the tree and the input from the same
 * property, and -- its main advantage over the LCG harness -- shrinks a
 * failure to a minimal reproducing case instead of only printing a seed a
 * developer has to manually replay.
 *
 * Reproducibility matches this codebase's existing fuzzing convention: the
 * seed is pinned (fast-check defaults to `Date.now()`, which this repo's
 * "reproducible from the printed seed alone" culture cannot tolerate), and
 * `numRuns` is driven by `TPEG_FUZZ_SCALE`, exactly like the `SEEDS`
 * constant in the LCG-based specs (e.g.
 * `TPEG_FUZZ_SCALE=30 bun test src/pbt-invariants.spec.ts` for a deep audit
 * run).
 */

import { beforeEach, describe, expect, it } from "bun:test";
import fc from "fast-check";
import { anyChar, literal } from "./basic";
import { charClass, negatedCharClass } from "./char-class";
import { choice, commit, reject, sequence } from "./combinators";
import { resetFailureWatermark } from "./failure";
import { andPredicate, notPredicate } from "./lookahead";
import { oneOrMore, optional, zeroOrMore } from "./repetition";
import type { Parser } from "./types";

// See `combinator-laws.spec.ts`'s identical `beforeEach` for the full
// rationale (module-global failure watermark, keyed by input VALUE).
beforeEach(() => {
  resetFailureWatermark();
});

const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const FC_PARAMS = { seed: 20260818, numRuns: 200 * FUZZ_SCALE };

interface Node {
  readonly label: string;
  readonly parser: Parser<unknown>;
}

const node = (label: string, parser: Parser<unknown>): Node => ({
  label,
  parser,
});

// Every leaf below is guaranteed non-nullable (always consumes exactly one
// code point on success, never zero-width) -- see
// `combinator-oracle.spec.ts`'s `NONNULLABLE_LEAVES` for the identical
// rationale: `star`/`plus` below are only ever applied to a bare leaf, never
// a composite that might turn out nullable, since wrapping a nullable
// parser in `zeroOrMore`/`oneOrMore` legitimately triggers their
// infinite-loop guard (a genuine, non-fatal failure -- not a bug) rather
// than the "always succeeds" this file's `star`/`plus` property below
// relies on.
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

/** Random parser trees built from `LEAVES` and a subset of this package's
 * composition forms, deep enough to exercise nested `sequence`/`choice`/
 * `optional`/`commit` together, shallow enough (`maxDepth: 3`) to stay fast
 * across hundreds of runs. `notPredicate`/`andPredicate`/`reject` are
 * deliberately NOT recursive tree constructors here -- they're applied
 * directly in the properties that need them below, since wrapping every
 * property's outermost parser with them (rather than burying them at random
 * depth) is what actually exercises the "non-consuming on success"
 * invariant against the widest variety of inner shapes. */
const { tree } = fc.letrec<{ tree: Node; leaf: Node }>((tie) => ({
  leaf: leafArb,
  tree: fc.oneof(
    { maxDepth: 3, depthIdentifier: "tpeg-pbt-tree" },
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

const ALPHABET = ["a", "b", "c", "x", "y", "z", EMOJI];
const inputArb = fc.string({
  unit: fc.constantFrom(...ALPHABET),
  maxLength: 8,
});

describe("PEG invariants (fast-check): properties every parser tree must satisfy", () => {
  it("parsing the same input/position twice yields identical results (purity)", () => {
    fc.assert(
      fc.property(tree, inputArb, ({ parser }, input) => {
        expect(parser(input, 0)).toEqual(parser(input, 0));
      }),
      FC_PARAMS,
    );
  });

  it("on success, the position only ever moves forward, and never past the end of input", () => {
    fc.assert(
      fc.property(tree, inputArb, inputArb, ({ parser }, prefix, rest) => {
        const input = prefix + rest;
        const pos = prefix.length;
        const r = parser(input, pos);
        if (r.success) {
          expect(r.next).toBeGreaterThanOrEqual(pos);
          expect(r.next).toBeLessThanOrEqual(input.length);
        }
      }),
      FC_PARAMS,
    );
  });

  it("notPredicate/andPredicate/reject never advance the position on success (lookahead never consumes)", () => {
    fc.assert(
      fc.property(tree, inputArb, ({ parser }, input) => {
        for (const wrapped of [
          notPredicate(parser),
          andPredicate(parser),
          reject(parser),
        ]) {
          const r = wrapped(input, 0);
          if (r.success) expect(r.next).toBe(0);
        }
      }),
      FC_PARAMS,
    );
  });

  it("zeroOrMore(leaf)/oneOrMore(leaf) always succeed, for any guaranteed-non-nullable leaf", () => {
    fc.assert(
      fc.property(leafArb, inputArb, ({ parser }, input) => {
        expect(zeroOrMore(parser)(input, 0).success).toBe(true);
        // oneOrMore additionally requires at least one match -- only
        // asserted not to hit the infinite-loop guard, not to always
        // succeed outright (an input with zero leading matches is a
        // legitimate, ordinary failure).
        expect(() => oneOrMore(parser)(input, 0)).not.toThrow();
      }),
      FC_PARAMS,
    );
  });

  it("optional(e) never fails except by re-raising a fatal (cut/commit) failure from e", () => {
    fc.assert(
      fc.property(tree, inputArb, ({ parser }, input) => {
        const r = optional(parser)(input, 0);
        if (!r.success) {
          expect(r.error.fatal).toBe(true);
        }
      }),
      FC_PARAMS,
    );
  });

  it("commit(commit(e)) behaves exactly like commit(e), over generated trees and inputs (generalizes combinator-laws.spec.ts's fixed-input version)", () => {
    fc.assert(
      fc.property(tree, inputArb, ({ parser }, input) => {
        const once = commit(parser);
        const twice = commit(commit(parser));
        const r1 = once(input, 0);
        const r2 = twice(input, 0);
        expect(r1).toEqual(r2);
      }),
      FC_PARAMS,
    );
  });
});
