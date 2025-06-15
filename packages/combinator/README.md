# tpeg

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Note**: This project is currently under development (Alpha version). The API may change, so use with caution in production environments.

TPEG is a TypeScript library for building parsers using Parsing Expression Grammars (PEGs). It consists of multiple packages that work together to provide a flexible parsing solution.

## Features

- Lightweight: Minimal dependencies with a small footprint
- Declarative Grammars: Define grammars using composable combinators
- Modular Architecture: Use only the packages you need
- TypeScript Support: Built with TypeScript from the ground up
- AST Support: Generate Abstract Syntax Trees for parsed content
- Repetition Operators: Full support for PEG repetition operators (`*`, `+`, `?`, `{n,m}`)
- Efficient: Designed with performance in mind

## Packages

TPEG is organized as a monorepo with the following packages:

### tpeg-core

Core types and utilities for PEG parsing.

```bash
npm install tpeg-core
```

### tpeg-combinator

Parser combinators built on top of tpeg-core.

```bash
npm install tpeg-combinator
```

### tpeg-ast

Tools for building and manipulating Abstract Syntax Trees.

```bash
npm install tpeg-ast
```

### tpeg-parser (In Development)

PEG grammar parser for TPEG syntax with full repetition operator support.

```bash
npm install tpeg-parser
```

## Usage Examples

TPEG includes sample parsers for:

- JSON Parser
- CSV Parser
- Arithmetic Expression Parser
- PEG Grammar Parser

### Try the Arithmetic Calculator

You can easily try our arithmetic expression parser with the interactive tools:

```bash
# Clone and setup
git clone https://github.com/SuzumiyaAoba/tpeg.git
cd tpeg
bun install

# Try the calculator with different modes
cd packages/samples

# Basic demo
bun run arith

# Calculate a specific expression
bun run arith "1 + 2 * 3"

# Show AST structure
bun run arith --ast "(1 + 2) * 3"

#### Run all examples  
bun run arith:examples

# Interactive REPL
bun run arith:repl
```

### Basic Example

```typescript
import { literal, choice, seq, zeroOrMore, parse } from "tpeg-core";

// Define a simple parser for "hello" or "world"
const helloOrWorld = choice(literal("hello"), literal("world"));

// Parse a sequence of hello or world, separated by spaces
const parser = seq(helloOrWorld, zeroOrMore(seq(literal(" "), helloOrWorld)));

// Parse some text
const result = parse(parser, "hello world hello");
console.log(result);
```

## Parser Combinators

This package provides many useful parser combinators built on top of tpeg-core:

### String Parsing

- `quotedString()`: Parses a JavaScript/JSON-style double-quoted string
- `singleQuotedString()`: Parses a single-quoted string
- `anyQuotedString()`: Parses a string with either single or double quotes
- `takeUntil(condition)`: Consumes characters until a condition is met
- `between(open, close)`: Matches content between two parsers

### Pattern Matching

- `regex(pattern)`: Parses text that matches a regular expression
- `regexGroups(pattern)`: Parses and returns all capture groups from a regex match

### Number Parsing

- `number()`: Parses a JavaScript/JSON-style number including fractions and exponents
- `int()`: Parses an integer number

### List Parsing

- `sepBy(value, separator)`: Parses values separated by a delimiter (zero or more)
- `sepBy1(value, separator)`: Parses values separated by a delimiter (one or more)
- `commaSeparated(value)`: Parses comma-separated values with optional trailing comma
- `commaSeparated1(value)`: Parses comma-separated values (at least one)

### Error Handling

- `labeled(parser, message)`: Provides custom error messages
- `labeledWithContext(parser, message, context)`: Adds context to error messages
- `withDetailedError(parser, name)`: Creates detailed error reports with input excerpts
- `withPosition(parser)`: Tracks line and column for better error reporting

### Performance and Debugging

- `memoize(parser, options)`: Creates a memoized version of a parser with cache size control
- `recursive()`: Creates a recursive parser
- `debug(parser, name, options)`: Logs parsing process for debugging

### Whitespace and Tokens

- `token(parser)`: Wraps a parser to consume whitespace before and after
- `whitespace`: Consumes whitespace characters
- `spaces`: Consumes zero or more whitespace characters
- `newline`: Matches any newline sequence

## Getting Started

### Prerequisites

- Node.js 14+
- npm or bun

### Installation

```bash
# Install core package
npm install tpeg-core

# Or with bun
bun add tpeg-core

# Optionally install additional packages
npm install tpeg-combinator tpeg-ast
```

## Development

```bash
# Clone the repository
git clone https://github.com/SuzumiyaAoba/tpeg.git
cd tpeg

# Install dependencies
bun install

# Build all packages
bun run build

# Run tests
bun run test

# Run tests with coverage report
bun run test:coverage

# Watch tests during development
bun run test:watch
```

### Testing

TPEG has a comprehensive test suite including:

- Unit tests for individual parsers and utilities
- Integration tests for parser combinations
- Sample parser implementations tests
- Performance benchmarks

We aim to maintain high test coverage (>80%) to ensure stability and reliability.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
