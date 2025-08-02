# @tpeg/type-inference

Type inference system for TPEG grammar definitions.

## Overview

This package provides comprehensive type inference capabilities for TPEG grammar definitions. It analyzes grammar structures and generates TypeScript type information for better type safety and enhanced developer experience.

## Features

- **Automatic Type Inference**: Analyzes TPEG expressions and generates appropriate TypeScript types
- **Circular Dependency Detection**: Detects and handles circular dependencies in grammar rules
- **Configurable Inference Strategies**: Customize type inference behavior through options
- **Performance Optimization**: Caching mechanisms for improved performance
- **Documentation Generation**: Automatic JSDoc comment generation for inferred types
- **Type Integration**: Seamless integration with code generation for type-safe parsers
- **Type Guards**: Automatic generation of type guard functions
- **Dependency Analysis**: Comprehensive analysis of rule dependencies

## Installation

```bash
npm install @tpeg/type-inference
```

## Usage

### Basic Type Inference

```typescript
import { TypeInferenceEngine } from '@tpeg/type-inference';
import { 
  createGrammarDefinition, 
  createRuleDefinition, 
  createStringLiteral,
  createCharacterClass,
  createCharRange,
  createPlus,
  createSequence,
  createChoice
} from '@tpeg/core';

// Create a simple grammar
const grammar = createGrammarDefinition('MyGrammar', [], [
  createRuleDefinition('greeting', createStringLiteral('hello', '"')),
  createRuleDefinition('digit', createCharacterClass([createCharRange('0', '9')])),
  createRuleDefinition('number', createPlus(createCharacterClass([createCharRange('0', '9')]))),
  createRuleDefinition('expression', createChoice([
    createStringLiteral('hello', '"'),
    createStringLiteral('world', '"')
  ]))
]);

// Perform type inference
const engine = new TypeInferenceEngine();
const result = engine.inferGrammarTypes(grammar);

// Access inferred types
console.log(result.ruleTypes.get('greeting')?.typeString); // '"hello"'
console.log(result.ruleTypes.get('digit')?.typeString); // 'string'
console.log(result.ruleTypes.get('number')?.typeString); // 'string[]'
console.log(result.ruleTypes.get('expression')?.typeString); // '"hello" | "world"'
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
  detectCircularDependencies: true,
  customTypeMappings: new Map([
    ['email', 'string'],
    ['url', 'string'],
    ['uuid', 'string']
  ])
});
```

### Type Integration with Code Generation

```typescript
import { TypeIntegrationEngine } from '@tpeg/type-inference';

const integrationEngine = new TypeIntegrationEngine({
  strictTypes: true,
  includeDocumentation: true,
  generateTypeGuards: true,
  typeNamespace: 'MyGrammarTypes'
});

const typedGrammar = integrationEngine.createTypedGrammar(grammar);

// Generate type definitions
console.log(typedGrammar.typeDefinitions);
// Output:
// export namespace MyGrammarTypes {
//   export type GreetingResult = "hello";
//   export type DigitResult = string;
//   export type NumberResult = string[];
//   export type ExpressionResult = "hello" | "world";
//   
//   export function isGreetingResult(value: unknown): value is GreetingResult {
//     return typeof value === "string" && value === "hello";
//   }
//   // ... more type guards
// }

// Generate parser interface
const parserInterface = integrationEngine.generateParserInterface(typedGrammar);
console.log(parserInterface);
// Output:
// export interface MyGrammarParser {
//   greeting(input: string): ParseResult<GreetingResult>;
//   digit(input: string): ParseResult<DigitResult>;
//   number(input: string): ParseResult<NumberResult>;
//   expression(input: string): ParseResult<ExpressionResult>;
// }
```

### Complex Grammar Example

```typescript
import { 
  createGrammarDefinition, 
  createRuleDefinition, 
  createStringLiteral,
  createCharacterClass,
  createCharRange,
  createPlus,
  createSequence,
  createChoice,
  createOptional,
  createStar
} from '@tpeg/core';

// JSON-like grammar
const jsonGrammar = createGrammarDefinition('JSONGrammar', [], [
  createRuleDefinition('string', createStringLiteral('"', '"')),
  createRuleDefinition('number', createCharacterClass([createCharRange('0', '9')])),
  createRuleDefinition('boolean', createChoice([
    createStringLiteral('true', '"'),
    createStringLiteral('false', '"')
  ])),
  createRuleDefinition('array', createSequence([
    createStringLiteral('[', '"'),
    createOptional(createChoice([
      createCharacterClass([createCharRange('0', '9')]),
      createStringLiteral('"', '"')
    ])),
    createStar(createSequence([
      createStringLiteral(',', '"'),
      createChoice([
        createCharacterClass([createCharRange('0', '9')]),
        createStringLiteral('"', '"')
      ])
    ])),
    createStringLiteral(']', '"')
  ]))
]);

const engine = new TypeInferenceEngine({
  inferArrayTypes: true,
  inferUnionTypes: true,
  inferObjectTypes: true,
  generateDocumentation: true
});

const result = engine.inferGrammarTypes(jsonGrammar);

// Check for circular dependencies
console.log('Circular dependencies:', result.circularDependencies);

// Get type information for specific rules
const stringType = result.ruleTypes.get('string');
console.log('String rule type:', stringType?.typeString);
console.log('String rule documentation:', stringType?.documentation);
```

### Utility Methods

```typescript
const integrationEngine = new TypeIntegrationEngine();
const typedGrammar = integrationEngine.createTypedGrammar(grammar);

// Get type info for specific rule
const typeInfo = integrationEngine.getTypeInfo(typedGrammar, 'greeting');
console.log(typeInfo?.typeString); // '"hello"'

// Check for circular dependencies
const hasCircular = integrationEngine.hasCircularDependency(typedGrammar, 'ruleName');
console.log('Has circular dependency:', hasCircular);

// Get dependencies for a rule
const dependencies = integrationEngine.getDependencies(typedGrammar, 'number');
console.log('Dependencies:', dependencies); // ['digit']
```

## API Reference

### TypeInferenceEngine

Main class for performing type inference on TPEG grammars.

#### Constructor Options

- `inferArrayTypes` (boolean): Whether to infer array types for repetition operators (default: true)
- `inferUnionTypes` (boolean): Whether to infer union types for choice operators (default: true)
- `inferObjectTypes` (boolean): Whether to infer object types for sequence operators (default: true)
- `includePositions` (boolean): Whether to include position information in types (default: false)
- `customTypeMappings` (Map<string, string>): Custom type mappings for specific patterns
- `generateDocumentation` (boolean): Whether to generate JSDoc comments (default: true)
- `maxRecursionDepth` (number): Maximum recursion depth to prevent stack overflow (default: 50)
- `enableCaching` (boolean): Whether to enable caching for performance (default: true)
- `detectCircularDependencies` (boolean): Whether to detect circular dependencies (default: true)

#### Methods

- `inferGrammarTypes(grammar: GrammarDefinition): GrammarTypeInference`: Infer types for a complete grammar
- `inferExpressionType(expression: Expression): InferredType`: Infer type for a specific expression

### TypeIntegrationEngine

Combines type inference with code generation for enhanced type-safe parser generation.

#### Constructor Options

- `strictTypes` (boolean): Whether to generate strict types (no 'any' or 'unknown') (default: true)
- `includeDocumentation` (boolean): Whether to include JSDoc comments in generated types (default: true)
- `customTypeMappings` (Map<string, string>): Custom type mappings for specific patterns
- `generateTypeGuards` (boolean): Whether to generate type guards for inferred types (default: false)
- `typeNamespace` (string): Namespace for generated types (optional)

#### Methods

- `createTypedGrammar(grammar: GrammarDefinition): TypedGrammarDefinition`: Create a typed grammar definition with full type information
- `generateParserInterface(typedGrammar: TypedGrammarDefinition): string`: Generate complete TypeScript interface for the parser
- `getTypeInfo(typedGrammar: TypedGrammarDefinition, ruleName: string): InferredType | undefined`: Get type information for a specific rule
- `hasCircularDependency(typedGrammar: TypedGrammarDefinition, ruleName: string): boolean`: Check if a rule has circular dependencies
- `getDependencies(typedGrammar: TypedGrammarDefinition, ruleName: string): string[]`: Get all dependencies for a rule

### Types

#### InferredType

```typescript
interface InferredType {
  typeString: string;           // TypeScript type string
  nullable: boolean;           // Whether the type can be null/undefined
  isArray: boolean;           // Whether the type is an array
  baseType: string;           // Base type (string, number, etc.)
  imports: string[];          // Required imports
  documentation: string;      // Generated documentation
}
```

#### GrammarTypeInference

```typescript
interface GrammarTypeInference {
  ruleTypes: Map<string, InferredType>;           // Type information for each rule
  circularDependencies: string[][];               // Detected circular dependencies
  imports: string[];                              // Required imports
  documentation: string;                          // Generated documentation
}
```

#### TypedGrammarDefinition

```typescript
interface TypedGrammarDefinition extends Omit<GrammarDefinition, "rules"> {
  originalGrammar: GrammarDefinition;             // Original grammar definition
  rules: TypedRuleDefinition[];                   // Rules with type information
  typeInference: GrammarTypeInference;           // Type inference results
  typeDefinitions: string;                        // Generated TypeScript type definitions
  imports: string[];                              // Required imports
}
```

## Performance Considerations

- The type inference engine uses caching to improve performance for repeated operations
- Circular dependency detection is optimized to avoid infinite loops
- Large grammars are processed efficiently with configurable recursion limits
- Memory usage is optimized through efficient data structures

## Error Handling

The type inference system gracefully handles various error conditions:

- **Unknown Rule References**: Returns `unknown` type for undefined rules
- **Circular Dependencies**: Detects and reports circular dependencies
- **Invalid Expressions**: Handles malformed expressions gracefully
- **Recursion Limits**: Prevents stack overflow with configurable limits

## License

MIT 