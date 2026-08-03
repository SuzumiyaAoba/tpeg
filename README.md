# TPEG

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Status**: This project is in active development (alpha). APIs may change without notice.

TPEG is a TypeScript library for building parsers using Parsing Expression Grammars (PEGs). It is organized as a Bun/npm monorepo: a small core parsing engine, a combinator library built on top of it, a grammar parser for TPEG's own grammar syntax, and a template-based code generator, plus supporting AST and type-inference packages and example/demo packages.

日本語版は [README.ja.md](./README.ja.md) を参照してください.

## Packages

| Package | Description |
| --- | --- |
| [`@suzumiyaaoba/tpeg-core`](./packages/core) | Core PEG parsing types, primitives, and utilities. No dependency on any other package in this repo. |
| [`@suzumiyaaoba/tpeg-combinator`](./packages/combinator) | Higher-level parser combinators (strings, lists, error labeling, memoization, debugging) built on `tpeg-core`. |
| [`@suzumiyaaoba/tpeg-ast`](./packages/ast) | AST construction and manipulation helpers, built on the [unist](https://github.com/syntax-tree/unist) ecosystem. |
| [`@suzumiyaaoba/tpeg-type-inference`](./packages/type-inference) | Type inference and type-safe-grammar integration for TPEG grammar definitions. |
| [`@suzumiyaaoba/tpeg-parser`](./packages/parser) | A parser for TPEG's own grammar definition syntax, built on `tpeg-core` and `tpeg-combinator`. See [`docs/peg-grammar.md`](./docs/peg-grammar.md). |
| [`@suzumiyaaoba/tpeg-generator`](./packages/generator) | Template-based (Eta) code generation: turns a parsed TPEG grammar into a standalone TypeScript parser. |
| [`@suzumiyaaoba/tpeg-cli`](./packages/cli) | `tpeg` command-line tool: generates a standalone TypeScript parser from a `.tpeg` grammar file. |
| [`@suzumiyaaoba/tpeg-parser-sample`](./packages/parser-sample) | Runnable demos of the grammar parser and generator (`bun run demo`, `bun run demo:grammar`, ...). |
| [`@suzumiyaaoba/tpeg-samples`](./packages/samples) | Legacy example parsers (JSON, CSV, arithmetic, PEG) written directly against `tpeg-core`/`tpeg-combinator`. |

Each package has its own README with package-specific usage details and API notes; the list above is the map, not the territory — when a package's own README and this one disagree, trust the package's.

### Dependency graph

```
tpeg-core (no workspace dependencies)
├── tpeg-ast              (+ unist ecosystem)
├── tpeg-combinator        (depends on tpeg-core)
│   └── tpeg-samples       (depends on tpeg-core, tpeg-combinator) [legacy]
├── tpeg-generator         (+ eta templates)
├── tpeg-type-inference
└── tpeg-parser            (depends on tpeg-core, tpeg-combinator)
    ├── tpeg-parser-sample (depends on tpeg-core, tpeg-parser)
    └── tpeg-cli           (depends on tpeg-core, tpeg-parser)
```

## Quick example

```typescript
import { choice, literal, parse, seq, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

// A parser for "hello" or "world"
const helloOrWorld = choice(literal("hello"), literal("world"));

// A parser for a space-separated sequence of those
const parser = seq(helloOrWorld, zeroOrMore(seq(literal(" "), helloOrWorld)));

const result = parse(parser)("hello world hello");
console.log(result);
```

Try the arithmetic sample interactively:

```bash
git clone https://github.com/SuzumiyaAoba/tpeg.git
cd tpeg
bun install

cd packages/samples
bun run arith                        # basic demo
bun run arith "1 + 2 * 3"            # evaluate an expression
bun run arith --ast "(1 + 2) * 3"    # print the AST
bun run arith:repl                   # interactive REPL
```

## Development

Requires [Bun](https://bun.sh/).

```bash
bun install       # install dependencies for every workspace package

bun run check     # biome check, read-only (what CI runs)
bun run fix       # biome check --fix --unsafe, writes to source
bun run format    # biome format --write

bun run typecheck # tsc --noEmit for every package
bun run build     # build every package in dependency order

bun run test            # bun's own recursive test discovery, all packages
bun run test:coverage   # same, with coverage
bun run test:watch      # same, in watch mode
```

`lint`/`check` are read-only and safe to run in CI; `fix`/`format` write to files and are meant for local use. CI (`.github/workflows/ci.yml`) runs `check` → `build` → `typecheck` → `test`, in that order — `typecheck` runs after `build` because cross-package type resolution depends on each package's `dist/` existing.

Per-package scripts are also available, e.g. `cd packages/core && bun run test`, or via the root's namespaced scripts (`bun run build:core`, `bun run typecheck:combinator`, ...) — see `package.json` for the full list.

There is no fixed test/package/file count documented here on purpose — those numbers drift with every commit. Run the commands above to see current, accurate ones.

## Documentation

- [PEG fundamentals](./docs/peg.md) — an introduction to parsing expression grammars
- [TPEG grammar specification](./docs/peg-grammar.md) — the grammar definition language TPEG's own parser implements
- [CLI usage](./packages/cli/README.md) — generating a standalone parser from a `.tpeg` file with the `tpeg` command
- [Generator documentation](./packages/generator/README.md) — code generation system details
- [Snapshot testing guide](./packages/generator/SNAPSHOT_TESTING.md) — how the generator's snapshot tests work
- [`CLAUDE.md`](./CLAUDE.md) — guidance for AI coding assistants working in this repo (also useful as a technical overview for humans)

## License

MIT — see [LICENSE](./LICENSE).
