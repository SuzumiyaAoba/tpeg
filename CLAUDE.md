# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TPEG is a TypeScript library for building parsers using Parsing Expression Grammars (PEGs). The project is structured as a monorepo with multiple packages:

- **tpeg-core**: Core PEG parsing types and utilities
- **tpeg-combinator**: Parser combinators built on tpeg-core  
- **tpeg-ast**: Abstract Syntax Tree building and manipulation tools (using unist ecosystem)
- **tpeg-parser**: TPEG grammar parser implementation 
- **tpeg-generator**: Code generation system with template-based output using Eta templates
- **tpeg-parser-sample**: Comprehensive demo samples showcasing parser capabilities
- **tpeg-samples**: Legacy example parsers (JSON, CSV, arithmetic, PEG grammar)

## Development Commands

### Build System
```bash
# Build all packages
bun run build

# Build individual packages
bun run build:core
bun run build:ast  
bun run build:combinator
bun run build:parser
bun run build:generator
bun run build:parser-sample
```

### Testing
```bash
# Run all tests
bun run test

# Run tests with coverage
bun run test:coverage

# Watch tests during development
bun run test:watch

# Test specific package
cd packages/core && bun test
```

### Code Quality
```bash
# Lint and format with Biome
bun run lint
bun run check
bun run fix

# Type checking
bun run typecheck
```

### Demo and Sample Parsers
```bash
# Parser sample demos (comprehensive)
bun run demo              # Full demo
bun run demo:basic        # Basic parsing demo
bun run demo:grammar      # Grammar validation demo  
bun run demo:files        # File parsing demo

# Legacy sample parsers
cd packages/samples
bun run arith "1 + 2 * 3"
bun run arith --ast "(1 + 2) * 3"
bun run arith:repl

# Run other legacy samples
bun run json
bun run csv
bun run peg
```

## Architecture

### Core Parser Design
The parsing system follows a functional approach with these key concepts:

- **Parser<T>**: Function type `(input: string, position: number) => ParseResult<T>`
- **ParseResult<T>**: Either success with value and new position, or failure with error
- **Combinators**: Higher-order functions that combine parsers (seq, choice, zeroOrMore, etc.)

### Package Dependencies
```
tpeg-core (no dependencies)
    ├── tpeg-combinator (depends on tpeg-core)
    ├── tpeg-ast (depends on unist ecosystem: @types/unist, unist-builder)
    ├── tpeg-parser (depends on tpeg-core, tpeg-combinator)
    ├── tpeg-generator (depends on tpeg-core, eta templates)
    ├── tpeg-parser-sample (depends on tpeg-core, tpeg-parser)
    └── tpeg-samples (depends on tpeg-core, tpeg-combinator) [legacy]
```

### Current Development Phase
The project has completed Phase 3.1 with parser generation system implementation. Recent achievements:
- **Phase 3.1 Complete**: Implemented comprehensive parser generation system with type inference
- **Code Generation**: Added tpeg-generator package with Eta template-based code generation
- **Type Inference System**: Advanced type inference for parser combinators and generated code
- **Parser Sample Framework**: Comprehensive demo system in tpeg-parser-sample package
- **Monorepo Structure**: 7 packages with ~192 TypeScript files and 40 test files
- **Full Test Coverage**: All tests passing with comprehensive integration testing
- Key files: 
  - `packages/generator/src/`: Code generation implementation
  - `packages/parser-sample/src/`: Demo and validation systems
  - `packages/parser/src/`: TPEG grammar parser implementation
- Grammar specification: `docs/peg-grammar.md`

### Testing Strategy
- Comprehensive test suite with 40 test files across 7 packages (~192 TypeScript files total)
- Unit tests for individual parsers and utilities (*.spec.ts)
- Integration tests for parser combinations and advanced features
- Type inference system integration tests
- Code generation and template system tests
- Sample parser implementation tests (JSON, CSV, arithmetic)
- Performance benchmarks in tpeg-combinator
- Grammar validation and error handling tests
- Achieved comprehensive test coverage across all packages

## Code Style and Development Guidelines

### TypeScript Standards
- Use TypeScript strict mode, avoid `any` type
- Follow naming conventions: camelCase for variables/functions, PascalCase for classes/types, UPPER_CASE for constants
- Use generics for type-safe reusable functions
- Be explicit about types and leverage type narrowing

### Code Quality
- Uses Biome for formatting and linting (`bun run lint`, `bun run check`, `bun run fix`)
- Double quotes for strings, space indentation
- ESM modules throughout
- Keep functions small and focused on single responsibility
- Write comprehensive JSDoc comments for public APIs

### Parser Implementation
- **Parser Architecture**: Use direct const declarations for better performance and readability
  - Prefer `export const parser: Parser<T> = ...` over `export const parser = (): Parser<T> => ...`
  - Use IIFE pattern `(() => { ... })()` only when complex initialization is required
  - Maintain function-based parsers only for recursive dependencies (e.g., `expression()` in composition.ts)
- Follow PEG principles consistently, ensure proper termination conditions
- Design composable and reusable parsers with clear abstractions
- Provide meaningful error messages with position information
- Handle whitespace and comments appropriately
- Document parser behavior and usage patterns

### Performance Optimization
- Use memoization for recursive parsers to avoid exponential complexity
- Profile parser performance for large inputs
- Minimize object allocations in hot paths
- Set limits on input size and recursion depth
- Include benchmarks for critical parsing operations

### Security Considerations
- Validate and sanitize untrusted input before parsing
- Set limits on input size and recursion depth to prevent DoS/stack overflow
- Avoid regex patterns vulnerable to catastrophic backtracking
- Implement timeout mechanisms for long-running operations

### Git Workflow
- Use descriptive commit messages with types: feat, fix, docs, style, refactor, test, chore
- Create GitHub Issues for features and bugs, link commits with "Fixes #123"
- Use feature branches with descriptive names
- Add AI assistance signature to PRs: `*This Pull Request was created with assistance from Claude 4 Sonnet*`

## Recent Major Changes (2025-07-01)

### Phase 3.1: Parser Generation System (Latest)
Major milestone with comprehensive parser generation capabilities:

#### Key Additions
- **tpeg-generator Package**: Complete code generation system using Eta templates
  - Template-based parser generation with optimized and base variants
  - Performance utilities and type-safe code generation
  - Supports both memoized and optimized parser output patterns

- **tpeg-parser-sample Package**: Comprehensive demonstration framework
  - Grammar validation and parsing demonstrations
  - File-based parser examples with TPEG grammar files
  - Performance benchmarking and generator integration demos

- **Type Inference System**: Advanced type inference for parser combinators
  - Intelligent type narrowing and inference for generated parsers
  - Integration with existing parser combinator architecture
  - Comprehensive test coverage for type inference scenarios

#### Enhanced Package Structure
- **7 Total Packages**: Core, combinator, AST, parser, generator, parser-sample, samples (legacy)
- **~192 TypeScript Files**: Substantial codebase growth with robust architecture
- **40 Test Files**: Comprehensive testing across all packages and integration points
- **Eta Template System**: Professional-grade code generation with template inheritance

#### Recent Improvements
- Resolved all Biome linting errors across the monorepo
- Fixed TypeScript module resolution issues in monorepo configuration
- Enhanced build system with individual package build targets
- Comprehensive demo system showcasing parser capabilities

### Previous Phase 1.1: Parser Combinator Refactoring
Earlier foundational work that established current architecture:

#### Migration Guide (Still Relevant)
```typescript
// Before (deprecated)
import { letter } from 'tpeg-combinator';
const parser = letter();

// After (current)
import { letter } from 'tpeg-combinator';
const parser = letter;
```

#### Breaking Changes
- Parser imports now use direct constants instead of function calls
- Exception: Complex parsers with circular dependencies remain functions (e.g., `expression()`)