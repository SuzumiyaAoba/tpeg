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
bun add @suzumiyaaoba/tpeg-core
```

## Basic Usage

A `Parser<T>` is `(input: string, pos: number) => ParseResult<T>` — `pos` is a plain 0-based offset into `input`, not a `{ offset, line, column }` object. Call a parser directly with offset `0` to start from the beginning, or use `parse(parser)(input)` (see "Error Handling" below) to do that for you.

### Simple Parsers

```typescript
import { literal, charClass, anyChar } from "@suzumiyaaoba/tpeg-core";

// Parse literal strings
const hello = literal("hello");
const result = hello("hello world", 0);
// result.val = "hello"

// Parse character classes -- a range is a [start, end] tuple, not a "0-9"-style string
const digit = charClass(["0", "9"]);
const digitResult = digit("5abc", 0);
// digitResult.val = "5"

// Parse any character
const any = anyChar();
const anyResult = any("x", 0);
// anyResult.val = "x"
```

### Combinators

```typescript
import {
  sequence,
  choice,
  zeroOrMore,
  oneOrMore,
  optional,
} from "@suzumiyaaoba/tpeg-core";

// Sequence: match multiple parsers in order
const greeting = sequence(literal("hello"), literal(" "), literal("world"));
const greetingResult = greeting("hello world", 0);
// greetingResult.val = ["hello", " ", "world"]

// Choice: match any of several alternatives
const yesNo = choice(literal("yes"), literal("no"));
const choiceResult = yesNo("yes", 0);
// choiceResult.val = "yes"

// Repetition: zero or more, one or more, optional
const digits = oneOrMore(charClass(["0", "9"]));
const digitsResult = digits("123abc", 0);
// digitsResult.val = ["1", "2", "3"]
```

### Capture System

The capture system allows you to structure parsed data with meaningful labels:

```typescript
import {
  capture,
  captureSequence,
  captureChoice,
} from "@suzumiyaaoba/tpeg-core";

// Basic capture
const nameParser = capture("name", literal("John"));
const nameResult = nameParser("John", 0);
// nameResult.val = { name: "John" }

// Multiple captures in sequence
const userParser = captureSequence(
  capture("firstName", literal("John")),
  literal(" "),
  capture("lastName", literal("Doe")),
);
const userResult = userParser("John Doe", 0);
// userResult.val = { firstName: "John", lastName: "Doe" }

// Captures with choice
const greetingParser = captureChoice(
  capture("formal", literal("Hello")),
  capture("casual", literal("Hi")),
);
const greetingResult = greetingParser("Hello", 0);
// greetingResult.val = { formal: "Hello" }
```

### Advanced Examples

`optional`, `zeroOrMore`, `oneOrMore`, and `quantified` read a successful child's `next` once before reading its value. They reject non-numeric, fractional, non-finite, backward, or out-of-input positions with a fatal failure at the child's call site. Positions are validated before comparison, without implicit numeric conversion. Finite quantified repetitions still allow zero-width matches; unbounded repetitions require progress.

`quantified` validates its bounds at construction: `min` must be a non-negative safe integer, and `max` must be a safe integer at least `min`, omitted, or `Infinity`. Invalid bounds produce a grammar-authoring `Error` even when their values cannot be converted to text. `charClassRun(specs, min)` accepts only `0` or `1` and rejects other minimums at construction.

`sequence`/`oneOrMore`/`zeroOrMore` return arrays, not joined strings — use `map` to fold multi-character matches back into a single string before capturing them.

#### HTTP Request Parser with Captures

```typescript
import {
  capture,
  captureSequence,
  literal,
  charClass,
  oneOrMore,
  choice,
  sequence,
  map,
} from "@suzumiyaaoba/tpeg-core";

const method = capture(
  "method",
  choice(literal("GET"), literal("POST"), literal("PUT"), literal("DELETE")),
);

const pathChar = choice(
  charClass(["a", "z"]),
  charClass(["A", "Z"]),
  charClass(["0", "9"]),
  literal("/"),
  literal("-"),
);

const path = capture(
  "path",
  map(
    sequence(literal("/"), oneOrMore(pathChar)),
    ([slash, rest]) => slash + rest.join(""),
  ),
);

const protocol = capture("protocol", literal("HTTP/1.1"));

const httpRequest = captureSequence(
  method,
  literal(" "),
  path,
  literal(" "),
  protocol,
);

const result = httpRequest("GET /api/users HTTP/1.1", 0);
// result.val = {
//   method: "GET",
//   path: "/api/users",
//   protocol: "HTTP/1.1"
// }
```

#### JSON-like Parser

```typescript
import {
  capture,
  captureChoice,
  captureSequence,
  literal,
  charClass,
  zeroOrMore,
  oneOrMore,
  choice,
  sequence,
  map,
} from "@suzumiyaaoba/tpeg-core";

const stringValue = capture(
  "string",
  map(
    sequence(
      literal('"'),
      zeroOrMore(charClass(["a", "z"], ["A", "Z"], ["0", "9"], " ")),
      literal('"'),
    ),
    ([, chars]) => chars.join(""),
  ),
);

const numberValue = capture(
  "number",
  map(oneOrMore(charClass(["0", "9"])), (digits) => digits.join("")),
);

const boolValue = capture("boolean", choice(literal("true"), literal("false")));

const value = captureChoice(stringValue, numberValue, boolValue);

const keyValue = captureSequence(
  capture("key", stringValue),
  literal(":"),
  capture("value", value),
);

const result = keyValue('"name":"John"', 0);
// result.val = {
//   key: { string: "name" },
//   value: { string: "John" }
// }
```

## Grammar AST Utilities

Grammar node types, constructors (`createSequence`, `createIdentifier`, etc.),
and type guards remain available from the package entry point. Internally they
live in `grammar-nodes.ts`, `grammar-builders.ts`, and `grammar-guards.ts`;
`grammar-types.ts` re-exports them for compatibility.

Use the shared traversal helpers when inspecting grammar expressions:

```typescript
import {
  collectRuleReferences,
  createIdentifier,
  createSequence,
  createStar,
  measureExpression,
  walkExpression,
} from "@suzumiyaaoba/tpeg-core";

const expression = createSequence([
  createIdentifier("item"),
  createStar(createIdentifier("separator")),
]);

collectRuleReferences(expression); // Set { "item", "separator" }
measureExpression(expression); // { depth: 2, nodeCount: 4 }
walkExpression(expression, (node, depth) => {
  console.log(node.type, depth);
});
```

`expressionChildren` returns immediate children in source order.
`walkExpression` visits each occurrence in depth-first order; returning `false`
skips that node's children. `someExpression` stops at the first matching node.
Traversals include action bodies but do not follow references into other rules.
`findRecursiveRuleNames` detects cycle members in a rule dependency graph, and
`collectTopLevelLabels` collects capture names visible to code generation.

## Error Handling

`parse(parser, options)` accepts positive integer or `Infinity` limits for `maxInputLength` and `maxRecursionDepth`. Defaults apply to missing or undefined options; explicit null and other invalid values raise `RangeError` when constructing the parser. The public `withRecursionDepthLimit(limit, callback)` validates the same contract before invoking the callback. Input-length and recursion-depth failures both carry `fatal` and `abort`, so enclosing choices and lookahead cannot turn a resource-limit failure into a success.

`ParseError` diagnostics can use class getters, inherited fields, or non-enumerable properties such as `Error.message`. Combinators that change cut flags retain these fields. Use `cloneParseError(error)` to obtain a writable shallow copy of the standard diagnostic fields and own enumerable metadata when adding diagnostics in a custom wrapper. It reads each copied getter once and retains `fatal` and `abort`.

`choice`, `captureChoice`, and `predictiveChoice` also aggregate concrete failures that omit `expected` or provide an empty expectation array. The farthest failure wins; tied custom messages are combined without treating their text as expected input. A unique custom diagnostic retains its metadata and context. Diagnostic recording keeps source context arrays separate from materialized errors and follows the same rollback, nested parsing, and memoization behavior as leaf expectations.

Custom wrappers can snapshot the failure watermark before calling a child parser, then use `renameWatermarkExpectationsSince(input, snapshot, name, details?)` to update only the records that call contributed. Optional `found` and `context` details are copied into custom diagnostics without changing earlier snapshots or memoized records.

`formatParseError` keeps the failing character or end of input visible when shortening long source lines, and aligns the pointer with the displayed excerpt. Source control characters such as tabs and escape bytes are shown as visible escapes. `contextLines: 0` displays the error line without surrounding lines; `showPosition: false` hides the source excerpt. Empty input still displays an empty source line and its pointer.

Formatting reads each diagnostic field and option once and normalizes diagnostic text before evaluating options. Custom message templates can use inherited getters; undefined or invalid templates retain the selected locale's defaults. Unknown placeholders remain literal. `reportParseError` reads the result's error once, retains that object if formatting fails, and reports a throwing error getter without reading it again.

```typescript
import { sequence, literal, parse, offsetToPos } from "@suzumiyaaoba/tpeg-core";

const parser = sequence(literal("hello"), literal(" "), literal("world"));
const result = parse(parser)("hello there");

if (!result.success) {
  console.error(`Parse error: ${result.error.message}`);
  // result.error.pos is a plain offset; convert to line/column on demand
  const pos = offsetToPos("hello there", result.error.pos);
  console.error(`At line ${pos.line}, column ${pos.column}`);
}
```

## Type Safety

All parsers are fully typed with TypeScript:

```typescript
// Type inference works automatically
const typedParser = capture("count", oneOrMore(charClass(["0", "9"])));
// typedParser has type: Parser<{ count: string[] }>

const result = typedParser("123", 0);
if (result.success) {
  // result.val has type: { count: string[] }
  console.log(result.val.count); // ["1", "2", "3"]
}
```

## API Reference

### Basic Parsers

- `literal(str: string)` - Parse exact string
- `charClass(...specs)` - Parse a character matching any of the given specs; each spec is either a single character or a `[start, end]` tuple
- `charClassRun(specs, min, negated?, parserName?)` - Scan a maximal character-class run, with `min` equal to `0` for zero or more or `1` for one or more
- `anyChar(parserName?)` - Parse any single character (the `any` export is a pre-built `anyChar("any")`)

### Combinators

- `sequence(...parsers)` - Parse parsers in order
- `choice(...parsers)` - Parse first successful alternative
- `zeroOrMore(parser)` - Parse zero or more repetitions
- `oneOrMore(parser)` - Parse one or more repetitions
- `optional(parser)` - Parse optionally (zero or one)
- `quantified(parser, min, max?)` - Parse specific number of repetitions
- `map(parser, fn)` - Transform a parser's successful value

`map` and `mapResult` preserve the child's consumed positions before invoking the mapper, including when it calls a parser that reuses its result object. `sequence` and `captureSequence` read each child's value once and retain its next position before reading that value. On rejection, `filter` reports the value it tested and the starting position captured before reading that value or running the predicate.

### Capture System

- `capture(label, parser)` - Capture parser result with label
- `captureSequence(...parsers)` - Sequence with automatic capture merging
- `captureChoice(...parsers)` - Choice preserving capture structure
- `mergeCaptures(captures)` - Merge multiple captured objects
- `isCapturedValue(value)` - Check if value is a captured object
- `getCapturedValue(captured, label)` - Get value by an own label; returns `undefined` for missing labels and excludes inherited properties
- `getCaptureLabels(captured)` - Get all labels from captured object

### Lookahead

- `andPredicate(parser)` - Positive lookahead (non-consuming)
- `notPredicate(parser)` - Negative lookahead (non-consuming)

### Utilities

- `parse(parser)` - Curry a parser into `(input: string) => ParseResult<T>`, starting at offset 0
- `createPos(offset?)` - Create a plain numeric offset (defaults to 0)
- `offsetToPos(input, offset)` - Compute `{ offset, line, column }` for a finite, non-negative integer offset, on demand; invalid offsets throw `RangeError`. Offsets past the input are preserved, with the column bounded by the last line's length
- `isValidOffset(value)` - Check whether a value is a non-negative integer below 2³², rejecting non-numeric values without coercion
- `getCharAt(input, offset)` / `getCharAndLength(input, offset)` - Read a Unicode character; invalid or out-of-range offsets return `""` / `["", 0]`
- `isFailure(result)` - Check if result is a failure
- `isSuccess(result)` - Check if result is a success

## License

MIT
