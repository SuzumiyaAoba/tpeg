# TPEG Samples

This package contains practical examples of the TPEG (TypeScript Parsing Expression Grammar) library. Each sample demonstrates different parsing capabilities and use cases.

## 📋 Available Samples

### 🧮 Arithmetic Calculator

- **Location**: `src/arith/`
- **Function**: Parsing and evaluation of arithmetic expressions
- **Features**:
  - Both direct calculation and AST construction approaches
  - Operator precedence handling
  - Parenthetical grouping
  - Floating-point number support
  - Interactive REPL

### 📊 CSV Parser

- **Location**: `src/csv/`
- **Function**: Parsing CSV format data
- **Features**:
  - Support for quoted fields
  - Escaped quote handling
  - Header-based object conversion
  - CSV generation functionality
  - Proper handling of empty fields

### 📋 JSON Parser

- **Location**: `src/json/`
- **Function**: Parsing JSON format data
- **Features**:
  - Complete JSON specification support
  - Nested structure handling
  - Support for all data types (strings, numbers, booleans, null, objects, arrays)
  - Proper whitespace handling

### 📝 PEG Meta-Grammar

- **Location**: `src/peg/`
- **Function**: Parsing PEG grammar itself
- **Features**:
  - PEG grammar structure demonstration
  - Meta-grammar concept explanation
  - Complex parsing expression examples

### ⚙️ INI Config Parser

- **Location**: `src/ini/`
- **Function**: Parsing INI-style configuration files
- **Features**:
  - `[section]` headers and global keys
  - `;`/`#` whole-line and inline comments
  - CRLF/LF/CR line endings
  - Round-trip serialization via `formatINI`

### 🧬 S-expression Parser

- **Location**: `src/sexpr/`
- **Function**: Parsing Lisp-style S-expressions
- **Features**:
  - Recursive nested lists via `recursive()`
  - Symbols, numbers, and quoted strings as distinct atom kinds
  - `'x` quote sugar desugared to `(quote x)`
  - `;` line comments
  - `printSExp` pretty-printing / round-tripping

### 🔗 URL Parser

- **Location**: `src/url/`
- **Function**: Decomposing absolute URLs into components
- **Features**:
  - `scheme://userinfo@host:port/path?query#fragment`
  - Optional authority so `mailto:`-style URLs parse too
  - `commit` keeping a malformed authority a hard error
  - Query-string decoding via `parseQueryParams`

### 🏗️ Code Generation (`.tpeg` → TypeScript)

- **Location**: `src/codegen/` (see its own `README.md`)
- **Function**: Generating a standalone TypeScript parser from a `.tpeg` grammar file
- **Features**:
  - Full pipeline: read grammar file → parse → generate → import → run
  - Both `generateTypeScriptParser` and `generateOptimizedTypeScriptParser`
  - `@start`/`@skip`/`@noskip` annotations and `{ ... }` semantic actions
  - Equivalent CLI usage documented side by side

## 🚀 Usage

### Running All Samples

```bash
# Use the main sample runner
bun run samples

# Run specific samples
bun run samples arith
bun run samples csv
bun run samples json
bun run samples peg
bun run samples ini
bun run samples sexpr
bun run samples url
bun run samples codegen

# Run all samples sequentially
bun run samples --all
```

### Running Individual Samples

```bash
# Arithmetic calculator
bun run arith              # Basic demo
bun run arith:examples     # Comprehensive examples
bun run arith:repl         # Interactive REPL

# CSV parser
bun run csv                # CSV parsing demo

# JSON parser
bun run json               # JSON parsing demo

# PEG grammar
bun run peg                # PEG grammar demo

# INI config parser
bun run ini                # INI parsing demo

# S-expression parser
bun run sexpr              # S-expression parsing demo

# URL parser
bun run url                # URL parsing demo

# Code generation
bun run codegen            # .tpeg -> TypeScript parser demo
bun run codegen:regen      # Regenerate src/codegen/generated/ only
```

### Running Tests

```bash
# Run all tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run specific test file
bunx vp test packages/samples/src/csv/csv.spec.ts
```

## 📚 Learning Points

### 1. Parser Combinators

Each sample demonstrates how to use TPEG's basic parser combinators:

- `literal()` - Literal string matching
- `choice()` - Alternative handling
- `seq()` - Sequence handling
- `map()` - Parse result transformation
- `zeroOrMore()`, `oneOrMore()` - Repetition patterns

### 2. Error Handling

- Providing meaningful error messages
- Proper handling of parse failures
- Error reporting with position information

### 3. Performance Considerations

- Using memoization
- Efficient parser structures
- Processing large datasets

### 4. Practical Patterns

- Handling recursive grammars
- Proper whitespace handling
- Data transformation and AST construction

## 🔧 Development

### Project Structure

```
src/
├── arith/          # Arithmetic calculator sample
│   ├── calculator.ts
│   ├── demo.ts
│   ├── repl.ts
│   └── *.spec.ts
├── csv/            # CSV parser sample
│   ├── csv.ts
│   ├── demo.ts
│   └── *.spec.ts
├── json/           # JSON parser sample
│   ├── json.ts
│   ├── demo.ts
│   └── *.spec.ts
├── peg/            # PEG grammar sample
│   ├── index.ts
│   ├── demo.ts
│   └── *.spec.ts
├── ini/            # INI config parser sample
│   ├── ini.ts
│   ├── demo.ts
│   └── *.spec.ts
├── sexpr/          # S-expression parser sample
│   ├── sexpr.ts
│   ├── demo.ts
│   └── *.spec.ts
├── url/            # URL parser sample
│   ├── url.ts
│   ├── demo.ts
│   └── *.spec.ts
├── codegen/        # .tpeg -> TypeScript generation sample
│   ├── calc.tpeg
│   ├── demo.ts
│   ├── generated/
│   ├── README.md
│   └── *.spec.ts
├── index.ts        # Main entry point
└── combinator.spec.ts  # Integration tests
```

### Adding New Samples

1. Create a new directory under `src/`
2. Create parser implementation file
3. Create demo file (`demo.ts`)
4. Create test file (`*.spec.ts`)
5. Add scripts to `package.json`
6. Register sample in `src/index.ts`

### Coding Standards

- Use TypeScript strict mode
- Provide proper type annotations
- Maintain comprehensive test coverage
- Implement meaningful error messages

## 📖 References

- [TPEG Core Documentation](../core/README.md)
- [TPEG Combinator Documentation](../combinator/README.md)
- [About PEG (Parsing Expression Grammar)](https://en.wikipedia.org/wiki/Parsing_expression_grammar)

## 🤝 Contributing

New samples and sample improvements are welcome! Please follow these guidelines:

1. Create practical and educationally valuable samples
2. Include comprehensive tests
3. Provide clear documentation
4. Follow existing coding standards

## 📄 License

MIT License - See [LICENSE](../../LICENSE) file for details.
