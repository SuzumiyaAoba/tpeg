/**
 * Property-based (`fast-check`) generalization of `eta-differential.spec.ts`'s
 * INPUT side. That file already fuzzes the grammar side with a large,
 * genuinely random sample (`genGrammarSource(rng)`, LCG-driven) -- unlike
 * the fixed-tree situation `packages/core/src/pbt-invariants.spec.ts`'s
 * module doc comment describes for `combinator-laws.spec.ts`, so there is
 * no comparable gap to fill THERE. But every grammar it tests is matched
 * against the exact same `ALL_TEST_INPUTS` -- a list generated ONCE, with
 * its own hard-coded LCG seed, at module load
 * (`packages/parser/src/differential-fuzz.ts`'s `RANDOM_TEST_INPUTS` doc
 * comment says so explicitly: "independent of any caller's own
 * grammar-generation seed"). That's the same "fixed input list, no
 * shrinking" situation `pbt-invariants.spec.ts` generalized `combinator`'s
 * `INPUTS` array away from -- so this file applies the identical fix here:
 * keep `genGrammarSource`'s grammar generation as-is (it already has the
 * randomness/sample-size fast-check would add), and replace the input side
 * with an `fc` string arbitrary, so a divergence shrinks to a MINIMAL
 * (grammar, input) pair instead of only ever being found at whichever of
 * the 54 fixed strings happens to trigger it.
 *
 * Grammar compilation (parsing, generating, `new Function`) is genuinely
 * expensive and is not itself what this file adds coverage for, so it
 * happens ONCE per grammar, outside `fc.assert` -- `fc.constantFrom` over
 * the resulting compiled entries is what lets a single `fc.property` fuzz
 * the input against ALL of them, with shrinking on both which entry and
 * which input triggered the failure.
 */

import { describe, expect, test } from "vite-plus/test";
import { type Parser, parse } from "@suzumiyaaoba/tpeg-core";
import {
  ALL_TEST_INPUTS,
  compileStart,
  genGrammarSource,
  generateTypeScriptParser,
  grammarDefinition,
  keyWithValue,
  makeRng,
} from "@suzumiyaaoba/tpeg-parser";
import fc from "fast-check";
import { EtaTPEGCodeGenerator } from "./eta-generator";

const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const GRAMMAR_SAMPLE_SIZE = 30 * FUZZ_SCALE;
// Independent of both `eta-differential.spec.ts`'s `TPEG_ETA_DIFF_SEED`
// (grammar generation) and `codegen-differential.spec.ts`'s
// `TPEG_DIFF_SEED` -- a third, deliberately different fixed default so a
// fixed-seed run of each file explores different grammars.
const GRAMMAR_SEED =
  Number(process.env["TPEG_ETA_PBT_GRAMMAR_SEED"]) || 20260910;
const FC_PARAMS = { seed: 20260910, numRuns: 300 * FUZZ_SCALE };

interface EtaVariantSpec {
  readonly name: string;
  readonly options: { optimize: boolean; enableMemoization: boolean };
}

const ETA_VARIANTS: readonly EtaVariantSpec[] = [
  {
    name: "eta (base template)",
    options: { optimize: false, enableMemoization: false },
  },
  {
    name: "eta (optimized template + memoization)",
    options: { optimize: true, enableMemoization: true },
  },
];

interface CompiledEntry {
  readonly source: string;
  readonly base: Parser<unknown>;
  readonly variants: readonly [EtaVariantSpec, Parser<unknown>][];
}

// Same character set `RANDOM_TEST_INPUTS` draws from (every leaf/bracket
// character `LEAVES`/`genRecursiveRuleBody` can produce, plus astral/
// non-ASCII), with `\n`/`\t` added to pair with the control-character
// leaves (`'"\\n"'`, `"[\\t]"`, ...) the way `FIXED_TEST_INPUTS` already
// pairs bare control-character inputs against them.
const INPUT_ALPHABET = [
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
  "\n",
  "\t",
] as const;
// A random string of up to 8 characters from `INPUT_ALPHABET` rarely lands
// on an EXACT match against a 1-3 character `LEAVES` literal by chance
// alone (most draws are simply too long, or the wrong length entirely) --
// `ALL_TEST_INPUTS` earns its keep specifically by being hand-curated to
// land on those exact matches (`"a"`, `"ab"`, `"abc"`, ...). Folding it in
// via `fc.oneof` keeps that proven hit rate while still adding fast-check's
// own generative/shrinking value on top, instead of replacing a working
// mechanism with a strictly weaker one.
const inputArb = fc.oneof(
  fc.constantFrom(...ALL_TEST_INPUTS),
  fc.string({ unit: fc.constantFrom(...INPUT_ALPHABET), maxLength: 4 }),
);

describe("Eta generator differential fuzzing (fast-check input side, vs. tpeg-parser's base generator)", () => {
  test(
    `agrees with the base generator across ${GRAMMAR_SAMPLE_SIZE} random grammars x fast-check-generated inputs, for every Eta variant`,
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

      const rng = makeRng(GRAMMAR_SEED);
      const entries: CompiledEntry[] = [];
      let skippedCount = 0;

      for (let i = 0; i < GRAMMAR_SAMPLE_SIZE; i++) {
        const source = genGrammarSource(rng);
        const parsed = parse(grammarDefinition)(source);
        if (!parsed.success) {
          skippedCount++;
          continue;
        }

        try {
          const base = compileStart(
            generateTypeScriptParser(parsed.val, {
              includeImports: false,
              includeTypes: false,
            }).code,
            core,
            combinator,
          );
          const variants: [EtaVariantSpec, Parser<unknown>][] = [];
          for (const variant of ETA_VARIANTS) {
            const generator = new EtaTPEGCodeGenerator({
              language: "typescript",
              includeImports: false,
              includeTypes: false,
              ...variant.options,
            });
            const code = (await generator.generateGrammar(parsed.val)).code;
            variants.push([variant, compileStart(code, core, combinator)]);
          }
          entries.push({ source, base, variants });
        } catch {
          // A construction-time rejection or `new Function` compile error --
          // not a fast-check concern, exactly as in `eta-differential.spec.ts`.
          skippedCount++;
        }
      }

      // A meaningful corpus actually compiled -- guards against this test
      // silently fuzzing nothing if grammar generation/compilation regresses.
      expect(entries.length).toBeGreaterThan(GRAMMAR_SAMPLE_SIZE / 2);
      expect(skippedCount).toBeLessThan(GRAMMAR_SAMPLE_SIZE * 0.2);

      // Throws on the FIRST mismatch found, rather than collecting every
      // diff across all `numRuns` the way `eta-differential.spec.ts`'s
      // LCG-driven loop does -- that's what lets `fc.assert` recognize the
      // run as failing and shrink it to a minimal (grammar, input) pair.
      // A property that only records diffs into an array and returns
      // normally would look like it passed to `fc.assert`, defeating the
      // entire point of switching this to fast-check.
      fc.assert(
        fc.property(fc.constantFrom(...entries), inputArb, (entry, input) => {
          let baseResult: ReturnType<Parser<unknown>>;
          try {
            baseResult = entry.base(input, 0);
          } catch {
            return;
          }
          const baseKey = keyWithValue(baseResult);

          for (const [variant, parser] of entry.variants) {
            let result: ReturnType<Parser<unknown>>;
            try {
              result = parser(input, 0);
            } catch (error) {
              throw new Error(
                `[${variant.name}] THREW at runtime on ${JSON.stringify(input)} for grammar:\n${entry.source}\n  ${(error as Error).message}`,
              );
            }
            const variantKey = keyWithValue(result);
            if (baseKey !== variantKey) {
              throw new Error(
                `[${variant.name}] DIFF on ${JSON.stringify(input)} for grammar:\n${entry.source}\n  base=${baseKey}  variant=${variantKey}`,
              );
            }
          }
        }),
        FC_PARAMS,
      );
    },
    60000 * FUZZ_SCALE,
  );
});
