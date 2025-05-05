# tpeg-combinator

[![npm version](https://badge.fury.io/js/tpeg.svg)](https://badge.fury.io/js/tpeg-combinator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`tpeg-combinator` is a lightweight and flexible library for parsing text using Parsing Expression Grammars (PEGs) in TypeScript. It provides a set of combinators that allow you to define grammars in a declarative way, making it easy to parse complex text formats.

## ✨ Key Features

- **🚀 Lightweight:** Minimal dependencies and a small footprint.
- **🧩 Declarative Grammars:** Define grammars using composable combinators, resulting in clean, readable, and maintainable code.
- **🛠️ Flexible & Powerful:** Supports a wide array of parsing operations, including sequence, choice, repetition, and lookahead predicates.
- **🛡️ TypeScript-First:** Built from the ground up with TypeScript, providing robust type safety and an exceptional developer experience.

## Usage

### Core Combinators

tpeg provides a set of core combinators for building parsers:

- `anyChar()`: Parses any single character.
- `literal(str)`: Parses a literal string.
- `charClass(...charsOrRanges)`: Parses a character within a specified set or range.
- `sequence(...parsers)`: Parses a sequence of parsers.
- `choice(...parsers)`: Parses one of several alternative parsers.
- `optional(parser)`: Parses an optional parser (zero or one occurrence).
- `zeroOrMore(parser)`: Parses zero or more occurrences of a parser.
- `oneOrMore(parser)`: Parses one or more occurrences of a parser.
- `andPredicate(parser)`: Positive lookahead (checks if a parser succeeds without consuming input).
- `notPredicate(parser)`: Negative lookahead (checks if a parser fails without consuming input).
- `map(parser, f)`: Transforms the result of a parser using a mapping function.
- `mapResult(parser, f)`: Transforms the result of a parser using a mapping function that receives the whole ParseSuccess object.
- `takeUntil(condition)`: Consumes characters until a condition parser succeeds.
- `between(open, close)`: Parses content between opening and closing parsers.
- `sepBy(value, separator)`: Parses zero or more occurrences of a value parser, separated by a separator parser.
- `sepBy1(value, separator)`: Parses one or more occurrences of a value parser, separated by a separator parser.
- `whitespace()`: Parses whitespace characters (spaces, tabs, newlines).
- `token(parser)`: Wraps a parser to consume trailing whitespace.
- `quotedString()`: Parses a quoted string with escape sequences.
- `memoize(parser)`: Creates a memoized version of a parser for better performance.
- `recursive()`: Creates a recursive parser that can reference itself.
- `labeled(parser, errorMessage)`: Attaches a custom error message to a parser.
- `number()`: Parses a JavaScript/JSON-style number.
- `int()`: Parses an integer number.
- `withPosition(parser)`: Adds position information to parser results.

#### `anyChar()`

The `anyChar()` combinator is the most basic parser. It attempts to consume and return any single character from the input stream. If there is no more input to consume, it will fail.

**Example:**

```typescript
import { any, parse } from "tpeg-combinator";

const parser = anyChar();

// Success case
const successResult = parse(parser)("a");
if (successResult.success) {
  console.log(successResult.val); // Output: "a"
  console.log(successResult.next.offset); // Output: 1
}

// Failure case
const failureResult = parse(parser)("");
if (!failureResult.success) {
  console.log("Parsing failed.");
}
```

**Alias**

- `any()`

#### `literal(str)`

The `literal(str)` combinator parses a specific literal string. It succeeds only if the input stream starts with the exact string provided.

```ts
import { literal, parse } from "tpeg-combinator";

const parser = literal("hello");

// Success case
const successResult = parse(parser)("hello world");
if (successResult.success) {
  console.log(successResult.val); // Output: "hello"
  console.log(successResult.next.offset); // Output: 5
}

// Failure case
const failureResult = parse(parser)("world hello");
if (!failureResult.success) {
  console.log("Parsing failed.");
}

const failureResult2 = parse(parser)("hell");
if (!failureResult2.success) {
  console.log("Parsing failed.");
}
```

**Alias**

- `lit(str)`

#### `charClass(...charsOrRanges)`

The `charClass()` combinator parses a character within a specified set or range.

**Example:**

```ts
import { charClass, parse } from "tpeg-combinator";

// Parse any lowercase letter
const lowerCaseParser = charClass(["a", "z"]);

// Success case
const successResult1 = parse(lowerCaseParser)("b");
if (successResult1.success) {
  console.log(successResult1.val); // Output: "b"
  console.log(successResult1.next.offset); // Output: 1
}

// Failure case
const failureResult1 = parse(lowerCaseParser)("B");
if (!failureResult1.success) {
  console.log("Parsing failed.");
}

// Parse any digit
const digitParser = charClass(["0", "9"]);

// Success case
const successResult2 = parse(digitParser)("5");
if (successResult2.success) {
  console.log(successResult2.val); // Output: "5"
  console.log(successResult2.next.offset); // Output: 1
}

// Parse 'a', 'b', or 'c'
const abcParser = charClass("a", "b", "c");

// Success case
const successResult3 = parse(abcParser)("a");
if (successResult3.success) {
  console.log(successResult3.val); // Output: "a"
  console.log(successResult3.next.offset); // Output: 1
}

// Failure case
const failureResult3 = parse(abcParser)("d");
if (!failureResult3.success) {
  console.log("Parsing failed.");
}

// Parse any alphanumeric character
const alphanumericParser = charClass(["a", "z"], ["A", "Z"], ["0", "9"]);

// Success case
const successResult4 = parse(alphanumericParser)("Z");
if (successResult4.success) {
  console.log(successResult4.val); // Output: "Z"
  console.log(successResult4.next.offset); // Output: 1
}
```

#### `sequence(...parsers)`

The `sequence(...parsers)` combinator parses a sequence of parsers. It succeeds only if all the parsers in the sequence succeed, one after the other. The result is an array of the results of each parser.

**Example:**

```ts
import { sequence, literal, charClass, parse } from "tpeg-combinator";

// Parse "hello" followed by a digit
const parser = sequence(literal("hello"), charClass(["0", "9"]));

// Success case
const successResult = parse(parser)("hello5");
if (successResult.success) {
  console.log(successResult.val); // Output: ["hello", "5"]
  console.log(successResult.next.offset); // Output: 6
}

// Failure case (missing digit)
const failureResult1 = parse(parser)("hello");
if (!failureResult1.success) {
  console.log("Parsing failed.");
}

// Failure case (wrong literal)
const failureResult2 = parse(parser)("world5");
if (!failureResult2.success) {
  console.log("Parsing failed.");
}

// Parse "a" then "b" then "c"
const abcParser = sequence(literal("a"), literal("b"), literal("c"));
const successResult2 = parse(abcParser)("abc");
if (successResult2.success) {
  console.log(successResult2.val); // Output: ["a", "b", "c"]
  console.log(successResult2.next.offset); // Output: 3
}
```

**Alias**

- `seq(...parsers)`

#### `choice(...parsers)`

The `choice(...parsers)` combinator attempts to parse one of several alternative parsers. It tries each parser in order, and succeeds if any of them succeed. If all parsers fail, the `choice` combinator also fails. The result is the result of the first successful parser.

**Example:**

```ts
import { choice, literal, parse } from "tpeg-combinator";

// Parse either "hello" or "world"
const parser = choice(literal("hello"), literal("world"));

// Success case 1
const successResult1 = parse(parser)("hello");
if (successResult1.success) {
  console.log(successResult1.val); // Output: "hello"
  console.log(successResult1.next.offset); // Output: 5
}

// Success case 2
const successResult2 = parse(parser)("world");
if (successResult2.success) {
  console.log(successResult2.val); // Output: "world"
  console.log(successResult2.next.offset); // Output: 5
}

// Failure case
const failureResult = parse(parser)("other");
if (!failureResult.success) {
  console.log("Parsing failed.");
}
```

#### `optional(parser)`

The `optional(parser)` combinator attempts to parse the given parser, but it doesn't fail if the parser fails. If the parser succeeds, the `optional` combinator returns singleton array containing the parser's result. If the parser fails, the `optional` combinator succeeds and returns an empty array.

**Example**

```ts
import { optional, literal, parse } from "tpeg-combinator";

// Parse an optional "hello"
const parser = optional(literal("hello"));

// Success case (with "hello")
const successResult1 = parse(parser)("hello");
if (successResult1.success) {
  console.log(successResult1.val); // Output: ["hello"]
  console.log(successResult1.next.offset); // Output: 5
}

// Success case (without "hello")
const successResult2 = parse(parser)("world");
if (successResult2.success) {
  console.log(successResult2.val); // Output: []
  console.log(successResult2.next.offset); // Output: 0
}
```

**Alias**

- `opt(parser)`

#### `zeroOrMore(parser)`

The `zeroOrMore(parser)` combinator parses zero or more occurrences of the given parser. It always succeeds, even if the parser never succeeds. The result is an array of the results of each successful parse.

**Example:**

```ts
import { zeroOrMore, literal, parse } from "tpeg-combinator";

// Parse zero or more "a"s
const parser = zeroOrMore(literal("a"));

// Success case (multiple "a"s)
const successResult1 = parse(parser)("aaa");
if (successResult1.success) {
  console.log(successResult1.val); // Output: ["a", "a", "a"]
  console.log(successResult1.next.offset); // Output: 3
}

// Success case (no "a"s)
const successResult2 = parse(parser)("bbb");
if (successResult2.success) {
  console.log(successResult2.val); // Output: []
  console.log(successResult2.next.offset); // Output: 0
}
```

**Alias**

- `star(parser)`
- `many(parser)`

#### `oneOrMore(parser)`

The `oneOrMore(parser)` combinator parses one or more occurrences of the given parser. It fails if the parser never succeeds. The result is an array of the results of each successful parse.

**Example:**

```ts
import { oneOrMore, literal, parse } from "tpeg-combinator";

// Parse one or more "a"s
const parser = oneOrMore(literal("a"));

// Success case (multiple "a"s)
const successResult1 = parse(parser)("aaa");
if (successResult1.success) {
  console.log(successResult1.val); // Output: ["a", "a", "a"]
  console.log(successResult1.next.offset); // Output: 3
}

// Success case (one "a")
const successResult2 = parse(parser)("a");
if (successResult2.success) {
  console.log(successResult2.val); // Output: ["a"]
  console.log(successResult2.next.offset); // Output: 1
}

// Failure case (no "a"s)
const failureResult = parse(parser)("bbb");
if (!failureResult.success) {
  console.log("Parsing failed.");
}
```

**Alias**

- `plus(parser)`
- `many1(parser)`

#### `andPredicate(parser)`

The `andPredicate(parser)` combinator is a positive lookahead predicate. It checks if the given parser would succeed at the current position in the input stream, but it does not consume any input. If the parser would succeed, the `andPredicate` combinator succeeds and returns `undefined`. If the parser would fail, the `andPredicate` combinator fails.

**Example:**

```ts
import { andPredicate, literal, parse, anyChar } from "tpeg-combinator";

// Check if the next character is "a" without consuming it
const parser = andPredicate(literal("a"));

// Success case ("a" is next)
const successResult1 = parse(parser)("abc");
if (successResult1.success) {
  console.log(successResult1.val); // Output: undefined
  console.log(successResult1.next.offset); // Output: 0 (no input consumed)
}
const successResult2 = parse(sequence(parser, anyChar()))("abc");
if (successResult2.success) {
  console.log(successResult2.val); // Output: [undfined, "a"]
  console.log(successResult2.next.offset); // Output: 1
}

// Failure case ("b" is next)
const failureResult = parse(parser)("bbc");
if (!failureResult.success) {
  console.log("Parsing failed.");
}
```

**Alias**

- `and(parser)`
- `positive(parser)`
- `assert(parser)`

#### `notPredicate(parser)`

The `notPredicate(parser)` combinator is a negative lookahead predicate. It checks if the given parser would fail at the current position in the input stream, but it does not consume any input. If the parser would fail, the `notPredicate` combinator succeeds and returns `undefined`. If the parser would succeed, the `notPredicate` combinator fails.

**Example:**

```ts
import { notPredicate, literal, parse, anyChar } from "tpeg-combinator";

// Check if the next character is NOT "a" without consuming it
const parser = notPredicate(literal("a"));

// Success case ("b" is next)
const successResult1 = parse(parser)("bbc");
if (successResult1.success) {
  console.log(successResult1.val); // Output: undefined
  console.log(successResult1.next.offset); // Output: 0 (no input consumed)
}
const successResult2 = parse(sequence(parser, anyChar()))("bbc");
if (successResult2.success) {
  console.log(successResult2.val); // Output: [undefined, "b"]
  console.log(successResult2.next.offset); // Output: 1
}

// Failure case ("a" is next)
const failureResult = parse(parser)("abc");
if (!failureResult.success) {
  console.log("Parsing failed.");
}
```

**Alias**

- `not(parser)`
- `negative(parser)`

#### `map(parser, f)`

The `map(parser, f)` combinator transforms the result of a parser using a mapping function `f`. If the parser succeeds, the mapping function is applied to the parser's result, and the `map` combinator returns the transformed value. If the parser fails, the `map` combinator also fails.

**Example**

```ts
import { map, literal, parse } from "tpeg-combinator";

// Parse "hello" and transform it to uppercase
const parser = map(literal("hello"), (s) => s.toUpperCase());

// Success case
const successResult = parse(parser)("hello");
if (successResult.success) {
  console.log(successResult.val); // Output: "HELLO"
  console.log(successResult.next.offset); // Output: 5
}

// Failure case
const failureResult = parse(parser)("world");
if (!failureResult.success) {
  console.log("Parsing failed.");
}
```

#### `mapResult(parser, f)`

The `mapResult(parser, f)` combinator transforms the result of a parser using a mapping function f. This function receives the whole `ParseSuccess` object. If the parser succeeds, the mapping function is applied to the `ParseSuccess` object, and the `mapResult` combinator returns the transformed value. If the parser fails, the `mapResult` combinator also fails.

**Example:**

```ts
import { mapResult, literal, parse, ParseSuccess } from "tpeg-combinator";

// Parse "hello" and transform it to uppercase and add offset
const parser = mapResult(literal("hello"), (result: ParseSuccess<string>) => {
  return { val: result.val.toUpperCase(), offset: result.next.offset };
});

// Success case
const successResult = parse(parser)("hello");
if (successResult.success) {
  console.log(successResult.val); // Output: { val: "HELLO", offset: 5 }
  console.log(successResult.next.offset); // Output: 5
}

// Failure case
const failureResult = parse(parser)("world");
if (!failureResult.success) {
  console.log("Parsing failed.");
}
```

## 📚 Examples

Explore these examples to see tpeg in action:

- [Simple Arithmetic Expression Parser](./packages/samples/src/arith/): Parse and evaluate basic arithmetic expressions.
- [PEG Grammar Parser](./packages/samples/src/peg/): Parse PEG grammars themselves, demonstrating the power of tpeg.

## 🤝 Contributing

We welcome contributions from the community! If you're interested in helping improve tpeg, please:

- Open an issue to report bugs or suggest new features.
- Submit a pull request with your proposed changes.

## 📄 License

This project is licensed under the MIT License.
