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
 *
 * The random-grammar/random-input generator and the `compileStart`/
 * `key*` comparison plumbing live in `./differential-fuzz.ts` (and are
 * re-exported from this package's entry point) rather than in this file
 * directly, so `@suzumiyaaoba/tpeg-generator`'s `eta-differential.spec.ts`
 * can drive its Eta-based generator through the identical (grammar, input)
 * space instead of keeping a second, driftable copy.
 */

import { describe, expect, test } from "vite-plus/test";
import { type Parser, parse } from "@suzumiyaaoba/tpeg-core";
import {
  applyAstOptimizations,
  insertAutomaticCuts,
  mergeCharacterClasses,
  promoteGlobalCuts,
} from "./ast-optimize";
import { generateTypeScriptParser } from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import {
  ALL_TEST_INPUTS,
  compileStart,
  genGrammarSource,
  keySuccessOnly,
  keyWithValue,
  makeRng,
} from "./differential-fuzz";
import { analyzeFirstSets } from "./first-sets";
import { grammarDefinition } from "./grammar";
import {
  ReferenceInterpreterLimitError,
  referenceRecognize,
} from "./reference-interpreter";
import type { GrammarDefinition } from "./types";

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
// Overridable so a local seed sweep (`for s in $(seq 1 20); do
// TPEG_DIFF_SEED=$s bun test src/codegen-differential.spec.ts; done`) can
// explore grammar shapes this file's one fixed default seed never draws --
// increasing `TPEG_FUZZ_SCALE` alone only extends the SAME LCG sequence
// from the same seed, so it retreads the same early draws rather than
// reaching genuinely different ones. Left at the original fixed default for
// ordinary CI/local runs, so a plain `bun test` stays exactly as
// reproducible as before.
const SEED = Number(process.env["TPEG_DIFF_SEED"]) || 20260809; // today's date at authorship time -- arbitrary but fixed

describe("codegen differential fuzzing (base generator vs. every optimization variant, plus a reference-interpreter oracle)", () => {
  test(
    `agrees with the base generator (and the oracle) across ${SAMPLE_SIZE} random grammars x ${ALL_TEST_INPUTS.length} inputs, for every variant`,
    async () => {
      const core =
        (await import("@suzumiyaaoba/tpeg-core")) as unknown as Record<
          string,
          unknown
        >;
      const combinator =
        (await import("@suzumiyaaoba/tpeg-combinator")) as unknown as Record<
          string,
          unknown
        >;

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
      // Guards against "this file is green" being a vacuous claim for the
      // two optimizations with the LARGEST semantic divergence surface and
      // the LEAST oracle coverage. Neither `regexFused`/`regexFusedMap`
      // (`packages/core/src/regex-fused.ts` -- "this module trusts its
      // caller completely and does no validation of `source` itself") nor
      // the dispatch-trie's beyond-FIRST_1 discrimination
      // (`packages/core/src/dispatch-trie.ts`) has any independent oracle;
      // the only signal that either was ever actually exercised by this
      // fuzzer is whether the generated code for the relevant variant
      // actually contains a call to it. `STRUCTURALLY_DISQUALIFYING`
      // (`regex-fusion.ts`) excludes any rule containing an `Identifier`,
      // `Cut`, a label, or either lookahead -- `genExpr`'s 33 branches
      // produce all four constantly, so it is not obvious a priori that
      // fusion fires on more than a sliver of generated grammars.
      let regexFusionFiredCount = 0;
      let predictiveTrieEmittedCount = 0;

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
            const code = variant.build(parsed.val);
            if (
              variant.name.startsWith("optimized + regex fusion") &&
              (code.includes("regexFused(") || code.includes("regexFusedMap("))
            ) {
              regexFusionFiredCount++;
            }
            if (
              variant.name === "optimized (predictive dispatch, default)" &&
              /},\s*"[^"]*"\s*\]/.test(code)
            ) {
              predictiveTrieEmittedCount++;
            }
            variantParsers.push([
              variant,
              compileStart(code, core, combinator),
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
            // A `ReferenceInterpreterLimitError` (recursion depth
            // exceeded, e.g. deep mutual recursion) is out of scope for
            // this input -- see that class's doc comment -- so it's
            // silently skipped, exactly like a construction-time rejection
            // is skipped above. A zero-width repetition no longer throws
            // this (see the class's doc comment); it's now a FATAL
            // `Result`, compared above like any other outcome.
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
      // See `regexFusionFiredCount`/`predictiveTrieEmittedCount`'s
      // declaration above. Measured at `TPEG_FUZZ_SCALE=30` (18000
      // grammars, this file's fixed SEED): fusion fires on ~75% of tested
      // grammars, the trie on ~54% -- both floored at a fraction far below
      // that measurement (not just `> 0`) so an unrelated shift in
      // `genExpr`'s branch mix has headroom, while a regression that
      // silently guts either one (e.g. `STRUCTURALLY_DISQUALIFYING`
      // becoming overbroad, or dispatch-trie construction breaking) still
      // fails loudly instead of leaving this file green on zero real
      // coverage of its largest, least-oracled optimizations.
      expect(regexFusionFiredCount).toBeGreaterThan(testedCount * 0.1);
      expect(predictiveTrieEmittedCount).toBeGreaterThan(testedCount * 0.1);
      // Guards against `parse(grammarDefinition)`/construction-time
      // rejections silently eating this fuzzer's real coverage while
      // `testedCount &gt; SAMPLE_SIZE / 2` above still passes -- measured
      // skip rate is ~1.6% (294/18000) at scale 30; floored generously
      // above that so a legitimate future rejection (a new, correctly
      // stricter validation) has room, while a validator turning
      // over-eager and silently skipping most of the sample still fails.
      expect(skippedCount).toBeLessThan(SAMPLE_SIZE * 0.15);

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
