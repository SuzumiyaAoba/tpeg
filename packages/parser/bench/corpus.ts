/**
 * Synthetic input generators for the parse-throughput benchmark
 * (see `run.ts`). All generators are deterministic (no RNG) so bench runs
 * are reproducible and diffable across commits.
 */

/**
 * A compact (whitespace-free) JSON document of roughly `targetLength`
 * characters, built as a flat array of small objects. Matches
 * `BENCH_JSON_GRAMMAR` in `grammars.ts`, which has no whitespace rule.
 *
 * `idOffset` shifts the numbers embedded in the document without changing
 * its size or structure -- see `generateVariedInputs` below for why this
 * matters for benchmarking a memoizing parser.
 */
export function generateJsonCorpus(targetLength: number, idOffset = 0): string {
  const items: string[] = [];
  let length = 2; // "[" + "]"
  let i = idOffset;
  while (length < targetLength) {
    const item = `{"id":${i},"name":"item${i}","active":${i % 2 === 0 ? "true" : "false"},"tags":[${i},${i + 1},${i + 2}],"note":null}`;
    items.push(item);
    // +1 for the "," joiner, except before the first item.
    length += item.length + (items.length > 1 ? 1 : 0);
    i++;
  }
  return `[${items.join(",")}]`;
}

/**
 * A flat chain of `count` numbers joined by `*`, e.g. `"1*2*3*...*N"`.
 *
 * Against `BENCH_UNFACTORED_ARITHMETIC_GRAMMAR`, this triggers the
 * grammar's constant-factor backtracking: `sum`'s three alternatives all
 * start by parsing `product`, so a chain with no top-level `+`/`-` causes
 * the *entire* `product` chain to be reparsed 3 times (once per failed
 * `sum` alternative) before falling through to the bare-`product` case.
 * Cost scales linearly in `count` (with a ~3x constant factor), so this
 * is safe to scale up -- unlike `generateNestedParens` below.
 *
 * `startAt` shifts the numbers in the chain without changing its length
 * or shape -- see `generateVariedInputs` below.
 */
export function generateMultiplicationChain(
  count: number,
  startAt = 1,
): string {
  const terms: string[] = [];
  for (let i = 0; i < count; i++) {
    terms.push(String(startAt + i));
  }
  return terms.join("*");
}

/**
 * `depth` parentheses nested around a single digit, e.g. depth=3 ->
 * `"(((1)))"`.
 *
 * This is the textbook exponential-backtracking case for unfactored PEG
 * choice: each nesting level re-triggers the same 3x reparse described
 * above, and because `atom = "(" sum ")" / number` puts a full `sum` back
 * at the next level, the reparse cost compounds *multiplicatively* across
 * levels (~9x per added level of depth, measured empirically while
 * building this benchmark: depth 4 ≈ 40ms, depth 5 ≈ 300ms, depth 6 ≈
 * 3.4s on the reference machine used during development).
 *
 * DO NOT raise `DEFAULT_PATHOLOGICAL_DEPTH` casually -- at this growth
 * rate, depth 8 is already on the order of minutes. This generator
 * exists to make the exponential blowup PEG theory warns about visible
 * and measurable, not to be a general-purpose large-input generator.
 *
 * `digit` swaps the single character at the core without changing depth
 * -- see `generateVariedInputs` below.
 */
export function generateNestedParens(depth: number, digit = "1"): string {
  return "(".repeat(depth) + digit + ")".repeat(depth);
}

/** Safe default for `generateNestedParens` -- see its docstring. */
export const DEFAULT_PATHOLOGICAL_DEPTH = 5;

/**
 * Builds `count` inputs of (approximately) the same size/shape by calling
 * `generate(seed)` with `seed = 0, 1, 2, ...`.
 *
 * This exists because `packages/combinator/src/logic.ts`'s `memoize`
 * caches by the *exact input string*: benchmarking an optimized
 * (memoizing) parser by calling it `iterations` times on one fixed input
 * would, after the first call, measure nothing but cache hits -- which is
 * not a meaningful comparison against the standard (non-memoizing)
 * codegen path, and isn't representative of real usage either (a parser
 * is normally run once per distinct document, not N times on the same
 * one). Varying the input's content, while holding its size/structure
 * fixed, keeps the comparison honest.
 */
export function generateVariedInputs(
  count: number,
  generate: (seed: number) => string,
): string[] {
  return Array.from({ length: count }, (_, seed) => generate(seed));
}
