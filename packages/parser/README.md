# TPEG Parser

TPEG Grammar Parser implements parsing functionality for TPEG (TypeScript Parsing Expression Grammar) basic syntax elements.

## Overview

This package provides parsers for the fundamental syntax elements of TPEG grammar as defined in `docs/peg-grammar.md`:

- **String Literals**: `"hello"`, `'world'`
- **Character Classes**: `[a-z]`, `[A-Z]`, `[0-9]`, `[^0-9]`, `.`
- **Identifiers**: Rule references like `expression`, `number`, `identifier`

## Installation

```bash
# Install dependencies
bun install

# Build the package
bun run build

# Run tests
bun run test
```

## Usage

### Basic Syntax Parser

`basicSyntax`, `stringLiteral`, `characterClass`, and `identifier` are `Parser<T>` values, not factory functions — call them directly with `(input, pos)`, where `pos` is a plain 0-based offset (not a `{ offset, line, column }` object).

```typescript
import { basicSyntax } from "@suzumiyaaoba/tpeg-parser";

// Parse string literals
const stringResult = basicSyntax('"hello world"', 0);
if (stringResult.success) {
  console.log(stringResult.val);
  // { type: 'StringLiteral', value: 'hello world', quote: '"' }
}

// Parse character classes
const charClassResult = basicSyntax("[a-z]", 0);
if (charClassResult.success) {
  console.log(charClassResult.val);
  // { type: 'CharacterClass', ranges: [{ start: 'a', end: 'z' }], negated: false }
}

// Parse identifiers
const identifierResult = basicSyntax("expression", 0);
if (identifierResult.success) {
  console.log(identifierResult.val);
  // { type: 'Identifier', name: 'expression' }
}
```

### Individual Parsers

```typescript
import {
  stringLiteral,
  characterClass,
  identifier,
} from "@suzumiyaaoba/tpeg-parser";

// String literal parser
const result1 = stringLiteral("'hello'", 0);

// Character class parser
const result2 = characterClass("[^0-9]", 0);

// Identifier parser
const result3 = identifier("my_rule_123", 0);
```

## API Reference

### Types

#### `BasicSyntaxNode`

Union type for all basic TPEG syntax elements:

```typescript
type BasicSyntaxNode = StringLiteral | CharacterClass | Identifier | AnyChar;
```

#### `StringLiteral`

```typescript
interface StringLiteral {
  type: "StringLiteral";
  value: string;
  quote: '"' | "'";
}
```

#### `CharacterClass`

```typescript
interface CharacterClass {
  type: "CharacterClass";
  ranges: CharRange[];
  negated: boolean;
}

interface CharRange {
  start: string;
  end?: string; // undefined for single characters
}
```

#### `Identifier`

```typescript
interface Identifier {
  type: "Identifier";
  name: string;
}
```

#### `AnyChar`

```typescript
interface AnyChar {
  type: "AnyChar";
}
```

### Parsers

#### `basicSyntax: Parser<BasicSyntaxNode>`

Combined parser for all basic TPEG syntax elements.

#### `stringLiteral: Parser<StringLiteral>`

Parser for string literals with support for:

- Double quotes: `"hello"`
- Single quotes: `'world'`
- Escape sequences: `\n`, `\r`, `\t`, `\\`, `\"`, `\'`

Note: Template literals (`` `template` ``) are planned for future extension.

#### `characterClass: Parser<CharacterClass | AnyChar>`

Parser for character classes and any character dot:

- Character ranges: `[a-z]`, `[A-Z]`, `[0-9]`
- Multiple ranges: `[a-zA-Z0-9_]`
- Negated classes: `[^0-9]`
- Single characters: `[abc]`
- Any character: `.`
- Escaped characters: `[\]\\^]`

#### `identifier: Parser<Identifier>`

Parser for identifiers (rule references):

- Must start with letter or underscore: `a-z`, `A-Z`, `_`
- Can contain letters, digits, underscores: `a-z`, `A-Z`, `0-9`, `_`
- Examples: `expression`, `_private`, `rule123`, `my_rule_name`

## Error Handling

All parsers return a `ParseResult<T>` which is either:

```typescript
// Success
{
  success: true;
  val: T;
  current: number; // offset before parsing began
  next: number; // offset after parsing completed
}

// Failure
{
  success: false;
  error: ParseError;
}
```

Error information includes:

- Error message
- Position where error occurred
- Expected vs found values
- Parser context

## Testing

The package includes comprehensive tests covering:

- Valid syntax parsing
- Error cases
- Edge cases
- Parser precedence
- Partial parsing behavior

Run tests with:

```bash
bun run test
```

The `compileStart` differential-testing helper, `evaluateGeneratedModule`, and
the benchmark harness execute generated JavaScript with module-level `this`, `arguments`, and
`new.target` behavior. They load the packaged `runtime/native-evaluator.mjs`
without bundling it, so keep that file alongside `dist` when copying the package.
These helpers require a runtime with synchronous ESM `require()` enabled, such
as Node.js 20.19+ or 22.12+, or Bun. Node.js documents this capability in its
[module-loading reference](https://nodejs.org/download/release/v20.19.0/docs/api/modules.html#loading-ecmascript-modules-using-require).
Parsing grammars and generating source code do not load this evaluator. The
helper accepts the JavaScript emitted by these generators. Named, unaliased
imports from `tpeg-core` and `tpeg-combinator` use the supplied helper bindings;
each imported name must be an own property of the supplied scope. Other imports
and `import.meta` are unsupported. Transpile TypeScript before evaluation.
Supplied helper values are captured by name at construction time and exposed
through constant bindings. Reassigning a helper throws, including through
direct `eval`; properties of referenced objects remain mutable. Helper getters
run before binding setup, and generated initializers run after temporary
evaluation data has been restored.

`evaluateGeneratedModule(code, scope)` returns the module's exported values.
An optional third argument selects parser rules, checks each export is a
function, and retains the literal names in its return type:

```typescript
const { start } = evaluateGeneratedModule(generated.code, helpers, ["start"]);
const result = start("input", 0);
```

## Dependencies

- `@suzumiyaaoba/tpeg-core`: Core parsing functionality and types
- `@suzumiyaaoba/tpeg-combinator`: Parser combinators and utilities

## Contributing

This package is part of the TPEG project. See the main project README for contribution guidelines.

## License

MIT

## Bundling grammar modules

`bundleGrammarFile(path)` reads a local `.tpeg` file and its transitive imports
and returns one `GrammarDefinition` for any code generator.
`parseGrammarFile(path, source)` parses a complete file from memory, including
imports, transforms, and an optional leading BOM. It reports errors with
one-based line and column numbers. For a local entry file, pass its successful
`result.val` to `bundleGrammarFile` to use that snapshot and read its imports from disk.
`bundleGrammarModules(entry, dependencies)` performs the same linking on
already-parsed `ModuleFile` values. The linker enforces exports, selective
imports, aliases, import version constraints, `@requires`, and circular-import
checks in the file loader. Distinct files may share a basename.

`extends` and `includes` inherit rules. A local declaration overrides an
inherited rule; an inherited rule's local references dispatch to that override,
while explicit `base.rule` references retain the parent implementation.
Conflicting mixins require a local override. Rule-local annotations, transforms,
and each defining module's whitespace policy are retained. A child with no
local rules inherits an explicit parent `@start` annotation.

```typescript
import {
  bundleGrammarFile,
  generateTypeScriptParser,
} from "@suzumiyaaoba/tpeg-parser";

const grammar = bundleGrammarFile("./grammar.tpeg");
const generated = generateTypeScriptParser(grammar);
```
