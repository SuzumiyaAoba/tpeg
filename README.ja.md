# tpeg

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **注意**: このプロジェクトは現在開発中（アルファ版）です。APIは変更される可能性があるため、本番環境での使用には注意してください。

TPEGは、Parsing Expression Grammar（PEG）を使用してパーサーを構築するためのTypeScriptライブラリです。コード生成機能を備えた柔軟なパースソリューションを提供する複数のパッケージで構成されています。

## 機能

- **軽量**: 最小限の依存関係と小さなフットプリント
- **宣言的文法**: 組み合わせ可能なコンビネーターを使用して文法を定義
- **モジュラーアーキテクチャ**: 必要なパッケージのみを使用
- **TypeScriptサポート**: TypeScriptで最初から構築
- **ASTサポート**: パースされたコンテンツの抽象構文木を生成
- **コード生成**: テンプレートを使用して文法定義からパーサーコードを生成
- **繰り返し演算子**: PEG繰り返し演算子（`*`、`+`、`?`、`{n,m}`）の完全サポート
- **効率的**: パフォーマンスを考慮して設計
- **スナップショットテスト**: コード生成の包括的なテスト

## パッケージ

TPEGは以下のパッケージで構成されるモノレポです：

### tpeg-core

PEGパースのためのコア型とユーティリティ。

```bash
npm install tpeg-core
```

### tpeg-combinator

tpeg-coreの上に構築されたパーサーコンビネーター。

```bash
npm install tpeg-combinator
```

### tpeg-ast

抽象構文木の構築と操作のためのツール。

```bash
npm install tpeg-ast
```

### tpeg-parser

完全な繰り返し演算子サポートを持つTPEG構文のPEG文法パーサー。

```bash
npm install tpeg-parser
```

### tpeg-generator

TPEGパーサーのためのテンプレートベースのコード生成システム。

```bash
npm install tpeg-generator
```

### tpeg-samples

様々なユースケースを実証するサンプルパーサー。

```bash
npm install tpeg-samples
```

### tpeg-parser-sample

パーサーパッケージのサンプル実装と例。

```bash
npm install tpeg-parser-sample
```

## 使用例

TPEGには以下のサンプルパーサーが含まれています：

- JSONパーサー
- CSVパーサー
- 算術式パーサー
- PEG文法パーサー

### 算術計算機を試す

インタラクティブツールで算術式パーサーを簡単に試すことができます：

```bash
# クローンとセットアップ
git clone https://github.com/SuzumiyaAoba/tpeg.git
cd tpeg
bun install

# 異なるモードで計算機を試す
cd packages/samples

# 基本的なデモ
bun run arith

# 特定の式を計算
bun run arith "1 + 2 * 3"

# AST構造を表示
bun run arith --ast "(1 + 2) * 3"

#### すべての例を実行
bun run arith:examples

# インタラクティブREPL
bun run arith:repl
```

### 基本的な例

```typescript
import { literal, choice, seq, zeroOrMore, parse } from "tpeg-core";

// "hello"または"world"の簡単なパーサーを定義
const helloOrWorld = choice(literal("hello"), literal("world"));

// スペースで区切られたhelloまたはworldのシーケンスをパース
const parser = seq(helloOrWorld, zeroOrMore(seq(literal(" "), helloOrWorld)));

// テキストをパース
const result = parse(parser, "hello world hello");
console.log(result);
```

### コード生成の例

```typescript
import { generateEtaTypeScriptParser } from 'tpeg-generator';
import type { GrammarDefinition } from 'tpeg-generator';

const grammar: GrammarDefinition = {
  type: 'GrammarDefinition',
  name: 'Calculator',
  annotations: [],
  rules: [
    {
      type: 'RuleDefinition',
      name: 'number',
      pattern: {
        type: 'StringLiteral',
        value: '123'
      }
    }
  ]
};

const result = await generateEtaTypeScriptParser(grammar, {
  namePrefix: 'calc_',
  includeTypes: true,
  optimize: true
});

console.log(result.code); // 生成されたTypeScriptパーサーコード
```

## パーサーコンビネーター

このパッケージは、tpeg-coreの上に構築された多くの有用なパーサーコンビネーターを提供します：

### 文字列パース

- `quotedString()`: JavaScript/JSONスタイルの二重引用符付き文字列をパース
- `singleQuotedString()`: 単一引用符付き文字列をパース
- `anyQuotedString()`: 単一または二重引用符の文字列をパース
- `takeUntil(condition)`: 条件が満たされるまで文字を消費
- `between(open, close)`: 2つのパーサー間のコンテンツにマッチ

### パターンマッチング

- `regex(pattern)`: 正規表現にマッチするテキストをパース
- `regexGroups(pattern)`: 正規表現マッチからすべてのキャプチャグループをパースして返す

### 数値パース

- `number()`: 分数と指数を含むJavaScript/JSONスタイルの数値をパース
- `int()`: 整数をパース

### リストパース

- `sepBy(value, separator)`: 区切り文字で区切られた値をパース（0回以上）
- `sepBy1(value, separator)`: 区切り文字で区切られた値をパース（1回以上）
- `commaSeparated(value)`: オプションの末尾カンマを持つカンマ区切り値をパース
- `commaSeparated1(value)`: カンマ区切り値をパース（少なくとも1つ）

### エラーハンドリング

- `labeled(parser, message)`: カスタムエラーメッセージを提供
- `labeledWithContext(parser, message, context)`: エラーメッセージにコンテキストを追加
- `withDetailedError(parser, name)`: 入力抜粋を含む詳細なエラーレポートを作成
- `withPosition(parser)`: より良いエラー報告のために行と列を追跡

### パフォーマンスとデバッグ

- `memoize(parser, options)`: キャッシュサイズ制御を持つパーサーのメモ化版を作成
- `recursive()`: 再帰パーサーを作成
- `debug(parser, name, options)`: デバッグのためにパースプロセスをログ出力

### 空白とトークン

- `token(parser)`: 前後の空白を消費するパーサーをラップ
- `whitespace`: 空白文字を消費
- `spaces`: 0回以上の空白文字を消費
- `newline`: 任意の改行シーケンスにマッチ

## テスト

TPEGには以下の包括的なテストスイートがあります：

- 個別のパーサーとユーティリティのユニットテスト
- パーサー組み合わせの統合テスト
- サンプルパーサー実装のテスト
- パフォーマンスベンチマーク
- コード生成の一貫性のためのスナップショットテスト

安定性と信頼性を確保するため、高いテストカバレッジ（>80%）を維持することを目指しています。

### スナップショットテスト

generatorパッケージには、コード生成が一貫した期待される出力を生成することを保証するスナップショットテストが含まれています。以下を検証します：

- 生成されたTypeScriptコード構造
- import文
- export宣言
- パフォーマンスメタデータ

スナップショットテストの詳細については、[SNAPSHOT_TESTING.md](./packages/generator/SNAPSHOT_TESTING.md)を参照してください。

## はじめに

### 前提条件

- Node.js 14+
- npmまたはbun

### インストール

```bash
# コアパッケージをインストール
npm install tpeg-core

# またはbunで
bun add tpeg-core

# オプションで追加パッケージをインストール
npm install tpeg-combinator tpeg-ast tpeg-generator
```

## 開発

```bash
# リポジトリをクローン
git clone https://github.com/SuzumiyaAoba/tpeg.git
cd tpeg

# 依存関係をインストール
bun install

# すべてのパッケージをビルド
bun run build

# テストを実行
bun run test

# カバレッジレポート付きでテストを実行
bun run test:coverage

# 開発中のテストを監視
bun run test:watch
```

## ドキュメント

- [PEG基礎](./docs/peg.md) - 構文解析表現文法の紹介
- [TPEG文法仕様](./docs/peg-grammar.md) - 詳細な文法定義言語仕様
- [Generatorドキュメント](./packages/generator/README.md) - コード生成システムドキュメント
- [スナップショットテストガイド](./packages/generator/SNAPSHOT_TESTING.md) - スナップショットテストドキュメント

## ライセンス

このプロジェクトはMITライセンスの下でライセンスされています - 詳細はLICENSEファイルを参照してください。 