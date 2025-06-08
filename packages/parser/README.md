# TPEG Parser

TPEG Grammar Parser implements parsing functionality for TPEG (TypeScript Parsing Expression Grammar) basic syntax elements.

## Overview

This package provides parsers for the fundamental syntax elements of TPEG grammar as defined in `docs/peg-grammar.md`:

- **String Literals**: `"hello"`, `'world'`, `` `template` ``
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

```typescript
import { basicSyntax } from 'tpeg-parser';

const parser = basicSyntax();
const pos = { offset: 0, line: 1, column: 1 };

// Parse string literals
const stringResult = parser('"hello world"', pos);
if (stringResult.success) {
  console.log(stringResult.val); 
  // { type: 'StringLiteral', value: 'hello world', quote: '"' }
}

// Parse character classes
const charClassResult = parser('[a-z]', pos);
if (charClassResult.success) {
  console.log(charClassResult.val);
  // { type: 'CharacterClass', ranges: [{ start: 'a', end: 'z' }], negated: false }
}

// Parse identifiers
const identifierResult = parser('expression', pos);
if (identifierResult.success) {
  console.log(identifierResult.val);
  // { type: 'Identifier', name: 'expression' }
}
```

### Individual Parsers

```typescript
import { stringLiteral, characterClass, identifier } from 'tpeg-parser';

// String literal parser
const strParser = stringLiteral();
const result1 = strParser("'hello'", pos);

// Character class parser
const charParser = characterClass();
const result2 = charParser('[^0-9]', pos);

// Identifier parser
const idParser = identifier();
const result3 = idParser('my_rule_123', pos);
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
  quote: '"' | "'" | '`';
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

#### `basicSyntax(): Parser<BasicSyntaxNode>`
Combined parser for all basic TPEG syntax elements.

#### `stringLiteral(): Parser<StringLiteral>`
Parser for string literals with support for:
- Double quotes: `"hello"`
- Single quotes: `'world'`
- Template literals: `` `template` ``
- Escape sequences: `\n`, `\r`, `\t`, `\\`, `\"`, `\'`, `` \` ``

#### `characterClass(): Parser<CharacterClass | AnyChar>`
Parser for character classes and any character dot:
- Character ranges: `[a-z]`, `[A-Z]`, `[0-9]`
- Multiple ranges: `[a-zA-Z0-9_]`
- Negated classes: `[^0-9]`
- Single characters: `[abc]`
- Any character: `.`
- Escaped characters: `[\]\\^]`

#### `identifier(): Parser<Identifier>`
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
  current: Pos;
  next: Pos;
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

- `tpeg-core`: Core parsing functionality and types
- `tpeg-combinator`: Parser combinators and utilities

## Contributing

This package is part of the TPEG project. See the main project README for contribution guidelines.

## License

MIT

---
*This package was created with assistance from Claude 4 Sonnet* 