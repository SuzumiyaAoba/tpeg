/**
 * Differential fuzzing of this package's hand-written combinators against
 * `reference-eval.ts`'s independent evaluator -- see that module's doc
 * comment for why this exists alongside `combinator-laws.spec.ts` (an
 * algebraic law can't catch a bug shared by both sides of the law; an
 * independent implementation can).
 *
 * Every random {@link Spec} is built into TWO real parsers -- one using
 * plain `choice` for every `"alt"` node, one using `predictiveChoice` with
 * filters/literal-prefixes this file derives independently (see "Filter
 * derivation" below) -- and both are compared against `reference-eval.ts`'s
 * recognition-only result. This deliberately reaches constructs the
 * grammar-TEXT fuzzers (`packages/parser/src/codegen-differential.spec.ts`,
 * this package's own `combinator-laws.spec.ts`) structurally cannot:
 *
 * - An ASTRAL character-class RANGE (e.g. `[😀-🙏]`) -- the `.tpeg` text
 *   parser's `charClassChar` (`packages/parser/src/character-class.ts`)
 *   only accepts ASCII printable characters as a class member, so no
 *   grammar-text fuzzer can ever generate one; this file builds `Spec`
 *   trees directly, skipping that restriction entirely.
 * - `predictiveChoice` driven by a REAL (non-`null`) filter derived from
 *   an arbitrary random tree, not just the `null`-filter case
 *   `combinator-laws.spec.ts` already covers, and not just the
 *   hand-picked literal-prefix cases in `combinators.spec.ts`.
 * - `quantified` with arbitrary `min`/`max` combinations (`{0,0}`,
 *   unbounded, etc.), `charClassRun`, `withDefault`, `reject` -- all
 *   exercised directly rather than only through codegen's narrower output
 *   shapes.
 *
 * ## Filter derivation
 *
 * `predictiveChoice`'s two caller contracts (see its doc comment,
 * `./combinators.ts`) are re-derived here from scratch, independently of
 * `packages/parser/src/first-sets.ts` (a different package, over a
 * different AST, this one can't depend on anyway): `nullable`,
 * `canReachCutAtZero`, and `firstSetOf` below are this file's own mini
 * FIRST-set analysis over {@link Spec}. Every one of them is deliberately
 * conservative in the SAFE direction -- when genuinely unsure, `firstSetOf`
 * returns `null` ("try unconditionally") and `canReachCutAtZero` prefers
 * `true` ("assume unsafe to skip") -- so a mistake in this analysis can
 * only ever cost dispatch-table COVERAGE (a filter that could have been
 * non-`null` staying `null`), never soundness (a filter that should have
 * been `null` staying non-`null`). If this analysis is itself wrong in the
 * unsafe direction, that shows up as a genuine test failure below, which
 * is exactly the point: this file's own filter derivation is under test
 * here just as much as `predictiveChoice` is.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { anyChar, literal } from "./basic";
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
import { andPredicate, notPredicate } from "./lookahead";
import {
  type CharSpecItem,
  ReferenceEvalLimitError,
  type Spec,
  evalSpec,
} from "./reference-eval";
import { oneOrMore, optional, quantified, zeroOrMore } from "./repetition";
import type { NonEmptyArray, Parser } from "./types";

beforeEach(() => {
  resetFailureWatermark();
});

// --- Deterministic PRNG (same LCG as combinator-laws.spec.ts / codegen-differential.spec.ts) ---

const makeRng = (seed: number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
};

const pick = <T>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)] as T;

// --- Leaves --------------------------------------------------------------

const EMOJI_LO = 0x1f600; // start of the "emoticons" astral block
const EMOJI_HI = 0x1f64f; // end of that block
const emoji = (cp: number): string => String.fromCodePoint(cp);
const IN_RANGE_EMOJI = emoji(0x1f60a); // 😊 -- inside [EMOJI_LO, EMOJI_HI]
const OUT_OF_RANGE_EMOJI = emoji(0x1f389); // 🎉 -- outside it

// Every leaf here is guaranteed NON-nullable (always consumes >=1 code
// point on success) -- safe to wrap in `star`/`plus`/an unbounded `quant`
// without risking the zero-width-match guard (`ReferenceEvalLimitError`
// here, `createInfiniteLoopError` in the real `zeroOrMore`/`oneOrMore`).
const NONNULLABLE_LEAVES: readonly Spec[] = [
  { kind: "lit", value: "a" },
  { kind: "lit", value: "b" },
  { kind: "lit", value: "ab" },
  { kind: "lit", value: "xy" },
  { kind: "lit", value: "xz" },
  { kind: "lit", value: "wy" },
  { kind: "lit", value: IN_RANGE_EMOJI },
  { kind: "cls", specs: ["a", "b", "c"], negated: false },
  { kind: "cls", specs: [["a", "c"]], negated: false },
  { kind: "cls", specs: ["a"], negated: true },
  {
    kind: "cls",
    specs: [[emoji(EMOJI_LO), emoji(EMOJI_HI)]],
    negated: false,
  },
  { kind: "cls", specs: [[emoji(EMOJI_LO), emoji(EMOJI_HI)]], negated: true },
  { kind: "run", specs: ["a", "b"], min: 1, negated: false },
  {
    kind: "run",
    specs: [[emoji(EMOJI_LO), emoji(EMOJI_HI)]],
    min: 1,
    negated: false,
  },
  { kind: "any" },
];

// Nullable leaves -- fine anywhere EXCEPT directly under star/plus/an
// unbounded quant.
const NULLABLE_LEAVES: readonly Spec[] = [
  { kind: "run", specs: ["a", "b"], min: 0, negated: false },
];

const ALL_LEAVES: readonly Spec[] = [...NONNULLABLE_LEAVES, ...NULLABLE_LEAVES];

// --- Random Spec generation ------------------------------------------------

const genSpec = (rng: () => number, depth: number): Spec => {
  if (depth <= 0) return pick(rng, ALL_LEAVES);
  const next = () => genSpec(rng, depth - 1);
  const leaf = () => pick(rng, NONNULLABLE_LEAVES);
  switch (Math.floor(rng() * 18)) {
    case 0:
      return pick(rng, ALL_LEAVES);
    case 1:
      return { kind: "seq", elements: [next(), next()] };
    case 2:
      return { kind: "seq", elements: [next(), next(), next()] };
    case 3:
      return { kind: "alt", alternatives: [next(), next()] };
    case 4:
      return { kind: "alt", alternatives: [next(), next(), next()] };
    case 5:
      // Star/plus over a bare leaf, never a composite that might be
      // nullable -- see the module doc comment and `NONNULLABLE_LEAVES`.
      return { kind: "star", expression: leaf() };
    case 6:
      return { kind: "plus", expression: leaf() };
    case 7:
      return { kind: "opt", expression: next() };
    case 8: {
      // Bounded quant: safe over ANY expression (even a nullable one) --
      // the `for` loop is bounded by `max` regardless, matching
      // `quantified`'s own construction-time-safe handling
      // (`./repetition.ts`).
      const min = Math.floor(rng() * 3);
      const max = min + Math.floor(rng() * 3);
      return { kind: "quant", expression: next(), min, max };
    }
    case 9: {
      // Unbounded quant: only safe over a guaranteed-non-nullable leaf.
      // `max` OMITTED, not set to `undefined` -- `exactOptionalPropertyTypes`
      // (this package's tsconfig) distinguishes the two for an optional
      // property.
      const min = Math.floor(rng() * 3);
      return { kind: "quant", expression: leaf(), min };
    }
    case 10:
      return { kind: "and", expression: next() };
    case 11:
      return { kind: "not", expression: next() };
    case 12:
      return { kind: "default", expression: next() };
    case 13:
      return { kind: "reject", expression: next() };
    case 14:
      // Cut past a leading non-nullable leaf -- canReachCutAtZero must be
      // FALSE for this (the leaf always consumes first).
      return {
        kind: "seq",
        elements: [leaf(), { kind: "cut", expression: next() }],
      };
    case 15:
      // Cut as the very first element -- canReachCutAtZero must be TRUE.
      return {
        kind: "seq",
        elements: [{ kind: "cut", expression: next() }, next()],
      };
    case 16:
      // A cut-bearing branch as one alternative of a choice -- exercises
      // fatal-failure absorption at the `alt`'s own boundary (both in
      // `reference-eval.ts` and in the real `choice`/`predictiveChoice`).
      return {
        kind: "alt",
        alternatives: [
          {
            kind: "seq",
            elements: [leaf(), { kind: "cut", expression: next() }],
          },
          next(),
        ],
      };
    default:
      return { kind: "cut", expression: next() };
  }
};

// --- Independent FIRST-set / cut-reachability analysis (see module doc) ---

const nullable = (spec: Spec): boolean => {
  switch (spec.kind) {
    case "lit":
      return spec.value.length === 0;
    case "any":
    case "cls":
      return false;
    case "run":
      return spec.min === 0;
    case "seq":
      return spec.elements.every(nullable);
    case "alt":
      return spec.alternatives.some(nullable);
    case "star":
    case "opt":
    case "and":
    case "not":
    case "default":
    case "reject":
      return true;
    case "plus":
    case "cut":
      return nullable(spec.expression);
    case "quant":
      return spec.min === 0 || nullable(spec.expression);
  }
};

/** True if some execution path through `spec`, starting at whatever
 * position the caller reaches it at, could invoke a `cut` node before
 * consuming any input -- the combinator-layer counterpart of
 * `packages/parser/src/first-sets.ts`'s `canCommitWithoutConsuming`. A
 * `predictiveChoice` alternative for which this is `true` MUST get a
 * `null` filter (see that function's "Caller contract" doc comment,
 * `./combinators.ts`) -- skipping it based on a real filter would change
 * which alternative wins whenever it would have failed fatally instead of
 * being tried. `and`/`not`/`reject` are hard stops (`false` unconditionally):
 * each absorbs any fatal failure from its own probe at its own boundary
 * (see `andPredicate`/`notPredicate`'s doc comments, `./lookahead.ts`, and
 * `reject`'s, `./combinators.ts`), so a cut nested inside one can never
 * escape as fatal to whatever encloses it. */
const canReachCutAtZero = (spec: Spec): boolean => {
  switch (spec.kind) {
    case "lit":
    case "any":
    case "cls":
    case "run":
      return false;
    case "seq": {
      for (const el of spec.elements) {
        if (canReachCutAtZero(el)) return true;
        if (!nullable(el)) return false;
      }
      return false;
    }
    case "alt":
      return spec.alternatives.some(canReachCutAtZero);
    case "star":
    case "plus":
    case "opt":
      return canReachCutAtZero(spec.expression);
    case "quant":
      return canReachCutAtZero(spec.expression);
    case "and":
    case "not":
    case "reject":
      return false;
    case "cut":
      return true;
    case "default":
      return canReachCutAtZero(spec.expression);
  }
};

const singleCharRange = (cp: number): FirstCharFilter => ({
  ranges: [{ lo: cp, hi: cp }],
});

const specItemRanges = (
  specs: readonly CharSpecItem[],
): readonly { lo: number; hi: number }[] =>
  specs.map((s) => {
    const [startStr, endStr] = typeof s === "string" ? [s, s] : s;
    return {
      lo: startStr.codePointAt(0) as number,
      hi: endStr.codePointAt(0) as number,
    };
  });

/** A sound (possibly over-broad, never under-broad) FIRST-set for `spec`,
 * or `null` if this analysis can't safely characterize it -- see the
 * module doc comment's "Filter derivation" section for the safety
 * direction this deliberately favors. */
const firstSetOf = (spec: Spec): FirstCharFilter | null => {
  switch (spec.kind) {
    case "lit":
      return spec.value.length === 0
        ? null
        : singleCharRange(spec.value.codePointAt(0) as number);
    case "any":
      return null;
    case "cls":
      return spec.negated ? null : { ranges: specItemRanges(spec.specs) };
    case "run":
      return spec.negated || spec.min === 0
        ? null
        : { ranges: specItemRanges(spec.specs) };
    case "seq": {
      const ranges: { lo: number; hi: number }[] = [];
      for (const el of spec.elements) {
        const fs = firstSetOf(el);
        if (fs === null) return null;
        ranges.push(...fs.ranges);
        if (!nullable(el)) return { ranges };
      }
      return { ranges };
    }
    case "alt": {
      const ranges: { lo: number; hi: number }[] = [];
      for (const alt of spec.alternatives) {
        const fs = firstSetOf(alt);
        if (fs === null) return null;
        ranges.push(...fs.ranges);
      }
      return { ranges };
    }
    case "plus":
      return firstSetOf(spec.expression);
    case "quant":
      return spec.min === 0 ? null : firstSetOf(spec.expression);
    case "cut":
      return firstSetOf(spec.expression);
    case "star":
    case "opt":
    case "and":
    case "not":
    case "default":
    case "reject":
      return null;
  }
};

/** Mirrors `packages/parser/src/codegen-optimized.ts`'s
 * `literalPrefixForExpression`: non-`null` only for a bare `lit` of length
 * >= 2, or a `seq` whose first element is one -- exactly the shapes for
 * which `firstSetOf` above is guaranteed to return exactly that literal's
 * first character (never broader), satisfying `predictiveChoice`'s
 * literal-prefix caller contract by construction. */
const literalPrefixFor = (spec: Spec): string | null => {
  if (spec.kind === "lit") return spec.value.length >= 2 ? spec.value : null;
  if (spec.kind !== "seq") return null;
  const first = spec.elements[0];
  if (first?.kind === "lit" && first.value.length >= 2) return first.value;
  return null;
};

// --- Building real parsers from a Spec -------------------------------------

const toCharClassArgs = (
  specs: readonly CharSpecItem[],
): NonEmptyArray<string | [string, string]> =>
  specs.map((s) => (typeof s === "string" ? s : [s[0], s[1]])) as NonEmptyArray<
    string | [string, string]
  >;

let predictiveChoiceFilterCount = 0;
let predictiveChoiceLiteralPrefixCount = 0;

const build = (
  spec: Spec,
  altMode: "choice" | "predictive",
): Parser<unknown> => {
  switch (spec.kind) {
    case "lit":
      return literal(spec.value);
    case "any":
      return anyChar();
    case "cls":
      return spec.negated
        ? negatedCharClass(...toCharClassArgs(spec.specs))
        : charClass(...toCharClassArgs(spec.specs));
    case "run":
      return charClassRun(toCharClassArgs(spec.specs), spec.min, spec.negated);
    case "seq":
      return sequence(...spec.elements.map((e) => build(e, altMode)));
    case "alt": {
      if (altMode === "choice") {
        return choice(...spec.alternatives.map((a) => build(a, altMode)));
      }
      const entries = spec.alternatives.map((alt) => {
        const parser = build(alt, altMode);
        const filter = canReachCutAtZero(alt) ? null : firstSetOf(alt);
        if (filter) predictiveChoiceFilterCount++;
        const prefix = literalPrefixFor(alt);
        // Only pass a literal prefix when it satisfies predictiveChoice's
        // own contract (see this module's doc comment and
        // `combinators.ts`'s "Caller contract: literalPrefix must be a
        // prefix EVERY match shares..."): filter must be exactly the
        // prefix's first character.
        const safePrefix =
          prefix !== null &&
          filter !== null &&
          filter.ranges.length === 1 &&
          filter.ranges[0]?.lo === filter.ranges[0]?.hi &&
          filter.ranges[0]?.lo === prefix.codePointAt(0)
            ? prefix
            : null;
        if (safePrefix) predictiveChoiceLiteralPrefixCount++;
        return [parser, filter, safePrefix] as const;
      });
      return predictiveChoice(entries);
    }
    case "star":
      return zeroOrMore(build(spec.expression, altMode));
    case "plus":
      return oneOrMore(build(spec.expression, altMode));
    case "opt":
      return optional(build(spec.expression, altMode));
    case "quant":
      return quantified(build(spec.expression, altMode), spec.min, spec.max);
    case "and":
      return andPredicate(build(spec.expression, altMode));
    case "not":
      return notPredicate(build(spec.expression, altMode));
    case "cut":
      return commit(build(spec.expression, altMode));
    case "default":
      return withDefault(build(spec.expression, altMode), undefined);
    case "reject":
      return reject(build(spec.expression, altMode));
  }
};

// --- Inputs ------------------------------------------------------------

const FIXED_INPUTS = [
  "",
  "a",
  "b",
  "ab",
  "ba",
  "aa",
  "xy",
  "xz",
  "wy",
  "xya",
  "c",
  "abab",
  IN_RANGE_EMOJI,
  OUT_OF_RANGE_EMOJI,
  `a${IN_RANGE_EMOJI}`,
  `${IN_RANGE_EMOJI}${IN_RANGE_EMOJI}`,
  emoji(EMOJI_LO),
  emoji(EMOJI_HI),
  emoji(EMOJI_LO - 1), // just outside the astral range's low end
  emoji(EMOJI_HI + 1), // just outside its high end
];

const ALPHABET = [
  "a",
  "b",
  "c",
  "x",
  "y",
  "z",
  "w",
  IN_RANGE_EMOJI,
  OUT_OF_RANGE_EMOJI,
];

const genInputs = (rng: () => number, count: number): string[] => {
  const out = [...FIXED_INPUTS];
  for (let i = 0; i < count; i++) {
    const len = Math.floor(rng() * 6);
    let s = "";
    for (let j = 0; j < len; j++) s += pick(rng, ALPHABET);
    out.push(s);
  }
  return out;
};

// --- Harness ---------------------------------------------------------------

const keySuccessOnly = (r: ReturnType<Parser<unknown>>): string =>
  r.success ? `S:${r.next}` : "F";

const SEEDS = 500;

describe("combinator oracle: choice/predictiveChoice builds vs. reference-eval.ts", () => {
  it(`agrees with reference-eval across ${SEEDS} random specs x ~${FIXED_INPUTS.length + 10} inputs, for both choice-mode and predictiveChoice-mode builds`, () => {
    const diffs: string[] = [];
    let tested = 0;
    let skipped = 0;

    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = makeRng(seed);
      const spec = genSpec(rng, 4);

      let choiceParser: Parser<unknown>;
      let predictiveParser: Parser<unknown>;
      try {
        choiceParser = build(spec, "choice");
        predictiveParser = build(spec, "predictive");
      } catch {
        // A construction-time rejection (e.g. `quantified`'s min/max
        // validation) -- not expected given this generator's own
        // discipline, but handled defensively exactly like the sibling
        // grammar-text fuzzers do.
        skipped++;
        continue;
      }

      tested++;
      const inputRng = makeRng(seed * 7919 + 1); // distinct stream from spec generation
      for (const input of genInputs(inputRng, 10)) {
        let oracleKey: string;
        try {
          const r = evalSpec(spec, input, 0);
          oracleKey = r.ok ? `S:${r.next}` : "F";
        } catch (error) {
          if (!(error instanceof ReferenceEvalLimitError)) {
            diffs.push(
              `[reference-eval THREW] seed=${seed} input=${JSON.stringify(input)}\n  ${(error as Error).message}\n  spec=${JSON.stringify(spec)}`,
            );
          }
          continue;
        }

        for (const [label, parser] of [
          ["choice", choiceParser],
          ["predictiveChoice", predictiveParser],
        ] as const) {
          let result: ReturnType<Parser<unknown>>;
          try {
            result = parser(input, 0);
          } catch (error) {
            diffs.push(
              `[${label} THREW] seed=${seed} input=${JSON.stringify(input)}\n  ${(error as Error).message}\n  spec=${JSON.stringify(spec)}`,
            );
            continue;
          }
          const key = keySuccessOnly(result);
          if (key !== oracleKey) {
            diffs.push(
              `[${label}] seed=${seed} input=${JSON.stringify(input)}\n  oracle=${oracleKey} ${label}=${key}\n  spec=${JSON.stringify(spec)}`,
            );
          }
        }
      }
    }

    // Guards against this test silently testing nothing if generation
    // regresses (same convention as `codegen-differential.spec.ts`).
    expect(tested).toBeGreaterThan(SEEDS / 2);
    // Guards against the predictiveChoice-mode build silently degenerating
    // to "every filter is null" -- the whole point of building a SECOND,
    // predictive-mode parser per spec is to exercise real (non-null)
    // filters and the dispatch trie, not just re-prove `choice` works.
    expect(predictiveChoiceFilterCount).toBeGreaterThan(0);
    expect(predictiveChoiceLiteralPrefixCount).toBeGreaterThan(0);

    if (diffs.length > 0) {
      const preview = diffs.slice(0, 10).join("\n\n");
      throw new Error(
        `${diffs.length} differential-fuzzing failure(s) out of ${tested} specs tested (${skipped} skipped). First ${Math.min(10, diffs.length)}:\n\n${preview}`,
      );
    }
  });
});
