# Code Generation Sample: `.tpeg` → TypeScript Parser

This sample demonstrates TPEG's code-generation pipeline end to end:
a grammar file (`calc.tpeg`) is parsed into a `GrammarDefinition` AST,
compiled to standalone TypeScript by `tpeg-parser`'s generators, and the
resulting module is imported and executed.

## Files

```
calc.tpeg                          Grammar source (calculator with @start/@skip/@noskip + actions)
demo.ts                            parse -> generate -> write -> dynamically import -> run
generated/calc.generated.ts        Output of generateTypeScriptParser (committed, inspectable)
generated/calc.optimized.generated.ts  Output of generateOptimizedTypeScriptParser
codegen.spec.ts                    Tests: pipeline, drift check, generated-parser behavior
```

## Running

```bash
# From the repository root
bun run --cwd packages/samples codegen

# Or directly
bun run packages/samples/src/codegen/demo.ts

# Just (re)write generated/ without running the parsers
bun run packages/samples/src/codegen/demo.ts --generate-only
```

## The same thing via the `tpeg` CLI

The demo mirrors `packages/cli/src/cli.ts`'s pipeline. The equivalent
one-shot commands are:

```bash
# Standard generator
bun run packages/cli/src/cli.ts \
  packages/samples/src/codegen/calc.tpeg \
  -o packages/samples/src/codegen/generated/calc.generated.ts

# Performance-optimized generator
bun run packages/cli/src/cli.ts \
  packages/samples/src/codegen/calc.tpeg --optimize \
  -o packages/samples/src/codegen/generated/calc.optimized.generated.ts
```

## Using the generated parser

Every rule becomes an exported `Parser<T>` (`(input, pos) => ParseResult`),
and the grammar's `@start` rule is additionally exported as `start`:

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { start, expression } from "./generated/calc.generated";

parse(start)("1 + 2 * 3"); // -> success, val: 7
parse(start)("1 +"); // -> failure (top requires `!.` EOF)
parse(expression)("1 +"); // -> success, val: 1 (prefix match)
```

## Grammar features this sample exercises

| Feature            | Where                                             |
| ------------------ | ------------------------------------------------- |
| `@start: rule`     | entry-point selection + `export { top as start }` |
| `@skip: ws`        | automatic whitespace at every sequence boundary   |
| `@noskip`          | keeps `number` lexical (`"- 12"` stays invalid)   |
| `name:expr` labels | `left`, `rest`, `op`, `right` captures            |
| `@expr` span       | `number` captures its raw matched text            |
| `{ ... }` actions  | per-alternative semantic actions (the evaluator)  |
| `!.` lookahead     | end-of-input assertion in `top`                   |
| `!`/`&`/`@`        | prefix operators                                  |
| `e*`/`e?`/`e+`     | repetition operators                              |
