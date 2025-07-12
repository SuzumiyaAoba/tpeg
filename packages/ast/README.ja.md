# TPEG AST

TPEG（TypeScript Parsing Expression Grammar）の抽象構文木ユーティリティ。

## 概要

このパッケージは、Unist仕様に従う抽象構文木（AST）を構築および操作するためのユーティリティを提供します。TPEGパーサーとシームレスに連携して、パースされたコンテンツの構造化された表現を作成するように設計されています。

## インストール

```bash
npm install tpeg-ast
```

## 機能

- **Unist準拠のASTノード**: unifiedエコシステムと互換性
- **型安全なノード作成**: すべてのAST操作に対するTypeScriptサポート
- **ツリー操作ユーティリティ**: AST構造の走査と修正のための関数
- **位置追跡**: 自動ソース位置情報
- **拡張可能なノード型**: ドメイン固有文法のためのカスタムノード型を簡単に追加

## 基本的な使用法

```typescript
import { createNode, walkTree, findNodes } from 'tpeg-ast';

// ASTノードを作成
const literalNode = createNode('Literal', {
  value: 'hello',
  raw: '"hello"'
});

const expressionNode = createNode('Expression', {
  left: literalNode,
  operator: '+',
  right: createNode('Literal', { value: 'world', raw: '"world"' })
});

// ツリーを走査
walkTree(expressionNode, (node) => {
  console.log(`ノード型: ${node.type}`);
});

// 特定のノードを検索
const literals = findNodes(expressionNode, 'Literal');
```

## APIリファレンス

### コア関数

#### `createNode<T>(type: string, properties: T): ASTNode<T>`
指定された型とプロパティを持つ新しいASTノードを作成します。

#### `walkTree(node: ASTNode, visitor: (node: ASTNode) => void): void`
ASTツリーを走査し、各ノードに対してビジター関数を呼び出します。

#### `findNodes(node: ASTNode, type: string): ASTNode[]`
ツリー内の特定の型のすべてのノードを検索します。

### 型

#### `ASTNode<T = any>`
Unist仕様に従うすべてのASTノードの基本インターフェース：

```typescript
interface ASTNode<T = any> {
  type: string;
  position?: Position;
  data?: any;
  // Tからの追加プロパティ
}
```

#### `Position`
ソース位置情報：

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

## TPEGパーサーとの統合

```typescript
import { map } from 'tpeg-core';
import { createNode } from 'tpeg-ast';

// パース結果をASTノードに変換
const numberParser = map(
  digits,
  (value, position) => createNode('Number', {
    value: parseInt(value, 10),
    raw: value,
    position
  })
);
```

## 依存関係

- [Unist](https://github.com/syntax-tree/unist)仕様に基づく
- [unified](https://unifiedjs.com/)エコシステムと互換性

## ライセンス

MIT 