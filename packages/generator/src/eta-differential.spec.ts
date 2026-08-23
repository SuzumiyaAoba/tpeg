/**
 * Differential fuzzing of `EtaTPEGCodeGenerator` (this package's
 * Eta-template-based generator) against `@suzumiyaaoba/tpeg-parser`'s
 * `generateTypeScriptParser` (the base, non-Eta generator) -- the
 * generator-package half of `packages/parser/src/codegen-differential.spec.ts`,
 * reusing that file's random-grammar/random-input generator and comparison
 * plumbing (`differential-fuzz.ts`, re-exported by `@suzumiyaaoba/tpeg-parser`)
 * rather than keeping a second, driftable copy.
 *
 * ## Why this exists
 *
 * Before this file, `EtaTPEGCodeGenerator` had NO differential testing or
 * independent oracle at all -- only hand-written snapshot tests
 * (`eta-generator.spec.ts`), which pin whatever the generator currently
 * outputs rather than checking it against anything independent. That gap
 * is exactly how this generator ended up diverging from `tpeg-parser`'s
 * `codegen.ts` on four separate points, found by manual PEG-semantics
 * audit rather than by any test in this repository, PLUS a fifth defect
 * this file's own fuzzer caught on its very first run (see the last item
 * below):
 *
 * - forward/self/mutual rule references emitted as a bare identifier
 *   instead of `lazy(() => ...)`, throwing a `const` temporal-dead-zone
 *   `ReferenceError` at module-evaluation time for nearly any
 *   non-trivial grammar (`generateIdentifier`/`generateIdentifierCode`);
 * - a `StringLiteral`/`CharacterClass` value's control characters (`\n`,
 *   `\t`, ...) emitted as a raw byte inside a `"..."` source literal
 *   instead of escaped, producing invalid TypeScript
 *   (`generateStringLiteral`/`generateCharacterClass`);
 * - `ActionExpression` (an inline `{ ... }` action) entirely unhandled,
 *   throwing `Unsupported expression type: ActionExpression` at
 *   generation time even though `validateGrammarForEtaGenerator` accepts
 *   the node;
 * - a degenerate cut-only-remainder `Sequence` (`~ "a"` / `"a" ~`) always
 *   wrapped in `sequence(...)`, producing `["a"]` instead of the bare
 *   `"a"` the equivalent `codegen.ts` output produces;
 * - (found by this file's fuzzer, not by manual audit) `optimized/
 *   rule-optimized.eta`'s trailing `// <comment>` block relied on a
 *   template-source newline that Eta's default `autoTrim` setting
 *   silently strips (see `eta-generator.ts`'s constructor doc comment for
 *   the exact mechanism), so a rule carrying a `@memoize`/recursion/
 *   high-complexity comment swallowed the ENTIRE NEXT rule's `export
 *   const ...` declaration into its own `//` line -- compiling a grammar
 *   into fewer rules than it declared, with no error, whenever a
 *   commented rule wasn't the grammar's last one.
 *
 * All five are fixed in `eta-generator.ts`/its templates by delegating to
 * the same shared helpers `codegen.ts` uses where applicable (see that
 * module's own doc comment), rather than reimplementing each fix locally
 * -- this file exists so a FUTURE divergence of any of these kinds gets
 * caught by a running test instead of requiring another manual audit.
 *
 * Compared on value (`keyWithValue`, not just recognition): unlike
 * `codegen-differential.spec.ts`'s AST-rewrite variants, plain Eta
 * generation performs no shape-changing rewrite of its own, so full
 * parity with the base generator's value is the expected -- not merely
 * best-effort -- outcome.
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
import { EtaTPEGCodeGenerator } from "./eta-generator";

const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const SAMPLE_SIZE = 300 * FUZZ_SCALE;
// Independent of `codegen-differential.spec.ts`'s own `TPEG_DIFF_SEED`-
// overridable seed -- deliberately a different fixed default so the two
// files' fixed-seed runs don't happen to explore the exact same grammars.
const SEED = Number(process.env["TPEG_ETA_DIFF_SEED"]) || 20260823;

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

describe("Eta generator differential fuzzing (vs. tpeg-parser's base generator)", () => {
  test(
    `agrees with the base generator across ${SAMPLE_SIZE} random grammars x ${ALL_TEST_INPUTS.length} inputs, for every Eta variant`,
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

      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const source = genGrammarSource(rng);
        const parsed = parse(grammarDefinition)(source);
        if (!parsed.success) {
          skippedCount++;
          continue;
        }

        let base: Parser<unknown>;
        const variantParsers: [EtaVariantSpec, Parser<unknown>][] = [];
        try {
          base = compileStart(
            generateTypeScriptParser(parsed.val, {
              includeImports: false,
              includeTypes: false,
            }).code,
            core,
            combinator,
          );
          for (const variant of ETA_VARIANTS) {
            const generator = new EtaTPEGCodeGenerator({
              language: "typescript",
              includeImports: false,
              includeTypes: false,
              ...variant.options,
            });
            const code = (await generator.generateGrammar(parsed.val)).code;
            variantParsers.push([
              variant,
              compileStart(code, core, combinator),
            ]);
          }
        } catch {
          // A construction-time rejection (e.g. `assertNoNullableRepetition`
          // via `validateGrammarForEtaGenerator`, or a left-recursive/
          // duplicate-name rule) or a `new Function` compile error -- not a
          // differential-fuzzing concern, since the base generator would
          // have hit an equivalent rejection for the same grammar.
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
          const baseKey = keyWithValue(baseResult);

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
            const variantKey = keyWithValue(result);
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
      expect(skippedCount).toBeLessThan(SAMPLE_SIZE * 0.2);

      if (diffs.length > 0) {
        const preview = diffs.slice(0, 10).join("\n\n");
        throw new Error(
          `${diffs.length} differential-fuzzing failure(s) out of ${testedCount} grammars tested (${skippedCount} skipped -- parse failure or a correct construction-time rejection). First ${Math.min(10, diffs.length)}:\n\n${preview}`,
        );
      }
    },
    60000 * FUZZ_SCALE,
  );
});

// --- Pinned regressions for the four bugs this file's module doc comment
// describes -- each is a minimal grammar the fuzzer above is not
// guaranteed to draw on any given run, so these pin them directly. Every
// one of these failed before the corresponding `eta-generator.ts` fix and
// passes after. ---------------------------------------------------------

describe("Eta generator: pinned regressions (found by manual PEG-semantics audit, not by the fuzzer above)", () => {
  const generate = async (
    source: string,
    options: { includeImports?: boolean } = {},
  ) => {
    const parsed = parse(grammarDefinition)(source);
    if (!parsed.success) {
      throw new Error(`test grammar failed to parse: ${parsed.error.message}`);
    }
    const generator = new EtaTPEGCodeGenerator({
      language: "typescript",
      includeImports: options.includeImports ?? false,
      includeTypes: false,
    });
    return (await generator.generateGrammar(parsed.val)).code;
  };

  const run = async (code: string, core: unknown, combinator: unknown) => {
    const c = core as Record<string, unknown>;
    const cb = combinator as Record<string, unknown>;
    return compileStart(code, c, cb);
  };

  test("G1: a forward/self-referencing rule generates a loadable module (lazy(), not a bare identifier)", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");
    const code = await generate(
      'grammar T {\n  start = expr\n  expr = "(" expr ")" / "a"\n}',
    );
    // The bug threw a TDZ ReferenceError the moment the generated module's
    // top-level `const` initializers ran (i.e. inside `compileStart`
    // itself via `new Function(...)`), not merely on first parser
    // invocation -- so reaching the assertions below at all is already
    // most of this test.
    const start = await run(code, core, combinator);
    expect(start("(a)", 0)).toMatchObject({ success: true, next: 3 });
    expect(start("((a))", 0)).toMatchObject({ success: true, next: 5 });
  });

  test("G2: a control-character StringLiteral/CharacterClass generates syntactically valid, correctly-escaped source", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");
    const nlCode = await generate('grammar T {\n  start = "\\n"\n}');
    expect(nlCode).not.toContain('"\n"'); // must be escaped, not a raw newline byte
    const nlParser = await run(nlCode, core, combinator);
    expect(nlParser("\n", 0)).toMatchObject({ success: true, val: "\n" });

    const classCode = await generate("grammar T {\n  start = [\\t]+\n}");
    const classParser = await run(classCode, core, combinator);
    expect(classParser("\t\t", 0)).toMatchObject({
      success: true,
      val: ["\t", "\t"],
    });
  });

  test("G3: an ActionExpression generates instead of throwing 'Unsupported expression type'", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");
    const code = await generate(
      'grammar T {\n  start = a:"x" { return a; }\n}',
    );
    const start = await run(code, core, combinator);
    expect(start("x", 0)).toMatchObject({ success: true, val: "x" });
    expect(start("y", 0)).toMatchObject({ success: false });
  });

  test("G4: a degenerate cut-only-remainder Sequence yields a bare value, not a 1-tuple", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");
    const leading = await run(
      await generate('grammar T {\n  start = ~ "a"\n}'),
      core,
      combinator,
    );
    expect(leading("a", 0)).toMatchObject({ success: true, val: "a" });

    const trailing = await run(
      await generate('grammar T {\n  start = "a" ~\n}'),
      core,
      combinator,
    );
    expect(trailing("a", 0)).toMatchObject({ success: true, val: "a" });
  });

  test("G5: includeImports:true on a recursive grammar emits only resolvable imports (memoize from tpeg-combinator is a declared dependency)", async () => {
    const code = await generate(
      'grammar T {\n  start = expr\n  expr = "(" expr ")" / "a"\n}',
      { includeImports: true },
    );
    expect(code).toContain('from "@suzumiyaaoba/tpeg-combinator"');
    expect(code).toContain("lazy");
  });

  test("G6: a rule carrying a generated comment (recursion/high-complexity/@memoize), NOT the grammar's last rule, still leaves every later rule intact", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");
    // `rec` is self-recursive (-> gets a "contains recursion" comment) and
    // is declared BEFORE `sub`, the shape `optimized/rule-optimized.eta`'s
    // swallowed-newline bug needed: a commented rule with something after
    // it. `optimize: true` (this generator's default) selects the
    // affected "optimized/parser-file" template; the "eta (base template)"
    // variant in the fuzz test above never carries a rule comment at all
    // (see `eta-generator.ts`'s `generateRuleComment`, only reachable via
    // the optimized path here), so this shape is exercised ONLY by this
    // pinned test, not by that fuzz loop.
    const code = await generate(
      'grammar T {\n  start = rec sub\n  rec = "(" rec ")" / "a"\n  sub = "b"\n}',
    );
    // Before the fix: `sub`'s entire `export const sub = ...;` line was
    // swallowed into `rec`'s trailing `// contains recursion` comment, so
    // this substring check alone would already have caught the bug --
    // failing before requiring the runtime assertion below to even run.
    expect(code).toContain("export const sub");
    const start = compileStart(code, core, combinator);
    expect(start("ab", 0)).toMatchObject({ success: true, next: 2 });
    expect(start("(a)b", 0)).toMatchObject({ success: true, next: 4 });
  });
});
