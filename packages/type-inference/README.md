# @suzumiyaaoba/tpeg-type-inference

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
npm install @suzumiyaaoba/tpeg-type-inference
```

## Usage

### Basic Type Inference

```typescript
import { TypeInferenceEngine } from "@suzumiyaaoba/tpeg-type-inference";
import {
  createGrammarDefinition,
  createRuleDefinition,
  createStringLiteral,
  createCharacterClass,
  createCharRange,
  createIdentifier,
  createPlus,
  createSequence,
  createChoice,
} from "@suzumiyaaoba/tpeg-core";

// Create a simple grammar
const grammar = createGrammarDefinition(
  "MyGrammar",
  [],
  [
    createRuleDefinition("greeting", createStringLiteral("hello", '"')),
    createRuleDefinition(
      "digit",
      createCharacterClass([createCharRange("0", "9")]),
    ),
    createRuleDefinition("number", createPlus(createIdentifier("digit"))),
    createRuleDefinition(
      "expression",
      createChoice([
        createStringLiteral("hello", '"'),
        createStringLiteral("world", '"'),
      ]),
    ),
  ],
);

// Perform type inference
const engine = new TypeInferenceEngine();
const result = engine.inferGrammarTypes(grammar);

// Access inferred types
console.log(result.ruleTypes.get("greeting")?.typeString); // '"hello"'
console.log(result.ruleTypes.get("digit")?.typeString); // 'string'
console.log(result.ruleTypes.get("number")?.typeString); // 'string[]'
console.log(result.ruleTypes.get("expression")?.typeString); // '"hello" | "world"'
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
    ['"hello"', "string"],
    ['"world"', "string"],
  ]),
});
```

### Type Integration with Code Generation

```typescript
import { TypeIntegrationEngine } from "@suzumiyaaoba/tpeg-type-inference";

const integrationEngine = new TypeIntegrationEngine({
  includeDocumentation: true,
  generateTypeGuards: true,
  typeNamespace: "MyGrammarTypes",
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
// import type { ParseResult } from "@suzumiyaaoba/tpeg-core";
//
// export interface MyGrammarParser {
//   greeting(input: string): ParseResult<MyGrammarTypes.GreetingResult>;
//   digit(input: string): ParseResult<MyGrammarTypes.DigitResult>;
//   number(input: string): ParseResult<MyGrammarTypes.NumberResult>;
//   expression(input: string): ParseResult<MyGrammarTypes.ExpressionResult>;
// }
```

Generated guards validate required capture properties and their values recursively,
including objects nested in arrays and optional values. Array checks also inspect
sparse entries. A rule inferred as `unknown`, such as a semantic action, accepts
every value including `undefined`; a labeled `unknown` value still requires the
label's property to exist.
Within each tuple member check, guards read the member once and validate that
value through nested checks. Later members are read only if earlier checks pass.
Guards skip value reads when the type already determines the result: `unknown[]`
only requires an array, `never[]` requires an empty array, and an `unknown`
capture only requires the property to exist. A union containing `unknown`
accepts every value without inspecting its alternatives.
Array checks use the built-in method, so overriding an array's own `findIndex`
does not change validation. Guards also work when a namespace contains `Array`
or `undefined`. Namespace names may use dotted identifiers; a reserved root
such as `class`, or a strict-mode reserved binding such as `yield`, causes an
error when generating type definitions or parser interfaces.
When generating guards, names that cannot be runtime bindings, including
`await`, `eval`, `arguments`, and nested keywords such as `Types.class`, are
also rejected. Type-only output retains names that TypeScript permits.
Nested namespaces initialize their own properties, so names such as
`Types.__proto__` and `Types.constructor` do not modify built-in objects.
Existing own namespace properties are preserved.

`ParserResult` is reserved for the union of all rule results. A rule whose
PascalCase result name is `ParserResult`, such as `parser`, `Parser`, or `_parser`,
causes a descriptive generation error. Rename that rule to keep its result type
distinct. A `parse` rule and a root namespace named `ParseResult` are supported:
the parser interface imports the core `ParseResult` wrapper under a separate
name when needed, while preserving generated result type names.

Custom mapping keys match exact inferred type strings after child expressions
have been inferred. Each value replaces the whole type; mapping `"a"[]` to
`unknown` produces an `unknown` guard, with no array constraint. Mappings change
the generated types; the grammar and actions determine the parser's values.
Guards support mappings to `string`, `number`, `boolean`, `bigint`, `symbol`,
`object`, `unknown`, `any`, `never`, `void`, `undefined`, `null`, and individual
quoted string literal types. Other replacements, including external type names,
arrays and compound types, require your own validator: generating guards for
them throws a descriptive error. Set `generateTypeGuards: false` to generate
their type definitions, and supply any referenced type declarations separately.
Identity mappings preserve the original shape checks.

Edits to the supplied `customTypeMappings` map are observed by subsequent
inference calls, including cached expressions. Cache entries record the mapping
lookups used by their children as well as their own lookup. Changed lookups
trigger reinference; unrelated entries preserve cache reuse. This also applies
when a getter changes mappings during inference or invokes nested grammar
inference on the same engine.

The retained grammar's rule patterns also remain live for expression inference.
Replacing or editing a referenced pattern invalidates dependent cache entries,
including transitive references and surrounding arrays, tuples, and captures.
References that read pattern or expression accessors bypass caching, as do their
parents, so getters and their exceptions retain uncached behavior. Newly
introduced cycles and increased recursion depth are checked again.

Sequences with direct labels also merge same-level captures forwarded by
choices, optionals, groups, and bare singleton sequences. Later captures
overwrite earlier fields: `x:"a" (x:"b" / "c")` infers
`{ x: "b" } | { x: "a" }`. Rule boundaries, arrays of captures, and nested
merged objects contribute no same-level fields. With `inferObjectTypes`
enabled, this field analysis remains active when ordinary choice-value
unions are disabled.

An unlabeled semantic action or an external parser can return arbitrary
capture-tagged fields, including changed values and new keys. In a labeled
sequence, inference includes an `unknown` string index signature and widens
earlier field values to `unknown` on those branches. Their required presence
is retained. A subsequent guaranteed capture restores its precise value type;
optional later captures can still expose an earlier arbitrary value. Registered
rules strip the tag at their boundary, and arrays or labeled action values
contain it without merging its fields. Action source is not analyzed, so this
also widens an action that happens to return an ordinary object or scalar.

For unlabeled contributions to a labeled sequence, inference follows capture
tags through groups, choices, optionals, and bare singleton sequences. It does
not infer scalar values, arrays, nested merged objects, or local rule values
that cannot contribute fields. Only rule existence is needed at a local rule
boundary. This also avoids irrelevant cycle warnings for recursion such as
`start = x:"a" (start)?`, whose result is `{ x: "a" }`. Fields that actually
contribute still use full value inference and custom mappings. Value and
capture analysis have separate cache entries and retain dependency and depth
checks; asking for a discarded expression's own type still analyzes its value.
Circular diagnostics describe cycles encountered during value inference.
They do not enumerate every recursive parser call; `getDependencies` still
lists the rule references in the grammar AST, including discarded values.

If an intermediate merge exceeds 256 distinct capture combinations, inference
uses one object with required and optional fields, preserving possible field
values and subsequent overwrites while widening correlations between fields.
`InferredType.optionalObjectProperties` identifies the optional fields in
`objectProperties`. Generated guards allow those fields to be absent and
validate their values when present; an explicit `undefined` is accepted only
when the field's value type allows it.

In this widened form, optional names inherited from `Object.prototype`, such
as `constructor` and `__proto__`, include `unknown`: when their own capture is
absent, property access can expose an inherited value. A later guaranteed
capture restores its precise field type. Ordinary optional field values
remain checked when present.

`InferredType.nullable` describes whether the whole inferred type includes
`null` or `undefined`. It is true for `unknown`, `void`, and a union with a
nullable member. An array or capture object containing nullable values is
itself non-nullable.

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
  createStar,
} from "@suzumiyaaoba/tpeg-core";

// JSON-like grammar
const jsonGrammar = createGrammarDefinition(
  "JSONGrammar",
  [],
  [
    createRuleDefinition("string", createStringLiteral('"', '"')),
    createRuleDefinition(
      "number",
      createCharacterClass([createCharRange("0", "9")]),
    ),
    createRuleDefinition(
      "boolean",
      createChoice([
        createStringLiteral("true", '"'),
        createStringLiteral("false", '"'),
      ]),
    ),
    createRuleDefinition(
      "array",
      createSequence([
        createStringLiteral("[", '"'),
        createOptional(
          createChoice([
            createCharacterClass([createCharRange("0", "9")]),
            createStringLiteral('"', '"'),
          ]),
        ),
        createStar(
          createSequence([
            createStringLiteral(",", '"'),
            createChoice([
              createCharacterClass([createCharRange("0", "9")]),
              createStringLiteral('"', '"'),
            ]),
          ]),
        ),
        createStringLiteral("]", '"'),
      ]),
    ),
  ],
);

const engine = new TypeInferenceEngine({
  inferArrayTypes: true,
  inferUnionTypes: true,
  inferObjectTypes: true,
  generateDocumentation: true,
});

const result = engine.inferGrammarTypes(jsonGrammar);

// Check for circular dependencies
console.log("Circular dependencies:", result.circularDependencies);

// Get type information for specific rules
const stringType = result.ruleTypes.get("string");
console.log("String rule type:", stringType?.typeString);
console.log("String rule documentation:", stringType?.documentation);
```

### Utility Methods

```typescript
const integrationEngine = new TypeIntegrationEngine();
const typedGrammar = integrationEngine.createTypedGrammar(grammar);

// Get type info for specific rule
const typeInfo = integrationEngine.getTypeInfo(typedGrammar, "greeting");
console.log(typeInfo?.typeString); // '"hello"'

// Check for circular dependencies
const hasCircular = integrationEngine.hasCircularDependency(
  typedGrammar,
  "ruleName",
);
console.log("Has circular dependency:", hasCircular);

// Get dependencies for a rule
const dependencies = integrationEngine.getDependencies(typedGrammar, "number");
console.log("Dependencies:", dependencies); // ['digit']
```

## API Reference

### TypeInferenceEngine

Main class for performing type inference on TPEG grammars.

#### Constructor Options

- `inferArrayTypes` (boolean): Whether to infer array types for repetition operators (default: true)
- `inferUnionTypes` (boolean): Whether to infer union types for choice operators (default: true)
- `inferObjectTypes` (boolean): Whether to infer object types for sequence operators (default: true)
- `customTypeMappings` (Map<string, string>): Replacements keyed by exact inferred type strings
- `generateDocumentation` (boolean): Whether to generate JSDoc comments (default: true)
- `maxRecursionDepth` (number): Maximum recursive inference depth, a non-negative safe integer (default: 100)
- `enableCaching` (boolean): Whether to enable caching for performance (default: true)
- `detectCircularDependencies` (boolean): Whether to detect circular dependencies (default: true)

#### Methods

- `inferGrammarTypes(grammar: GrammarDefinition): GrammarTypeInference`: Infer types for a complete grammar
- `inferExpressionType(expression: Expression): InferredType`: Infer type for a specific expression

With `generateDocumentation: false`, inferred types have no documentation,
including unknown types and inference-failure placeholders. Warnings and circular
dependency information remain available in the grammar inference result.

### TypeIntegrationEngine

Combines type inference with code generation for enhanced type-safe parser generation.

#### Constructor Options

- `includeDocumentation` (boolean): Whether to include JSDoc comments in generated types (default: true)
- `customTypeMappings` (Map<string, string>): Replacements keyed by exact inferred type strings
- `generateTypeGuards` (boolean): Whether to generate type guards for inferred types (default: false)
- `typeNamespace` (string): Namespace for generated types (optional)

#### Methods

- `createTypedGrammar(grammar: GrammarDefinition): TypedGrammarDefinition`: Create a typed grammar definition with full type information
- `generateParserInterface(typedGrammar: TypedGrammarDefinition): string`: Generate complete TypeScript interface for the parser
- `getTypeInfo(typedGrammar: TypedGrammarDefinition, ruleName: string): InferredType | undefined`: Get type information for a specific rule
- `hasCircularDependency(typedGrammar: TypedGrammarDefinition, ruleName: string): boolean`: Check if a rule has circular dependencies
- `getDependencies(typedGrammar: TypedGrammarDefinition, ruleName: string): string[]`: Get all dependencies for a rule

`includeDocumentation: false` disables inferred documentation and every generated
JSDoc block, including type guard descriptions, the result union, and the parser
interface header. It preserves type definitions, interfaces, guards, and diagnostics.

### Types

#### InferredType

```typescript
interface InferredType {
  typeString: string; // TypeScript type string
  nullable: boolean; // Whether the type can be null/undefined
  isArray: boolean; // Whether the type is an array
  baseType: string; // Base type (string, number, etc.)
  imports: string[]; // Required imports
  documentation?: string | undefined; // Generated when documentation is enabled
}
```

#### GrammarTypeInference

```typescript
interface GrammarTypeInference {
  ruleTypes: Map<string, InferredType>; // Type information for each rule
  circularDependencies: string[][]; // Detected circular dependencies
  imports: string[]; // Required imports
  warnings: string[]; // Inference diagnostics, independent of documentation
  stats: {
    typesInferred: number;
    cacheHits: number;
    cacheMisses: number;
    inferenceTime: number;
  };
}
```

#### TypedGrammarDefinition

```typescript
interface TypedGrammarDefinition extends Omit<GrammarDefinition, "rules"> {
  originalGrammar: GrammarDefinition; // Original grammar definition
  rules: TypedRuleDefinition[]; // Rules with type information
  typeInference: GrammarTypeInference; // Type inference results
  typeDefinitions: string; // Generated TypeScript type definitions
  imports: string[]; // Required imports
}
```

## Performance Considerations

- The type inference engine uses caching to improve performance for repeated operations
- Circular dependency detection is optimized to avoid infinite loops
- Large grammars are processed efficiently with configurable recursion limits
- Memory usage is optimized through efficient data structures

Cache keys use the fields needed for type inference and ignore extra AST
metadata and `toJSON` hooks. Expressions with accessor fields or children
beyond the remaining depth limit bypass caching. With `enableCaching: false`,
no cache keys are built. Cached and uncached inference produce the same types,
including capture properties and documentation.

Each cached result records its required inference depth, including expansion
of referenced rules. It is reused only when it fits the remaining depth budget,
so caching and rule order do not change depth-limit errors. Results can still
be reused at different depths when sufficient budget remains. Active rule state
is cleared after each rule, including failures; a later expression inference can
reference the most recently analyzed grammar without a stale circular-dependency
error.

Reentrant calls to `inferGrammarTypes` use independent rule definitions, type
caches, depth bookkeeping, and statistics. When a getter on the analyzed AST
infers another grammar with the same engine, the calling inference resumes its
own state after the nested run, including when the nested run throws. Each
grammar measures elapsed time from its own start. An ordinary completed run
remains the grammar used by later `inferExpressionType` calls.

The depth limit applies to recursive type inference. Types determined by an
operator itself, such as semantic actions and lookahead assertions, do not
require inferring its child. Transparent groups around captures and dependency
walks can traverse deeply nested trees without exhausting the call stack.

## Error Handling

The type inference system gracefully handles various error conditions:

- **Unknown Rule References**: Returns `unknown` type for undefined rules
- **Circular Dependencies**: Detects and reports circular dependencies
- **Invalid Expressions**: Handles malformed expressions gracefully
- **Recursion Limits**: Prevents stack overflow with configurable limits

## License

MIT
