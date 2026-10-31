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
