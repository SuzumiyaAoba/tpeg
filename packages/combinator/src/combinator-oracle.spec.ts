/**
 * Differential fuzzing of this package's combinators
 * (`memoize`/`commitAtTopLevel`/`sepBy`/`sepBy1`/`between`/`takeUntil`)
 * against `@suzumiyaaoba/tpeg-core`'s `reference-eval.ts` oracle -- the
 * combinator-package half of `packages/core/src/combinator-oracle.spec.ts`
 * (see that file's doc comment for the full rationale: an algebraic law,
 * like the ones in this package's `combinator-laws.spec.ts`/
 * `packages/core/src/combinator-laws.spec.ts`, can't catch a bug shared by
 * both sides of the law -- an independent implementation can).
 *
 * `reference-eval.ts` only knows about `tpeg-core`'s primitives, not this
 * package's own combinators, so this file translates every {@link CSpec}
 * (a strict superset of `tpeg-core`'s `Spec`, adding this package's own
 * node kinds) down to a plain `Spec` via {@link toCoreSpec} BEFORE handing
 * it to `evalSpec` -- see that function for exactly how each new kind is
 * expressed in terms of primitives the oracle already understands:
 *
 * - `"memo"` (`memoize`) translates to its own `expression` UNCHANGED --
 *   memoization is a pure caching optimization, transparent to
 *   recognition, by construction.
 * - `"topcut"` (`commitAtTopLevel`) translates exactly like a `"cut"` node
 *   (`commit`'s own translation is the identity -- `Spec` already has a
 *   `"cut"` node) -- see `commitAtTopLevel`'s doc comment (`./logic.ts`)
 *   for why the watermark side effect it ALSO performs doesn't affect
 *   recognition (it only prunes `memoize` caches, a reachability-only,
 *   never-correctness-affecting optimization).
 * - `"sepby"`/`"sepby1"` translate to `(value (sep value)*)?` /
 *   `value (sep value)*` respectively -- `sepBy`'s own doc comment
 *   (`./list.ts`) explains why this equivalence needs `value` to be
 *   non-nullable (else `zeroOrMore`'s infinite-loop guard can fire and
 *   `sepBy` propagates that ordinary failure rather than reinterpreting it
 *   as "empty," which a naive `optional(...)` wrapping would get wrong) --
 *   this file's generator only ever draws a non-nullable `value`, exactly
 *   like it never wraps `star`/`plus`/an unbounded `quant` around a
 *   nullable expression, sidestepping the divergence entirely rather than
 *   modeling it.
 * - `"between"`/`"takeuntil"` translate to `open (!close .)* close` /
 *   `(!cond .)*` -- `takeUntil`'s own linear character-by-character scan
 *   (`getCharAt`/`nextPos` in `./string.ts`) checks its condition BEFORE
 *   consuming and stops at end of input regardless of whether the
 *   condition ever matched, exactly like a `Star` over `notPredicate`
 *   would. This also pins `takeUntil`'s fatal-swallowing behavior found
 *   during this task's investigation (it only ever checks
 *   `condition(...).success`, never `isFatalFailure`): `reference-eval.ts`'s
 *   `"not"` case does the identical thing (`r.ok ? NG(false) : OK(pos)`,
 *   independent of `r.fatal`), so this translation models that swallowing
 *   faithfully rather than diverging from it.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  type CharSpecItem,
  type FirstCharFilter,
  type NonEmptyArray,
  type Parser,
  ReferenceEvalLimitError,
  type Spec,
  andPredicate,
  anyChar,
  charClass,
  charClassRun,
  choice,
  commit,
  evalSpec,
  isFatalFailure,
  literal,
  negatedCharClass,
  notPredicate,
  oneOrMore,
  optional,
  predictiveChoice,
  quantified,
  reject,
  resetFailureWatermark,
  sequence,
  withDefault,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import { sepBy, sepBy1 } from "./list";
import { commitAtTopLevel, memoize } from "./logic";
import { between, takeUntil } from "./string";

beforeEach(() => {
  resetFailureWatermark();
});

// --- Deterministic PRNG (same LCG as every other differential-fuzzing suite in this codebase) ---

const makeRng = (seed: number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
};

const pick = <T>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)] as T;

// --- The extended combinator-level Spec -------------------------------

/** A strict superset of `@suzumiyaaoba/tpeg-core`'s `Spec`, adding one
 * node per combinator this package exports that `reference-eval.ts`
 * doesn't already model. Every core `Spec` kind is repeated here
 * (children typed `CSpec`, not `Spec`) so the new kinds can nest freely
 * with the old ones in either direction -- e.g. `memoize` wrapping a
 * `sepBy` wrapping a `commit`. */
type CSpec =
  | { readonly kind: "lit"; readonly value: string }
  | { readonly kind: "any" }
  | {
      readonly kind: "cls";
      readonly specs: readonly CharSpecItem[];
      readonly negated: boolean;
    }
  | {
      readonly kind: "run";
      readonly specs: readonly CharSpecItem[];
      readonly min: 0 | 1;
      readonly negated: boolean;
    }
  | { readonly kind: "seq"; readonly elements: readonly CSpec[] }
  | { readonly kind: "alt"; readonly alternatives: readonly CSpec[] }
  | { readonly kind: "star"; readonly expression: CSpec }
  | { readonly kind: "plus"; readonly expression: CSpec }
  | { readonly kind: "opt"; readonly expression: CSpec }
  | {
      readonly kind: "quant";
      readonly expression: CSpec;
      readonly min: number;
      readonly max?: number;
    }
  | { readonly kind: "and"; readonly expression: CSpec }
  | { readonly kind: "not"; readonly expression: CSpec }
  | { readonly kind: "cut"; readonly expression: CSpec }
  | { readonly kind: "default"; readonly expression: CSpec }
  | { readonly kind: "reject"; readonly expression: CSpec }
  | { readonly kind: "memo"; readonly expression: CSpec }
  | { readonly kind: "topcut"; readonly expression: CSpec }
  | { readonly kind: "sepby"; readonly value: CSpec; readonly sep: CSpec }
  | { readonly kind: "sepby1"; readonly value: CSpec; readonly sep: CSpec }
  | { readonly kind: "between"; readonly open: CSpec; readonly close: CSpec }
  | { readonly kind: "takeuntil"; readonly cond: CSpec };

/** Translates `c` down to a plain `Spec` that `reference-eval.ts`'s
 * `evalSpec` can evaluate -- see the module doc comment for why each new
 * kind's translation is recognition-faithful. */
const toCoreSpec = (c: CSpec): Spec => {
  switch (c.kind) {
    case "lit":
    case "any":
    case "cls":
    case "run":
      return c;
    case "seq":
      return { kind: "seq", elements: c.elements.map(toCoreSpec) };
    case "alt":
      return { kind: "alt", alternatives: c.alternatives.map(toCoreSpec) };
    case "star":
      return { kind: "star", expression: toCoreSpec(c.expression) };
    case "plus":
      return { kind: "plus", expression: toCoreSpec(c.expression) };
    case "opt":
      return { kind: "opt", expression: toCoreSpec(c.expression) };
    case "quant":
      return {
        kind: "quant",
        expression: toCoreSpec(c.expression),
        min: c.min,
        // Conditionally spread, not `max: c.max` -- `exactOptionalPropertyTypes`
        // rejects an explicit `undefined` for an optional property, and
        // `c.max`'s read type is `number | undefined` regardless of
        // whether the property was actually omitted upstream.
        ...(c.max !== undefined && { max: c.max }),
      };
    case "and":
      return { kind: "and", expression: toCoreSpec(c.expression) };
    case "not":
      return { kind: "not", expression: toCoreSpec(c.expression) };
    case "cut":
      return { kind: "cut", expression: toCoreSpec(c.expression) };
    case "default":
      return { kind: "default", expression: toCoreSpec(c.expression) };
    case "reject":
      return { kind: "reject", expression: toCoreSpec(c.expression) };
    case "memo":
      // Memoization is a pure caching optimization -- transparent to
      // recognition by construction.
      return toCoreSpec(c.expression);
    case "topcut":
      return { kind: "cut", expression: toCoreSpec(c.expression) };
    case "sepby": {
      const value = toCoreSpec(c.value);
      const sep = toCoreSpec(c.sep);
      return {
        kind: "opt",
        expression: {
          kind: "seq",
          elements: [
            value,
            {
              kind: "star",
              expression: { kind: "seq", elements: [sep, value] },
            },
          ],
        },
      };
    }
    case "sepby1": {
      const value = toCoreSpec(c.value);
      const sep = toCoreSpec(c.sep);
      return {
        kind: "seq",
        elements: [
          value,
          { kind: "star", expression: { kind: "seq", elements: [sep, value] } },
        ],
      };
    }
    case "between": {
      const open = toCoreSpec(c.open);
      const close = toCoreSpec(c.close);
      return {
        kind: "seq",
        elements: [
          open,
          {
            kind: "star",
            expression: {
              kind: "seq",
              elements: [{ kind: "not", expression: close }, { kind: "any" }],
            },
          },
          close,
        ],
      };
    }
    case "takeuntil": {
      const cond = toCoreSpec(c.cond);
      return {
        kind: "star",
        expression: {
          kind: "seq",
          elements: [{ kind: "not", expression: cond }, { kind: "any" }],
        },
      };
    }
  }
};

// --- Independent FIRST-set / cut-reachability analysis --------------------
//
// Deliberately re-derived here, not imported from
// `packages/core/src/combinator-oracle.spec.ts` (a test-only file with no
// public export, and by design -- each oracle independently re-derives
// this rather than sharing test scaffolding across packages). Operates on
// plain `Spec` (post-`toCoreSpec` translation), so it needs no knowledge
// of this package's own node kinds. See that sibling file's identical
// functions for the full safety-direction rationale: every one of these
// is conservative in the SAFE direction (never claims something is
// excludable/non-nullable/cut-free when it might not be).

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

const literalPrefixFor = (spec: Spec): string | null => {
  if (spec.kind === "lit") return spec.value.length >= 2 ? spec.value : null;
  if (spec.kind !== "seq") return null;
  const first = spec.elements[0];
  if (first?.kind === "lit" && first.value.length >= 2) return first.value;
  return null;
};

// --- Leaves --------------------------------------------------------------

const EMOJI_LO = 0x1f600;
const EMOJI_HI = 0x1f64f;
const emoji = (cp: number): string => String.fromCodePoint(cp);
const IN_RANGE_EMOJI = emoji(0x1f60a);
const OUT_OF_RANGE_EMOJI = emoji(0x1f389);

// Non-nullable: safe under star/plus/an unbounded quant, and as sepBy's
// own `value` (see the module doc comment on why that matters).
const NONNULLABLE_LEAVES: readonly CSpec[] = [
  { kind: "lit", value: "a" },
  { kind: "lit", value: "b" },
  { kind: "lit", value: "ab" },
  { kind: "lit", value: "xy" },
  { kind: "lit", value: "xz" },
  { kind: "lit", value: IN_RANGE_EMOJI },
  { kind: "cls", specs: ["a", "b", "c"], negated: false },
  { kind: "cls", specs: [["a", "c"]], negated: false },
  {
    kind: "cls",
    specs: [[emoji(EMOJI_LO), emoji(EMOJI_HI)]],
    negated: false,
  },
  { kind: "run", specs: ["a", "b"], min: 1, negated: false },
  { kind: "any" },
];

const NULLABLE_LEAVES: readonly CSpec[] = [
  { kind: "run", specs: ["a", "b"], min: 0, negated: false },
];

const ALL_LEAVES: readonly CSpec[] = [
  ...NONNULLABLE_LEAVES,
  ...NULLABLE_LEAVES,
];

// --- Random CSpec generation ------------------------------------------

/** `","`/`"|"` -- always drawn as a distinct fixed separator from the
 * value alphabet, so `sepBy`/`sepBy1`'s separator can never accidentally
 * collide with `value`'s own FIRST set in a way that would make the
 * two indistinguishable regardless of implementation. */
const SEP_LEAVES: readonly CSpec[] = [
  { kind: "lit", value: "," },
  { kind: "lit", value: "|" },
];

const genCSpecInner = (rng: () => number, depth: number): CSpec => {
  if (depth <= 0) return pick(rng, ALL_LEAVES);
  const next = () => genCSpec(rng, depth - 1);
  const leaf = () => pick(rng, NONNULLABLE_LEAVES);
  switch (Math.floor(rng() * 22)) {
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
      return { kind: "star", expression: leaf() };
    case 6:
      return { kind: "plus", expression: leaf() };
    case 7:
      return { kind: "opt", expression: next() };
    case 8: {
      const min = Math.floor(rng() * 3);
      const max = min + Math.floor(rng() * 3);
      return { kind: "quant", expression: next(), min, max };
    }
    case 9: {
      // `max` OMITTED, not set to `undefined` -- `exactOptionalPropertyTypes`
      // distinguishes the two for an optional property.
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
      return {
        kind: "seq",
        elements: [leaf(), { kind: "cut", expression: next() }],
      };
    case 15:
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
    case 16:
      // `value` non-nullable by construction (`leaf()`, drawn from
      // `NONNULLABLE_LEAVES`) -- see the module doc comment on why
      // `sepBy`'s `(value (sep value)*)?` translation needs this.
      return { kind: "sepby", value: leaf(), sep: pick(rng, SEP_LEAVES) };
    case 17:
      return { kind: "sepby1", value: leaf(), sep: pick(rng, SEP_LEAVES) };
    case 18:
      return { kind: "between", open: next(), close: next() };
    case 19:
      return { kind: "takeuntil", cond: next() };
    case 20:
      // A cut inside a `between`'s content: exercises fatal propagation
      // OUT of `takeUntil`'s internal scan (which never itself sees a
      // cut, since it only calls `close`, not the scanned content) --
      // this specifically targets the outer `seq(open, ..., close)`
      // shape by embedding the cut in a SIBLING element instead.
      return {
        kind: "seq",
        elements: [
          { kind: "between", open: leaf(), close: leaf() },
          { kind: "cut", expression: next() },
        ],
      };
    default:
      return { kind: "cut", expression: next() };
  }
};

/** Wraps roughly one in eight generated nodes in `memo` -- distributes
 * `memoize` throughout the tree (leaves included) without needing a
 * dedicated switch case, since every recursive call passes back through
 * this function. */
const genCSpec = (rng: () => number, depth: number): CSpec => {
  const built = genCSpecInner(rng, depth);
  return rng() < 0.12 ? { kind: "memo", expression: built } : built;
};

// --- Building real parsers from a CSpec -------------------------------

const toCharClassArgs = (
  specs: readonly CharSpecItem[],
): NonEmptyArray<string | [string, string]> =>
  specs.map((s) => (typeof s === "string" ? s : [s[0], s[1]])) as NonEmptyArray<
    string | [string, string]
  >;

let predictiveChoiceFilterCount = 0;
let extraKindCount = 0;

const build = (c: CSpec, altMode: "choice" | "predictive"): Parser<unknown> => {
  switch (c.kind) {
    case "lit":
      return literal(c.value);
    case "any":
      return anyChar();
    case "cls":
      return c.negated
        ? negatedCharClass(...toCharClassArgs(c.specs))
        : charClass(...toCharClassArgs(c.specs));
    case "run":
      return charClassRun(toCharClassArgs(c.specs), c.min, c.negated);
    case "seq":
      return sequence(...c.elements.map((e) => build(e, altMode)));
    case "alt": {
      if (altMode === "choice") {
        return choice(...c.alternatives.map((a) => build(a, altMode)));
      }
      const entries = c.alternatives.map((alt) => {
        const parser = build(alt, altMode);
        const coreAlt = toCoreSpec(alt);
        const filter = canReachCutAtZero(coreAlt) ? null : firstSetOf(coreAlt);
        if (filter) predictiveChoiceFilterCount++;
        const prefix = literalPrefixFor(coreAlt);
        const safePrefix =
          prefix !== null &&
          filter !== null &&
          filter.ranges.length === 1 &&
          filter.ranges[0]?.lo === filter.ranges[0]?.hi &&
          filter.ranges[0]?.lo === prefix.codePointAt(0)
            ? prefix
            : null;
        return [parser, filter, safePrefix] as const;
      });
      return predictiveChoice(entries);
    }
    case "star":
      return zeroOrMore(build(c.expression, altMode));
    case "plus":
      return oneOrMore(build(c.expression, altMode));
    case "opt":
      return optional(build(c.expression, altMode));
    case "quant":
      return quantified(build(c.expression, altMode), c.min, c.max);
    case "and":
      return andPredicate(build(c.expression, altMode));
    case "not":
      return notPredicate(build(c.expression, altMode));
    case "cut":
      return commit(build(c.expression, altMode));
    case "default":
      return withDefault(build(c.expression, altMode), undefined);
    case "reject":
      return reject(build(c.expression, altMode));
    case "memo":
      extraKindCount++;
      return memoize(build(c.expression, altMode));
    case "topcut":
      extraKindCount++;
      return commitAtTopLevel(build(c.expression, altMode));
    case "sepby":
      extraKindCount++;
      return sepBy(build(c.value, altMode), build(c.sep, altMode));
    case "sepby1":
      extraKindCount++;
      return sepBy1(build(c.value, altMode), build(c.sep, altMode));
    case "between":
      extraKindCount++;
      return between(build(c.open, altMode), build(c.close, altMode));
    case "takeuntil":
      extraKindCount++;
      return takeUntil(build(c.cond, altMode));
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
  "a,a",
  "a,a,a",
  "a|a",
  ",",
  "a,",
  ",a",
  "xy",
  "xz",
  "c",
  IN_RANGE_EMOJI,
  OUT_OF_RANGE_EMOJI,
  `a${IN_RANGE_EMOJI}`,
  `${IN_RANGE_EMOJI},${IN_RANGE_EMOJI}`,
  emoji(EMOJI_LO),
  emoji(EMOJI_HI),
];

const ALPHABET = [
  "a",
  "b",
  "c",
  "x",
  "y",
  ",",
  "|",
  IN_RANGE_EMOJI,
  OUT_OF_RANGE_EMOJI,
];

const genInputs = (rng: () => number, count: number): string[] => {
  const out = [...FIXED_INPUTS];
  for (let i = 0; i < count; i++) {
    const len = Math.floor(rng() * 7);
    let s = "";
    for (let j = 0; j < len; j++) s += pick(rng, ALPHABET);
    out.push(s);
  }
  return out;
};

// --- Harness ---------------------------------------------------------------

// "FATAL" (distinct from ordinary "F") is a failure that's still fatal
// once it reaches the caller. Notably exercised here by `topcut` (see
// below): `commitAtTopLevel`'s whole point is to expose a fatal failure
// all the way to the top of the parse, so this is the one file among the
// oracle suites where a "FATAL" key is expected to be common, not rare.
const keySuccessOnly = (r: ReturnType<Parser<unknown>>): string =>
  r.success ? `S:${r.next}` : isFatalFailure(r) ? "FATAL" : "F";

// See `codegen-differential.spec.ts`'s identical `FUZZ_SCALE` comment:
// multiplies the seed count for a deep audit run, e.g.
// `TPEG_FUZZ_SCALE=30 bun test src/combinator-oracle.spec.ts`. A no-op at
// the default of 1.
const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const SEEDS = 400 * FUZZ_SCALE;

describe("combinator-package oracle: this package's own combinators vs. tpeg-core's reference-eval.ts", () => {
  it(
    `agrees with reference-eval across ${SEEDS} random specs x ~${FIXED_INPUTS.length + 12} inputs, for both choice-mode and predictiveChoice-mode builds`,
    () => {
      const diffs: string[] = [];
      let tested = 0;
      let skipped = 0;
      // Guards against the "FATAL" key silently never being produced --
      // see `packages/parser/src/codegen-differential.spec.ts`'s
      // identical `fatalKeyCount`. `topcut` (below) exists specifically
      // to expose this at the top of the parse, so this file's count
      // should be substantial, not just nonzero.
      let fatalKeyCount = 0;

      for (let seed = 1; seed <= SEEDS; seed++) {
        const rng = makeRng(seed);
        let root = genCSpec(rng, 4);
        // Every ~5th seed, additionally wrap with a top-level
        // `commitAtTopLevel` as the LAST element of the outermost sequence
        // -- the only placement `commitAtTopLevel`'s own soundness
        // restriction allows (see `./logic.ts`'s doc comment: no live
        // backtrack point may exist above it). Never generated as a nested
        // case inside `genCSpecInner` for exactly that reason.
        if (seed % 5 === 0) {
          root = {
            kind: "seq",
            elements: [root, { kind: "topcut", expression: genCSpec(rng, 1) }],
          };
        }

        let choiceParser: Parser<unknown>;
        let predictiveParser: Parser<unknown>;
        try {
          choiceParser = build(root, "choice");
          predictiveParser = build(root, "predictive");
        } catch {
          skipped++;
          continue;
        }

        tested++;
        const coreSpec = toCoreSpec(root);
        const inputRng = makeRng(seed * 7919 + 1);
        for (const input of genInputs(inputRng, 12)) {
          let oracleKey: string;
          try {
            const r = evalSpec(coreSpec, input, 0);
            oracleKey = r.ok ? `S:${r.next}` : r.fatal ? "FATAL" : "F";
            if (oracleKey === "FATAL") fatalKeyCount++;
          } catch (error) {
            if (!(error instanceof ReferenceEvalLimitError)) {
              diffs.push(
                `[reference-eval THREW] seed=${seed} input=${JSON.stringify(input)}\n  ${(error as Error).message}\n  spec=${JSON.stringify(root)}`,
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
                `[${label} THREW] seed=${seed} input=${JSON.stringify(input)}\n  ${(error as Error).message}\n  spec=${JSON.stringify(root)}`,
              );
              continue;
            }
            const key = keySuccessOnly(result);
            if (key !== oracleKey) {
              diffs.push(
                `[${label}] seed=${seed} input=${JSON.stringify(input)}\n  oracle=${oracleKey} ${label}=${key}\n  spec=${JSON.stringify(root)}`,
              );
            }
          }
        }
      }

      expect(tested).toBeGreaterThan(SEEDS / 2);
      expect(predictiveChoiceFilterCount).toBeGreaterThan(0);
      expect(fatalKeyCount).toBeGreaterThan(0);
      // Guards against this file's own extra node kinds silently never
      // being generated (a generator regression that would leave
      // `memoize`/`commitAtTopLevel`/`sepBy`/`sepBy1`/`between`/`takeUntil`
      // completely untested here while the test still reports green).
      expect(extraKindCount).toBeGreaterThan(0);

      if (diffs.length > 0) {
        const preview = diffs.slice(0, 10).join("\n\n");
        throw new Error(
          `${diffs.length} differential-fuzzing failure(s) out of ${tested} specs tested (${skipped} skipped). First ${Math.min(10, diffs.length)}:\n\n${preview}`,
        );
      }
      // Scaled by FUZZ_SCALE for the same reason as
      // `codegen-differential.spec.ts`'s test timeout.
    },
    10000 * FUZZ_SCALE,
  );
});
