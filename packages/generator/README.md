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
bun add tpeg-generator
```

## Usage

### Basic Code Generation

```typescript
import { generateEtaTypeScriptParser } from 'tpeg-generator';
import type { GrammarDefinition } from 'tpeg-generator';

const grammar: GrammarDefinition = {
  type: 'GrammarDefinition',
  name: 'Calculator',
  annotations: [],
  rules: [
    {
      type: 'RuleDefinition',
      name: 'number',
      pattern: {
        type: 'StringLiteral',
        value: '123'
      }
    }
  ]
};

const result = await generateEtaTypeScriptParser(grammar, {
  namePrefix: 'calc_',
  includeTypes: true,
  optimize: true
});

console.log(result.code); // Generated TypeScript parser code
```

### Advanced Configuration

```typescript
import { EtaTPEGCodeGenerator } from 'tpeg-generator';

const generator = new EtaTPEGCodeGenerator({
  language: 'typescript',
  namePrefix: 'parser_',
  includeTypes: true,
  optimize: true,
  enableMemoization: true,
  includeMonitoring: false,
  templatesDir: './custom-templates',
  cache: true,
  debug: false
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
├── optimized/
│   ├── imports.eta          # Performance-enhanced imports
│   ├── parser-file.eta      # Optimized parser file
│   └── rule-optimized.eta   # Performance-optimized rules
└── helpers/
    └── format-utils.eta     # Formatting utilities
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
  language: 'typescript';
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
    estimatedComplexity: 'low' | 'medium' | 'high';
    optimizationSuggestions: string[];
    generationTime: number;
    templateEngine: string;
  };
}
```

## Performance Analysis

The generator includes comprehensive performance analysis:

```typescript
import { analyzeGrammarPerformance } from 'tpeg-generator';

const analysis = analyzeGrammarPerformance(grammar);
console.log(analysis.estimatedParseComplexity); // 'low' | 'medium' | 'high'
console.log(analysis.optimizationSuggestions); // Array of suggestions
```

## Template Customization

You can customize code generation by providing your own template directory:

```typescript
const generator = new EtaTPEGCodeGenerator({
  templatesDir: './my-custom-templates',
  // ... other options
});
```

## Testing

The package includes comprehensive tests including snapshot tests for code generation consistency:

```bash
# Run all tests
bun test

# Run snapshot tests only
bun test src/eta-generator.spec.ts

# Update snapshots after code changes
bun test --update-snapshots
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
bun test

# Type checking
bun run typecheck
```

## License

MIT