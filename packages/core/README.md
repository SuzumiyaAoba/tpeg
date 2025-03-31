# tpeg

`tpeg` is a lightweight and flexible library for parsing text using Parsing Expression Grammars (PEGs) in TypeScript. It provides a set of combinators that allow you to define grammars in a declarative way, making it easy to parse complex text formats.

## Features

-   **Lightweight:** Minimal dependencies and a small footprint.
-   **Declarative:** Define grammars using combinators, making them easy to read and understand.
-   **Flexible:** Supports a wide range of parsing operations, including sequence, choice, repetition, and predicates.
-   **TypeScript:** Built with TypeScript, providing type safety and excellent developer experience.
-   **Error Reporting:** Provides detailed error messages with position information to help you debug your grammars.
- **PEG Parser:** Includes a parser for parsing PEG grammars themselves.

## Usage

### Core Combinators

tpeg provides a set of core combinators for building parsers:

- `any()`: Parses any single character.
- `lit(str)`: Parses a literal string.
- `charClass(...charsOrRanges)`: Parses a character within a specified set or range.
- `seq(...parsers)`: Parses a sequence of parsers.
- `choice(...parsers)`: Parses one of several alternative parsers.
- `opt(parser)`: Parses an optional parser (zero or one occurrence).
- `star(parser)`: Parses zero or more occurrences of a parser.
- `plus(parser)`: Parses one or more occurrences of a parser.
- `and(parser)`: Positive lookahead (checks if a parser succeeds without consuming input).
- `not(parser)`: Negative lookahead (checks if a parser fails without consuming input).
- `map(parser, f)`: Transforms the result of a parser using a mapping function.
- `mapResult(parser, f)`: Transforms the result of a parser using a mapping function that receives the whole ParseSuccess object.

### Examples

- [simple arithmetic expression parser](./packages/samples/src/arith/)
- [PEG Grammar Parser](./packages/samples/src/peg/)

## Contributing

Contributions are welcome! Please feel free to open issues or submit pull requests.
