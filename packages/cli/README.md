# @suzumiyaaoba/tpeg-cli

Command-line interface for generating TypeScript, JavaScript, Python, Go and Rust parsers from `.tpeg` grammar files.

## Usage

```bash
tpeg <input.tpeg> [options]
```

A `.tpeg` input file is a `grammar Name { ... }` block, optionally followed by one or more
`transforms Name@typescript { ... }` blocks (see [`docs/peg-grammar.md`](../../docs/peg-grammar.md)).

### Options

| Flag                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-o, --output <path>`  | Write generated code to this file (default: stdout)                                                                                                                                                                                                                                                                                                                                                                                              |
| `--name-prefix <name>` | Prefix every generated parser export with `<name>`                                                                                                                                                                                                                                                                                                                                                                                               |
| `--optimize`           | Use the performance-optimized code generator (also enables FIRST-set predictive dispatch by default)                                                                                                                                                                                                                                                                                                                                             |
| `--ast-optimize`       | Rewrite the grammar before code generation: left-factor shared alternative prefixes, merge adjacent character classes, and degenerate `!x .` negative-lookahead pairs into a negated character class. Off by default — left-factoring's safety check doesn't look past an ancestor rule's own semantic action reading the factored rule's value shape, so review generated output for grammars with actions before relying on this in production |
| `--regex-fusion`       | Compile non-terminal-free rules to a single `regexFused(...)` call instead of a combinator tree. Requires `--optimize`. Off by default pending more real-world grammar coverage                                                                                                                                                                                                                                                                  |
| `--auto-cut`           | Insert cut/commit at provably safe positions in ordered choices (see `insertAutomaticCuts` in `packages/parser/src/ast-optimize.ts`). Applied after `--ast-optimize`'s rewrites, if both are given                                                                                                                                                                                                                                               |
| `--promote-cuts`       | Mark every provably-safe cut so it compiles to `commitAtTopLevel` instead of an ordinary, purely-local `commit`, letting `@memoize`'d rules discard now-unreachable cache entries. Applied after `--auto-cut`, if both are given — a no-op without `--auto-cut` and no hand-written `~` in the source grammar                                                                                                                                    |
| `--no-types`           | Omit `Parser<T>` type annotations from output                                                                                                                                                                                                                                                                                                                                                                                                    |
| `-h, --help`           | Show usage                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `-v, --version`        | Show the CLI version                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Examples

```bash
tpeg grammar.tpeg -o parser.ts
tpeg grammar.tpeg --optimize --name-prefix my_ > parser.ts
tpeg grammar.tpeg --optimize --ast-optimize > parser.ts
tpeg grammar.tpeg --optimize --regex-fusion --auto-cut > parser.ts
```

## Development

```bash
bun run dev -- grammar.tpeg      # run from source
bun run build                    # compile to dist/
bun run typecheck
bun run test
```

## Target languages and bundled imports

```bash
tpeg grammar.tpeg --language javascript -o parser.mjs
tpeg grammar.tpeg --language python -o parser.py
tpeg grammar.tpeg --language go --package-name parser -o parser.go
tpeg grammar.tpeg --language rust -o parser.rs
tpeg grammar.tpeg --bundle -o parser.ts
```

`-l`/`--language` selects the target; TypeScript remains the default.
Native targets require only their standard library. `--package-name` sets
the Go package name. `--header <file>` prepends imports or declarations;
TypeScript/JavaScript headers can supply external parser bindings.
`--name-prefix` prefixes the native
`parse`/`Parse` entry point. `--optimize`, regex fusion and `--no-types` apply
only to TypeScript/JavaScript; AST rewrites remain available for all targets.

`--bundle` reads the local import graph, validates versions and exports,
links selective and aliased imports, and resolves `extends`/`includes`.
Native targets enable it automatically. A child rule overrides an inherited
rule, and inherited references use that override; explicit `base.rule`
references still use the parent's rule. Ambiguous mixin rules require an
explicit override. Each rule retains the whitespace policy of its defining
module. Circular imports and incompatible versions fail before output is
written. Without `--bundle`, TypeScript/JavaScript keep their external-binding
behavior for imported parsers.

Native transforms must be written for the chosen language; inline
JavaScript/TypeScript actions cannot be compiled into a native target.
See the [generator guide](../generator/README.md#native-language-generators-and-plugins)
for parser APIs, captured-value types, callbacks and Unicode handling.
