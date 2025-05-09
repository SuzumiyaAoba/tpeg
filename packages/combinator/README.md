# tpeg

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Note**: This project is currently under development (Alpha version). The API may change, so use with caution in production environments.

TPEG is a TypeScript library for building parsers using Parsing Expression Grammars (PEGs). It consists of multiple packages that work together to provide a flexible parsing solution.

## Features

- Lightweight: Minimal dependencies with a small footprint
- Declarative Grammars: Define grammars using composable combinators
- Modular Architecture: Use only the packages you need
- TypeScript Support: Built with TypeScript
- AST Support: Generate Abstract Syntax Trees for parsed content
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

## Usage Examples

TPEG includes sample parsers for:

- JSON Parser
- CSV Parser
- Arithmetic Expression Parser
- PEG Grammar Parser

### Basic Example

```typescript
import { literal, choice, seq, zeroOrMore } from "tpeg-core";
import { parse } from "tpeg-core";

// Define a simple parser for "hello" or "world"
const helloOrWorld = choice(literal("hello"), literal("world"));

// Parse a sequence of hello or world, separated by spaces
const parser = seq(helloOrWorld, zeroOrMore(seq(literal(" "), helloOrWorld)));

// Parse some text
const result = parse(parser)("hello world hello");
console.log(result);
```

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
