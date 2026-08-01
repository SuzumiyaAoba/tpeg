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
