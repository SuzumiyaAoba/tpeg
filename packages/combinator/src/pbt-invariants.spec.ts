/**
 * Property-based (`fast-check`) generalization of this package's own
 * `combinator-laws.spec.ts` -- see `packages/core/src/pbt-invariants.spec.ts`'s
 * module doc comment for the full rationale shared with that file. The laws
 * checked here are the SAME ones `combinator-laws.spec.ts` already checks
 * with its hand-rolled LCG PRNG (`memoize(e) ≡ e`, `takeUntil` vs. its
 * `zeroOrMore(seq(!cond, anyChar()))` unrolling, `sepBy1` vs. its `seq` +
 * `zeroOrMore` unrolling) -- this file adds exactly what that harness
 * cannot: a GENERATED input alphabet instead of a fixed 20-string list, and
 * shrinking to a minimal counterexample instead of only a replayable seed.
 * Deliberately not a replacement -- both files stay.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { NonEmptyArray, Parser } from "@suzumiyaaoba/tpeg-core";
import {
  anyChar,
  charClass,
  choice,
  commit,
  literal,
  map,
  negatedCharClass,
  notPredicate,
  optional,
  resetFailureWatermark,
  sequence,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import fc from "fast-check";
import { sepBy1 } from "./list";
import { memoize } from "./logic";
import { takeUntil } from "./string";

// `memoize` (`./logic.ts`) explicitly reads/writes the shared
// farthest-failure watermark on every cache hit (`mergeFailureWatermark`)
// -- see `packages/core/src/combinator-laws.spec.ts`'s identical
// `beforeEach` for the full cross-test-isolation rationale. Redundant with
// the global `bunfig.toml` preload (`test/reset-failure-watermark.ts`) in
// practice, but kept explicit here since this file is the most
// watermark-sensitive of the three `pbt-invariants.spec.ts` files.
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

// Guaranteed non-nullable (always consumes exactly one code point on
// success) -- see `packages/core/src/pbt-invariants.spec.ts`'s identical
// `LEAVES` doc comment for why `star`/`plus` below only ever wrap a bare
// leaf.
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

/** A richer parser tree than `leafArb` alone -- fine for `memoize`/
 * `takeUntil` below (neither cares about nullability, unlike `sepBy`/
 * `sepBy1`; see `list.ts`'s `sepBy` doc comment and
 * `combinator-laws.spec.ts`'s identical restriction), so this one is
 * allowed to nest `opt`/`commit` freely. */
const { tree } = fc.letrec<{ tree: Node; leaf: Node }>((tie) => ({
  leaf: leafArb,
  tree: fc.oneof(
    { maxDepth: 3, depthIdentifier: "tpeg-combinator-pbt-tree" },
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
    tie("tree").map((t) => node(`opt(${t.label})`, optional(t.parser))),
    tie("tree").map((t) => node(`commit(${t.label})`, commit(t.parser))),
  ),
}));

const ALPHABET = ["a", "b", "c", "x", "y", "z", EMOJI];
const inputArb = fc.string({
  unit: fc.constantFrom(...ALPHABET),
  maxLength: 8,
});

describe("PEG laws (fast-check): tpeg-combinator's own combinators, generalized from combinator-laws.spec.ts", () => {
  it("memoize(e) is observationally identical to e, on first AND repeated (cache-hit) calls", () => {
    fc.assert(
      fc.property(tree, inputArb, ({ parser }, input) => {
        const memoized = memoize(parser);
        const expected = parser(input, 0);
        // Called twice on purpose: the second call is a cache HIT, which
        // must still agree with the plain parser -- not just the first
        // (miss) call.
        expect(memoized(input, 0)).toEqual(expected);
        expect(memoized(input, 0)).toEqual(expected);
      }),
      FC_PARAMS,
    );
  });

  it("takeUntil(cond) === the joined text of zeroOrMore(seq(!cond, anyChar()))", () => {
    fc.assert(
      fc.property(tree, inputArb, ({ parser: cond }, input) => {
        const tu = takeUntil(cond);
        const reference = map(
          zeroOrMore(sequence(notPredicate(cond), anyChar())),
          (pairs) =>
            (pairs as [undefined, string][]).map(([, ch]) => ch).join(""),
        );
        expect(tu(input, 0)).toEqual(reference(input, 0));
      }),
      FC_PARAMS,
    );
  });

  it("sepBy1(value, sep) === map(seq(value, zeroOrMore(seq(sep, value))), ...), for non-nullable value/sep", () => {
    fc.assert(
      fc.property(
        leafArb,
        leafArb,
        inputArb,
        ({ parser: value }, { parser: sep }, input) => {
          const a = sepBy1(value, sep);
          const reference = map(
            sequence(
              value,
              zeroOrMore(map(sequence(sep, value), ([, v]) => v)),
            ),
            (parts) => {
              const [head, tail] = parts as [unknown, unknown[]];
              return [head, ...tail] as NonEmptyArray<unknown>;
            },
          );
          expect(a(input, 0)).toEqual(reference(input, 0));
        },
      ),
      FC_PARAMS,
    );
  });
});
