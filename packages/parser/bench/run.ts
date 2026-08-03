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
  generateChainInput,
  generateConfigCorpus,
  generateJsonCorpus,
  generateKeywordCorpus,
  generateMultiplicationChain,
  generateNestedParens,
  generateVariedInputs,
} from "./corpus";
import {
  BENCH_ACYCLIC_CHAIN_GRAMMAR,
  BENCH_ACYCLIC_CHAIN_ROOT_RULE,
  BENCH_CUTTABLE_CONFIG_GRAMMAR,
  BENCH_CUTTABLE_CONFIG_ROOT_RULE,
  BENCH_JSON_GRAMMAR,
  BENCH_JSON_ROOT_RULE,
  BENCH_KEYWORD_GRAMMAR,
  BENCH_KEYWORD_ROOT_RULE,
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
  {
    // Pillar 4b: `string`/`number`/`boolean`/`nullLiteral` (everything
    // but `value`/`object`/`pair`/`array`, which reference other rules)
    // compile to a single `regexFused(...)` call each instead of a
    // combinator tree -- see `packages/parser/src/regex-fusion.ts`. The
    // Pillar 4a gate measurement (see the perf plan) found ~82% of leaf
    // invocations on this grammar belong to exactly these rules, with a
    // ~6.65x collapse factor (leaf invocations per rule entry) -- this
    // arm measures how much of that survives shape reconstruction
    // (`Array.from` for repetitions, tuple/marker literals for
    // Sequence/Choice/Optional) against the predictive-dispatch-only
    // baseline above.
    label:
      "optimized codegen, predictive dispatch on, regex fusion on, memoization on",
    options: {
      optimize: true,
      enableMemoization: true,
      enablePredictiveDispatch: true,
      enableRegexFusion: true,
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
  {
    // Pillar 4b: only `number = [0-9]+` is non-terminal-free in this
    // grammar (`expr`/`sum`/`product`/`atom` all reference other rules)
    // -- the Pillar 4a gate measurement found it accounts for ~87% of
    // this grammar's leaf invocations on the multiplication-chain
    // corpus, with a ~6.77x collapse factor.
    label: "left-factored + memoization + regex fusion",
    options: {
      optimize: true,
      enableMemoization: true,
      leftFactor: true,
      enableRegexFusion: true,
    },
  },
];

/**
 * Phase 0 gate for Pillar 7 (FOLLOW-set-proven cut promotion to
 * `commitAtTopLevel`): `insertAutomaticCuts` inserts 3 `Cut` AST nodes
 * into `BENCH_CUTTABLE_CONFIG_GRAMMAR`'s `entry` rule (see `grammars.ts`),
 * but today those all compile to plain `commit(...)` -- F1 in the perf
 * plan found `commitAtTopLevel` is gated on `isStartRuleTopLevel`, which
 * `insertAutomaticCuts` (a `Choice`-alternative rewrite) never sets. This
 * arm exists so a later pillar's promotion pass has something to show a
 * delta against: today, cut-with-memoization should behave like plain
 * memoization (no `commitAtTopLevel` is emitted yet), which is itself the
 * baseline this arm is here to record.
 */
const CUTTABLE_CONFIGS: { label: string; options: CompileRuleOptions }[] = [
  ...CONFIGS,
  {
    label: "optimized codegen, memoization on, auto-cut on",
    options: { optimize: true, enableMemoization: true, autoCut: true },
  },
  {
    label:
      "optimized codegen, memoization on, auto-cut on, predictive dispatch on",
    options: {
      optimize: true,
      enableMemoization: true,
      autoCut: true,
      enablePredictiveDispatch: true,
    },
  },
];

/**
 * Phase 0 baseline for Pillar 8 (literal-trie dispatch, extending
 * `predictiveChoice` past a single character): unlike every other bench
 * grammar, `BENCH_KEYWORD_GRAMMAR`'s `stmt` choice has multiple
 * alternatives sharing a first character (`if`/`import`/`interface`/
 * `instanceof` all start with `i`), the shape `predictiveChoice`'s
 * FIRST_1 dispatch degenerates on. The "predictive dispatch on" arm here
 * is the number a future trie-dispatch pillar must beat -- `leaf
 * invocations/parse` should stay high on this arm despite predictive
 * dispatch being enabled, in contrast to `BENCH_JSON_GRAMMAR`'s 7-way
 * disjoint-first-character choice where the same flag collapses it
 * sharply.
 */
const KEYWORD_CONFIGS: { label: string; options: CompileRuleOptions }[] = [
  ...CONFIGS,
  {
    label: "optimized codegen, predictive dispatch on, memoization off",
    options: {
      optimize: true,
      enableMemoization: false,
      enablePredictiveDispatch: true,
    },
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

  {
    // `generateChainInput` always returns a single digit -- this
    // grammar's cost comes entirely from its unfactored-choice *shape*,
    // not input length, so there is nothing to scale up here.
    const { timedInputs, warmupInputs } = buildInputSets(
      200,
      WARMUP_COUNT,
      generateChainInput,
    );
    section(
      "Acyclic chain grammar (10 unfactored levels, none recursive -- " +
        "see grammars.ts: demonstrates that hasRecursion/nodeCount was " +
        "the wrong memoization trigger)",
    );
    for (const { label, options } of CONFIGS) {
      const compiled = compileRule(
        BENCH_ACYCLIC_CHAIN_GRAMMAR,
        BENCH_ACYCLIC_CHAIN_ROOT_RULE,
        options,
      );
      const result = runParseThroughput(label, compiled, timedInputs, {
        warmupInputs,
      });
      console.log(formatResult(result));
    }
    console.log(
      "  'optimized codegen, memoization on' should show leaf " +
        "invocations/parse collapse from ~59000 (~3^9, standard/memo-off) " +
        "to ~20 and ops/sec jump ~1000x: `codegen-optimized.ts` now " +
        "decides memoization via `reentrancy.ts`'s analysis (which of " +
        "rules a1..a9 -- shared by every alternative of their caller's " +
        "3-way Choice -- can actually be re-invoked at an offset already " +
        "parsed) instead of the old hasRecursion/complexity proxy, which " +
        "flagged none of this grammar's 10 rules despite none being " +
        "recursive or individually complex. See " +
        "`packages/parser/src/reentrancy.ts` and its spec for the " +
        "algorithm and its acceptance-test predictions.",
    );
  }

  {
    const { timedInputs, warmupInputs } = buildInputSets(
      200,
      WARMUP_COUNT,
      (seed) => generateConfigCorpus(50_000, seed * 1_000),
    );
    runSection(
      "Cuttable config grammar (Pillar 7 target -- see grammars.ts: " +
        "3 Cut AST nodes inserted by --auto-cut, none yet promoted to " +
        "commitAtTopLevel)",
      BENCH_CUTTABLE_CONFIG_GRAMMAR,
      BENCH_CUTTABLE_CONFIG_ROOT_RULE,
      timedInputs,
      warmupInputs,
      CUTTABLE_CONFIGS,
    );
  }

  {
    const { timedInputs, warmupInputs } = buildInputSets(
      200,
      WARMUP_COUNT,
      (seed) => generateKeywordCorpus(2_000, seed * 100),
    );
    runSection(
      "Keyword grammar (Pillar 8 target -- see grammars.ts: FIRST_1 " +
        "predictive dispatch degenerates on shared-first-character " +
        "keyword alternatives)",
      BENCH_KEYWORD_GRAMMAR,
      BENCH_KEYWORD_ROOT_RULE,
      timedInputs,
      warmupInputs,
      KEYWORD_CONFIGS,
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
