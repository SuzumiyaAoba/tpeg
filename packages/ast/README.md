# TPEG AST

Abstract Syntax Tree utilities for TPEG (TypeScript Parsing Expression Grammar).

## Overview

This package provides utilities for building and manipulating Abstract Syntax Trees (ASTs) that follow the Unist specification. It's designed to work seamlessly with TPEG parsers to create structured representations of parsed content.

## Installation

```bash
npm install tpeg-ast
```

## Features

- **Unist-compliant AST nodes**: Compatible with the unified ecosystem
- **Type-safe node creation**: TypeScript support for all AST operations
- **Tree manipulation utilities**: Functions for traversing and modifying AST structures
- **Position tracking**: Automatic source position information
- **Extensible node types**: Easy to add custom node types for domain-specific grammars

## Basic Usage

```typescript
import { createNode, walkTree, findNodes } from 'tpeg-ast';

// Create AST nodes
const literalNode = createNode('Literal', {
  value: 'hello',
  raw: '"hello"'
});

const expressionNode = createNode('Expression', {
  left: literalNode,
  operator: '+',
  right: createNode('Literal', { value: 'world', raw: '"world"' })
});

// Walk the tree
walkTree(expressionNode, (node) => {
  console.log(`Node type: ${node.type}`);
});

// Find specific nodes
const literals = findNodes(expressionNode, 'Literal');
```

## API Reference

### Core Functions

#### `createNode<T>(type: string, properties: T): ASTNode<T>`
Creates a new AST node with the specified type and properties.

#### `walkTree(node: ASTNode, visitor: (node: ASTNode) => void): void`
Traverses the AST tree and calls the visitor function for each node.

#### `findNodes(node: ASTNode, type: string): ASTNode[]`
Finds all nodes of a specific type within the tree.

### Types

#### `ASTNode<T = any>`
Base interface for all AST nodes following the Unist specification:

```typescript
interface ASTNode<T = any> {
  type: string;
  position?: Position;
  data?: any;
  // Additional properties from T
}
```

#### `Position`
Source position information:

```typescript
interface Position {
  start: Point;
  end: Point;
}

interface Point {
  line: number;
  column: number;
  offset?: number;
}
```

## Integration with TPEG Parsers

```typescript
import { map } from 'tpeg-core';
import { createNode } from 'tpeg-ast';

// Transform parse results into AST nodes
const numberParser = map(
  digits,
  (value, position) => createNode('Number', {
    value: parseInt(value, 10),
    raw: value,
    position
  })
);
```

## Dependencies

- Based on the [Unist](https://github.com/syntax-tree/unist) specification
- Compatible with the [unified](https://unifiedjs.com/) ecosystem

## License

MIT