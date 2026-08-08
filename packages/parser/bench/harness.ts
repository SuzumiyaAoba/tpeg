/**
 * Parse-throughput benchmark harness.
 *
 * This measures the thing that, before this file existed, no benchmark in
 * the repository measured: how fast a parser *emitted by
 * `generateTypeScriptParser`/`generateOptimizedTypeScriptParser`* actually
 * parses real input. `packages/parser-sample/src/performance-demo.ts`
 * measures code-generation speed, not parse speed; `packages/core/src/
 * performance.spec.ts` and `packages/combinator/benchmark.spec.ts` measure
 * single-character primitives, not a parser executing on a document.
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
import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  insertAutomaticCuts,
  leftFactorChoices,
  promoteGlobalCuts,
} from "../src/ast-optimize";
import { generateTypeScriptParser } from "../src/codegen";
import { generateOptimizedTypeScriptParser } from "../src/codegen-optimized";
import { analyzeFirstSets } from "../src/first-sets";
import { grammarDefinition } from "../src/grammar";
import { MIN_FUSION_WEIGHT } from "../src/regex-fusion";

const ORIGIN_POS = 0;

/**
 * Live peak stats for every `memoize` cache created through
 * `createMemoProbe`'s `memoize` shim, sharing one watermark with its
 * `commitAtTopLevel` shim -- see `createMemoProbe`'s doc comment.
 */
export interface MemoProbeStats {
  /** Highest total number of live (not-yet-pruned) cache entries observed
   * across every `memoize`-wrapped rule combined, at any point during the
   * parse(s) run through this probe. */
  peakMemoEntries: number;
  /** Highest `(highest cached offset) - (current prune base) + 1` observed
   * for any single `memoize`-wrapped rule -- the size of the "window" of
   * offsets that rule's cache has ever had to span at once.
   * `promoteGlobalCuts`'s cut promotion is supposed to keep this bounded
   * independent of input length; configurations without it (ordinary,
   * non-global commits only) are expected to let it grow with input size. */
  peakMemoWindow: number;
}

/**
 * Builds a matched pair of `commitAtTopLevel`/`memoize` replacements that
 * track cache-size statistics `logic.ts`'s real implementations don't
 * expose (their cache array and prune-watermark are private closure
 * state, by design -- this is a benchmark-only concern, not a reason to
 * add introspection to production code).
 *
 * The shim reimplements the *same* watermark/prune bookkeeping
 * `packages/combinator/src/logic.ts` uses internally (input-identity
 * reset, "advance on a higher commit position", "prune entries below the
 * watermark lazily on next touch"), driven by the SAME calls the real
 * `commitAtTopLevel`/`memoize` receive -- both shims delegate to the real
 * implementation for actual parsing behavior, so this can only ever watch
 * and report, never change what a benchmarked parser accepts or returns.
 * The tracked entry set intentionally mirrors "one Set<number> per
 * memoized rule" rather than reusing `logic.ts`'s array-splice approach --
 * different data structure, same prune/insert timing, same peak values.
 */
function createMemoProbe(): {
  stats: MemoProbeStats;
  memoize: typeof tpegCombinator.memoize;
  commitAtTopLevel: typeof tpegCombinator.commitAtTopLevel;
} {
  let watermarkInput: string | null = null;
  let watermarkOffset = 0;
  const stats: MemoProbeStats = { peakMemoEntries: 0, peakMemoWindow: 0 };

  const commitAtTopLevel: typeof tpegCombinator.commitAtTopLevel = (parser) => {
    const real = tpegCombinator.commitAtTopLevel(parser);
    return (input, pos) => {
      if (input !== watermarkInput) {
        watermarkInput = input;
        watermarkOffset = 0;
      }
      if (pos > watermarkOffset) watermarkOffset = pos;
      return real(input, pos);
    };
  };

  const memoize: typeof tpegCombinator.memoize = (parser, options) => {
    const real = tpegCombinator.memoize(parser, options);
    let cachedInput: string | null = null;
    let entries = new Set<number>();
    let base = 0;
    return (input, pos) => {
      if (input !== cachedInput) {
        cachedInput = input;
        entries = new Set();
        base = 0;
      }
      if (watermarkInput === input && watermarkOffset > base) {
        for (const p of entries) {
          if (p < watermarkOffset) entries.delete(p);
        }
        base = watermarkOffset;
      }
      entries.add(pos);
      if (entries.size > stats.peakMemoEntries) {
        stats.peakMemoEntries = entries.size;
      }
      let highest = base - 1;
      for (const p of entries) {
        if (p > highest) highest = p;
      }
      const window = highest - base + 1;
      if (window > stats.peakMemoWindow) stats.peakMemoWindow = window;
      return real(input, pos);
    };
  };

  return { stats, memoize, commitAtTopLevel };
}

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
  /**
   * Total number of times a "collapsed" leaf -- currently just
   * `charClassRun` (see `CompileRuleOptions.enableCharClassRun`) -- was
   * invoked. Counted SEPARATELY from `leafInvocations` rather than
   * folded into it: a `charClassRun` call replaces what would otherwise
   * have been N `charClass`/`negatedCharClass` invocations (one per
   * character consumed), so a drop in `leafInvocations` alone can't
   * distinguish "real elimination of redundant work" from "the counter
   * simply stopped seeing the replacement." Reading both together (e.g.
   * `leafInvocationsPerParse` falling while `collapsedInvocationsPerParse`
   * rises) is what actually demonstrates the collapse.
   */
  collapsedInvocations: LeafInvocationCounter;
  /** Non-null iff `CompileRuleOptions.probeMemo` was set -- live stats
   * updated by every call made through `parser` so far, from the same
   * `createMemoProbe` shim wired into this parser's `memoize`/
   * `commitAtTopLevel`. */
  memoStats: MemoProbeStats | null;
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
   * Applies `insertAutomaticCuts` (packages/parser/src/ast-optimize.ts) to
   * the parsed grammar before codegen, AFTER `leftFactor` if both are set
   * (mirrors the CLI's `--auto-cut` ordering: left-factoring can turn a
   * choice's alternatives into disjoint-prefixed sequences that only then
   * become cut candidates). Independent of `optimize`/`enableMemoization`:
   * this changes how much of a `memoize` table a cut *could* prune once
   * `promoteCuts` (below) actually lets some of them reach
   * `commitAtTopLevel` -- see `probeMemo` and the memo-table probe fields
   * on `ParseThroughputResult`.
   */
  autoCut?: boolean;
  /**
   * Applies `promoteGlobalCuts` (packages/parser/src/ast-optimize.ts)
   * to the parsed grammar before codegen,
   * AFTER `autoCut` (a cut has to exist before it can be promoted).
   * Marks every provably-safe `Cut` `global: true`, which both codegens
   * then compile to `commitAtTopLevel` instead of the ordinary `commit` --
   * see that function's module doc comment for the soundness argument.
   * Setting this without `autoCut` (and no hand-written `~` in
   * `grammarSrc`) is a no-op: there are no cuts to promote.
   */
  promoteCuts?: boolean;
  /**
   * Wraps the injected `memoize`/`commitAtTopLevel` with
   * `createMemoProbe`'s stats-tracking shim (see its doc comment) and
   * exposes the result as `CompiledBenchParser.memoStats`. Off by default:
   * the shim does real bookkeeping work on every memoized call, so
   * leaving it off keeps ordinary throughput numbers uncontaminated by
   * probe overhead.
   */
  probeMemo?: boolean;
  /**
   * Only meaningful when `optimize: true`. Forwarded to
   * `generateOptimizedTypeScriptParser`'s `enablePredictiveDispatch` --
   * emits `predictiveChoice(...)` (FIRST-set-gated) instead of
   * `choice(...)` for eligible `Choice` nodes.
   *
   * Defaults to `false` here, deliberately diverging from
   * `generateOptimizedTypeScriptParser`'s own default (`true`).
   * `CONFIGS`/`JSON_CONFIGS` in `run.ts` rely
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
  /**
   * Only meaningful when `enableRegexFusion` is on. Forwarded to
   * `generateOptimizedTypeScriptParser`'s `regexFusionScope` -- `"rule"`
   * (the default here, matching the codegen default) considers only a
   * rule's own top-level pattern, byte-identical to this module's
   * original whole-rule-only fusion; `"subtree"` additionally fuses any
   * maximal fusable node reached by walking a rule's pattern top-down
   * (see `packages/parser/src/regex-fusion.ts`'s
   * `planFusion`). Kept as its own axis, defaulting to match the
   * existing `enableRegexFusion` arms exactly, so a `"subtree"` arm can
   * be isolated against a `"rule"` baseline on the same grammar.
   */
  regexFusionScope?: "rule" | "subtree";
  /**
   * Only meaningful when `enableRegexFusion` is on and
   * `regexFusionScope: "subtree"`. Forwarded to
   * `generateOptimizedTypeScriptParser`'s `regexFusionMinWeight` --
   * lets a bench arm sweep the profitability threshold directly (see
   * `regex-fusion.ts`'s `MIN_FUSION_WEIGHT` doc comment for the cost
   * model it's threshold-ing). Defaults to the codegen's own default
   * when omitted.
   */
  regexFusionMinWeight?: number;
  /**
   * Forwarded to codegen for BOTH the standard and optimized path (unlike
   * `enablePredictiveDispatch`/`enableRegexFusion` above, which only mean
   * anything under `optimize: true`) -- `CodeGenOptions.enableCharClassRun`
   * (`packages/parser/src/codegen.ts`) applies identically to either
   * generator. Collapses a `Star`/`Plus`/`Quantified{0,}`/`Quantified{1,}`
   * over a bare `CharacterClass` into a single `charClassRun(...)` scan.
   *
   * Defaults to `false` here, deliberately diverging from both
   * generators' own default (`true`) --
   * same isolation reason `enablePredictiveDispatch` documents: leaving
   * this on by default in every arm would make it impossible to tell how
   * much of a delta belongs to this optimization specifically. Do not
   * change this default to track the codegen option's.
   */
  enableCharClassRun?: boolean;
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
      `bench grammar failed to parse: ${parsed.error.message} at offset ${parsed.error.pos}`,
    );
  }
  const leftFactored = options.leftFactor
    ? leftFactorChoices(parsed.val)
    : parsed.val;
  const cutInserted = options.autoCut
    ? insertAutomaticCuts(leftFactored)
    : leftFactored;
  const grammar = options.promoteCuts
    ? promoteGlobalCuts(cutInserted, analyzeFirstSets(cutInserted)).grammar
    : cutInserted;

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
        regexFusionScope: options.regexFusionScope ?? "rule",
        regexFusionMinWeight: options.regexFusionMinWeight ?? MIN_FUSION_WEIGHT,
        enableCharClassRun: options.enableCharClassRun ?? false,
        ...namePrefixOverride,
      })
    : generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
        enableCharClassRun: options.enableCharClassRun ?? false,
        ...namePrefixOverride,
      });

  const leafInvocations: LeafInvocationCounter = { count: 0 };
  const collapsedInvocations: LeafInvocationCounter = { count: 0 };
  const memoProbe = options.probeMemo ? createMemoProbe() : null;

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
    memoize: memoProbe ? memoProbe.memoize : tpegCombinator.memoize,
    commitAtTopLevel: memoProbe
      ? memoProbe.commitAtTopLevel
      : tpegCombinator.commitAtTopLevel,
    literal: countingFactory(tpegCore.literal, leafInvocations),
    charClass: countingFactory(tpegCore.charClass, leafInvocations),
    negatedCharClass: countingFactory(
      tpegCore.negatedCharClass,
      leafInvocations,
    ),
    anyChar: countingFactory(tpegCore.anyChar, leafInvocations),
    charClassRun: countingFactory(tpegCore.charClassRun, collapsedInvocations),
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

  return {
    parser,
    code: generated.code,
    leafInvocations,
    collapsedInvocations,
    memoStats: memoProbe?.stats ?? null,
  };
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
   * Collapsed-leaf (currently: `charClassRun`) invocations per single
   * parse -- see `CompiledBenchParser.collapsedInvocations`'s doc
   * comment for why this is tracked separately from
   * `leafInvocationsPerParse` rather than folded into it.
   */
  collapsedInvocationsPerParse: number;
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
  /**
   * Peak `memoize` cache stats across the timed loop (reset just before
   * it, like `leafInvocations`), or `null` if `compiled.memoStats` is
   * `null` (i.e. `CompileRuleOptions.probeMemo` wasn't set). See
   * `MemoProbeStats`'s own doc comment for what each field means -- in
   * short, `peakMemoWindow` is the number to watch for `promoteGlobalCuts`'
   * "truncation actually bounds the table" claim.
   */
  peakMemoEntries: number | null;
  peakMemoWindow: number | null;
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
  const { parser, leafInvocations, collapsedInvocations, memoStats } = compiled;
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
  collapsedInvocations.count = 0;
  if (memoStats) {
    memoStats.peakMemoEntries = 0;
    memoStats.peakMemoWindow = 0;
  }
  const start = performance.now();
  for (const input of inputs) {
    parser(input, ORIGIN_POS);
  }
  const totalTimeMs = performance.now() - start;
  const leafInvocationsPerParse = leafInvocations.count / iterations;
  const collapsedInvocationsPerParse = collapsedInvocations.count / iterations;

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
    collapsedInvocationsPerParse,
    heapDeltaBytes,
    peakMemoEntries: memoStats?.peakMemoEntries ?? null,
    peakMemoWindow: memoStats?.peakMemoWindow ?? null,
  };
}

export function formatResult(r: ParseThroughputResult): string {
  const heap =
    r.heapDeltaBytes === null
      ? "n/a (run with --expose-gc for heap delta)"
      : `${(r.heapDeltaBytes / 1024).toFixed(1)} KB retained / ${r.iterations} parses${r.heapDeltaBytes < 0 ? " (negative = GC ran mid-loop; treat as noise, not freed memory)" : ""}`;
  const lines = [
    `${r.name}`,
    `  input length:        ${r.inputLength}`,
    `  iterations:          ${r.iterations}`,
    `  ops/sec:             ${r.opsPerSec.toFixed(1)}`,
    `  avg time:            ${r.avgTimeMs.toFixed(4)} ms`,
    `  leaf invocations/parse: ${r.leafInvocationsPerParse.toFixed(1)} (vs input length ${r.inputLength} -- ratio ${(r.leafInvocationsPerParse / r.inputLength).toFixed(2)}x)`,
    `  heap (see caveat):   ${heap}`,
  ];
  if (r.collapsedInvocationsPerParse > 0) {
    lines.push(
      `  collapsed invocations/parse: ${r.collapsedInvocationsPerParse.toFixed(1)} (charClassRun -- see doc comment)`,
    );
  }
  if (r.peakMemoEntries !== null && r.peakMemoWindow !== null) {
    lines.push(
      `  peak memo entries:   ${r.peakMemoEntries}`,
      `  peak memo window:    ${r.peakMemoWindow}`,
    );
  }
  return lines.join("\n");
}
