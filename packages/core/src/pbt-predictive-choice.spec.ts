/**
 * Property-based (`fast-check`) differential test: `predictiveChoice` must
 * be observationally indistinguishable from plain `choice` over the same
 * alternatives, for any input -- see
 * `packages/core/src/pbt-invariants.spec.ts`'s module doc comment for the
 * shared rationale with this repo's other `pbt-*.spec.ts` files.
 *
 * `predictiveChoice` (`combinators.ts`) is a pure performance optimization:
 * a FIRST-set-gated dispatch table (falling back to a per-alternative
 * literal-prefix trie, `dispatch-trie.ts`, for alternatives sharing a
 * longer common prefix) that skips running an alternative it can PROVE
 * can't match at the current position, then hands the survivors to the
 * exact same `tryOrderedCandidates` ordered-choice loop `choice` itself
 * uses. Its own doc comment states the soundness goal directly: "ordered-
 * choice semantics are fully preserved... in their original relative
 * order." This is a differential test of exactly that claim, deliberately
 * NOT a hand-written oracle re-implementing dispatch-table lookup (the
 * pattern `reference-interpreter.ts`'s doc comment rejects for the same
 * reason) -- `choice` itself, unfiltered, IS the oracle.
 *
 * ## Building alternatives that respect predictiveChoice's caller contracts
 *
 * `predictiveChoice`'s own doc comment spells out two contracts a caller
 * must uphold, which this file's `null`/precise split enforces by
 * construction rather than testing around:
 *
 * - A non-`null` filter asserts "skippable when excluded" -- unsound for
 *   any alternative that could reach a `Cut` without having consumed input
 *   (it can fail *fatally* regardless of the actual character, aborting the
 *   whole choice rather than falling through). `OPAQUE_ALTS` below (which
 *   includes `commit`/`optional`-wrapping compositions) always gets `null`;
 *   only a bare, cut-free `literal(...)` (`LITERAL_ALTS`) gets a precise
 *   filter.
 * - A non-`null` `literalPrefix` requires `filter` to match EXACTLY that
 *   prefix's first character -- `LITERAL_ALTS` below always derives both
 *   from the same source string, so they agree by construction.
 *
 * Several `LITERAL_ALTS` deliberately share a first character (`"if"`/
 * `"import"`/`"in"`) to exercise `buildDispatchTrie`'s beyond-FIRST_1
 * discrimination as part of the same differential check, rather than in a
 * separate hand-written oracle.
 */

import { beforeEach, describe, expect, it } from "vite-plus/test";
import fc from "fast-check";
import { anyChar, literal } from "./basic";
import { charClass, negatedCharClass } from "./char-class";
import {
  choice,
  commit,
  type FirstCharFilter,
  predictiveChoice,
} from "./combinators";
import { isFatalFailure, resetFailureWatermark } from "./failure";
import { optional } from "./repetition";
import type { ParseResult, Parser } from "./types";

beforeEach(() => {
  resetFailureWatermark();
});

const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const FC_PARAMS = { seed: 20260908, numRuns: 200 * FUZZ_SCALE };

const expectSameOutcome = (
  a: ParseResult<unknown>,
  b: ParseResult<unknown>,
): void => {
  expect(a.success).toBe(b.success);
  if (a.success && b.success) {
    expect(a.next).toBe(b.next);
    expect(a.val).toEqual(b.val);
  } else if (!a.success && !b.success) {
    expect(isFatalFailure(a)).toBe(isFatalFailure(b));
  }
};

interface Alt {
  readonly label: string;
  readonly parser: Parser<unknown>;
  readonly filter: FirstCharFilter | null;
  readonly literalPrefix: string | null;
}

const exactFilter = (firstCodePoint: number): FirstCharFilter => ({
  ranges: [{ lo: firstCodePoint, hi: firstCodePoint }],
});

// Deliberately overlapping first characters ("i") across several entries,
// so `predictiveChoice`'s ASCII bucket for `'i'` ends up with >= 2
// literal-prefixed alternatives -- exactly what triggers
// `buildDispatchTrie` (see `combinators.ts`'s "Past FIRST_1" doc comment).
const LITERAL_STRINGS = ["a", "b", "ab", "ac", "if", "import", "in", "x"];
const LITERAL_ALTS: readonly Alt[] = LITERAL_STRINGS.map((s) => ({
  label: `lit:${s}`,
  parser: literal(s),
  filter: exactFilter(s.codePointAt(0) as number),
  literalPrefix: s.length >= 2 ? s : null,
}));

const EMOJI = String.fromCodePoint(0x1f600);
// Every entry here either has an unbounded/complex FIRST set (a negated
// class, `anyChar`) or can reach a `Cut` without consuming input
// (`optional(commit(...))`) -- both are cases `predictiveChoice`'s doc
// comment requires a `null` filter for, so these are never given one.
const OPAQUE_ALTS: readonly Alt[] = [
  {
    label: "cls:ab",
    parser: charClass("a", "b"),
    filter: null,
    literalPrefix: null,
  },
  {
    label: "cls:!a",
    parser: negatedCharClass("a"),
    filter: null,
    literalPrefix: null,
  },
  { label: "any", parser: anyChar(), filter: null, literalPrefix: null },
  {
    label: "lit:emoji",
    parser: literal(EMOJI),
    filter: null,
    literalPrefix: null,
  },
  {
    label: "opt(commit(lit:a))",
    parser: optional(commit(literal("a"))),
    filter: null,
    literalPrefix: null,
  },
];

const altArb: fc.Arbitrary<Alt> = fc.oneof(
  ...LITERAL_ALTS.map((a) => fc.constant(a)),
  ...OPAQUE_ALTS.map((a) => fc.constant(a)),
);

// 1 to 6 alternatives, allowing duplicates (a real grammar can have two
// alternatives that happen to overlap in FIRST set, e.g. `"if"` and a
// catch-all `identifier`) -- ordered-choice's "first match wins" is
// exactly what this file checks predictiveChoice preserves under that
// condition.
const alternativesArb: fc.Arbitrary<readonly Alt[]> = fc.array(altArb, {
  minLength: 1,
  maxLength: 6,
});

// Includes every `LITERAL_ALTS` first character, a character matching NO
// alternative's filter at all ("q", to exercise predictiveChoice's
// immediate "no candidates survive" failure path), and the astral emoji
// (to exercise the non-ASCII fallback path).
const ALPHABET = ["a", "b", "c", "i", "m", "n", "q", "x", EMOJI];
const inputArb = fc.string({
  unit: fc.constantFrom(...ALPHABET),
  maxLength: 8,
});

describe("PEG optimization (fast-check): predictiveChoice is observationally identical to choice", () => {
  it("predictiveChoice(alts) === choice(...alts) for any input, across ASCII-table dispatch, the literal-prefix trie, the non-ASCII fallback, and null-filter opaque alternatives together", () => {
    fc.assert(
      fc.property(alternativesArb, inputArb, (alts, input) => {
        const plain = choice(...alts.map((a) => a.parser))(input, 0);
        const predictive = predictiveChoice(
          alts.map((a) => [a.parser, a.filter, a.literalPrefix] as const),
        )(input, 0);
        expectSameOutcome(predictive, plain);
      }),
      FC_PARAMS,
    );
  });
});
