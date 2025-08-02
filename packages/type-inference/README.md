# @tpeg/type-inference

Type inference system for TPEG grammar definitions.

## Overview

This package provides comprehensive type inference capabilities for TPEG grammar definitions. It analyzes grammar structures and generates TypeScript type information for better type safety.

## Features

- **Automatic Type Inference**: Analyzes TPEG expressions and generates appropriate TypeScript types
- **Circular Dependency Detection**: Detects and handles circular dependencies in grammar rules
- **Configurable Inference Strategies**: Customize type inference behavior through options
- **Performance Optimization**: Caching mechanisms for improved performance
- **Documentation Generation**: Automatic JSDoc comment generation for inferred types

## Installation

```bash
npm install @tpeg/type-inference
```

## Usage

### Basic Type Inference

```typescript
import { TypeInferenceEngine } from '@tpeg/type-inference';
import { createGrammarDefinition, createStringLiteral } from '@tpeg/core';

const grammar = createGrammarDefinition('MyGrammar', [
  createRuleDefinition('greeting', createStringLiteral('hello', '"'))
]);

const engine = new TypeInferenceEngine();
const result = engine.inferGrammarTypes(grammar);

console.log(result.ruleTypes.get('greeting')?.typeString); // '"hello"'
```

### Advanced Configuration

```typescript
const engine = new TypeInferenceEngine({
  inferArrayTypes: true,
  inferUnionTypes: true,
  inferObjectTypes: true,
  generateDocumentation: true,
  maxRecursionDepth: 100,
  enableCaching: true,
  detectCircularDependencies: true
});
```

### Type Integration

```typescript
import { TypeIntegrationEngine } from '@tpeg/type-inference';

const integrationEngine = new TypeIntegrationEngine({
  strictTypes: true,
  includeDocumentation: true,
  generateTypeGuards: true
});

const typedGrammar = integrationEngine.createTypedGrammar(grammar);
console.log(typedGrammar.typeDefinitions);
```

## API Reference

### TypeInferenceEngine

Main class for performing type inference on TPEG grammars.

#### Constructor Options

- `inferArrayTypes`: Whether to infer array types for repetition operators
- `inferUnionTypes`: Whether to infer union types for choice operators
- `inferObjectTypes`: Whether to infer object types for sequence operators
- `includePositions`: Whether to include position information in types
- `customTypeMappings`: Custom type mappings for specific patterns
- `generateDocumentation`: Whether to generate JSDoc comments
- `maxRecursionDepth`: Maximum recursion depth to prevent stack overflow
- `enableCaching`: Whether to enable caching for performance
- `detectCircularDependencies`: Whether to detect circular dependencies

#### Methods

- `inferGrammarTypes(grammar)`: Infer types for a complete grammar
- `inferExpressionType(expression)`: Infer type for a specific expression

### TypeIntegrationEngine

Combines type inference with code generation for enhanced type-safe parser generation.

#### Constructor Options

- `strictTypes`: Whether to generate strict types (no 'any' or 'unknown')
- `includeDocumentation`: Whether to include JSDoc comments in generated types
- `customTypeMappings`: Custom type mappings for specific patterns
- `generateTypeGuards`: Whether to generate type guards for inferred types
- `typeNamespace`: Namespace for generated types

#### Methods

- `createTypedGrammar(grammar)`: Create a typed grammar definition with full type information
- `generateParserInterface(typedGrammar)`: Generate complete TypeScript interface for the parser

## License

MIT 