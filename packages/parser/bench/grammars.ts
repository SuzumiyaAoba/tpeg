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
