# TPEGパーサーサンプル

TPEG（TypeScript Parsing Expression Grammar）パーサー機能の包括的な実証。このパッケージは、基本構文解析、表現構成、高度な文法定義ブロックを含むすべての実装された機能を紹介します。

## 🎯 実証される内容

### 基本解析機能
- **文字列リテラル**: `"hello world"`、`'single quotes'`、エスケープシーケンス
- **文字クラス**: `[a-z]`、`[0-9A-F]`、`[abc]`
- **識別子**: 変数名、camelCase、snake_case、Unicodeサポート
- **表現構成**: シーケンス、選択、グループ化

### 高度な文法機能（フェーズ1.6）
- **文法注釈**: `@version`、`@description`、`@author`
- **規則定義**: 表現を持つ複雑な解析規則
- **完全な文法ブロック**: 構造化された文法定義
- **コメントサポート**: 単一行（`//`）とドキュメント（`///`）コメント
- **Unicodeサポート**: 全体を通じた完全なUnicode処理

## 🚀 クイックスタート

```bash
# 完全なデモを実行
bun run demo

# 基本解析機能デモを実行
bun run demo:basic

# 文法定義機能デモを実行
bun run demo:grammar
```

## 📚 デモスクリプト

### 1. 完全なデモ（`bun run demo`）
計算機文法定義を含む実世界の例でTPEGのすべての機能の包括的な概要。

### 2. 基本デモ（`bun run demo:basic`）
基本的な解析機能を実証：
- エスケープシーケンス付き文字列リテラル解析
- 文字クラスマッチング
- 識別子認識
- 表現構成（シーケンス、選択、グループ）

### 3. 文法デモ（`bun run demo:grammar`）
フェーズ1.6文法定義機能を紹介：
- メタデータのための文法注釈
- 複雑な表現を持つ規則定義
- 完全な文法ブロック
- コメント解析
- 実世界の文法例

### 4. ファイルベースデモ（`bun run demo:files`）
ファイルベースの解析ワークフローを実証：
- .tpegファイルからの文法定義の読み込み
- テキストファイルからの入力サンプルの読み込み
- 実世界の解析シナリオ
- 構造化された入力処理

## 🔧 使用例

### 基本解析

```typescript
import { parse } from "tpeg-core";
import { stringLiteral, identifier, tpegExpression } from "tpeg-parser";

// 文字列リテラルをパース
const result1 = parse(stringLiteral, '"hello world"');
// → { success: true, val: { type: "StringLiteral", value: "hello world" } }

// 識別子をパース
const result2 = parse(identifier, "myVariable");
// → { success: true, val: { type: "Identifier", name: "myVariable" } }

// 複雑な表現をパース
const result3 = parse(tpegExpression, '"start" " " [a-z]+ "end"');
// → { success: true, val: { type: "Sequence", elements: [...] } }
```

### 文法定義

```typescript
import { parse } from "tpeg-core";
import { grammarDefinition } from "tpeg-parser";

const grammarSource = `
grammar Calculator {
  @version: "1.0"
  @description: "Simple arithmetic calculator"
  
  expression = term (("+" / "-") term)*
  term = factor (("*" / "/") factor)*
  factor = number / "(" expression ")"
  number = [0-9]+ ("." [0-9]+)?
}`;

const result = parse(grammarDefinition, grammarSource);
// → { success: true, val: { name: "Calculator", annotations: [...], rules: [...] } }
```

## 🌟 主要機能のハイライト

### ✅ 実装された機能
- エスケープシーケンス付き文字列リテラル（`\\n`、`\\t`、`\\"`など）
- 文字クラスと範囲`[a-z]`、`[0-9A-F]`
- アンダースコアサポート付き識別子
- 表現構成（シーケンス、選択、グループ化）
- 文法注釈（`@version`、`@description`など）
- 複雑な表現を持つ規則定義
- メタデータ付き完全な文法ブロック
- コメント解析（`//`と`///`）
- すべてのパーサーを通じたUnicodeサポート
- 位置情報を含む包括的なエラー報告

### 🏗️ アーキテクチャの利点
- **モノレポ構造**: 複数の焦点を絞ったパッケージ
- **TypeScript Strict Mode**: `@tsconfig/strictest`との完全な準拠
- **包括的なテスト**: 683のテストと高いカバレッジ
- **関数型設計**: パフォーマンス最適化を備えたパーサーコンビネーター
- **AST生成**: Unist準拠の抽象構文木
- **パフォーマンス**: 最適な速度のためのconstベースのパーサー宣言

## 📦 パッケージ構造

```text
packages/parser-sample/
├── src/
│   ├── demo.ts           # 完全な機能実証
│   ├── basic-demo.ts     # 基本解析機能
│   ├── grammar-demo.ts   # 文法定義機能
│   └── index.ts          # メインエクスポート
├── package.json
├── tsconfig.json
└── README.md
```

## 🔗 関連パッケージ

- **tpeg-core**: コア解析型とユーティリティ
- **tpeg-parser**: TPEG文法パーサー実装
- **tpeg-combinator**: パーサーコンビネーター
- **tpeg-ast**: AST構築と操作
- **tpeg-samples**: 追加の例パーサー（JSON、CSV、算術）

## 💡 次のステップ

このデモを探索した後：

1. **ソースコードを調査** `src/`で実装詳細を理解
2. **他のサンプルを確認** `packages/samples/`でJSON、CSV、算術パーサー
3. **ドキュメントを読む** 各パッケージのREADMEで詳細なAPI情報
4. **カスタム文法で実験** 実証されたパターンを使用

## 🎉 解析の準備完了！

このサンプルはTPEGパーサーの完全な力を実証します。実装は基本解析の優雅な単純さと完全な文法定義システムの洗練された機能の両方を紹介します。

TPEGで楽しい解析を！🚀 