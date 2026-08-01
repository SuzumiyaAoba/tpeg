#!/usr/bin/env bun
/**
 * Parse-throughput benchmark entrypoint.
 *
 * Run with `bun run bench` from `packages/parser/`, or `bun run
 * bench:parser` from the repo root (see `package.json`). Deliberately
 * named `run.ts` (not `*.spec.ts`/`*.test.ts`) and lives outside `src/`,
 * so `bun test`'s recursive scan never picks it up -- this is meant to be
 * read and diffed by a human across commits, not asserted on in CI (see
 * plan Phase 1.5 on why wall-clock assertions in CI are a separate,
 * risk-flagged concern).
 *
 * For an accurate heap-delta reading, run with `bun --expose-gc
 * run.ts` (the `bench` script already does this); without it,
 * `formatResult` reports heap delta as unavailable rather than a noisy
 * number. Even with `--expose-gc`, read the caveat on
 * `ParseThroughputResult.heapDeltaBytes` before drawing conclusions from
 * it -- it is not an allocation-volume measurement.
 */

import {
  DEFAULT_PATHOLOGICAL_DEPTH,
  generateJsonCorpus,
  generateMultiplicationChain,
  generateNestedParens,
  generateVariedInputs,
} from "./corpus";
import {
  BENCH_JSON_GRAMMAR,
  BENCH_JSON_ROOT_RULE,
  BENCH_UNFACTORED_ARITHMETIC_GRAMMAR,
  BENCH_UNFACTORED_ARITHMETIC_ROOT_RULE,
} from "./grammars";
import type { CompileRuleOptions } from "./harness";
import { compileRule, formatResult, runParseThroughput } from "./harness";

const WARMUP_COUNT = 10;

/**
 * Three configurations, not two: separating "optimized AST (1-element
 * seq/choice flattening), no memoization" from "optimized AST +
 * memoization" isolates memoization's own contribution to a benchmark
 * delta from the rest of what `optimize: true` changes. Without the
 * middle arm, a delta between `standard` and `optimize+memoize` can't be
 * attributed to either cause on its own.
 */
const CONFIGS: { label: string; options: CompileRuleOptions }[] = [
  { label: "standard codegen", options: { optimize: false } },
  {
    label: "optimized codegen, memoization off",
    options: { optimize: true, enableMemoization: false },
  },
  {
    label: "optimized codegen, memoization on",
    options: { optimize: true, enableMemoization: true },
  },
];

/**
 * Only meaningful for `BENCH_JSON_GRAMMAR`'s `value` rule, a 7-way
 * FIRST-disjoint `Choice` (object/array/string/number/true/false/null all
 * start with a different character) -- exactly the shape
 * `enablePredictiveDispatch` targets (Phase 3's FIRST-set dispatch, see
 * `packages/parser/src/first-sets.ts` and
 * `codegen-optimized.ts`'s `tryGeneratePredictiveChoice`). This is also
 * the one workload in this file where plain memoization *hurts*
 * (0% cache hit rate -- see the plan's Phase 1 results), so it's the
 * natural place to check whether predictive dispatch helps where
 * memoization can't.
 */
const JSON_CONFIGS: { label: string; options: CompileRuleOptions }[] = [
  ...CONFIGS,
  {
    label: "optimized codegen, predictive dispatch on, memoization off",
    options: {
      optimize: true,
      enableMemoization: false,
      enablePredictiveDispatch: true,
    },
  },
  {
    label: "optimized codegen, predictive dispatch on, memoization on",
    options: {
      optimize: true,
      enableMemoization: true,
      enablePredictiveDispatch: true,
    },
  },
];

/**
 * Only meaningful for `BENCH_UNFACTORED_ARITHMETIC_GRAMMAR`, whose choices
 * have a uniform single-element prefix (`leftFactorChoices` no-ops on
 * `BENCH_JSON_GRAMMAR`'s choices, which don't). Left factoring and
 * memoization attack the same redundant-reparsing cost from different
 * angles -- eliminating it vs. caching it -- so both are included
 * standalone and combined to see whether they're additive.
 */
const ARITHMETIC_CONFIGS: { label: string; options: CompileRuleOptions }[] = [
  ...CONFIGS,
  {
    label: "left-factored, no memoization",
    options: { optimize: false, leftFactor: true },
  },
  {
    label: "left-factored + memoization",
    options: { optimize: true, enableMemoization: true, leftFactor: true },
  },
];

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

/**
 * Builds two disjoint sets of varied inputs from the same `generate`
 * function: `warmupInputs` seeded from a range that never overlaps with
 * `timedInputs`'s seeds, so priming the parser during warmup can't also
 * prime the memoizing parser's cache for the strings about to be timed
 * (see `runParseThroughput`'s docstring).
 */
function buildInputSets(
  timedCount: number,
  warmupCount: number,
  generate: (seed: number) => string,
): { timedInputs: string[]; warmupInputs: string[] } {
  const timedInputs = generateVariedInputs(timedCount, generate);
  const warmupInputs = generateVariedInputs(warmupCount, (seed) =>
    generate(timedCount + seed),
  );
  return { timedInputs, warmupInputs };
}

function runSection(
  title: string,
  grammarSrc: string,
  ruleName: string,
  timedInputs: string[],
  warmupInputs: string[],
  configs: { label: string; options: CompileRuleOptions }[] = CONFIGS,
): void {
  section(title);
  for (const { label, options } of configs) {
    const compiled = compileRule(grammarSrc, ruleName, options);
    const result = runParseThroughput(label, compiled, timedInputs, {
      warmupInputs,
    });
    console.log(formatResult(result));
  }
}

function run(): void {
  {
    const { timedInputs, warmupInputs } = buildInputSets(
      200,
      WARMUP_COUNT,
      (seed) => generateJsonCorpus(50_000, seed * 1_000),
    );
    runSection(
      "JSON grammar (mostly-linear cost)",
      BENCH_JSON_GRAMMAR,
      BENCH_JSON_ROOT_RULE,
      timedInputs,
      warmupInputs,
      JSON_CONFIGS,
    );
  }

  {
    const { timedInputs, warmupInputs } = buildInputSets(
      200,
      WARMUP_COUNT,
      (seed) => generateMultiplicationChain(2_000, seed * 10_000 + 1),
    );
    runSection(
      "Unfactored arithmetic grammar, multiplication chain (linear backtracking)",
      BENCH_UNFACTORED_ARITHMETIC_GRAMMAR,
      BENCH_UNFACTORED_ARITHMETIC_ROOT_RULE,
      timedInputs,
      warmupInputs,
      ARITHMETIC_CONFIGS,
    );
  }

  {
    // Small counts: at this depth a single parse is already ~100-300ms
    // (see corpus.ts for measured timings), so 200 iterations here would
    // take minutes. Warmup is capped even smaller for the same reason.
    const { timedInputs, warmupInputs } = buildInputSets(5, 2, (seed) =>
      generateNestedParens(DEFAULT_PATHOLOGICAL_DEPTH, String(seed % 10)),
    );
    runSection(
      `Unfactored arithmetic grammar, nested parens depth=${DEFAULT_PATHOLOGICAL_DEPTH} (exponential backtracking -- see corpus.ts, do not raise depth casually)`,
      BENCH_UNFACTORED_ARITHMETIC_GRAMMAR,
      BENCH_UNFACTORED_ARITHMETIC_ROOT_RULE,
      timedInputs,
      warmupInputs,
      ARITHMETIC_CONFIGS,
    );
  }

  console.log(
    "\nNote: 'optimized codegen, memoization off' isolates the AST-shape " +
      "change (1-element seq/choice flattening) that optimize:true makes " +
      "besides inserting memoize(); compare it against 'standard codegen' " +
      "for that effect alone, and against 'memoization on' for " +
      "memoization's own effect.",
  );
}

run();
