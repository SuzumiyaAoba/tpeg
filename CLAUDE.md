# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TPEG is a TypeScript library for building parsers using Parsing Expression Grammars (PEGs). The project is structured as a monorepo (`packages/*`, Bun workspaces) with these packages:

- **tpeg-core**: Core PEG parsing types, primitives and utilities. No dependency on any other package here.
- **tpeg-combinator**: Higher-level parser combinators built on tpeg-core, split into modules (`primitive`, `string`, `list`, `logic`, `error`, `debug`) re-exported from `packages/combinator/src/index.ts`.
- **tpeg-ast**: Abstract Syntax Tree building and manipulation tools (using the unist ecosystem)
- **tpeg-type-inference**: Type inference and type-safe-grammar integration for TPEG grammar definitions (`TypeInferenceEngine`, `TypeIntegrationEngine`). A separate package from tpeg-core.
- **tpeg-parser**: Parser for TPEG's own grammar definition syntax, built on tpeg-core + tpeg-combinator
- **tpeg-generator**: Code generation system with template-based output using Eta templates
- **tpeg-parser-sample**: Runnable demos of the grammar parser and generator
- **tpeg-samples**: Legacy example parsers (JSON, CSV, arithmetic, PEG grammar), built directly on tpeg-core/tpeg-combinator
- **tpeg-cli**: `tpeg` command-line tool that generates a standalone TypeScript parser from a `.tpeg` grammar file, built on tpeg-core + tpeg-parser

For exact current counts (packages, files, tests), don't trust prose — run the commands in this file (`find packages -name "*.spec.ts" | wc -l`, `bun test`, etc.); they drift with every commit and this file doesn't get updated in lockstep.

## Development Commands

### Build System
```bash
# Build all packages, in dependency order
bun run build

# Build individual packages
bun run build:core
bun run build:ast
bun run build:combinator
bun run build:parser
bun run build:generator
bun run build:type-inference
bun run build:parser-sample
bun run build:samples
bun run build:cli
```

Cross-package type resolution (e.g. `tpeg-combinator` importing types from `tpeg-core`) depends on each dependency's `dist/` existing — a package's `dist/index.d.ts` is what `tsc` resolves against for a workspace dependency. If you `bun run typecheck` on a package whose dependencies haven't been built yet, `tsc` can fall back to that dependency's raw `src/`, checked under *your* package's compiler options instead of its own (this is why CI runs `build` before `typecheck`).

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
# Read-only checks (what CI runs) -- do not modify files
bun run lint      # biome lint
bun run check     # biome check (lint + format + import order); this is the CI gate

# Writes to files -- local use only
bun run fix       # biome check --fix --unsafe
bun run format    # biome format --write

# Type checking (all 9 packages with a package.json)
bun run typecheck
```

CI order is `check` → `build` → `typecheck` → `test` (see `.github/workflows/ci.yml`); run the same sequence locally before pushing if you want to catch what CI will catch.

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
tpeg-core (no workspace dependencies)
    ├── tpeg-ast (also depends on unist ecosystem: @types/unist)
    ├── tpeg-combinator (depends on tpeg-core)
    │   └── tpeg-samples (depends on tpeg-core, tpeg-combinator) [legacy]
    ├── tpeg-generator (depends on tpeg-core, eta templates)
    ├── tpeg-type-inference (depends on tpeg-core)
    └── tpeg-parser (depends on tpeg-core, tpeg-combinator)
        ├── tpeg-parser-sample (depends on tpeg-core, tpeg-parser)
        └── tpeg-cli (depends on tpeg-core, tpeg-parser)
```

### Architecture Notes
- The grammar parser (`packages/parser/src/`) implements TPEG's own grammar definition syntax; the spec it follows is `docs/peg-grammar.md`.
- Code generation (`packages/generator/src/`) turns a parsed grammar into a standalone TypeScript parser using Eta templates, with optimized and base template variants.
- Type inference for grammar definitions (`TypeInferenceEngine`, `TypeIntegrationEngine`) lives in its own package, `packages/type-inference/src/`, not in `tpeg-core` — see the migration note below for the correct import.
- `packages/parser-sample/src/` holds runnable demos of the grammar parser and generator; `packages/samples/` is a separate, older set of hand-written example parsers (JSON, CSV, arithmetic, PEG) that predates the grammar parser and doesn't depend on it.
- A previous `self-transpile` package (using TPEG to parse its own grammar) was removed; the parser combinator implementation was subsequently split from one large file into the current `primitive`/`string`/`list`/`logic`/`error`/`debug` modules under `packages/combinator/src/`.
- `packages/parser/src/self-hosted/` is a validation artifact (not a replacement): it describes TPEG's own grammar syntax *in TPEG itself*, compiles it with `tpeg-cli`, and checks the result against the hand-written parser for byte-for-byte AST equivalence. Nothing outside that directory changed because of it — see its own `README.md` for the four-layer grammar breakdown.

### Migration note: type inference moved out of tpeg-core
`TypeInferenceEngine` and `TypeIntegrationEngine` live in `packages/type-inference/`, not `tpeg-core`. Import from `@suzumiyaaoba/tpeg-type-inference`:

```typescript
import { TypeInferenceEngine, TypeIntegrationEngine } from '@suzumiyaaoba/tpeg-type-inference';

const typeInference = new TypeInferenceEngine({
  inferArrayTypes: true,
  inferUnionTypes: true,
  generateDocumentation: true
});

const typeIntegration = new TypeIntegrationEngine({
  strictTypes: true,
  generateTypeGuards: true,
  typeNamespace: 'MyGrammar'
});

const typedGrammar = typeIntegration.createTypedGrammar(grammar);
const typeDefinitions = typedGrammar.typeDefinitions;
```

### Testing Strategy
- Unit tests for individual parsers and utilities (`*.spec.ts`, colocated with source under each package's `src/`)
- Integration tests for parser combinations and advanced features
- Type inference system integration tests
- Code generation and template system tests
- Sample parser implementation tests (JSON, CSV, arithmetic)
- Performance benchmarks in tpeg-combinator
- Grammar validation and error handling tests
- Run `bun run test` for current pass/fail counts and `bun run test:coverage` for current coverage — don't rely on numbers written here.

## Code Style and Development Guidelines

### TypeScript Standards
- Use TypeScript strict mode, avoid `any` type
- Follow naming conventions: camelCase for variables/functions, PascalCase for classes/types, UPPER_CASE for constants
- Use generics for type-safe reusable functions
- Be explicit about types and leverage type narrowing

### Code Quality
- Uses Biome for formatting and linting — see "Code Quality" under Development Commands above for which scripts are read-only vs. which write
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
- Note AI assistance in PR descriptions when applicable, naming the actual model used (don't hardcode a model name here — it will be wrong within a few months)

## Notes for AI Assistants

- **Don't trust historical narrative sections (including previous versions of this file) over the repository itself.** Package lists, dependency trees, counts, and "current status" claims go stale between edits of this file and reality. When in doubt, `grep`/`find`/run the command rather than citing prose here.
- **Don't cite this file's git history or past "Recent Changes" as project status.** `git log` is the authoritative record of what changed and when; this file should describe the current state, not a changelog.
- For current CI status, check the [Actions tab](https://github.com/SuzumiyaAoba/tpeg/actions) rather than trusting a claim written here.
