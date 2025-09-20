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

## Quick Start

```typescript
import { 
  literal, 
  choice, 
  seq, 
  zeroOrMore, 
  parse,
  quotedString,
  number,
  sepBy,
  memoize
} from "@suzumiyaaoba/tpeg-combinator";

// Simple parser for "hello" or "world"
const helloOrWorld = choice(literal("hello"), literal("world"));

// Parse a sequence with repetition
const parser = seq(helloOrWorld, zeroOrMore(seq(literal(" "), helloOrWorld)));

const result = parse(parser, "hello world hello");
console.log(result);
```

## Parser Combinators

### String Parsing

#### `quotedString()`
Parses a JavaScript/JSON-style double-quoted string with escape sequences.

```typescript
import { quotedString, parse } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(quotedString, '"Hello, \\"world\\"!"');
// Result: { success: true, val: 'Hello, "world"!' }
```

#### `singleQuotedString()`
Parses a single-quoted string.

```typescript
import { singleQuotedString, parse } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(singleQuotedString, "'Hello, world!'");
// Result: { success: true, val: 'Hello, world!' }
```

#### `anyQuotedString()`
Parses a string with either single or double quotes.

```typescript
import { anyQuotedString, parse } from "@suzumiyaaoba/tpeg-combinator";

const result1 = parse(anyQuotedString, '"double quoted"');
const result2 = parse(anyQuotedString, "'single quoted'");
```

#### `takeUntil(condition)`
Consumes characters until a condition is met.

```typescript
import { takeUntil, literal, parse } from "@suzumiyaaoba/tpeg-combinator";

const parser = takeUntil(literal(","));
const result = parse(parser, "hello,world");
// Result: { success: true, val: "hello" }
```

#### `between(open, close)`
Matches content between two parsers.

```typescript
import { between, literal, parse } from "@suzumiyaaoba/tpeg-combinator";

const parser = between(literal("("), literal(")"));
const result = parse(parser, "(content)");
// Result: { success: true, val: "content" }
```

### Pattern Matching

#### `regex(pattern)`
Parses text that matches a regular expression.

```typescript
import { regex, parse } from "@suzumiyaaoba/tpeg-combinator";

const emailParser = regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);
const result = parse(emailParser, "user@example.com");
```

#### `regexGroups(pattern)`
Parses and returns all capture groups from a regex match.

```typescript
import { regexGroups, parse } from "@suzumiyaaoba/tpeg-combinator";

const parser = regexGroups(/^(\d+)-(\d+)-(\d+)$/);
const result = parse(parser, "2023-12-25");
// Result: { success: true, val: ["2023", "12", "25"] }
```

### Number Parsing

#### `number()`
Parses a JavaScript/JSON-style number including fractions and exponents.

```typescript
import { number, parse } from "@suzumiyaaoba/tpeg-combinator";

const result1 = parse(number, "123");
const result2 = parse(number, "3.14");
const result3 = parse(number, "1.23e-4");
```

#### `int()`
Parses an integer number.

```typescript
import { int, parse } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(int, "42");
// Result: { success: true, val: 42 }
```

### List Parsing

#### `sepBy(value, separator)`
Parses values separated by a delimiter (zero or more).

```typescript
import { sepBy, literal, number, parse } from "@suzumiyaaoba/tpeg-combinator";

const parser = sepBy(number, literal(","));
const result = parse(parser, "1,2,3,4");
// Result: { success: true, val: [1, 2, 3, 4] }
```

#### `sepBy1(value, separator)`
Parses values separated by a delimiter (one or more).

```typescript
import { sepBy1, literal, number, parse } from "@suzumiyaaoba/tpeg-combinator";

const parser = sepBy1(number, literal(","));
const result = parse(parser, "1,2,3");
// Result: { success: true, val: [1, 2, 3] }
```

#### `commaSeparated(value)`
Parses comma-separated values with optional trailing comma.

```typescript
import { commaSeparated, number, parse } from "tpeg-combinator";

const parser = commaSeparated(number);
const result = parse(parser, "1, 2, 3,");
// Result: { success: true, val: [1, 2, 3] }
```

### Error Handling

#### `labeled(parser, message)`
Provides custom error messages.

```typescript
import { labeled, literal, parse } from "@suzumiyaaoba/tpeg-combinator";

const parser = labeled(literal("hello"), "Expected 'hello'");
const result = parse(parser, "world");
// Result: { success: false, error: { message: "Expected 'hello'" } }
```

#### `withDetailedError(parser, name)`
Creates detailed error reports with input excerpts.

```typescript
import { withDetailedError, literal, parse } from "@suzumiyaaoba/tpeg-combinator";

const parser = withDetailedError(literal("hello"), "hello_parser");
const result = parse(parser, "world");
// Provides detailed error with context
```

#### `withPosition(parser)`
Tracks line and column for better error reporting.

```typescript
import { withPosition, literal, parse } from "@suzumiyaaoba/tpeg-combinator";

const parser = withPosition(literal("hello"));
const result = parse(parser, "world");
// Error includes line and column information
```

### Performance and Debugging

#### `memoize(parser, options)`
Creates a memoized version of a parser with cache size control.

```typescript
import { memoize, literal, parse } from "@suzumiyaaoba/tpeg-combinator";

const parser = memoize(literal("hello"), { cacheSize: 100 });
const result = parse(parser, "hello");
```

#### `recursive()`
Creates a recursive parser.

```typescript
import { recursive, choice, literal, seq, parse } from "@suzumiyaaoba/tpeg-combinator";

const [expression, setExpression] = recursive<string>();
setExpression(
  choice(
    literal("x"),
    seq(literal("("), expression, literal(")"))
  )
);

const result = parse(expression, "((x))");
```

#### `debug(parser, name, options)`
Logs parsing process for debugging.

```typescript
import { debug, literal, parse } from "@suzumiyaaoba/tpeg-combinator";

const parser = debug(literal("hello"), "hello_debug");
const result = parse(parser, "hello");
// Logs parsing steps to console
```

### Whitespace and Tokens

#### `token(parser)`
Wraps a parser to consume whitespace before and after.

```typescript
import { token, literal, parse } from "@suzumiyaaoba/tpeg-combinator";

const parser = token(literal("hello"));
const result = parse(parser, "  hello  ");
// Consumes whitespace automatically
```

#### `whitespace`
Consumes whitespace characters.

```typescript
import { whitespace, parse } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(whitespace, "   \t\n");
// Consumes all whitespace characters
```

#### `spaces`
Consumes zero or more whitespace characters.

```typescript
import { spaces, parse } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(spaces, "   \t\n");
// Consumes optional whitespace
```

## Advanced Examples

### JSON Parser

```typescript
import { 
  choice, 
  seq, 
  zeroOrMore, 
  quotedString, 
  number, 
  literal,
  parse 
} from "@suzumiyaaoba/tpeg-combinator";

const jsonValue = choice(
  quotedString,
  number,
  literal("true"),
  literal("false"),
  literal("null")
);

const jsonArray = seq(
  literal("["),
  zeroOrMore(seq(jsonValue, literal(","))),
  jsonValue,
  literal("]")
);

const result = parse(jsonArray, '[1, 2, 3]');
```

### CSV Parser

```typescript
import { 
  sepBy1, 
  quotedString, 
  regex, 
  choice, 
  parse 
} from "@suzumiyaaoba/tpeg-combinator";

const csvField = choice(
  quotedString,
  regex(/^[^,\n\r]+/)
);

const csvRow = sepBy1(csvField, literal(","));
const csvParser = sepBy1(csvRow, literal("\n"));

const result = parse(csvParser, 'name,age\n"John",30\n"Jane",25');
```

## Testing

The package includes comprehensive tests:

```bash
# Run all tests
bun test

# Run specific test file
bun test index.spec.ts

# Run benchmarks
bun test benchmark.spec.ts
```

## API Reference

For complete API documentation, see the TypeScript definitions in the source code.

## License

MIT
