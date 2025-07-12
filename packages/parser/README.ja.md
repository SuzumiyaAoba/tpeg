# TPEGパーサー

TPEGパーサーは、`docs/peg-grammar.md`で定義されたTPEG（TypeScript Parsing Expression Grammar）基本構文要素の解析機能を実装します。

## 概要

このパッケージは、TPEG文法的基本構文要素のパーサーを提供します：

- **文字列リテラル**: `"hello"`、`'world'`
- **文字クラス**: `[a-z]`、`[A-Z]`、`[0-9]`、`[^0-9]`、`.`
- **識別子**: `expression`、`number`、`identifier`などの規則参照

## インストール

```bash
# 依存関係をインストール
bun install

# パッケージをビルド
bun run build

# テストを実行
bun test
```

## 使用法

### 基本構文パーサー

```typescript
import { basicSyntax } from 'tpeg-parser';

const parser = basicSyntax();
const pos = { offset: 0, line: 1, column: 1 };

// 文字列リテラルをパース
const stringResult = parser('"hello world"', pos);
if (stringResult.success) {
  console.log(stringResult.val); 
  // { type: 'StringLiteral', value: 'hello world', quote: '"' }
}

// 文字クラスをパース
const charClassResult = parser('[a-z]', pos);
if (charClassResult.success) {
  console.log(charClassResult.val);
  // { type: 'CharacterClass', ranges: [{ start: 'a', end: 'z' }], negated: false }
}

// 識別子をパース
const identifierResult = parser('expression', pos);
if (identifierResult.success) {
  console.log(identifierResult.val);
  // { type: 'Identifier', name: 'expression' }
}
```

### 個別パーサー

```typescript
import { stringLiteral, characterClass, identifier } from 'tpeg-parser';

// 文字列リテラルパーサー
const strParser = stringLiteral();
const result1 = strParser("'hello'", pos);

// 文字クラスパーサー
const charParser = characterClass();
const result2 = charParser('[^0-9]', pos);

// 識別子パーサー
const idParser = identifier();
const result3 = idParser('my_rule_123', pos);
```

## APIリファレンス

### 型

#### `BasicSyntaxNode`
すべての基本TPEG構文要素の共用体型：
```typescript
type BasicSyntaxNode = StringLiteral | CharacterClass | Identifier | AnyChar;
```

#### `StringLiteral`
```typescript
interface StringLiteral {
  type: 'StringLiteral';
  value: string;
  quote: '"' | "'";
}
```

#### `CharacterClass`
```typescript
interface CharacterClass {
  type: 'CharacterClass';
  ranges: CharRange[];
  negated: boolean;
}

interface CharRange {
  start: string;
  end?: string; // 単一文字の場合はundefined
}
```

#### `Identifier`
```typescript
interface Identifier {
  type: 'Identifier';
  name: string;
}
```

#### `AnyChar`
```typescript
interface AnyChar {
  type: 'AnyChar';
}
```

### パーサー

#### `basicSyntax(): Parser<BasicSyntaxNode>`
すべての基本TPEG構文要素の組み合わせパーサー。

#### `stringLiteral(): Parser<StringLiteral>`
以下のサポートを持つ文字列リテラルパーサー：
- 二重引用符: `"hello"`
- 単一引用符: `'world'`
- エスケープシーケンス: `\n`、`\r`、`\t`、`\\`、`\"`、`\'`

注意: テンプレートリテラル（`` `template` ``）は将来の拡張で計画されています。

#### `characterClass(): Parser<CharacterClass | AnyChar>`
文字クラスと任意文字ドットのパーサー：
- 文字範囲: `[a-z]`、`[A-Z]`、`[0-9]`
- 複数範囲: `[a-zA-Z0-9_]`
- 否定クラス: `[^0-9]`
- 単一文字: `[abc]`
- 任意文字: `.`
- エスケープ文字: `[\]\\^]`

#### `identifier(): Parser<Identifier>`
識別子（規則参照）パーサー：
- 文字またはアンダースコアで開始: `a-z`、`A-Z`、`_`
- 文字、数字、アンダースコアを含む: `a-z`、`A-Z`、`0-9`、`_`
- 例: `expression`、`_private`、`rule123`、`my_rule_name`

## エラーハンドリング

すべてのパーサーは`ParseResult<T>`を返します：

```typescript
// 成功
{
  success: true;
  val: T;
  current: Pos;
  next: Pos;
}

// 失敗
{
  success: false;
  error: ParseError;
}
```

エラー情報には以下が含まれます：
- エラーメッセージ
- エラーが発生した位置
- 期待値と実際の値
- パーサーコンテキスト

## テスト

パッケージには以下をカバーする包括的なテストが含まれています：
- 有効な構文のパース
- エラーケース
- エッジケース
- パーサー優先度
- 部分パース動作

テストを実行：
```bash
bun test
```

## 依存関係

- `tpeg-core`: コア解析機能と型
- `tpeg-combinator`: パーサーコンビネーターとユーティリティ

## 貢献

このパッケージはTPEGプロジェクトの一部です。貢献ガイドラインについてはメインプロジェクトのREADMEを参照してください。

## ライセンス

MIT

---
*このパッケージはClaude 4 Sonnetの支援を受けて作成されました* 