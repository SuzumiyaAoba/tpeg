/**
 * Algebraic-equivalence fuzzing for `tpeg-combinator`'s own combinators
 * (`memoize`, `takeUntil`, `between`, `sepBy`/`sepBy1`) -- see
 * `packages/core/src/combinator-laws.spec.ts`'s module doc comment for why
 * this class of test exists: none of these are reachable through
 * `codegen-differential.spec.ts` (`packages/parser`), which only ever
 * generates plain `choice`/`sequence`/`zeroOrMore` combinator calls, never
 * a hand-written caller reaching for `memoize`/`takeUntil`/`between`/
 * `sepBy` directly the way `packages/samples` or an external consumer of
 * this package would.
 *
 * Same deterministic LCG PRNG as `codegen-differential.spec.ts` and
 * `packages/core/src/combinator-laws.spec.ts` -- not `Math.random()`, so
 * any future failure is reproducible from the printed seed alone.
 */

import { describe, expect, it } from "bun:test";
import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  anyChar,
  charClass,
  choice,
  isFatalFailure,
  literal,
  map,
  negatedCharClass,
  notPredicate,
  optional,
  seq,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import { sepBy, sepBy1 } from "./list";
import { memoize } from "./logic";
import { between, takeUntil } from "./string";

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

const EMOJI = String.fromCodePoint(0x1f600);

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

/** A small, deliberately non-nullable parser tree -- every combinator
 * under test here (`sepBy`, `takeUntil`, `between`) has documented
 * special-case behavior for a NULLABLE value/condition (see `list.ts`'s
 * `sepBy` doc comment), which is a separate concern from the ordinary-case
 * algebraic law each test below checks; kept out of scope by construction
 * rather than filtered post hoc. */
const genParser = (rng: () => number, depth: number): Parser<unknown> => {
  if (depth <= 0) return pick(rng, LEAVES)();
  const next = () => genParser(rng, depth - 1);
  switch (Math.floor(rng() * 6)) {
    case 0:
      return pick(rng, LEAVES)();
    case 1:
      return seq(next(), next());
    case 2:
      return choice(next(), next());
    case 3:
      return choice(next(), next(), next());
    case 4:
      return seq(next(), next(), next());
    default:
      return pick(rng, LEAVES)();
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
  "a,a,a",
  "a,a",
];

type Key = string;
// Three-way failure split (`"FATAL"` vs. plain `"F"`), not just `"F"` -- see
// `packages/core/src/combinator-laws.spec.ts`'s identical `key` comment for
// why collapsing fatality into recognition-only would hide a cut-propagation
// bug (`memoize`/`takeUntil`/`between`/`sepBy` all wrap combinators that can
// carry a `fatal` failure through unchanged, per their own doc comments in
// `logic.ts`/`string.ts`/`list.ts`).
const key = (parser: Parser<unknown>, input: string): Key => {
  try {
    const r = parser(input, 0);
    if (r.success) return `S:${r.next}:${JSON.stringify(r.val)}`;
    return isFatalFailure(r) ? "FATAL" : "F";
  } catch {
    return "T";
  }
};

// See `packages/parser/src/codegen-differential.spec.ts`'s identical
// `FUZZ_SCALE` comment: multiplies the seed count for a deep audit run,
// e.g. `TPEG_FUZZ_SCALE=30 bun test src/combinator-laws.spec.ts`. A no-op
// at the default of 1.
const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const SEEDS = 300 * FUZZ_SCALE;

describe("combinator laws: memoize", () => {
  it("memoize(e) is observationally identical to e, on first AND repeated calls", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rngA = makeRng(seed);
      const rngB = makeRng(seed);
      const plain = genParser(rngA, 3);
      const memoized = memoize(genParser(rngB, 3));
      for (const input of INPUTS) {
        // Called twice on purpose: the SECOND call is a cache hit, which
        // must still produce the identical result the first (miss) call
        // did.
        expect(key(memoized, input)).toBe(key(plain, input));
        expect(key(memoized, input)).toBe(key(plain, input));
      }
    }
  });
});

describe("combinator laws: takeUntil / between", () => {
  it("takeUntil(cond) === the joined text of zeroOrMore(seq(!cond, anyChar()))", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rngA = makeRng(seed);
      const rngB = makeRng(seed);
      const cond1 = genParser(rngA, 2);
      const cond2 = genParser(rngB, 2);
      const tu = takeUntil(cond1);
      const reference = map(
        zeroOrMore(seq(notPredicate(cond2), anyChar())),
        (pairs) => pairs.map(([, ch]) => ch).join(""),
      );
      for (const input of INPUTS) {
        expect(key(tu, input)).toBe(key(reference, input));
      }
    }
  });

  it("between(open, close) === map(seq(open, takeUntil(close), close), ([, c]) => c)", () => {
    const open = literal("(");
    const close = literal(")");
    const b = between(open, close);
    const reference = map(
      seq(open, takeUntil(close), close),
      ([, content]) => content,
    );
    for (const input of [
      "()",
      "(abc)",
      "(a(b)c)",
      "(",
      "no parens",
      "(unterminated",
    ]) {
      expect(key(b, input)).toBe(key(reference, input));
    }
  });
});

describe("combinator laws: sepBy / sepBy1", () => {
  it("sepBy1(value, sep) === map(seq(value, zeroOrMore(seq(sep, value))), ([h, t]) => [h, ...t.map(...)])", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rngA = makeRng(seed);
      const rngB = makeRng(seed);
      const value1 = genParser(rngA, 2);
      const sep1 = genParser(rngA, 1);
      const value2 = genParser(rngB, 2);
      const sep2 = genParser(rngB, 1);
      const a = sepBy1(value1, sep1);
      const reference = map(
        seq(value2, zeroOrMore(map(seq(sep2, value2), ([, v]) => v))),
        ([head, tail]) => [head, ...tail],
      );
      for (const input of INPUTS) {
        expect(key(a, input)).toBe(key(reference, input));
      }
    }
  });

  it("sepBy(value, sep) === map(optional(sepBy1(value, sep)), ([xs]) => xs ?? []) for non-nullable value/sep", () => {
    // `sepBy`'s own doc comment (`list.ts`) explains why it is NOT
    // literally implemented as `optional(sepBy1(...))` -- a nullable
    // `value`/`sep` can make the internal `rest` trip its own
    // infinite-loop guard, which `optional` would incorrectly swallow as
    // "empty". Every leaf here is non-nullable (see `genParser`'s doc
    // comment), so that corner never triggers and the two really are
    // observationally identical -- this is the law that DOES hold in the
    // common case, not a claim about the pathological one.
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rngA = makeRng(seed);
      const rngB = makeRng(seed);
      const value1 = genParser(rngA, 2);
      const sep1 = genParser(rngA, 1);
      const value2 = genParser(rngB, 2);
      const sep2 = genParser(rngB, 1);
      const a = sepBy(value1, sep1);
      const reference = map(optional(sepBy1(value2, sep2)), (xs) =>
        xs.length > 0 ? xs[0] : [],
      );
      for (const input of INPUTS) {
        expect(key(a, input)).toBe(key(reference, input));
      }
    }
  });
});
