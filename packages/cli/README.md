# @suzumiyaaoba/tpeg-cli

Command-line interface for generating standalone TypeScript parsers from `.tpeg` grammar files.

## Usage

```bash
tpeg <input.tpeg> [options]
```

A `.tpeg` input file is a `grammar Name { ... }` block, optionally followed by one or more
`transforms Name@typescript { ... }` blocks (see [`docs/peg-grammar.md`](../../docs/peg-grammar.md)).

### Options

| Flag | Description |
| --- | --- |
| `-o, --output <path>` | Write generated code to this file (default: stdout) |
| `--name-prefix <name>` | Prefix every generated parser export with `<name>` |
| `--optimize` | Use the performance-optimized code generator |
| `--no-types` | Omit `Parser<T>` type annotations from output |
| `-h, --help` | Show usage |
| `-v, --version` | Show the CLI version |

### Examples

```bash
tpeg grammar.tpeg -o parser.ts
tpeg grammar.tpeg --optimize --name-prefix my_ > parser.ts
```

## Development

```bash
bun run dev -- grammar.tpeg      # run from source
bun run build                    # compile to dist/
bun run typecheck
bun test
```
