/**
 * Parse-throughput benchmark harness.
 *
 * This measures the thing that, before this file existed, no benchmark in
 * the repository measured: how fast a parser *emitted by
 * `generateTypeScriptParser`/`generateOptimizedTypeScriptParser`* actually
 * parses real input. `packages/parser-sample/src/performance-demo.ts`
 * measures code-generation speed, not parse speed; `packages/core/src/
 * performance.spec.ts` and `packages/combinator/benchmark.spec.ts` measure
 * single-character primitives, not a parser executing on a document. See
 * the plan's Phase 1 rationale for the full argument.
 *
 * Design notes:
 * - `compileRule` parses a grammar, generates code with `includeImports:
 *   false`, and `eval`s the resulting `export const name = ...`
 *   declarations via `new Function`, binding every tpeg-core/
 *   tpeg-combinator export as a parameter name -- the same pattern already
 *   used in `codegen-optimized.spec.ts` for compiling generated code
 *   in-process.
 * - `literal`/`charClass`/`negatedCharClass`/`anyChar` are wrapped so the
 *   *parser they return* increments a shared counter on every invocation
 *   (not on construction -- the factories are called once per rule, but
 *   the parsers they build are called once per attempted match). Summed
 *   over a whole parse, this counts total leaf-parser attempts. For a
 *   grammar with no backtracking this is close to the input length; for
 *   `BENCH_UNFACTORED_ARITHMETIC_GRAMMAR` it is substantially higher,
 *   because the same leaf gets attempted again each time an outer `choice`
 *   backtracks into it. That gap is the "redundant re-parsing" PEG theory
 *   (packrat memoization, left factoring) targets -- it is a proxy for
 *   backtracking cost that plain wall-clock time doesn't separate out.
 */

import * as tpegCombinator from "@suzumiyaaoba/tpeg-combinator";
import * as tpegCore from "@suzumiyaaoba/tpeg-core";
import type { Parser, Pos } from "@suzumiyaaoba/tpeg-core";
import { leftFactorChoices } from "../src/ast-optimize";
import { generateTypeScriptParser } from "../src/codegen";
import { generateOptimizedTypeScriptParser } from "../src/codegen-optimized";
import { grammarDefinition } from "../src/grammar";

const ORIGIN_POS: Pos = { offset: 0, column: 0, line: 1 };

export interface LeafInvocationCounter {
  count: number;
}

export interface CompiledBenchParser {
  /** The compiled, runnable parser for the requested rule. */
  parser: Parser<unknown>;
  /** The generated source, for inspection/debugging a bench result. */
  code: string;
  /**
   * Total number of times a leaf parser (`literal`/`charClass`/
   * `negatedCharClass`/`anyChar`) was *invoked* -- not constructed --
   * across every call made through `parser` so far. Reset it yourself
   * between runs (`counter.count = 0`) if you want a per-call count
   * rather than a running total.
   */
  leafInvocations: LeafInvocationCounter;
}

/**
 * Wraps a tpeg-core leaf-parser factory (e.g. `literal`) so the *returned
 * parser* increments `counter.count` each time it's called, while leaving
 * its parsing behavior untouched.
 */
function countingFactory<Args extends unknown[], T>(
  factory: (...args: Args) => Parser<T>,
  counter: LeafInvocationCounter,
): (...args: Args) => Parser<T> {
  return (...args: Args) => {
    const inner = factory(...args);
    const counted: Parser<T> = (input, pos) => {
      counter.count++;
      return inner(input, pos);
    };
    return counted;
  };
}

export interface CompileRuleOptions {
  /** Use `generateOptimizedTypeScriptParser` instead of the standard codegen. */
  optimize?: boolean;
  /**
   * Forwarded to codegen for both the standard and optimized path (kept
   * symmetric on purpose -- an earlier version of this function only
   * applied caller overrides to the optimized branch).
   */
  namePrefix?: string;
  /**
   * Only meaningful when `optimize: true`. Defaults to `true`. Set to
   * `false` to isolate the memoization axis from the rest of what
   * `optimize: true` changes (currently: 1-element seq/choice flattening)
   * when attributing a benchmark delta to memoization specifically.
   */
  enableMemoization?: boolean;
  /**
   * Applies `leftFactorChoices` (packages/parser/src/ast-optimize.ts) to
   * the parsed grammar before codegen. Independent of `optimize`/
   * `enableMemoization`: this changes leaf-invocation *count* (less
   * redundant re-parsing), whereas memoization changes what happens to
   * an already-fixed amount of redundant work (caches it instead of
   * redoing it). Combine both to compare "eliminate the work" against
   * "cache the work" on the same grammar.
   */
  leftFactor?: boolean;
  /**
   * Only meaningful when `optimize: true`. Forwarded to
   * `generateOptimizedTypeScriptParser`'s `enablePredictiveDispatch` --
   * emits `predictiveChoice(...)` (FIRST-set-gated) instead of
   * `choice(...)` for eligible `Choice` nodes.
   *
   * Defaults to `false` here, deliberately diverging from
   * `generateOptimizedTypeScriptParser`'s own default (`true`, as of
   * Phase 0 of the perf plan). `CONFIGS`/`JSON_CONFIGS` in `run.ts` rely
   * on this axis being off unless explicitly requested, to keep
   * "standard" / "memoization off" / "memoization on" isolated from
   * predictive dispatch's own effect -- if this defaulted to `true` too,
   * every base config would silently include it and the dedicated
   * "predictive dispatch on" arms would stop measuring anything new. Do
   * not change this default to track the codegen option's.
   */
  enablePredictiveDispatch?: boolean;
  /**
   * Only meaningful when `optimize: true`. Forwarded to
   * `generateOptimizedTypeScriptParser`'s `enableRegexFusion` -- compiles
   * a wholly-non-terminal-free rule to a single `regexFused(...)` call
   * (see `packages/parser/src/regex-fusion.ts`) instead of a combinator
   * tree. Defaults to `false` here for the same isolation reason
   * `enablePredictiveDispatch` does: `CONFIGS`/`JSON_CONFIGS` in
   * `run.ts` rely on this axis being off unless explicitly requested.
   */
  enableRegexFusion?: boolean;
  // NOTE: `includeImports`/`includeTypes` are deliberately NOT
  // caller-overridable. `compileRule` strips `export` and evals the body
  // directly via `new Function`; `includeImports: true` would leave a
  // top-level `import` statement in that body, which is a SyntaxError
  // outside a module. Always generated with both `false`.
}

/**
 * Parses `grammarSrc`, generates a parser for it (standard or optimized
 * codegen, per `options.optimize`), and compiles the result to a callable
 * `Parser` bound to `ruleName`.
 */
export function compileRule(
  grammarSrc: string,
  ruleName: string,
  options: CompileRuleOptions = {},
): CompiledBenchParser {
  const parsed = grammarDefinition(grammarSrc, ORIGIN_POS);
  if (!parsed.success) {
    throw new Error(
      `bench grammar failed to parse: ${parsed.error.message} at offset ${parsed.error.pos.offset}`,
    );
  }
  const grammar = options.leftFactor
    ? leftFactorChoices(parsed.val)
    : parsed.val;

  // `exactOptionalPropertyTypes` treats `namePrefix: undefined` as a
  // different (disallowed) thing from omitting `namePrefix` entirely, so
  // it's spread in only when actually provided rather than passed through
  // unconditionally.
  const namePrefixOverride = options.namePrefix
    ? { namePrefix: options.namePrefix }
    : {};

  const generated = options.optimize
    ? generateOptimizedTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
        optimize: true,
        enableMemoization: options.enableMemoization ?? true,
        enablePredictiveDispatch: options.enablePredictiveDispatch ?? false,
        enableRegexFusion: options.enableRegexFusion ?? false,
        ...namePrefixOverride,
      })
    : generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
        ...namePrefixOverride,
      });

  const leafInvocations: LeafInvocationCounter = { count: 0 };

  // Only pull `memoize` out of tpeg-combinator (the one combinator-package
  // export the codegen ever references, per `codegen-optimized.ts`'s
  // import list) rather than spreading the whole package: tpeg-combinator
  // exports names like `number`/`string` (parser-building helpers) that
  // collide with common TPEG *grammar rule names*, which would otherwise
  // turn into "Cannot declare a const variable twice" SyntaxErrors when
  // `new Function` tries to bind both a same-named parameter and a
  // generated `const <ruleName> = ...` in the same scope.
  const scope: Record<string, unknown> = {
    ...tpegCore,
    memoize: tpegCombinator.memoize,
    literal: countingFactory(tpegCore.literal, leafInvocations),
    charClass: countingFactory(tpegCore.charClass, leafInvocations),
    negatedCharClass: countingFactory(
      tpegCore.negatedCharClass,
      leafInvocations,
    ),
    anyChar: countingFactory(tpegCore.anyChar, leafInvocations),
  };

  // `export const rule = ...` -> `const rule = ...`; the surrounding
  // Function body then returns every rule so the caller can pick one out.
  const body = generated.code.replace(/^export const (\w+)/gm, "const $1");
  const ruleNames = [...generated.code.matchAll(/^export const (\w+)/gm)].map(
    (m) => m[1],
  );
  const factory = new Function(
    ...Object.keys(scope),
    `${body}\nreturn { ${ruleNames.join(", ")} };`,
  );
  const built = factory(...Object.values(scope)) as Record<
    string,
    Parser<unknown>
  >;

  const parser = built[ruleName];
  if (!parser) {
    throw new Error(
      `rule "${ruleName}" not found in generated code (available: ${ruleNames.join(", ")})`,
    );
  }

  return { parser, code: generated.code, leafInvocations };
}

export interface ParseThroughputResult {
  name: string;
  inputLength: number;
  iterations: number;
  totalTimeMs: number;
  avgTimeMs: number;
  opsPerSec: number;
  /** Leaf-parser invocations per single parse (see class docstring). */
  leafInvocationsPerParse: number;
  /**
   * `heapUsed` immediately after the timed loop, minus `heapUsed`
   * immediately before it (one `globalThis.gc()` call precedes the
   * "before" reading, if `--expose-gc` is set).
   *
   * This is NOT total allocation volume -- nothing prevents GC from
   * running *during* the timed loop, so it only measures what's still
   * reachable at the end. A negative value means GC reclaimed more than
   * was allocated in-window (i.e. it ran mid-loop) and should be read as
   * noise, not "freed memory." A large positive value is a lower bound on
   * retained memory (e.g. cached parse results still referenced by a
   * `memoize` table), not a measurement of GC pressure. Cross-check any
   * conclusion drawn from this field against `leafInvocationsPerParse`
   * and `opsPerSec`, which are exact.
   */
  heapDeltaBytes: number | null;
}

/**
 * Runs `parser` against `inputs` (one call per entry) and reports
 * throughput, leaf-invocation count, and heap growth.
 *
 * Mirrors the warmup + `performance.now()` pattern already used by
 * `benchmarkParser` in `packages/core/src/basic.ts` (kept un-exported
 * there specifically to discourage external use, per
 * `packages/core/src/index.ts:4-5` -- so this is a local reimplementation,
 * not an import, and additionally reports heap delta and leaf-invocation
 * count, which `benchmarkParser` does not).
 *
 * `inputs` should normally come from `generateVariedInputs` (see
 * `corpus.ts`): distinct content per call, same size/shape, so a
 * memoizing (optimized) parser can't turn every iteration after the
 * first into a free cache hit. A single-element array works too, but
 * then an `optimize: true` result reflects "reparse the same string
 * repeatedly," not steady-state throughput.
 *
 * `warmupInputs` defaults to a *separate* slice of varied inputs (via
 * `generateVariedInputs`-style seeding, offset past `inputs`) rather than
 * reusing `inputs` itself -- reusing them would prime the memoizing
 * parser's cache for the exact strings the timed loop is about to
 * measure, turning the "warmup" into free cache hits inside the timing
 * window too.
 */
export function runParseThroughput(
  name: string,
  compiled: CompiledBenchParser,
  inputs: string[],
  { warmupInputs = inputs }: { warmupInputs?: string[] } = {},
): ParseThroughputResult {
  if (inputs.length === 0) {
    throw new Error("runParseThroughput requires at least one input");
  }
  const { parser, leafInvocations } = compiled;
  const iterations = inputs.length;

  for (const warmupInput of warmupInputs) {
    parser(warmupInput, ORIGIN_POS);
  }

  const canForceGc = typeof globalThis.gc === "function";
  if (canForceGc) {
    globalThis.gc?.();
  }
  const heapBefore = canForceGc ? process.memoryUsage().heapUsed : null;

  leafInvocations.count = 0;
  const start = performance.now();
  for (const input of inputs) {
    parser(input, ORIGIN_POS);
  }
  const totalTimeMs = performance.now() - start;
  const leafInvocationsPerParse = leafInvocations.count / iterations;

  const heapAfter = canForceGc ? process.memoryUsage().heapUsed : null;
  const heapDeltaBytes =
    heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null;

  const totalInputLength = inputs.reduce((sum, s) => sum + s.length, 0);

  return {
    name,
    inputLength: Math.round(totalInputLength / iterations),
    iterations,
    totalTimeMs,
    avgTimeMs: totalTimeMs / iterations,
    opsPerSec: iterations / (totalTimeMs / 1000),
    leafInvocationsPerParse,
    heapDeltaBytes,
  };
}

export function formatResult(r: ParseThroughputResult): string {
  const heap =
    r.heapDeltaBytes === null
      ? "n/a (run with --expose-gc for heap delta)"
      : `${(r.heapDeltaBytes / 1024).toFixed(1)} KB retained / ${r.iterations} parses${r.heapDeltaBytes < 0 ? " (negative = GC ran mid-loop; treat as noise, not freed memory)" : ""}`;
  return [
    `${r.name}`,
    `  input length:        ${r.inputLength}`,
    `  iterations:          ${r.iterations}`,
    `  ops/sec:             ${r.opsPerSec.toFixed(1)}`,
    `  avg time:            ${r.avgTimeMs.toFixed(4)} ms`,
    `  leaf invocations/parse: ${r.leafInvocationsPerParse.toFixed(1)} (vs input length ${r.inputLength} -- ratio ${(r.leafInvocationsPerParse / r.inputLength).toFixed(2)}x)`,
    `  heap (see caveat):   ${heap}`,
  ].join("\n");
}
