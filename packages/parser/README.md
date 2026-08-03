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
bun test
```

## Usage

### Basic Syntax Parser

`basicSyntax`, `stringLiteral`, `characterClass`, and `identifier` are `Parser<T>` values, not factory functions — call them directly with `(input, pos)`, where `pos` is a plain 0-based offset (not a `{ offset, line, column }` object).

```typescript
import { basicSyntax } from '@suzumiyaaoba/tpeg-parser';

// Parse string literals
const stringResult = basicSyntax('"hello world"', 0);
if (stringResult.success) {
  console.log(stringResult.val); 
  // { type: 'StringLiteral', value: 'hello world', quote: '"' }
}

// Parse character classes
const charClassResult = basicSyntax('[a-z]', 0);
if (charClassResult.success) {
  console.log(charClassResult.val);
  // { type: 'CharacterClass', ranges: [{ start: 'a', end: 'z' }], negated: false }
}

// Parse identifiers
const identifierResult = basicSyntax('expression', 0);
if (identifierResult.success) {
  console.log(identifierResult.val);
  // { type: 'Identifier', name: 'expression' }
}
```

### Individual Parsers

```typescript
import { stringLiteral, characterClass, identifier } from '@suzumiyaaoba/tpeg-parser';

// String literal parser
const result1 = stringLiteral("'hello'", 0);

// Character class parser
const result2 = characterClass('[^0-9]', 0);

// Identifier parser
const result3 = identifier('my_rule_123', 0);
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
  type: 'StringLiteral';
  value: string;
  quote: '"' | "'";
}
```

#### `CharacterClass`
```typescript
interface CharacterClass {
  type: 'CharacterClass';
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
  type: 'Identifier';
  name: string;
}
```

#### `AnyChar`
```typescript
interface AnyChar {
  type: 'AnyChar';
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
  next: number;     // offset after parsing completed
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
bun test
```

## Dependencies

- `@suzumiyaaoba/tpeg-core`: Core parsing functionality and types
- `@suzumiyaaoba/tpeg-combinator`: Parser combinators and utilities

## Contributing

This package is part of the TPEG project. See the main project README for contribution guidelines.

## License

MIT 