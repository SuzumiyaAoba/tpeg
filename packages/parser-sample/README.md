# TPEG Parser Sample

A comprehensive demonstration of TPEG (TypeScript Parsing Expression Grammar) parser capabilities. This package showcases all implemented features, including basic syntax parsing, expression composition, and advanced grammar definition blocks.

## 🎯 What's Demonstrated

### Basic Parsing Features
- **String Literals**: `"hello world"`, `'single quotes'`, escape sequences
- **Character Classes**: `[a-z]`, `[0-9A-F]`, `[abc]`
- **Identifiers**: Variable names, camelCase, snake_case, Unicode support
- **Expression Composition**: Sequences, choices, groupings

### Advanced Grammar Features (Phase 1.6)
- **Grammar Annotations**: `@version`, `@description`, `@author`
- **Rule Definitions**: Complex parsing rules with expressions
- **Complete Grammar Blocks**: Structured grammar definitions
- **Comment Support**: Single-line (`//`) and documentation (`///`) comments
- **Unicode Support**: Full Unicode handling throughout

## 🚀 Quick Start

```bash
# Run the complete demo
bun run demo

# Run basic parsing features demo
bun run demo:basic

# Run grammar definition features demo
bun run demo:grammar
```

## 📚 Demo Scripts

### 1. Complete Demo (`bun run demo`)
A comprehensive overview of all TPEG features with real-world examples including a calculator grammar definition.

### 2. Basic Demo (`bun run demo:basic`)
Demonstrates fundamental parsing capabilities:
- String literal parsing with escape sequences
- Character class matching
- Identifier recognition
- Expression composition (sequences, choices, groups)

### 3. Grammar Demo (`bun run demo:grammar`)
Showcases Phase 1.6 grammar definition features:
- Grammar annotations for metadata
- Rule definitions with complex expressions
- Complete grammar blocks
- Comment parsing
- Real-world grammar examples

### 4. File-Based Demo (`bun run demo:files`)
Demonstrates file-based parsing workflows:
- Loading grammar definitions from .tpeg files
- Reading input samples from text files
- Real-world parsing scenarios
- Structured input processing

## 🔧 Example Usage

### Basic Parsing

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { stringLiteral, identifier, tpegExpression } from "@suzumiyaaoba/tpeg-parser";

// Parse a string literal
const result1 = parse(stringLiteral)('"hello world"');
// → { success: true, val: { type: "StringLiteral", value: "hello world", quote: '"' } }

// Parse an identifier
const result2 = parse(identifier)("myVariable");
// → { success: true, val: { type: "Identifier", name: "myVariable" } }

// Parse a complex expression
const result3 = parse(tpegExpression)('"start" " " [a-z]+ "end"');
// → { success: true, val: { type: "Sequence", elements: [...] } }
```

### Grammar Definition

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { grammarDefinition } from "@suzumiyaaoba/tpeg-parser";

const grammarSource = `
grammar Calculator {
  @version: "1.0"
  @description: "Simple arithmetic calculator"
  
  expression = term (("+" / "-") term)*
  term = factor (("*" / "/") factor)*
  factor = number / "(" expression ")"
  number = [0-9]+ ("." [0-9]+)?
}`;

const result = parse(grammarDefinition)(grammarSource);
// → { success: true, val: { name: "Calculator", annotations: [...], rules: [...] } }
```

## 🌟 Key Features Highlighted

### ✅ Implemented Features
- String literals with escape sequences (`\\n`, `\\t`, `\\"`, etc.)
- Character classes and ranges `[a-z]`, `[0-9A-F]`
- Identifiers with underscore support
- Expression composition (sequence, choice, grouping)
- Grammar annotations (`@version`, `@description`, etc.)
- Rule definitions with complex expressions
- Complete grammar blocks with metadata
- Comment parsing (`//` and `///`)
- Unicode support throughout all parsers
- Comprehensive error reporting with position info

### 🏗️ Architecture Benefits
- **Monorepo Structure**: Multiple focused packages
- **TypeScript Strict Mode**: Full compliance with `@tsconfig/strictest`
- **Comprehensive Testing**: high test coverage across the monorepo (run `bun run test` for the current count — it drifts with every commit)
- **Functional Design**: Parser combinators with performance optimizations
- **AST Generation**: Unist-compatible abstract syntax trees
- **Performance**: Const-based parser declarations for optimal speed

## 📦 Package Structure

```text
packages/parser-sample/
├── src/
│   ├── demo.ts             # Complete feature demonstration
│   ├── basic-demo.ts       # Basic parsing features
│   ├── grammar-demo.ts     # Grammar definition features
│   ├── file-demo.ts        # File-based parsing workflows
│   ├── generator-demo.ts   # Code generation demo
│   ├── performance-demo.ts # Performance demo
│   ├── grammar-validation.ts
│   ├── pos.ts
│   └── index.ts            # Main exports
├── package.json
├── tsconfig.json
└── README.md
```

## 🔗 Related Packages

- **tpeg-core**: Core parsing types and utilities
- **tpeg-parser**: TPEG grammar parser implementation
- **tpeg-combinator**: Parser combinators
- **tpeg-ast**: AST building and manipulation
- **tpeg-samples**: Additional example parsers (JSON, CSV, arithmetic)

## 💡 Next Steps

After exploring this demo:

1. **Examine the source code** in `src/` to understand implementation details
2. **Check out other samples** in `packages/samples/` for JSON, CSV, and arithmetic parsers
3. **Read the documentation** in each package's README for detailed API information
4. **Experiment with custom grammars** using the demonstrated patterns

## 🎉 Ready to Parse!

This sample demonstrates the full power of TPEG parsers. The implementation showcases both the elegant simplicity of basic parsing and the sophisticated capabilities of complete grammar definition systems.

Happy parsing with TPEG! 🚀