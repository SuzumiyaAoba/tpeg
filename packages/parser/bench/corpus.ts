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
 * A single digit (0-9), the entire input `BENCH_ACYCLIC_CHAIN_GRAMMAR`'s
 * `a0` needs to succeed. The grammar's cost is driven entirely by its
 * *shape* (10 levels of unfactored 3-way choice), not by input length --
 * unlike `generateJsonCorpus`/`generateMultiplicationChain`, scaling this
 * up wouldn't change what's being measured, only add irrelevant parse
 * work after the pathological part. `seed` only varies which digit, for
 * `generateVariedInputs` (so a memoizing config's cache can't be primed
 * by warmup on the exact strings the timed loop measures).
 */
export function generateChainInput(seed: number): string {
  return String(seed % 10);
}

/**
 * An INI-style config document of roughly `targetLength` characters,
 * mixing `[section]` headers, `key=value` assignments, and `#comment`
 * lines -- matches `BENCH_CUTTABLE_CONFIG_GRAMMAR` in `grammars.ts`. Every
 * line ends in `\n` (the grammar's `nl` rule requires it, including the
 * last line, since `doc = entry+` has no special handling for a final
 * unterminated entry).
 *
 * `seed` shifts the numbers embedded in section/key names without
 * changing the document's size or entry-type sequence -- see
 * `generateVariedInputs` below for why this matters for benchmarking a
 * memoizing parser.
 */
export function generateConfigCorpus(targetLength: number, seed = 0): string {
  const lines: string[] = [];
  let length = 0;
  let i = seed;
  while (length < targetLength) {
    const kind = i % 5;
    const line =
      kind === 0
        ? `[section${i}]\n`
        : kind === 1
          ? `# comment about entry ${i}\n`
          : `key${i}=value${i}\n`;
    lines.push(line);
    length += line.length;
    i++;
  }
  return lines.join("");
}

/**
 * A document of `count` statements of roughly `keywordsPerKind` keyword
 * alternatives cycled round-robin (if/import/interface/instanceof/true/
 * this/throw/try/const/continue/class/case/<plain ident>), each followed
 * by a distinct identifier and a semicolon -- matches
 * `BENCH_KEYWORD_GRAMMAR` in `grammars.ts`.
 *
 * `seed` shifts which keyword the cycle starts on and the identifier
 * suffix, without changing the document's length or statement count --
 * see `generateVariedInputs` below.
 */
const KEYWORD_CORPUS_KEYWORDS = [
  "if",
  "import",
  "interface",
  "instanceof",
  "true",
  "this",
  "throw",
  "try",
  "const",
  "continue",
  "class",
  "case",
  null, // the grammar's plain `ident ";"` fallback alternative
] as const;

export function generateKeywordCorpus(count: number, seed = 0): string {
  const stmts: string[] = [];
  for (let i = 0; i < count; i++) {
    const kw =
      KEYWORD_CORPUS_KEYWORDS[(i + seed) % KEYWORD_CORPUS_KEYWORDS.length];
    // Matches `BENCH_KEYWORD_GRAMMAR`'s `ident = [a-z] [a-z0-9]*` --
    // no underscores or other separators, just letters/digits.
    const ident = `x${seed}${i}`;
    stmts.push(kw === null ? `${ident};\n` : `${kw} ${ident};\n`);
  }
  return stmts.join("");
}

/**
 * A config-file-shaped document of roughly `targetLength` characters --
 * matches `BENCH_INLINE_REGULAR_GRAMMAR` in `grammars.ts`: one `key =
 * value` entry per line, `key` an identifier, `value` cycling through
 * the grammar's two `val` alternatives (a quoted string, and a plain or
 * decimal number, exercising `"-"? [0-9]+ ("." [0-9]+)?` fully across
 * the cycle). Leading spaces before the key and around `=` exercise
 * `entry`'s inline `[ \t\n\r]*` runs -- the exact sub-expressions
 * `regexFusionScope: "subtree"` targets.
 */
export function generateInlineRegularCorpus(
  targetLength: number,
  seed = 0,
): string {
  const lines: string[] = [];
  let length = 0;
  let i = seed;
  while (length < targetLength) {
    // Matches `key = h:[a-zA-Z_] t:[a-zA-Z0-9_]* {...}` -- a letter,
    // then letters/digits/underscores.
    const key = `key_${i}`;
    const kind = i % 3;
    const value =
      kind === 0 ? `"value${i}"` : kind === 1 ? `${i}` : `-${i}.${i % 10}`;
    const line = `  ${key} = ${value}\n`;
    lines.push(line);
    length += line.length;
    i++;
  }
  return lines.join("");
}

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
