# TPEG AST

PEG文法のための型付きASTノード定義とビルダー関数。[unist](https://github.com/syntax-tree/unist)の`Node`/`Literal`/`Parent`インターフェースの上に構築されています。

## 概要

このパッケージは、PEG文法そのものの構文——リテラル、識別子、シーケンス、選択、文字クラス、繰り返し、先読み述語、規則定義、文法全体——を、型付きでunist互換なASTとしてモデル化します。`tpeg-parser`/`tpeg-generator`が構築・消費するノードモデルであり、汎用的なツリー走査ユーティリティ（`createNode`/`walkTree`/`findNodes`など）は提供しません。各ノード型にはそれぞれ専用のコンストラクター関数と型ガードが用意されています。

## インストール

```bash
npm install @suzumiyaaoba/tpeg-ast
```

## 基本的な使い方

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

すべてのコンストラクターはプレーンでJSONシリアライズ可能なオブジェクトを返します。ノードの形自体を覚える以外に、隠されたツリー操作APIを学ぶ必要はありません。

## ノード型

| ノード | 形状 | コンストラクター |
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

`ExprNode`は上記のすべての式ノード型（`Definition`/`Grammar`を除く）の共用体、`PegAstNode`はさらに`Definition`と`Grammar`を含みます。

## 型ガード

すべてのノード型に対応する型ガードが用意されています。例：`isLiteral(node)`、`isIdentifier(node)`、`isSequence(node)`、`isChoice(node)`、`isOptional(node)`、`isMap(node)`、`isCharClass(node)`、`isAnyChar(node)`、`isAndPredicate(node)`、`isNotPredicate(node)`、`isZeroOrMore(node)`、`isOneOrMore(node)`、`isGroup(node)`、`isChar(node)`、`isRange(node)`、`isDefinition(node)`、`isGrammar(node)`——それぞれ`PegAstNode`を対応する型に絞り込みます。

```typescript
import { isDefinition, isCharClass } from '@suzumiyaaoba/tpeg-ast';

if (isDefinition(node) && isCharClass(node.children[1])) {
  // node.children[1] は CharClass 型に絞り込まれる
}
```

## 依存関係

- `@types/unist` — すべてのPEGノードが拡張する`Node`/`Literal`/`Parent`インターフェース

## ライセンス

MIT
