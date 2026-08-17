/**
 * Differential fuzzing across every codegen/optimization variant, PLUS an
 * independent reference-interpreter oracle.
 *
 * For a large, deterministic sample of randomly-generated TPEG grammars,
 * every alternative code path must agree with plain
 * `generateTypeScriptParser` (the base generator, no optimizations) on
 * every test input:
 *
 * - `applyAstOptimizations` (left-factoring, character-class merging,
 *   negative-lookahead degeneration -- `ast-optimize.ts`)
 * - `mergeCharacterClasses` alone (isolates the one pass of the three
 *   above that never changes value shape -- see its own VariantSpec entry)
 * - `insertAutomaticCuts` / `promoteGlobalCuts` (cut insertion/promotion --
 *   `ast-optimize-cut-insertion.ts` / `ast-optimize-cut-promotion.ts`)
 * - `generateOptimizedTypeScriptParser` with predictive dispatch (default),
 *   with memoization, with regex fusion (`rule` and `subtree` scope), and
 *   with the full pipeline (every rewrite pass plus fusion) combined
 *
 * A rewrite that can change a rule's VALUE SHAPE without changing which
 * inputs it accepts (`applyAstOptimizations`'s left-factoring and
 * negative-lookahead degeneration, and any pipeline that includes them) is
 * compared on success/next only; every other variant -- including
 * `mergeCharacterClasses` alone -- is compared on success/next/val, since
 * it claims to be exactly shape-preserving.
 *
 * ## Why an independent oracle, not just base-vs-variants
 *
 * Comparing every optimized variant against the BASE generator is blind to
 * a bug shared by all of them: if `codegen.ts`'s own encoding of some PEG
 * construct were wrong, every variant would agree with it and this
 * comparison alone would report zero diffs. `reference-interpreter.ts` is a
 * separate implementation, written directly against the grammar AST with
 * no shared code path with any codegen module, so agreement between it and
 * the generated code is actual evidence the semantics are right. It only
 * checks recognition (success/next), never value -- see that module's doc
 * comment for why value shape is left to the base-vs-variants comparison.
 *
 * This is the harness that actually found the `predictiveChoice` x `Cut`
 * bug fixed alongside this file (`first-sets.ts`'s
 * `canCommitWithoutConsuming`, wired into `codegen-optimized.ts`'s
 * `tryGeneratePredictiveChoice`) -- kept here permanently as a much
 * broader net than any hand-picked example (see `cut-memoize.spec.ts` and
 * `packages/core/src/combinators.spec.ts` for the hand-picked regressions
 * this harness's failure was distilled into). Deterministic: a fixed
 * linear-congruential PRNG, not `Math.random()`, so any future failure is
 * reproducible from the printed grammar source and seed alone.
 */

import { describe, expect, test } from "bun:test";
import { type Parser, isFatalFailure, parse } from "@suzumiyaaoba/tpeg-core";
import {
  applyAstOptimizations,
  insertAutomaticCuts,
  mergeCharacterClasses,
  promoteGlobalCuts,
} from "./ast-optimize";
import { generateTypeScriptParser } from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { analyzeFirstSets } from "./first-sets";
import { grammarDefinition } from "./grammar";
import {
  ReferenceInterpreterLimitError,
  referenceRecognize,
} from "./reference-interpreter";
import type { GrammarDefinition } from "./types";

// --- Deterministic PRNG (linear congruential generator) -----------------

const makeRng = (seed: number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
};

const pick = <T>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)] as T;

// --- Random grammar generation --------------------------------------------

const LEAVES = [
  '"a"',
  '"b"',
  '"ab"',
  '"ba"',
  '"aa"',
  // 3+-character literals with a shared prefix -- exercises the
  // dispatch trie's beyond-FIRST_1 discrimination
  // (`packages/core/src/dispatch-trie.ts`), never reached by a purely
  // 1-2-character LEAVES set.
  '"abc"',
  '"abd"',
  "[a-b]",
  "[ab]",
  "[^a]",
  // Multi-range and negated multi-range classes -- distinct from the
  // single-range/single-negated-char forms above, exercising
  // `ast-optimize-char-class.ts`'s character-class-merging pass over more
  // than one range/member, plus the negated-multi-range codegen path,
  // neither reached by `[a-b]`/`[ab]`/`[^a]` alone.
  "[^a-b]",
  "[^ab]",
  "[a-bd-e]",
  "[^a-bd-e]",
  "[abc]",
  ".",
  // Non-ASCII / astral leaves -- exercises `codePointAt`-based decoding
  // (`anyChar`/`charClass`/`charClassRun` in `packages/core/src/
  // basic.ts`/`char-class.ts`) and the predictive-dispatch non-ASCII
  // fallback (`packages/core/src/combinators.ts`'s `predictiveChoice`).
  '"é"',
  '"ø"',
  '"😀"',
  // Non-ASCII character-class RANGES (`[à-ÿ]`-shaped, not just a single
  // non-ASCII string literal above) -- until `character-class.ts`'s
  // `charClassChar` grew a non-ASCII alternative, the .tpeg grammar TEXT
  // parser could only accept ASCII printable characters as a class
  // member, so this shape was structurally unreachable from any
  // grammar-TEXT fuzzer no matter the sample size; the equivalent astral
  // range was previously only exercised at the combinator layer
  // (`core/combinator-oracle.spec.ts`), never through the actual .tpeg
  // parse -> AST -> codegen pipeline this file drives.
  "[あ-ん]",
  "[^あ-ん]",
  "[a-zあ]",
  "[😀-🙏]",
] as const;

/** Generates one random Expression's SOURCE TEXT (not an AST -- fed back
 * through the real grammar parser, exactly like a human-authored .tpeg
 * file, so this exercises the full parse -> AST -> codegen pipeline, not
 * just codegen in isolation). `allowRuleRef` gates whether a reference to
 * `refs` may appear as a leaf, so a non-recursive rule's own body never
 * references itself. */
const genExpr = (
  rng: () => number,
  depth: number,
  allowRuleRef: boolean,
  refs: readonly string[],
): string => {
  const atom = () => pick(rng, allowRuleRef ? [...LEAVES, ...refs] : LEAVES);
  if (depth <= 0) return atom();
  const next = () => genExpr(rng, depth - 1, allowRuleRef, refs);
  switch (Math.floor(rng() * 29)) {
    case 0:
      return atom();
    case 1:
      return `(${next()} ${next()})`;
    case 2:
      return `(${next()} / ${next()})`;
    case 3:
      return `${atom()}*`;
    case 4:
      return `${atom()}+`;
    case 5:
      return `(${next()})?`;
    case 6:
      return `!${atom()} ${next()}`;
    case 7:
      return `&${atom()} ${next()}`;
    case 8:
      return `(${next()} / ${next()} / ${next()})`;
    case 9:
      return `${atom()}{1,3}`;
    case 10:
      return `${atom()}{2}`;
    case 11:
      // Three-element Sequence with a Cut, exercising cut-scoping past
      // the immediately-following element (`commit`'s doc comment,
      // `packages/core/src/combinators.ts`).
      return `(${next()} ~ ${next()} ${next()})`;
    case 12:
      // A labeled element -- exercises `capture` (`packages/core/src/
      // capture.ts`) alongside every rewrite pass; value shape is
      // unaffected by which VARIANT compiles it (only by whether the
      // grammar text has a label at all), so this composes safely with
      // the existing shapePreserving comparison.
      return `x:${atom()}`;
    case 13:
      // A trailing cut leaving exactly ONE non-Cut element behind --
      // every other cut-bearing case below has at least two remaining
      // elements, so this is the shape that slipped past every prior
      // audit round: dropping the `~` must leave the sequence's capture
      // "exactly as if `~` weren't there" (docs/peg-grammar.md's Capture
      // Structure Reference Table), which for a single survivor means a
      // BARE value, not a 1-tuple -- `codegen.ts`'s `generateSequence`
      // used to always wrap in `sequence(...)` regardless, disagreeing
      // with `codegen-optimized.ts` on every grammar shaped like this
      // (fixed alongside this comment).
      return `(${next()} ~)`;
    case 14:
      // Star over a CUT-bearing group, not just a bare atom (unlike case
      // 3) -- exercises `zeroOrMore` re-raising a fatal failure from a
      // committed sub-sequence rather than treating it as "stop
      // repeating" (`repetition.ts`'s doc comment, `packages/core/src/`).
      // The leading `atom()` guarantees the group is non-nullable
      // regardless of what `next()` draws, so this never trips
      // `assertNoNullableRepetition`.
      return `(${atom()} ~ ${next()})*`;
    case 15:
      // Same, but `oneOrMore` -- a fatal failure on the SECOND+ attempt
      // (not just the first) must also propagate.
      return `(${atom()} ~ ${next()})+`;
    case 16:
      // A Cut inside a NegativeLookahead's own probe: must commit only
      // WITHIN that probe's attempt, absorbed at the lookahead's own
      // boundary rather than escaping to whatever encloses `!(...)`
      // (`notPredicate`'s doc comment, `packages/core/src/lookahead.ts`).
      return `!(${next()} ~ ${next()}) ${next()}`;
    case 17:
      // Same for PositiveLookahead (`andPredicate`'s doc comment).
      return `&(${next()} ~ ${next()}) ${next()}`;
    case 18:
      // A bounded Quantified over a COMPOSITE (possibly-nullable)
      // expression -- unlike cases 9/10 (`atom(){1,3}`/`atom(){2}`,
      // always non-nullable), this exercises `quantified`'s explicit
      // carve-out: a bounded range has well-defined PEG semantics
      // regardless of whether the repeated expression is nullable, since
      // the `for` loop bounding it can never loop unboundedly either way
      // (`first-sets.ts`'s `assertNoNullableRepetition` doc comment).
      return `(${next()} / ${next()}){0,2}`;
    case 19:
      // An OPEN-ENDED Quantified (`{2,}`, no upper bound) over a
      // composite two-element sequence -- the leading `atom()` keeps it
      // non-nullable, so this is safe, but it's a shape cases 9/10/18
      // don't reach (no fixed upper bound, non-atomic body).
      return `(${atom()} ${next()}){2,}`;
    case 20:
      // Star over a plain (non-cut) group, not just an atom -- may
      // legitimately draw a nullable `next()` (e.g. one that itself
      // recursed into case 3's `atom()*` or case 5's `(...)?`), in which
      // case the harness's existing construction-time-rejection handling
      // (`assertNoNullableRepetition` firing, caught and counted as
      // skipped -- see the main test loop below) applies exactly like it
      // already does for a hand-written `("a"?)*`.
      return `(${next()} ${next()})*`;
    case 21:
      // A Cut as the FIRST element of a Sequence (zero preceding
      // elements) -- every existing cut-bearing case above (11/14/15/16/
      // 17) always has at least an `atom()` or lookahead ahead of the
      // `~`, so this is the only shape exercising that a cut still marks
      // every SUBSEQUENT element's failure fatal even with nothing before
      // it to have already matched.
      return `(~ ${next()} ${next()})`;
    case 22:
      // `optional` wrapping a group that ends in a committed
      // sub-sequence -- distinct from case 5's `(next())?` (never
      // contains a cut) and cases 14/15's `star`/`plus` (not `optional`):
      // exercises `optional`'s own fatal re-raise (`repetition.ts`'s doc
      // comment) rather than swallowing the cut's failure as "no match".
      return `(${next()} ~ ${next()})?`;
    case 23:
      // A labeled element wrapping a Cut-bearing group -- `capture`
      // alongside fatal-failure propagation through a `LabeledExpression`,
      // which `reference-interpreter.ts`'s own doc comment says is
      // "transparent" for recognition; this pins that codegen agrees.
      return `x:(${next()} ~ ${next()})`;
    case 24:
      // `{0,1}` -- the degenerate Quantified bound equivalent to `?`,
      // distinct from case 9's `{1,3}`/case 10's `{2}` (both force at
      // least one match) and case 18's `{0,2}` (wraps a composite, not a
      // bare atom).
      return `${atom()}{0,1}`;
    case 25:
      // A Cut-bearing group as one alternative of a Choice, directly at
      // the grammar-text level -- complements case 16/17's lookahead-
      // scoped absorption tests with `choice`'s own fatal-absorption
      // boundary (`commit`'s doc comment, `packages/core/src/
      // combinators.ts`): the committed alternative failing past its cut
      // must not fall through to the sibling.
      return `((${next()} ~ ${next()}) / ${next()})`;
    case 26:
      // Negative lookahead over a GROUP, not just a bare `atom()` (unlike
      // case 6) -- exercises `ast-optimize-negative-lookahead.ts`'s
      // degeneration pass over a composite probe.
      return `!(${next()}) ${next()}`;
    case 27:
      // A leading cut leaving exactly ONE non-Cut element behind --
      // case 21 already covers a leading cut with TWO elements after it;
      // this is the single-survivor counterpart to case 13 above, for
      // the same "as if `~` weren't there" reason.
      return `(~ ${next()})`;
    default:
      return `(${next()} ~ ${next()})`;
  }
};

/** One mutually-recursive rule's body: always `<prefix> (<ref>) <suffix> /
 * <base>` -- the prefix/suffix pair guarantees at least one character is
 * consumed before ever recursing, so this can never be left-recursive
 * (which neither the real runtime nor `reference-interpreter.ts` -- nor
 * indeed any of this project's codegen -- supports), regardless of which
 * rule `ref` names or how deep the mutual cycle goes. */
const genRecursiveRuleBody = (
  rng: () => number,
  refs: readonly string[],
): string => {
  const brackets = [
    ['"("', '")"'],
    ['"["', '"]"'],
    ['"<"', '">"'],
  ] as const;
  const [prefix, suffix] = pick(rng, brackets);
  const ref = pick(rng, refs);
  const base = pick(rng, LEAVES);
  return `${prefix} (${ref}) ${suffix} / ${base}`;
};

/** Renders `sub`'s optional `@memoize`/`@memoize: N` rule annotation --
 * exercises the automatic-memoization-adjacent EXPLICIT annotation path
 * (`codegen-optimized.ts`'s `findMemoizeAnnotation`/`wrapWithMemoize`),
 * distinct from `enableMemoization`'s reentrancy-driven automatic
 * decision (both are covered: the latter by the "optimized + memoization"
 * VARIANT below, applied to whichever rules `analyzeReentrancy` flags on
 * its own). */
const genMemoizeAnnotation = (rng: () => number): string => {
  switch (Math.floor(rng() * 3)) {
    case 0:
      return "";
    case 1:
      return "@memoize\n  ";
    default:
      return "@memoize: 4\n  ";
  }
};

const genGrammarSource = (rng: () => number): string => {
  const memoAnnotation = genMemoizeAnnotation(rng);
  return `grammar G {\n  start = ${genExpr(rng, 3, true, ["sub", "rec1"])}\n  sub = ${genExpr(rng, 2, false, [])}\n  ${memoAnnotation}rec1 = ${genRecursiveRuleBody(rng, ["rec1", "rec2"])}\n  rec2 = ${genRecursiveRuleBody(rng, ["rec1", "rec2"])}\n}`;
};

const TEST_INPUTS = [
  "",
  "a",
  "b",
  "ab",
  "aa",
  "ba",
  "abb",
  "aab",
  "abab",
  "bbb",
  "c",
  "ac",
  "abc",
  "abd",
  "aba",
  "bab",
  "abba",
  "aabb",
  "aaa",
  "baa",
  "é",
  "aé",
  "😀",
  "a😀b",
  "à",
  "(a)",
  "[a]",
  "<a>",
  "((a))",
  "([a])",
  "(<a>)",
  "(",
  "((((a",
];

/** Random strings appended to the fixed `TEST_INPUTS` list above, drawn
 * from a small alphabet covering every leaf/bracket character `LEAVES`/
 * `genRecursiveRuleBody` can produce, plus astral/non-ASCII characters --
 * a fixed hand-picked list alone repeatedly exercises the same handful of
 * (grammar, input) combinations across 600 random grammars; this widens
 * the input side too, at effectively zero extra runtime cost (still one
 * `new Function`-compiled parser call per input). Generated ONCE at module
 * load with its own fixed LCG seed (not `SEED` below, so changing the
 * grammar-generation seed doesn't also reshuffle inputs), so this list is
 * itself deterministic and reproducible across runs, exactly like every
 * other random sequence in this file. */
const RANDOM_TEST_INPUTS: readonly string[] = (() => {
  let state = 424242 >>> 0;
  const rng = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const alphabet = [
    "a",
    "b",
    "c",
    "d",
    "e",
    "(",
    ")",
    "[",
    "]",
    "<",
    ">",
    "é",
    "😀",
  ] as const;
  const inputs: string[] = [];
  for (let i = 0; i < 20; i++) {
    const len = Math.floor(rng() * 7);
    let s = "";
    for (let j = 0; j < len; j++) {
      s += alphabet[Math.floor(rng() * alphabet.length)];
    }
    inputs.push(s);
  }
  return inputs;
})();

const ALL_TEST_INPUTS: readonly string[] = [
  ...TEST_INPUTS,
  ...RANDOM_TEST_INPUTS,
];

// --- Harness ---------------------------------------------------------------

/** Compiles generated TypeScript source (no imports -- every variant here
 * is generated with `includeImports: false`) into a callable `start`
 * parser, given the already-loaded `tpeg-core`/`tpeg-combinator`
 * namespaces as the function's scope. Mirrors the `new Function(...)`
 * pattern `cut-memoize.spec.ts` uses for the same reason: these are
 * genuinely generated modules, not hand-written parsers, so there's no
 * static import target to bind them to.
 *
 * `combinator` is spread FIRST, `core` SECOND (core wins on any shared
 * name) -- this mirrors exactly how generated code actually imports the
 * two packages: leaf/composition parsers (`literal`, `choice`,
 * `sequence`, `charClassRun`, `predictiveChoice`, ...) always come from
 * `@suzumiyaaoba/tpeg-core`, while only `memoize`/`commitAtTopLevel` come
 * from `@suzumiyaaoba/tpeg-combinator` (see `codegen.ts`'s import
 * generation). The previous `{ ...core, ...combinator }` ordering let
 * `tpeg-combinator`'s re-exported copies of core names silently shadow
 * the real ones -- harmless while both packages shared one `tpeg-core`
 * instance, but exactly the wrong composition to have caught the
 * duplicate-bundling bug fixed alongside this file (see
 * `packages/combinator/src/dist-instance.spec.ts`), since that shadowing
 * masked which package's copy of `FAIL`/the watermark a generated
 * parser's calls actually reached. */
const compileStart = (
  code: string,
  core: Record<string, unknown>,
  combinator: Record<string, unknown>,
): Parser<unknown> => {
  const body = code.replace(/^export const (\w+)/gm, "const $1");
  const scope = { ...combinator, ...core };
  const factory = new Function(
    ...Object.keys(scope),
    `${body}\nreturn { start };`,
  );
  return (factory(...Object.values(scope)) as { start: Parser<unknown> }).start;
};

type ResultKey = string;

// "FATAL" is a failure that's still fatal once it reaches the caller --
// i.e. nothing between here and the top (`choice`/`predictiveChoice`/
// `andPredicate`/`notPredicate`) absorbed the cut first. Previously both
// keys collapsed this into the same "F" as an ordinary failure, so a
// cut-propagation bug that gets recognition right but fatality wrong
// (e.g. a fatal failure escaping a boundary that should have absorbed
// it, or one that got absorbed too early) produced zero diffs. Pinned
// against `reference-interpreter.ts`'s and `combinators.ts`'s own
// absorption rules by hand first (see the commit introducing this) before
// being turned on here.
const keySuccessOnly = (r: ReturnType<Parser<unknown>>): ResultKey =>
  r.success ? `S:${r.next}` : isFatalFailure(r) ? "FATAL" : "F";
const keyWithValue = (r: ReturnType<Parser<unknown>>): ResultKey =>
  r.success
    ? `S:${r.next}:${JSON.stringify(r.val)}`
    : isFatalFailure(r)
      ? "FATAL"
      : "F";

interface VariantSpec {
  readonly name: string;
  /** `false` for a rewrite that can legitimately change value shape --
   * compared on success/next only. */
  readonly shapePreserving: boolean;
  readonly build: (grammar: GrammarDefinition) => string;
}

const VARIANTS: readonly VariantSpec[] = [
  {
    name: "applyAstOptimizations",
    shapePreserving: false,
    build: (g) =>
      generateTypeScriptParser(applyAstOptimizations(g), {
        includeImports: false,
        includeTypes: false,
      }).code,
  },
  {
    // Isolates `applyAstOptimizations`'s three passes down to just
    // `mergeCharacterClasses`, which -- unlike its two siblings
    // (`degenerateNegativeLookaheads` can collapse a 2-element sequence
    // to 1, changing its capture shape; `leftFactorChoices` documents its
    // own `[P,X1,X2] -> [P,[X1,X2]]` reshaping) -- never changes value
    // shape at all: a matching `CharacterClass` always returns the one
    // matched character, whichever alternative of the original `Choice`
    // it came from (see `ast-optimize-char-class.ts`'s module doc
    // comment). Compared on value, unlike the combined
    // `applyAstOptimizations` variant above.
    name: "mergeCharacterClasses",
    shapePreserving: true,
    build: (g) =>
      generateTypeScriptParser(mergeCharacterClasses(g), {
        includeImports: false,
        includeTypes: false,
      }).code,
  },
  {
    name: "insertAutomaticCuts",
    shapePreserving: true,
    build: (g) =>
      generateTypeScriptParser(insertAutomaticCuts(g), {
        includeImports: false,
        includeTypes: false,
      }).code,
  },
  {
    name: "promoteGlobalCuts",
    shapePreserving: true,
    build: (g) =>
      generateTypeScriptParser(
        promoteGlobalCuts(g, analyzeFirstSets(g)).grammar,
        { includeImports: false, includeTypes: false },
      ).code,
  },
  {
    name: "optimized (predictive dispatch, default)",
    shapePreserving: true,
    build: (g) =>
      generateOptimizedTypeScriptParser(g, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
      }).code,
  },
  {
    name: "optimized + memoization",
    shapePreserving: true,
    build: (g) =>
      generateOptimizedTypeScriptParser(g, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
        enableMemoization: true,
      }).code,
  },
  {
    name: "optimized + regex fusion (rule scope)",
    shapePreserving: true,
    build: (g) =>
      generateOptimizedTypeScriptParser(g, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
        enableRegexFusion: true,
      }).code,
  },
  {
    name: "optimized + regex fusion (subtree scope)",
    shapePreserving: true,
    build: (g) =>
      generateOptimizedTypeScriptParser(g, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
        enableRegexFusion: true,
        regexFusionScope: "subtree",
      }).code,
  },
  {
    name: "full pipeline (ast-optimize + auto-cut + promote-cuts + optimized + memoization + subtree fusion)",
    shapePreserving: false, // includes applyAstOptimizations
    build: (g) => {
      const astOptimized = applyAstOptimizations(g);
      const cutInserted = insertAutomaticCuts(astOptimized);
      const promoted = promoteGlobalCuts(
        cutInserted,
        analyzeFirstSets(cutInserted),
      ).grammar;
      return generateOptimizedTypeScriptParser(promoted, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
        enableMemoization: true,
        enableRegexFusion: true,
        regexFusionScope: "subtree",
      }).code;
    },
  },
];

// Sample size chosen to keep this fast (a second or so) while still
// covering every operator combination many times over -- see the module
// doc comment for how this harness was actually used (ad hoc, with a
// larger sample) to find the bug this file's sibling tests now pin
// individually. Grammars that fail to parse (a syntactically-impossible
// random combination) or that a variant now correctly REJECTS at
// generation time (`assertNoNullableRepetition`, `first-sets.ts`) are
// skipped rather than counted as failures -- but `testedCount` is
// asserted to stay well above zero so a systemic regression in grammar
// generation/parsing can't silently shrink coverage to nothing while this
// test still reports green.
// Multiplies the sample size below when the fuzzer needs to run far
// beyond its CI-friendly default -- e.g. the negative-lookahead bug fixed
// in 9d2e9c3 only reproduced at 20000 random grammars, well past what
// this file runs on every `bun test`. Usage:
// `TPEG_FUZZ_SCALE=30 bun test src/codegen-differential.spec.ts`. Left at
// 1 (a no-op) for ordinary CI/local runs.
const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const SAMPLE_SIZE = 600 * FUZZ_SCALE;
const SEED = 20260809; // today's date at authorship time -- arbitrary but fixed

describe("codegen differential fuzzing (base generator vs. every optimization variant, plus a reference-interpreter oracle)", () => {
  test(
    `agrees with the base generator (and the oracle) across ${SAMPLE_SIZE} random grammars x ${ALL_TEST_INPUTS.length} inputs, for every variant`,
    async () => {
      const core = (await import(
        "@suzumiyaaoba/tpeg-core"
      )) as unknown as Record<string, unknown>;
      const combinator = (await import(
        "@suzumiyaaoba/tpeg-combinator"
      )) as unknown as Record<string, unknown>;

      const rng = makeRng(SEED);
      const diffs: string[] = [];
      let testedCount = 0;
      let skippedCount = 0;
      // Guards against the "FATAL" key (see `keySuccessOnly`'s comment)
      // silently never being produced by any generated grammar/input pair
      // -- if it never fires, the 3-value key degenerates back to the old
      // 2-value one and this file would report zero diffs whether or not
      // fatal propagation actually agrees, without anyone noticing.
      let fatalKeyCount = 0;

      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const source = genGrammarSource(rng);
        const parsed = parse(grammarDefinition)(source);
        if (!parsed.success) {
          skippedCount++;
          continue;
        }

        let base: Parser<unknown>;
        let oracle: ((input: string) => string) | null;
        const variantParsers: [VariantSpec, Parser<unknown>][] = [];
        try {
          base = compileStart(
            generateTypeScriptParser(parsed.val, {
              includeImports: false,
              includeTypes: false,
            }).code,
            core,
            combinator,
          );
          for (const variant of VARIANTS) {
            variantParsers.push([
              variant,
              compileStart(variant.build(parsed.val), core, combinator),
            ]);
          }
          // Built once per grammar, tried against every input below -- a
          // grammar the oracle can't handle at all (an unsupported node, or
          // no `start` rule) is a construction-time concern handled by the
          // same try/catch as the codegen variants above; a PER-INPUT limit
          // (recursion depth, zero-width repetition -- expected for a
          // pathological random input against a recursive grammar) is
          // handled per-input below instead, so one bad input doesn't skip
          // the oracle for every other input against the same grammar.
          oracle = referenceRecognize(parsed.val);
        } catch {
          // A construction-time rejection (e.g. `assertNoNullableRepetition`
          // firing on a randomly-generated nullable repetition) or a
          // `new Function` compile error -- not a differential-fuzzing
          // concern, since the base generator would have hit the same
          // rejection for the same grammar.
          skippedCount++;
          continue;
        }

        testedCount++;
        for (const input of ALL_TEST_INPUTS) {
          let baseResult: ReturnType<Parser<unknown>>;
          try {
            baseResult = base(input, 0);
          } catch {
            continue;
          }
          const baseKeySuccessOnly = keySuccessOnly(baseResult);
          if (baseKeySuccessOnly === "FATAL") fatalKeyCount++;

          try {
            const oracleKey = oracle(input);
            if (oracleKey !== baseKeySuccessOnly) {
              diffs.push(
                `[reference-interpreter] DIFF on ${JSON.stringify(input)} for grammar:\n${source}\n  base=${baseKeySuccessOnly}  oracle=${oracleKey}`,
              );
            }
          } catch (error) {
            if (!(error instanceof ReferenceInterpreterLimitError)) {
              diffs.push(
                `[reference-interpreter] THREW unexpectedly on ${JSON.stringify(input)} for grammar:\n${source}\n  ${(error as Error).message}`,
              );
            }
            // A `ReferenceInterpreterLimitError` (zero-width repetition, or
            // recursion depth exceeded) is out of scope for this input --
            // see that class's doc comment -- so it's silently skipped,
            // exactly like a construction-time rejection is skipped above.
          }

          for (const [variant, parser] of variantParsers) {
            let result: ReturnType<Parser<unknown>>;
            try {
              result = parser(input, 0);
            } catch (error) {
              diffs.push(
                `[${variant.name}] THREW at runtime on ${JSON.stringify(input)} for grammar:\n${source}\n  ${(error as Error).message}`,
              );
              continue;
            }
            const key = variant.shapePreserving ? keyWithValue : keySuccessOnly;
            const baseKey = key(baseResult);
            const variantKey = key(result);
            if (baseKey !== variantKey) {
              diffs.push(
                `[${variant.name}] DIFF on ${JSON.stringify(input)} for grammar:\n${source}\n  base=${baseKey}  variant=${variantKey}`,
              );
            }
          }
        }
      }

      // A meaningful sample actually ran -- guards against this test
      // silently testing nothing if grammar generation/parsing regresses.
      expect(testedCount).toBeGreaterThan(SAMPLE_SIZE / 2);
      // See `fatalKeyCount`'s declaration above.
      expect(fatalKeyCount).toBeGreaterThan(0);

      if (diffs.length > 0) {
        const preview = diffs.slice(0, 10).join("\n\n");
        throw new Error(
          `${diffs.length} differential-fuzzing failure(s) out of ${testedCount} grammars tested (${skippedCount} skipped -- parse failure or a correct construction-time rejection). First ${Math.min(10, diffs.length)}:\n\n${preview}`,
        );
      }
      // ${SAMPLE_SIZE} grammars x ${ALL_TEST_INPUTS.length} inputs x 9
      // (base + variants + oracle) takes ~9-10s on a typical dev machine at
      // FUZZ_SCALE=1 -- well past bun's 5000ms default test timeout, which
      // made this test fail intermittently in CI with no actual diff (just
      // "timed out after 5000ms"), indistinguishable at a glance from a
      // real regression. 60s leaves comfortable headroom without masking a
      // genuine hang; scaled by FUZZ_SCALE so a deliberately large
      // `TPEG_FUZZ_SCALE` run (see its own comment above) gets a
      // proportionally longer budget instead of always timing out.
    },
    60000 * FUZZ_SCALE,
  );
});
