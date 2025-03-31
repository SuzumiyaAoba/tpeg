# tpeg

[![npm version](https://badge.fury.io/js/tpeg.svg)](https://badge.fury.io/js/tpeg)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`tpeg` is a lightweight and flexible library for parsing text using Parsing Expression Grammars (PEGs) in TypeScript. It provides a set of combinators that allow you to define grammars in a declarative way, making it easy to parse complex text formats.

## ✨ Key Features

- **🚀 Lightweight:** Minimal dependencies and a small footprint.
- **🧩 Declarative Grammars:** Define grammars using composable combinators, resulting in clean, readable, and maintainable code.
- **🛠️ Flexible & Powerful:** Supports a wide array of parsing operations, including sequence, choice, repetition, and lookahead predicates.
- **🛡️ TypeScript-First:** Built from the ground up with TypeScript, providing robust type safety and an exceptional developer experience.

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
