# tpeg-generator

Template-based code generation system for TPEG parsers. Separated from the parser package for modular architecture and reusability.

## Features

- **Template-Based Generation**: Uses Eta template engine for predictable output
- **Type-Safe**: Full TypeScript support with strict type checking
- **Performance Optimized**: Automatic memoization and optimization detection
- **Modular Architecture**: Independent package for code generation concerns
- **Multiple Output Modes**: Basic and performance-optimized code generation

## Installation

```bash
bun add @suzumiyaaoba/tpeg-generator
```

## Usage

### Basic Code Generation

```typescript
import { generateEtaTypeScriptParser } from "@suzumiyaaoba/tpeg-generator";
import type { GrammarDefinition } from "@suzumiyaaoba/tpeg-generator";

const grammar: GrammarDefinition = {
  type: "GrammarDefinition",
  name: "Calculator",
  annotations: [],
  rules: [
    {
      type: "RuleDefinition",
      name: "number",
      pattern: {
        type: "StringLiteral",
        value: "123",
      },
    },
  ],
};

const result = await generateEtaTypeScriptParser(grammar, {
  namePrefix: "calc_",
  includeTypes: true,
  optimize: true,
});

console.log(result.code); // Generated TypeScript parser code
```

### Advanced Configuration

```typescript
import { EtaTPEGCodeGenerator } from "@suzumiyaaoba/tpeg-generator";

const generator = new EtaTPEGCodeGenerator({
  language: "typescript",
  namePrefix: "parser_",
  includeTypes: true,
  optimize: true,
  enableMemoization: true,
  includeMonitoring: false,
  templatesDir: "./custom-templates",
  cache: true,
  debug: false,
});

const result = await generator.generateGrammar(grammar);
```

## Template System

The generator uses external template files for predictable and maintainable code generation:

```
templates/
├── base/
│   ├── imports.eta          # Standard imports
│   ├── parser-file.eta      # Basic parser file structure
│   ├── rule.eta            # Standard rule generation
│   └── rule-memoized.eta   # Memoized rule generation
└── optimized/
    ├── imports.eta          # Performance-enhanced imports
    ├── parser-file.eta      # Optimized parser file
    └── rule-optimized.eta   # Performance-optimized rules
```

## API Reference

### Functions

#### `generateEtaTypeScriptParser(grammar, options?)`

Convenience function to generate TypeScript parser code.

- `grammar`: GrammarDefinition - The TPEG grammar to generate code for
- `options`: Partial<CodeGenOptions> - Generation options
- Returns: Promise<GeneratedCode>

### Classes

#### `EtaTPEGCodeGenerator`

Main code generator class with full configuration options.

### Types

#### `CodeGenOptions`

Configuration options for code generation:

```typescript
interface CodeGenOptions {
  language: "typescript";
  namePrefix?: string;
  header?: string;
  includeImports?: boolean;
  includeTypes?: boolean;
  optimize?: boolean;
  enableMemoization?: boolean;
  includeMonitoring?: boolean;
  templatesDir?: string;
  cache?: boolean;
  debug?: boolean;
}
```

With `includeTypes: true`, actions and transforms include the annotations needed for strict TypeScript compilation; `includeTypes: false` emits plain JavaScript. Transform failures preserve their original message even if the captured value cannot be JSON-serialized. In that case, the diagnostic's `found` field is `<unserializable value>`.

Generated actions and transforms preserve the child's match positions before reading its value or invoking user code. Reentering a custom parser that reuses a success object does not change the outer match's consumption. A transform reads its input value once and uses that same value for rejection diagnostics; object values are shared, not cloned. An action with no capture references and no bare `eval` reference does not read the child value. The snapshot bindings `__current` and `__next` are reserved for generated code, so choose another rule or external parser name, or use `namePrefix` for rules.

Actions obtain the raw capture before entering the scope containing labels and authored declarations. A label or action-local declaration named `__result` can therefore be used without shadowing the parser result used to read the capture.

A directly visible label is `undefined` when the matched value has no own enumerable field for that name. Such bindings read only own enumerable capture fields, excluding prototype properties and intrinsic fields such as a string or array’s `length`. `$$` retains the original value. Grouping parentheses are transparent at any depth. Labels guaranteed on every alternative retain the usual direct read; field getters are read only for referenced labels.

An action containing a bare `eval` reference conservatively keeps `$$` and all directly visible labels, including when the evaluated source computes a label name at runtime. Typed output includes harmless reads so these bindings pass `noUnusedLocals`. Unicode escapes in identifier names are recognized. Strings, comments, regular expressions and unrelated object property names do not request capture bindings.

Rule names such as `JSON` do not shadow the standard objects used by generated diagnostics. When a TypeScript transform is emitted, a rule whose declaration name is `globalThis` is rejected because diagnostics need the global object. Set `namePrefix` or rename the rule to avoid this collision. The parser package's optimized generator applies the same check when inline monitoring is enabled.

`undefined` and `Infinity` are also valid rule names. Generated absence checks, including the parser package’s regex-fusion reconstruction and inline monitoring, do not resolve the `undefined` binding. A hand-built `Quantified` AST with `max: Infinity` uses the repetition combinator’s default unbounded maximum, so a rule named `Infinity` does not change its range. When JSON serialization returns no value, transform diagnostics omit `found`.

#### `GeneratedCode`

Result of code generation:

```typescript
interface GeneratedCode {
  code: string;
  imports: string[];
  exports: string[];
  performance: {
    estimatedComplexity: "low" | "medium" | "high";
    optimizationSuggestions: string[];
    generationTime: number;
    templateEngine: string;
  };
}
```

## Performance Analysis

The generator includes comprehensive performance analysis:

```typescript
import { analyzeGrammarPerformance } from "@suzumiyaaoba/tpeg-generator";

const analysis = analyzeGrammarPerformance(grammar);
console.log(analysis.estimatedParseComplexity); // 'low' | 'medium' | 'high'
console.log(analysis.optimizationSuggestions); // Array of suggestions
```

`generationTime` measures each generation call independently, including overlapping calls on the same generator. Once measurement begins, failed generation attempts are also counted in `globalPerformanceMonitor` and their timers are finished before the error propagates.

For asynchronous work, `PerformanceMonitor.startTimer(operation)` returns a completion function that records that call's duration. Call it in `finally`; repeated completion returns the same duration without adding another measurement. `clear()` cancels unfinished timers. `start(operation)` / `end(operation)` remain available for synchronous, nested measurements.

## Template Customization

You can customize code generation by providing your own template directory:

```typescript
const generator = new EtaTPEGCodeGenerator({
  templatesDir: "./my-custom-templates",
  // ... other options
});
```

## Testing

The package includes comprehensive tests including snapshot tests for code generation consistency:

```bash
# Run all tests
bunx vp test

# Run snapshot tests only
bunx vp test packages/generator/src/eta-generator.spec.ts

# Update snapshots after code changes
bunx vp test -u
```

### Snapshot Testing

Snapshot tests ensure that code generation produces consistent and expected output. They verify:

- Generated TypeScript code structure
- Import statements
- Export declarations
- Performance metadata

For detailed information about snapshot testing, see [SNAPSHOT_TESTING.md](./SNAPSHOT_TESTING.md).

## Development

```bash
# Install dependencies
bun install

# Build the package
bun run build

# Run tests
bun run test

# Type checking
bun run typecheck
```

## License

MIT

## Native language generators and plugins

`generateParser(grammar, { language })` supports `typescript`, `javascript`,
`python`, `go`, and `rust`. `grammar` is the canonical `GrammarDefinition`
AST. JavaScript output removes types inside actions and transforms as well
as generated annotations. Native output requires only the target language's
standard library.

```typescript
import { bundleGrammarFile } from "@suzumiyaaoba/tpeg-parser";
import {
  generateParser,
  generateNativeParser,
} from "@suzumiyaaoba/tpeg-generator";

const grammar = bundleGrammarFile("./grammar.tpeg");
const python = await generateParser(grammar, { language: "python" });
const go = generateNativeParser(grammar, "go", { packageName: "parser" });
```

Native parsers implement literals, code-point character classes, sequences,
ordered choice, recursive rules, bounded and unbounded repetition,
lookahead, labels, spans, word boundaries, cuts, `@skip`/`@noskip`, and
`@memoize` (including bounded caches). Memo tables belong to one parse;
transforms run outside the memoized raw rule, as in the TypeScript backend.

| Target | Entry point                                                                           | Captured values                                      |
| ------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Python | `parse(text, rule=None, offset=0, *, complete=False, max_depth=256, transforms=None)` | strings, lists, dicts, `None`                        |
| Go     | `Parse(input, options ...ParseOptions)`                                               | `any`: strings, `[]any`, `map[string]any`, `nil`     |
| Rust   | `parse(&str)` / `parse_with_options(&str, ParseOptions)`                              | `Value::{String, Array, Object, Null, Bool, Number}` |

Results contain `success`, `val`, `current`, and `next`, or `error` with a
position, expected/found text, and cut/abort flags. Go results marshal with
`encoding/json`; Rust results expose `to_json()`. Prefix matching is the
default; `complete`/`Complete` requires end of input. Rule names select any
generated rule. Offsets use UTF-16 units to match the TypeScript API.
Go and Rust require Unicode scalar literals and offsets at code-point
boundaries; Go also rejects invalid UTF-8 input. Python additionally supports
unpaired surrogates. Native diagnostic wording can differ from TypeScript.

JavaScript uses the `@typescript` transform set and transpiles its bodies.

Use a `transforms Name@python`, `@go`, or `@rust` block for native code.
Only the first transform set for the selected language is used. Each
function receives the rule's raw captured value; its TPEG signature's type
text is descriptive, while the generated native parameter uses the types
below. JavaScript/TypeScript inline `{ ... }` actions are rejected by native
generators rather than translated into another language.

```tpeg
grammar Count { number = [0-9]+ }

transforms Count@python {
  number(captures: any) -> Result<number> {
    return {"success": True, "value": len(captures)}
  }
}
transforms Count@go {
  number(captures: any) -> Result<number> {
    return TransformResult{Success: true, Value: len(captures.([]any))}
  }
}
transforms Count@rust {
  number(captures: any) -> Result<number> {
    match captures {
      Value::Array(values) => Ok(Value::Number(values.len() as f64)),
      _ => Err("expected digits".into()),
    }
  }
}
```

Callbacks supplied at parse time override generated transforms. Python
callbacks return `{"success": True, "value": ...}` or
`{"success": False, "error": ...}`; Go callbacks have type
`func(any) TransformResult`; Rust callbacks have type
`fn(Value) -> Result<Value, String>`. `header` adds native declarations or
imports; `namePrefix` prefixes the entry point; `packageName` selects a Go
package. Native generation is synchronous through `generateNativeParser`.

Registries support additional target languages without global registration:

```typescript
import { createGeneratorRegistry } from "@suzumiyaaoba/tpeg-generator";

const registry = createGeneratorRegistry().register({
  language: "json",
  extension: ".json",
  generate(grammar) {
    return {
      code: JSON.stringify(grammar),
      language: "json",
      extension: ".json",
      exports: [],
      warnings: [],
    };
  },
});
const output = await registry.generate(grammar, { language: "json" });
```

Native execution tests use `python3`, `go`, and `rustc`. Set `TPEG_PYTHON`,
`TPEG_GO`, or `TPEG_RUSTC` to override their paths. Missing tools skip the
corresponding local tests; `TPEG_NATIVE_REQUIRED=1` makes them required (as
in CI). Tests compile and execute each backend, including deterministic
random grammars compared against TypeScript values and control flow.
