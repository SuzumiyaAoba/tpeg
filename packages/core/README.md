# tpeg-core

Core parsing functionality for TPEG (Typed Parser Expression Grammar) library.

## Features

- **Basic Parsers**: String literals, character classes, and any-character parsers
- **Combinators**: Sequence, choice, repetition, and lookahead combinators  
- **Capture System**: Label and capture parsed values with structured output
- **Error Handling**: Comprehensive error reporting with position tracking
- **Type Safety**: Full TypeScript support with strict type checking
- **Performance**: Optimized parsing algorithms with memoization support

## Installation

```bash
bun add tpeg-core
```

## Basic Usage

### Simple Parsers

```typescript
import { literal, charClass, anyChar } from "tpeg-core";

// Parse literal strings
const hello = literal("hello");
const result = hello("hello world", { offset: 0, line: 1, column: 1 });
// result.val = "hello"

// Parse character classes
const digit = charClass("0-9");
const digitResult = digit("5abc", { offset: 0, line: 1, column: 1 });
// digitResult.val = "5"

// Parse any character
const any = anyChar;
const anyResult = any("x", { offset: 0, line: 1, column: 1 });
// anyResult.val = "x"
```

### Combinators

```typescript
import { sequence, choice, zeroOrMore, oneOrMore, optional } from "tpeg-core";

// Sequence: match multiple parsers in order
const greeting = sequence(literal("hello"), literal(" "), literal("world"));
const greetingResult = greeting("hello world", pos);
// greetingResult.val = ["hello", " ", "world"]

// Choice: match any of several alternatives
const yesNo = choice(literal("yes"), literal("no"));
const choiceResult = yesNo("yes", pos);
// choiceResult.val = "yes"

// Repetition: zero or more, one or more, optional
const digits = oneOrMore(charClass("0-9"));
const digitsResult = digits("123abc", pos);
// digitsResult.val = ["1", "2", "3"]
```

### Capture System

The capture system allows you to structure parsed data with meaningful labels:

```typescript
import { capture, captureSequence, captureChoice } from "tpeg-core";

// Basic capture
const nameParser = capture("name", literal("John"));
const nameResult = nameParser("John", pos);
// nameResult.val = { name: "John" }

// Multiple captures in sequence
const userParser = captureSequence(
  capture("firstName", literal("John")),
  literal(" "),
  capture("lastName", literal("Doe"))
);
const userResult = userParser("John Doe", pos);
// userResult.val = { firstName: "John", lastName: "Doe" }

// Captures with choice
const greetingParser = captureChoice(
  capture("formal", literal("Hello")),
  capture("casual", literal("Hi"))
);
const greetingResult = greetingParser("Hello", pos);
// greetingResult.val = { formal: "Hello" }
```

### Advanced Examples

#### HTTP Request Parser with Captures

```typescript
import { capture, captureSequence, literal, charClass, oneOrMore, choice } from "tpeg-core";

const method = capture("method", choice(
  literal("GET"),
  literal("POST"),
  literal("PUT"),
  literal("DELETE")
));

const path = capture("path", sequence(
  literal("/"),
  oneOrMore(charClass("a-zA-Z0-9/-"))
));

const protocol = capture("protocol", literal("HTTP/1.1"));

const httpRequest = captureSequence(
  method,
  literal(" "),
  path,
  literal(" "),
  protocol
);

const result = httpRequest("GET /api/users HTTP/1.1", pos);
// result.val = {
//   method: "GET",
//   path: "/api/users", 
//   protocol: "HTTP/1.1"
// }
```

#### JSON-like Parser

```typescript
const stringValue = capture("string", sequence(
  literal('"'),
  zeroOrMore(charClass("a-zA-Z0-9 ")),
  literal('"')
));

const numberValue = capture("number", oneOrMore(charClass("0-9")));

const boolValue = capture("boolean", choice(
  literal("true"),
  literal("false")
));

const value = captureChoice(stringValue, numberValue, boolValue);

const keyValue = captureSequence(
  capture("key", stringValue),
  literal(":"),
  capture("value", value)
);

const result = keyValue('"name":"John"', pos);
// result.val = {
//   key: { string: "name" },
//   value: { string: "John" }
// }
```

## Error Handling

```typescript
import { parse } from "tpeg-core";

const parser = sequence(literal("hello"), literal(" "), literal("world"));
const result = parse(parser)("hello there");

if (!result.success) {
  console.error(`Parse error: ${result.error.message}`);
  console.error(`At line ${result.error.pos.line}, column ${result.error.pos.column}`);
}
```

## Type Safety

All parsers are fully typed with TypeScript:

```typescript
// Type inference works automatically
const typedParser = capture("count", oneOrMore(charClass("0-9")));
// typedParser has type: Parser<{ count: string[] }>

const result = typedParser("123", pos);
if (result.success) {
  // result.val has type: { count: string[] }
  console.log(result.val.count); // ["1", "2", "3"]
}
```

## API Reference

### Basic Parsers

- `literal(str: string)` - Parse exact string
- `charClass(...ranges: string[])` - Parse character from ranges
- `anyChar` - Parse any single character

### Combinators

- `sequence(...parsers)` - Parse parsers in order
- `choice(...parsers)` - Parse first successful alternative
- `zeroOrMore(parser)` - Parse zero or more repetitions
- `oneOrMore(parser)` - Parse one or more repetitions
- `optional(parser)` - Parse optionally (zero or one)
- `quantified(parser, min, max?)` - Parse specific number of repetitions

### Capture System

- `capture(label, parser)` - Capture parser result with label
- `captureSequence(...parsers)` - Sequence with automatic capture merging
- `captureChoice(...parsers)` - Choice preserving capture structure
- `mergeCaptures(captures)` - Merge multiple captured objects
- `isCapturedValue(value)` - Check if value is a captured object
- `getCapturedValue(captured, label)` - Get value by label
- `getCaptureLabels(captured)` - Get all labels from captured object

### Lookahead

- `andPredicate(parser)` - Positive lookahead (non-consuming)
- `notPredicate(parser)` - Negative lookahead (non-consuming)

### Utilities

- `parse(parser)` - Create a parse function from parser
- `createPos(offset?, column?, line?)` - Create position object
- `isFailure(result)` - Check if result is a failure
- `isSuccess(result)` - Check if result is a success

## License

MIT 