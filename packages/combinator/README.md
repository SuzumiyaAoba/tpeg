# tpeg-combinator

Parser combinators built on top of tpeg-core. This package provides high-level parser combinators for building complex parsers with ease.

## Features

- **Rich Combinator Library**: Comprehensive set of parser combinators
- **Type-Safe**: Full TypeScript support with strict type checking
- **Performance Optimized**: Built-in memoization and optimization
- **Error Handling**: Advanced error reporting and debugging
- **Whitespace Handling**: Built-in whitespace and token management
- **List Parsing**: Specialized combinators for parsing lists and sequences

## Installation

```bash
npm install @suzumiyaaoba/tpeg-combinator
# or
bun add @suzumiyaaoba/tpeg-combinator
```

Combinators re-export nothing from `tpeg-core` — primitives like `literal`, `choice`, `seq`, `zeroOrMore`, and `parse` come from `@suzumiyaaoba/tpeg-core` directly; only the higher-level combinators below live in `@suzumiyaaoba/tpeg-combinator`.

## Quick Start

```typescript
import { literal, choice, seq, zeroOrMore, parse } from "@suzumiyaaoba/tpeg-core";
import { quotedString, number, sepBy, memoize } from "@suzumiyaaoba/tpeg-combinator";

// Simple parser for "hello" or "world"
const helloOrWorld = choice(literal("hello"), literal("world"));

// Parse a sequence with repetition
const parser = seq(helloOrWorld, zeroOrMore(seq(literal(" "), helloOrWorld)));

const result = parse(parser)("hello world hello");
console.log(result);
```

## Parser Combinators

### String Parsing

#### `quotedString`
Parses a JavaScript/JSON-style double-quoted string with escape sequences.

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { quotedString } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(quotedString)('"Hello, \\"world\\"!"');
// Result: { success: true, val: 'Hello, "world"!' }
```

#### `singleQuotedString`
Parses a single-quoted string.

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { singleQuotedString } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(singleQuotedString)("'Hello, world!'");
// Result: { success: true, val: 'Hello, world!' }
```

#### `anyQuotedString`
Parses a string with either single or double quotes.

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { anyQuotedString } from "@suzumiyaaoba/tpeg-combinator";

const result1 = parse(anyQuotedString)('"double quoted"');
const result2 = parse(anyQuotedString)("'single quoted'");
```

#### `takeUntil(condition)`
Consumes characters until a condition is met.

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { takeUntil } from "@suzumiyaaoba/tpeg-combinator";

const parser = takeUntil(literal(","));
const result = parse(parser)("hello,world");
// Result: { success: true, val: "hello" }
```

#### `between(open, close)`
Matches content between two parsers.

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { between } from "@suzumiyaaoba/tpeg-combinator";

const parser = between(literal("("), literal(")"));
const result = parse(parser)("(content)");
// Result: { success: true, val: "content" }
```

### Number Parsing

#### `number`
Parses a JavaScript/JSON-style number including fractions and exponents.

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { number } from "@suzumiyaaoba/tpeg-combinator";

const result1 = parse(number)("123");
const result2 = parse(number)("3.14");
const result3 = parse(number)("1.23e-4");
```

#### `int`
Parses an integer number.

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { int } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(int)("42");
// Result: { success: true, val: 42 }
```

### List Parsing

#### `sepBy(value, separator)`
Parses values separated by a delimiter (zero or more).

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { sepBy, number } from "@suzumiyaaoba/tpeg-combinator";

const parser = sepBy(number, literal(","));
const result = parse(parser)("1,2,3,4");
// Result: { success: true, val: [1, 2, 3, 4] }
```

#### `sepBy1(value, separator)`
Parses values separated by a delimiter (one or more).

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { sepBy1, number } from "@suzumiyaaoba/tpeg-combinator";

const parser = sepBy1(number, literal(","));
const result = parse(parser)("1,2,3");
// Result: { success: true, val: [1, 2, 3] }
```

#### `commaSeparated(value)`
Parses comma-separated values with optional trailing comma.

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { commaSeparated, number } from "@suzumiyaaoba/tpeg-combinator";

const parser = commaSeparated(number);
const result = parse(parser)("1, 2, 3,");
// Result: { success: true, val: [1, 2, 3] }
```

### Error Handling

#### `labeled(parser, message)`
Provides custom error messages.

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { labeled } from "@suzumiyaaoba/tpeg-combinator";

const parser = labeled(literal("hello"), "Expected 'hello'");
const result = parse(parser)("world");
// Result: { success: false, error: { message: "Expected 'hello'" } }
```

#### `withDetailedError(parser, name)`
Creates detailed error reports with input excerpts.

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { withDetailedError } from "@suzumiyaaoba/tpeg-combinator";

const parser = withDetailedError(literal("hello"), "hello_parser");
const result = parse(parser)("world");
// Provides detailed error with context
```

#### `withPosition(parser)`
Tracks line and column for better error reporting.

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { withPosition } from "@suzumiyaaoba/tpeg-combinator";

const parser = withPosition(literal("hello"));
const result = parse(parser)("world");
// Error includes line and column information
```

### Performance and Debugging

#### `memoize(parser, options)`
Creates a memoized version of a parser with cache size control.

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { memoize } from "@suzumiyaaoba/tpeg-combinator";

const parser = memoize(literal("hello"), { cacheSize: 100 });
const result = parse(parser)("hello");
```

#### `recursive()`
Creates a recursive parser. Returns a `[parser, setter]` pair — build the body with other combinators first, then call `setter` to close the recursive tie.

```typescript
import { literal, choice, seq, parse } from "@suzumiyaaoba/tpeg-core";
import { recursive } from "@suzumiyaaoba/tpeg-combinator";

const [expression, setExpression] = recursive<string>();
setExpression(
  choice(
    literal("x"),
    seq(literal("("), expression, literal(")")),
  ),
);

const result = parse(expression)("((x))");
```

#### `debug(parser, name, options)`
Logs parsing process for debugging.

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { debug } from "@suzumiyaaoba/tpeg-combinator";

const parser = debug(literal("hello"), "hello_debug");
const result = parse(parser)("hello");
// Logs parsing steps to console
```

### Whitespace and Tokens

#### `token(parser)`
Wraps a parser to consume whitespace before and after.

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { token } from "@suzumiyaaoba/tpeg-combinator";

const parser = token(literal("hello"));
const result = parse(parser)("  hello  ");
// Consumes whitespace automatically
```

#### `whitespace`
Consumes whitespace characters.

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { whitespace } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(whitespace)("   \t\n");
// Consumes all whitespace characters
```

#### `spaces`
Consumes zero or more whitespace characters.

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { spaces } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(spaces)("   \t\n");
// Consumes optional whitespace
```

## Advanced Examples

### JSON Value Parser

```typescript
import { choice, seq, zeroOrMore, literal, parse } from "@suzumiyaaoba/tpeg-core";
import { quotedString, number } from "@suzumiyaaoba/tpeg-combinator";

const jsonValue = choice(
  quotedString,
  number,
  literal("true"),
  literal("false"),
  literal("null"),
);

const jsonArray = seq(
  literal("["),
  zeroOrMore(seq(jsonValue, literal(","))),
  jsonValue,
  literal("]"),
);

const result = parse(jsonArray)('[1,2,3]');
```

This minimal grammar doesn't skip whitespace between elements — wrap `jsonValue`/the literals in `token()` (see below) if the input may contain spaces.

### CSV Parser

```typescript
import { choice, literal, parse } from "@suzumiyaaoba/tpeg-core";
import { sepBy1, quotedString, takeUntil } from "@suzumiyaaoba/tpeg-combinator";

const csvField = choice(
  quotedString,
  // any run of characters up to the next field/row separator
  takeUntil(choice(literal(","), literal("\n"))),
);

const csvRow = sepBy1(csvField, literal(","));
const csvParser = sepBy1(csvRow, literal("\n"));

const result = parse(csvParser)('name,age\n"John",30\n"Jane",25');
```

## Testing

The package includes comprehensive tests, one spec file per module (`primitive`, `string`, `list`, `logic`, `error`, `debug`):

```bash
# Run all tests
bun test

# Run a specific module's tests
bun test src/primitive.spec.ts

# Run the cross-module integration tests
bun test src/integration.spec.ts
```

## API Reference

For complete API documentation, see the TypeScript definitions in the source code.

## License

MIT
