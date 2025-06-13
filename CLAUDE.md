# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TPEG is a TypeScript library for building parsers using Parsing Expression Grammars (PEGs). The project is structured as a monorepo with multiple packages:

- **tpeg-core**: Core PEG parsing types and utilities
- **tpeg-combinator**: Parser combinators built on tpeg-core  
- **tpeg-ast**: Abstract Syntax Tree building and manipulation tools
- **tpeg-parser**: TPEG grammar parser implementation (Phase 1.1)
- **tpeg-samples**: Example parsers (JSON, CSV, arithmetic, PEG grammar)

## Development Commands

### Build System
```bash
# Build all packages
bun run build

# Build individual packages
bun run build:core
bun run build:ast  
bun run build:combinator
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

### Sample Parsers
```bash
# Try arithmetic calculator
cd packages/samples
bun run arith "1 + 2 * 3"
bun run arith --ast "(1 + 2) * 3"
bun run arith:repl

# Run other samples
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
    ├── tpeg-ast (depends on unist ecosystem)
    └── tpeg-samples (depends on tpeg-core, tpeg-combinator)
```

### Current Development Phase
The project has completed Phase 1.1 with major parser combinator refactoring. Recent achievements:
- Successfully refactored parser combinators from function-based to direct const declarations
- Implemented complete TPEG syntax parser for grammar definitions including labeled expressions
- All 683 tests passing with 100% CI success rate
- Key files: `packages/parser/src/`: TPEG grammar parser implementation
- Grammar specification: `docs/peg-grammar.md`

### Testing Strategy
- Comprehensive test suite with 683 tests across 34 files
- Unit tests for individual parsers and utilities (*.spec.ts)
- Integration tests for parser combinations and advanced features
- Sample parser implementation tests (JSON, CSV, arithmetic)
- Performance benchmarks in tpeg-combinator
- Achieved >95% test coverage across all packages

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

## Recent Major Changes (2025-06-13)

### Parser Combinator Refactoring
A comprehensive refactoring was completed to improve parser performance and code readability:

#### Changes Made
- **Function to Const Migration**: Converted 42 parser definitions from `() => Parser<...>` to direct `const` declarations
- **Files Affected**:
  - `packages/core/src/basic.ts`: Core parsers like `any`, `anyChar`, `literal`
  - `packages/combinator/index.ts`: Major combinators like `letter`, `digit`, `whitespace`, `identifier`
  - `packages/parser/src/`: All parser files updated to new pattern
  - Multiple test files updated to remove function calls

#### Benefits Achieved
- **Performance**: Eliminated unnecessary function wrappers
- **Readability**: Cleaner, more direct parser definitions
- **Maintainability**: Reduced cognitive overhead and potential for bugs
- **Test Coverage**: Maintained 100% functionality with 683/683 tests passing

#### Breaking Changes
- Parser imports now use direct constants instead of function calls
- Example: `any()` → `any`, `letter()` → `letter`, `digit()` → `digit`
- Exception: Complex parsers with circular dependencies remain functions (e.g., `expression()`)

#### Migration Guide
```typescript
// Before (deprecated)
import { letter } from 'tpeg-combinator';
const parser = letter();

// After (current)
import { letter } from 'tpeg-combinator';
const parser = letter;
```

#### CI/Testing Improvements
- Fixed console.error mocking in test suites
- Resolved unhandled errors between tests
- All 683 tests passing with 0 failures and 0 errors
- CI pipeline fully green and stable