/**
 * TPEG grammar sources used by the parse-throughput benchmark harness
 * (see `run.ts`).
 *
 * These are deliberately NOT reused from `packages/parser-sample/examples/`:
 * `json-lite.tpeg` there defines a rule named `null`, and the standard
 * codegen emits `export const null = ...`, which is a JavaScript reserved
 * word and fails to `eval`. That's a real latent codegen bug (rule names
 * aren't checked against the JS reserved-word list), but fixing it is out
 * of scope for the benchmark harness -- `BENCH_JSON_GRAMMAR` below just
 * avoids the collision by naming the rule `nullLiteral`.
 */

/**
 * A JSON grammar, structurally equivalent to `json-lite.tpeg` (no
 * whitespace rule, so inputs must be compact/whitespace-free -- see
 * `corpus.ts`). Used as a "realistic, mostly non-pathological" workload:
 * `choice` in `value` fails fast on a type mismatch (first-token
 * dispatch), so this mostly measures per-character/per-node allocation
 * overhead rather than deep backtracking.
 */
export const BENCH_JSON_GRAMMAR = `
grammar BenchJson {
  value = string / number / boolean / nullLiteral / object / array
  string = "\\"" [^"]* "\\""
  number = "-"? [0-9]+ ("." [0-9]+)?
  boolean = "true" / "false"
  nullLiteral = "null"
  object = "{" (pair ("," pair)*)? "}"
  pair = string ":" value
  array = "[" (value ("," value)*)? "]"
}
`;

export const BENCH_JSON_ROOT_RULE = "value";

/**
 * A deliberately *unfactored* arithmetic grammar: each precedence level is
 * a 3-way ordered choice where every alternative starts by parsing the
 * same sub-rule (`product`/`atom`) before checking for an operator.
 *
 *   sum     = product "+" sum / product "-" sum / product
 *   product = atom "*" product / atom "/" product / atom
 *
 * For any term that is *not* followed by an operator (e.g. the last
 * term in a chain, or any parenthesized sub-expression that ends there),
 * a naive backtracking PEG implementation re-parses that term once per
 * failed alternative before falling through to the bare `product`/`atom`
 * alternative. This is the textbook case packrat memoization and left
 * factoring both target (see plan Phase 2-d and 2-e) -- it exists here
 * specifically to give the benchmark something with real, measurable
 * backtracking, as opposed to `BENCH_JSON_GRAMMAR`'s mostly-linear cost.
 *
 * Contrast with `packages/parser-sample/examples/calculator.tpeg`, which
 * already writes this left-factored as `term (("+" / "-") term)*` and so
 * does NOT exhibit this cost -- it was deliberately not reused here.
 */
export const BENCH_UNFACTORED_ARITHMETIC_GRAMMAR = `
grammar BenchUnfactoredArithmetic {
  expr = sum
  sum = product "+" sum / product "-" sum / product
  product = atom "*" product / atom "/" product / atom
  atom = "(" sum ")" / number
  number = [0-9]+
}
`;

export const BENCH_UNFACTORED_ARITHMETIC_ROOT_RULE = "expr";

/**
 * A 10-level chain of unfactored 3-way choices, none of which are
 * recursive: `a0` depends on `a1`, `a1` on `a2`, ..., down to `a9` (a
 * plain digit run). No rule refers back to itself or to an ancestor, so
 * `codegen-optimized.ts`'s `hasRecursion` check (via
 * `performance-utils.ts`'s cycle detection over the rule dependency
 * graph) is `false` for every rule here, and each rule's own node
 * count/depth is small -- so the "high complexity" heuristic
 * (`maxDepth > 10 || nodeCount > 50`) also never fires. The result: the
 * current `enableMemoization` heuristic (`estimatedComplexity === "high"
 * || hasRecursion`) memoizes *zero* of these 10 rules.
 *
 * Yet this grammar is exponential: every alternative of `aN`'s 3-way
 * choice starts by parsing `aN+1`, so on a failing/backtracking parse
 * `aN+1` (and everything below it) is reparsed up to 3 times per level,
 * compounding down the chain -- 3^9 redundant reparses of `a9` for a
 * single top-level call to `a0`, even though the input is a single
 * digit. This is the acyclic counterpart to
 * `BENCH_UNFACTORED_ARITHMETIC_GRAMMAR`'s left-recursive-looking (but
 * actually right-recursive, just unfactored) backtracking: it exists
 * specifically to demonstrate that "is this rule part of a reference
 * cycle" is the wrong question for "will memoizing this rule matter" --
 * what matters is whether the rule is *reachable from more than one
 * point at the same input offset*, which has nothing to do with
 * recursion. See the plan's Phase 1 (`packages/parser/src/
 * reentrancy.ts`) for the replacement analysis, which correctly flags
 * `a1`..`a9` (every rule reachable from more than one alternative of an
 * enclosing choice) as memoization targets despite none of them being
 * recursive.
 */
export const BENCH_ACYCLIC_CHAIN_GRAMMAR = `
grammar BenchAcyclicChain {
  a0 = a1 "x" / a1 "y" / a1
  a1 = a2 "x" / a2 "y" / a2
  a2 = a3 "x" / a3 "y" / a3
  a3 = a4 "x" / a4 "y" / a4
  a4 = a5 "x" / a5 "y" / a5
  a5 = a6 "x" / a6 "y" / a6
  a6 = a7 "x" / a7 "y" / a7
  a7 = a8 "x" / a8 "y" / a8
  a8 = a9 "x" / a9 "y" / a9
  a9 = [0-9]+
}
`;

export const BENCH_ACYCLIC_CHAIN_ROOT_RULE = "a0";

/**
 * A config-file-shaped grammar whose `entry` alternatives are each a
 * `Sequence` of >= 2 elements with pairwise-disjoint FIRST sets -- the
 * exact shape `packages/parser/src/ast-optimize.ts`'s `computeCutCandidate`
 * requires to insert a cut. This is deliberately NOT written as
 * `entry = section / assign / comment` (a choice of bare `Identifier`
 * references), which is `BENCH_JSON_GRAMMAR`'s `value` shape and produces
 * ZERO automatic cuts -- `findCutPosition` only considers a `Sequence`
 * alternative of >= 2 elements.
 *
 * Hand-evaluated cut sites (verified empirically: `insertAutomaticCuts`
 * inserts exactly 3 `Cut` AST nodes, one per alternative -- see the perf
 * plan's Phase 0 section for why this differs from the generated code's
 * raw `commit(` occurrence count):
 *   - alt 1 (`"[" name "]" nl`): cut after `"["` (k=1); FIRST(`"["`) =
 *     {`[`} is disjoint from FIRST(`name`) = `[a-zA-Z_]` and FIRST(`"#"`)
 *     = {`#`}.
 *   - alt 2 (`name "=" value nl`): cut after `name` (k=1); FIRST(`name`)
 *     = `[a-zA-Z_]` is disjoint from FIRST(`"#"`) = {`#`}.
 *   - alt 3 (`"#" text nl`): last alternative -- vacuously safe (nothing
 *     left to exclude).
 *
 * Exists to give Pillar 7 (`promoteGlobalCuts`, `packages/parser/src/
 * ast-optimize.ts`, cut promotion to `commitAtTopLevel`) a workload:
 * `entry` is referenced only from `doc = entry+`, with no enclosing
 * `Choice` and no lookahead around that reference -- the promotion
 * predicate's reference-site clause (FIRST-disjointness at every ancestor
 * `Choice`, transitively to the start rule) is vacuously satisfied here
 * (there is no ancestor `Choice` at all), unlike
 * `BENCH_UNFACTORED_ARITHMETIC_GRAMMAR`'s single cut site (`atom`,
 * referenced from a `Choice` all of whose alternatives start with `atom`
 * -- promotion correctly refuses that one).
 *
 * NOTE: none of `entry`/`name`/`value`/`text`/`nl` are ever memoized under
 * `enableMemoization: true` -- `reentrancy.ts`'s analysis correctly finds
 * no rule here is ever re-invoked at an offset it was already parsed at
 * (`doc = entry+` only calls `entry` at strictly increasing offsets, no
 * ambiguity to backtrack through). That's expected for a config-file
 * grammar and is exactly why `BENCH_CUTTABLE_CONFIG_MEMOIZED_GRAMMAR`
 * (below) exists as a separate constant for the memo-table-truncation
 * measurement specifically -- this one is for the cut-promotion-count and
 * general-throughput measurements Phase 0's baseline table already
 * recorded against it, which an added `@memoize` annotation would change.
 */
export const BENCH_CUTTABLE_CONFIG_GRAMMAR = `
grammar BenchCuttable {
  doc   = entry+
  entry = "[" name "]" nl / name "=" value nl / "#" text nl
  name  = [a-zA-Z_] [a-zA-Z0-9_]*
  value = [^\\n]*
  text  = [^\\n]*
  nl    = "\\n"
}
`;

export const BENCH_CUTTABLE_CONFIG_ROOT_RULE = "doc";

/**
 * Identical to `BENCH_CUTTABLE_CONFIG_GRAMMAR` except `entry` carries an
 * explicit `@memoize` annotation, forcing a memo table to exist regardless
 * of what `reentrancy.ts`'s analysis would otherwise decide (see the note
 * on that constant) -- an `@memoize`-annotated rule is memoized
 * unconditionally, per `codegen-optimized.ts`'s `generateOptimizedRule`.
 * This is what a real user reaching for `@memoize` on a rule they expect
 * to backtrack into heavily (independent of whether this specific corpus
 * happens to trigger it) would write. Exists SPECIFICALLY so Pillar 7's
 * `peakMemoWindow` claim ("truncation bounds the table independent of
 * input length") has a memo table to bound in the first place -- forcing
 * memoization is the only way to construct that on an otherwise-linear,
 * non-backtracking grammar shape without abandoning the property that
 * makes it Pillar-7-promotable to begin with (a genuinely reentrant
 * `entry` would need its own `Choice`/lookahead structure, which would
 * then need its own disjointness argument at the reference site).
 */
export const BENCH_CUTTABLE_CONFIG_MEMOIZED_GRAMMAR = `
grammar BenchCuttableMemoized {
  doc   = entry+
  @memoize
  entry = "[" name "]" nl / name "=" value nl / "#" text nl
  name  = [a-zA-Z_] [a-zA-Z0-9_]*
  value = [^\\n]*
  text  = [^\\n]*
  nl    = "\\n"
}
`;

export const BENCH_CUTTABLE_CONFIG_MEMOIZED_ROOT_RULE = "doc";

/**
 * A statement grammar with 12 keyword-led alternatives clustered on 3
 * first characters ('i', 't', 'c'), colliding at depths 1-3:
 *   - 'i': if / import / interface / instanceof (if|import split at
 *     depth 2; interface|instanceof split at depth 3)
 *   - 't': true / this / throw / try ("th" collides two ways, resolved
 *     at depth 2/3)
 *   - 'c': const / continue / class / case
 * plus a fallback `ident ";"` alternative with no literal prefix, which
 * therefore belongs to every dispatch bucket regardless of lookahead
 * depth.
 *
 * `predictiveChoice` (`packages/core/src/combinators.ts`) dispatches on
 * exactly ONE character, so on this grammar it degenerates: at a
 * statement starting with 'i', all four 'i'-led alternatives (plus the
 * fallback) remain candidates after the first character, the same
 * problem FIRST_1 has with any keyword-dense grammar. Exists to give
 * Pillar 8 (literal-trie dispatch, extending `predictiveChoice` past one
 * character) a workload -- none of the other bench grammars have
 * alternatives sharing a first character at all, so a FIRST_1 baseline
 * measured against them can't show this degeneration or the fix.
 *
 * Each alternative ends in `nl` (matching `corpus.ts`'s
 * `generateKeywordCorpus`, one `"...;\n"` line per statement) so that
 * `program = stmt+` actually consumes the whole document instead of
 * stopping after the first statement -- an earlier version of this
 * grammar omitted `nl`, silently truncating `stmt+` to a single
 * iteration on every corpus (caught via a near-zero
 * `leafInvocationsPerParse` on a 35KB input -- worth remembering as a
 * general trap when pairing a `+`-repeated rule with a line-oriented
 * corpus generator: always match the repeated rule's own consumption
 * against the corpus's line terminator).
 */
export const BENCH_KEYWORD_GRAMMAR = `
grammar BenchKeyword {
  program = stmt+
  stmt    = "if" ws ident ";" nl / "import" ws ident ";" nl / "interface" ws ident ";" nl / "instanceof" ws ident ";" nl
          / "true" ws ident ";" nl / "this" ws ident ";" nl / "throw" ws ident ";" nl / "try" ws ident ";" nl
          / "const" ws ident ";" nl / "continue" ws ident ";" nl / "class" ws ident ";" nl / "case" ws ident ";" nl
          / ident ";" nl
  ident   = [a-z] [a-z0-9]*
  ws      = " "
  nl      = "\\n"
}
`;

export const BENCH_KEYWORD_ROOT_RULE = "program";
