# TPEG AST

Typed AST node definitions and builder functions for PEG grammars, built on the [unist](https://github.com/syntax-tree/unist) `Node`/`Literal`/`Parent` interfaces.

## Overview

This package models the syntax of a PEG grammar itself — literals, identifiers, sequences, choices, character classes, repetition, predicates, rule definitions, and whole grammars — as a typed, unist-compatible AST. It's the node model `tpeg-parser`/`tpeg-generator` build and consume; it does not provide generic tree-walking utilities (no `createNode`/`walkTree`/`findNodes`) — each node type has its own constructor and type guard instead.

## Installation

```bash
npm install @suzumiyaaoba/tpeg-ast
```

## Basic Usage

```typescript
import { definition, grammar, charClass, range, identifier, sequence, literal } from '@suzumiyaaoba/tpeg-ast';

// digit = [0-9]
const digitRule = definition("digit", charClass(range("0", "9")));

// letter = [a-zA-Z]
const letterRule = definition("letter", charClass(range("a", "z"), range("A", "Z")));

// greeting = "hello" identifier
const greetingRule = definition("greeting", sequence(literal("hello"), identifier("name")));

const g = grammar(digitRule, letterRule, greetingRule);
// {
//   type: "grammar",
//   children: [
//     { type: "definition", children: [{ type: "identifier", value: "digit" }, ...] },
//     ...
//   ]
// }
```

Every constructor returns a plain, JSON-serializable object — there's no hidden tree-manipulation API to learn beyond the node shapes themselves.

## Node Types

| Node | Shape | Constructor |
| --- | --- | --- |
| `Literal<T>` | `{ type: "literal", value: T }` | `literal(value)` |
| `Identifier<T>` | `{ type: "identifier", value: T }` | `identifier(value)` |
| `Sequence` | `{ type: "sequence", children: ExprNode[] }` | `sequence(...exprs)` |
| `Choice` | `{ type: "choice", children: ExprNode[] }` | `choice(...exprs)` |
| `Optional` | `{ type: "optional", children: [ExprNode] }` | `optional(expr)` |
| `MapNode` | `{ type: "map", children: [ExprNode], data: { mapper } }` | `map(expr, mapper)` |
| `Char<T>` | `{ type: "char", value: T }` | `char(value)` |
| `Range<F, T>` | `{ type: "range", value: [F, T] }` | `range(from, to)` |
| `CharClass` | `{ type: "charClass", children: CharClassElement[] }` | `charClass(...elements)` |
| `AnyChar` | `{ type: "anyChar" }` | `anyChar()` |
| `AndPredicate` | `{ type: "andPredicate", children: [ExprNode] }` | `andPredicate(expr)` |
| `NotPredicate` | `{ type: "notPredicate", children: [ExprNode] }` | `notPredicate(expr)` |
| `ZeroOrMore` | `{ type: "zeroOrMore", children: [ExprNode] }` | `zeroOrMore(expr)` |
| `OneOrMore` | `{ type: "oneOrMore", children: [ExprNode] }` | `oneOrMore(expr)` |
| `Group` | `{ type: "group", children: [ExprNode] }` | `group(expr)` |
| `Definition` | `{ type: "definition", children: [Identifier, ExprNode] }` | `definition(id, expr)` |
| `Grammar` | `{ type: "grammar", children: Definition[] }` | `grammar(...definitions)` |

`ExprNode` is the union of all expression node types above (everything except `Definition`/`Grammar`); `PegAstNode` additionally includes `Definition` and `Grammar`.

## Type Guards

Every node type has a matching type guard, e.g. `isLiteral(node)`, `isIdentifier(node)`, `isSequence(node)`, `isChoice(node)`, `isOptional(node)`, `isMap(node)`, `isCharClass(node)`, `isAnyChar(node)`, `isAndPredicate(node)`, `isNotPredicate(node)`, `isZeroOrMore(node)`, `isOneOrMore(node)`, `isGroup(node)`, `isChar(node)`, `isRange(node)`, `isDefinition(node)`, `isGrammar(node)` — each narrows a `PegAstNode` to its specific interface.

```typescript
import { isDefinition, isCharClass } from '@suzumiyaaoba/tpeg-ast';

if (isDefinition(node) && isCharClass(node.children[1])) {
  // node.children[1] is narrowed to CharClass
}
```

## Dependencies

- `@types/unist` — the `Node`/`Literal`/`Parent` interfaces every PEG node extends

## License

MIT
