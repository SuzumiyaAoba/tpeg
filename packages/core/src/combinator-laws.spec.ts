/**
 * Algebraic-equivalence fuzzing for the hand-written combinator layer.
 *
 * `codegen-differential.spec.ts` (`packages/parser`) fuzzes the CODE
 * GENERATION pipeline against an independent reference interpreter, but
 * every one of its variants is GENERATED code -- always plain
 * `choice`/`sequence`/`zeroOrMore`/etc., never `memoize`,
 * `predictiveChoice` with a hand-supplied filter, `charClassRun`,
 * `captureChoice`/`captureSequence`, `withDefault`, or `reject` directly.
 * Those hand-written combinators (this package's actual public API, used
 * directly by anyone building a parser without going through the TPEG
 * grammar/codegen pipeline at all -- `packages/samples`, for instance) had
 * NO fuzzing coverage of their own before this file.
 *
 * Each block below checks one algebraic law: two independently-built
 * parser trees that a caller is entitled to assume behave IDENTICALLY,
 * exercised against the same random grammar/input pairs via the same
 * deterministic LCG PRNG `codegen-differential.spec.ts` uses (not
 * `Math.random()`, so any future failure is reproducible from the printed
 * seed alone).
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { anyChar, literal } from "./basic";
import { captureChoice, captureSequence } from "./capture";
import { charClass, charClassRun, negatedCharClass } from "./char-class";
import {
  type FirstCharFilter,
  choice,
  commit,
  predictiveChoice,
  reject,
  sequence,
  withDefault,
} from "./combinators";
import { resetFailureWatermark } from "./failure";
import { notPredicate } from "./lookahead";
import { oneOrMore, optional, zeroOrMore } from "./repetition";
import { map } from "./transform";
import type { Parser } from "./types";

// The farthest-failure watermark (`./failure.ts`) is module-global state
// keyed by the input string's VALUE -- see `combinators.spec.ts`'s
// identical `beforeEach` for the full rationale. Not load-bearing for
// what these tests actually assert (recognition/value equality, never
// error diagnostics), but kept for hygiene, so a failure here can never
// be blamed on cross-test watermark pollution.
beforeEach(() => {
  resetFailureWatermark();
});

// --- Deterministic PRNG (same LCG as codegen-differential.spec.ts) ------

const makeRng = (seed: number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
};

const pick = <T>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)] as T;

const EMOJI = String.fromCodePoint(0x1f600); // outside the BMP -- a surrogate pair

const LEAVES: readonly (() => Parser<unknown>)[] = [
  () => literal("a"),
  () => literal("b"),
  () => literal("ab"),
  () => charClass("a", "b"),
  () => negatedCharClass("a"),
  () => anyChar(),
  () => literal(EMOJI),
  () => charClass(["a", "c"]),
];

/** One random parser tree, built from `LEAVES` and every composition form
 * this package exports -- deep enough to nest a few operators, shallow
 * enough that this stays fast across hundreds of seeds. */
const genParser = (rng: () => number, depth: number): Parser<unknown> => {
  if (depth <= 0) return pick(rng, LEAVES)();
  const next = () => genParser(rng, depth - 1);
  switch (Math.floor(rng() * 11)) {
    case 0:
      return pick(rng, LEAVES)();
    case 1:
      return sequence(next(), next());
    case 2:
      return choice(next(), next());
    case 3:
      return zeroOrMore(pick(rng, LEAVES)());
    case 4:
      return oneOrMore(pick(rng, LEAVES)());
    case 5:
      return optional(next());
    case 6:
      return sequence(notPredicate(next()), next());
    case 7:
      return sequence(next(), commit(next()));
    case 8:
      return choice(next(), next(), next());
    case 9:
      return sequence(next(), next(), next());
    default:
      return sequence(next(), next());
  }
};

const INPUTS = [
  "",
  "a",
  "b",
  "ab",
  "ba",
  "aa",
  "abb",
  "aab",
  "abab",
  "c",
  "ac",
  "abc",
  EMOJI,
  `a${EMOJI}`,
  "aaa",
  "bbb",
  "abba",
  "cab",
  "aabb",
];

type Key = string;

/** Collapses a `ParseResult` to a comparable key: success carries both
 * position and VALUE (`JSON.stringify`d), a thrown infinite-loop guard
 * collapses to a single `"T"` marker (both sides of every law below are
 * built from the same leaves at the same depth, so an infinite-loop guard
 * firing on one side and not the other would itself be a law violation --
 * this just avoids the comparison itself throwing). */
const key = (parser: Parser<unknown>, input: string): Key => {
  try {
    const r = parser(input, 0);
    return r.success ? `S:${r.next}:${JSON.stringify(r.val)}` : "F";
  } catch {
    return "T";
  }
};
const keyRecognitionOnly = (parser: Parser<unknown>, input: string): Key => {
  try {
    const r = parser(input, 0);
    return r.success ? `S:${r.next}` : "F";
  } catch {
    return "T";
  }
};

const SEEDS = 400;

describe("combinator laws: memoize-free core parsers vs. their reference shape", () => {
  it("charClassRun(specs, 0) === zeroOrMore(charClass(...specs)) (recognition + value)", () => {
    const specs: (readonly [Parameters<typeof charClass>, boolean])[] = [
      [["a"], false],
      [["a", "b"], false],
      [[["a", "c"]], false],
      [[["a", "z"], "0"], false],
      [[EMOJI], false],
      [[["a", "b"], "c"], false],
      [["a"], true],
      [[["a", "c"]], true],
    ];
    for (const [spec, negated] of specs) {
      for (const min of [0, 1] as const) {
        const run = charClassRun(spec, min, negated);
        const base = negated ? negatedCharClass(...spec) : charClass(...spec);
        const reference = min === 0 ? zeroOrMore(base) : oneOrMore(base);
        for (const input of [...INPUTS, `${EMOJI}${EMOJI}`, `a${EMOJI}b`]) {
          expect(key(run, input)).toBe(key(reference, input));
        }
      }
    }
  });

  it("predictiveChoice with every filter null === choice, in the same relative order", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rngLeft = makeRng(seed);
      const rngRight = makeRng(seed);
      // Two independently-generated trees from the SAME seed produce
      // structurally identical (not merely equivalent) parsers, so any
      // divergence below can only come from predictiveChoice's own
      // dispatch logic, never from the two sides drawing different leaves.
      const predictive = predictiveChoice([
        [genParser(rngLeft, 2), null],
        [genParser(rngLeft, 2), null],
        [genParser(rngLeft, 2), null],
      ]);
      const plain = choice(
        genParser(rngRight, 2),
        genParser(rngRight, 2),
        genParser(rngRight, 2),
      );
      for (const input of INPUTS) {
        expect(key(predictive, input)).toBe(key(plain, input));
      }
    }
  });

  it("predictiveChoice with a REAL (non-null) filter per alternative === choice, in the same relative order", () => {
    // Complements the all-null-filter law above: `combinator-oracle.spec.ts`
    // already fuzzes `predictiveChoice` with filters derived from
    // arbitrary composite trees, so this stays intentionally simpler --
    // one exactly-correct filter per LEAF (not a composite), covering the
    // hot path (dispatch-table construction actually narrowing candidates
    // by ASCII code, plus the non-ASCII fallback for the emoji leaf) at
    // proportionate effort.
    const leafFilters: readonly [Parser<unknown>, FirstCharFilter | null][] = [
      [literal("a"), { ranges: [{ lo: 0x61, hi: 0x61 }] }],
      [literal("b"), { ranges: [{ lo: 0x62, hi: 0x62 }] }],
      [literal("ab"), { ranges: [{ lo: 0x61, hi: 0x61 }] }],
      [
        charClass("a", "b"),
        {
          ranges: [
            { lo: 0x61, hi: 0x61 },
            { lo: 0x62, hi: 0x62 },
          ],
        },
      ],
      [negatedCharClass("a"), null],
      [anyChar(), null],
      [
        literal(EMOJI),
        {
          ranges: [
            {
              lo: EMOJI.codePointAt(0) as number,
              hi: EMOJI.codePointAt(0) as number,
            },
          ],
        },
      ],
      [charClass(["a", "c"]), { ranges: [{ lo: 0x61, hi: 0x63 }] }],
    ];

    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = makeRng(seed);
      const chosen = [
        pick(rng, leafFilters),
        pick(rng, leafFilters),
        pick(rng, leafFilters),
      ];
      const predictive = predictiveChoice(
        chosen.map(([p, f]) => [p, f] as const),
      );
      const plain = choice(...chosen.map(([p]) => p));
      for (const input of INPUTS) {
        expect(key(predictive, input)).toBe(key(plain, input));
      }
    }
  });

  it("captureChoice === choice, captureSequence === sequence (recognition only -- value shape legitimately differs)", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rngA = makeRng(seed);
      const rngB = makeRng(seed);
      const a1 = genParser(rngA, 2);
      const b1 = genParser(rngA, 2);
      const a2 = genParser(rngB, 2);
      const b2 = genParser(rngB, 2);
      const capChoice = captureChoice(a1, b1);
      const plainChoice = choice(a2, b2);
      const capSeq = captureSequence(a1, b1);
      const plainSeq = sequence(a2, b2);
      for (const input of INPUTS) {
        expect(keyRecognitionOnly(capChoice, input)).toBe(
          keyRecognitionOnly(plainChoice, input),
        );
        expect(keyRecognitionOnly(capSeq, input)).toBe(
          keyRecognitionOnly(plainSeq, input),
        );
      }
    }
  });

  it("withDefault(e, d) === map(optional(e), ([v]) => v ?? d) (recognition + value)", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rngA = makeRng(seed);
      const rngB = makeRng(seed);
      const e1 = genParser(rngA, 2);
      const e2 = genParser(rngB, 2);
      const wd = withDefault<unknown>(e1, null);
      const reference = map(optional(e2), (xs) =>
        xs.length > 0 ? xs[0] : null,
      );
      for (const input of INPUTS) {
        expect(key(wd, input)).toBe(key(reference, input));
      }
    }
  });

  it("reject(e) === map(notPredicate(e), () => null) (recognition -- both are non-consuming)", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rngA = makeRng(seed);
      const rngB = makeRng(seed);
      const e1 = genParser(rngA, 2);
      const e2 = genParser(rngB, 2);
      const rj = reject(e1);
      const reference = map(notPredicate(e2), () => null);
      for (const input of INPUTS) {
        expect(keyRecognitionOnly(rj, input)).toBe(
          keyRecognitionOnly(reference, input),
        );
        // Both are lookahead-shaped: neither may advance the position on
        // success.
        const r = rj(input, 0);
        if (r.success) expect(r.next).toBe(0);
      }
    }
  });
});

describe("combinator laws: commit/cut", () => {
  it("commit is idempotent: commit(commit(e)) behaves exactly like commit(e)", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rngA = makeRng(seed);
      const rngB = makeRng(seed);
      const e1 = genParser(rngA, 2);
      const e2 = genParser(rngB, 2);
      const once = commit(e1);
      const twice = commit(commit(e2));
      for (const input of INPUTS) {
        const r1 = once(input, 0);
        const r2 = twice(input, 0);
        expect(key(once, input)).toBe(key(twice, input));
        if (!r1.success && !r2.success) {
          expect(r1.error.fatal ?? false).toBe(r2.error.fatal ?? false);
        }
      }
    }
  });

  it("commit only ever affects FAILURE (a success is untouched)", () => {
    const p = commit(literal("a"));
    const r = p("a", 0);
    expect(r).toEqual({ success: true, val: "a", current: 0, next: 1 });
  });

  it("a fatal failure aborts choice entirely rather than falling through to a sibling", () => {
    // `("a" ~ "b") / "c"` on "ac": the committed alternative fails past
    // its cut, so `choice` must not fall back to trying "c" -- this is
    // the exact semantics `commit`'s own doc comment (combinators.ts)
    // describes, pinned here as a standalone law rather than only via a
    // full grammar round-trip.
    const committed = sequence(literal("a"), commit(literal("b")));
    const withFallback = choice(committed, literal("c"));
    const result = withFallback("ac", 0);
    expect(result.success).toBe(false);
  });
});
