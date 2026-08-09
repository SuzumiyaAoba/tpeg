/**
 * Differential fuzzing across every codegen/optimization variant.
 *
 * For a large, deterministic sample of randomly-generated TPEG grammars,
 * every alternative code path must agree with plain
 * `generateTypeScriptParser` (the base generator, no optimizations) on
 * every test input:
 *
 * - `applyAstOptimizations` (left-factoring, character-class merging,
 *   negative-lookahead degeneration -- `ast-optimize.ts`)
 * - `insertAutomaticCuts` / `promoteGlobalCuts` (cut insertion/promotion --
 *   `ast-optimize-cut-insertion.ts` / `ast-optimize-cut-promotion.ts`)
 * - `generateOptimizedTypeScriptParser` with predictive dispatch (default),
 *   with regex fusion (`rule` and `subtree` scope), and with the full
 *   pipeline (every rewrite pass plus fusion) combined
 *
 * A rewrite that can change a rule's VALUE SHAPE without changing which
 * inputs it accepts (`applyAstOptimizations`'s left-factoring, and any
 * pipeline that includes it) is compared on success/next only; every other
 * variant is compared on success/next/val, since it claims to be exactly
 * shape-preserving.
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
import { type Parser, parse } from "@suzumiyaaoba/tpeg-core";
import {
  applyAstOptimizations,
  insertAutomaticCuts,
  promoteGlobalCuts,
} from "./ast-optimize";
import { generateTypeScriptParser } from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { analyzeFirstSets } from "./first-sets";
import { grammarDefinition } from "./grammar";
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
  "[a-b]",
  "[ab]",
  "[^a]",
  ".",
] as const;

/** Generates one random Expression's SOURCE TEXT (not an AST -- fed back
 * through the real grammar parser, exactly like a human-authored .tpeg
 * file, so this exercises the full parse -> AST -> codegen pipeline, not
 * just codegen in isolation). `allowRuleRef` gates whether `sub` may
 * appear as a leaf, so `sub`'s own body never references itself. */
const genExpr = (
  rng: () => number,
  depth: number,
  allowRuleRef: boolean,
): string => {
  const atom = () => pick(rng, allowRuleRef ? [...LEAVES, "sub"] : LEAVES);
  if (depth <= 0) return atom();
  const next = () => genExpr(rng, depth - 1, allowRuleRef);
  switch (Math.floor(rng() * 11)) {
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
    default:
      return `(${next()} ~ ${next()})`;
  }
};

const genGrammarSource = (rng: () => number): string =>
  `grammar G {\n  start = ${genExpr(rng, 3, true)}\n  sub = ${genExpr(rng, 2, false)}\n}`;

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
  "aba",
  "bab",
  "abba",
  "aabb",
  "aaa",
  "baa",
];

// --- Harness ---------------------------------------------------------------

/** Compiles generated TypeScript source (no imports -- every variant here
 * is generated with `includeImports: false`) into a callable `start`
 * parser, given the already-loaded `tpeg-core`/`tpeg-combinator`
 * namespaces as the function's scope. Mirrors the `new Function(...)`
 * pattern `cut-memoize.spec.ts` uses for the same reason: these are
 * genuinely generated modules, not hand-written parsers, so there's no
 * static import target to bind them to. */
const compileStart = (
  code: string,
  core: Record<string, unknown>,
  combinator: Record<string, unknown>,
): Parser<unknown> => {
  const body = code.replace(/^export const (\w+)/gm, "const $1");
  const scope = { ...core, ...combinator };
  const factory = new Function(
    ...Object.keys(scope),
    `${body}\nreturn { start };`,
  );
  return (factory(...Object.values(scope)) as { start: Parser<unknown> }).start;
};

type ResultKey = string;

const keySuccessOnly = (r: ReturnType<Parser<unknown>>): ResultKey =>
  r.success ? `S:${r.next}` : "F";
const keyWithValue = (r: ReturnType<Parser<unknown>>): ResultKey =>
  r.success ? `S:${r.next}:${JSON.stringify(r.val)}` : "F";

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
    name: "full pipeline (ast-optimize + auto-cut + promote-cuts + optimized + subtree fusion)",
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
        enableRegexFusion: true,
        regexFusionScope: "subtree",
      }).code;
    },
  },
];

// Sample size chosen to keep this fast (a few hundred ms) while still
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
const SAMPLE_SIZE = 600;
const SEED = 20260809; // today's date at authorship time -- arbitrary but fixed

describe("codegen differential fuzzing (base generator vs. every optimization variant)", () => {
  test(`agrees with the base generator across ${SAMPLE_SIZE} random grammars x ${TEST_INPUTS.length} inputs, for every variant`, async () => {
    const core = (await import("@suzumiyaaoba/tpeg-core")) as unknown as Record<
      string,
      unknown
    >;
    const combinator = (await import(
      "@suzumiyaaoba/tpeg-combinator"
    )) as unknown as Record<string, unknown>;

    const rng = makeRng(SEED);
    const diffs: string[] = [];
    let testedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const source = genGrammarSource(rng);
      const parsed = parse(grammarDefinition)(source);
      if (!parsed.success) {
        skippedCount++;
        continue;
      }

      let base: Parser<unknown>;
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
      for (const input of TEST_INPUTS) {
        let baseResult: ReturnType<Parser<unknown>>;
        try {
          baseResult = base(input, 0);
        } catch {
          continue;
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

    if (diffs.length > 0) {
      const preview = diffs.slice(0, 10).join("\n\n");
      throw new Error(
        `${diffs.length} differential-fuzzing failure(s) out of ${testedCount} grammars tested (${skippedCount} skipped -- parse failure or a correct construction-time rejection). First ${Math.min(10, diffs.length)}:\n\n${preview}`,
      );
    }
  });
});
