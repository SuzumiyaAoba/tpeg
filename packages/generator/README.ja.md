# tpeg-generator

TPEGパーサーのためのテンプレートベースのコード生成システム。モジュラーアーキテクチャと再利用性のためにパーサーパッケージから分離されています。

## 機能

- **テンプレートベース生成**: 予測可能な出力のためのEtaテンプレートエンジンを使用
- **型安全**: 厳密な型チェックを備えた完全なTypeScriptサポート
- **パフォーマンス最適化**: 自動メモ化と最適化検出
- **モジュラーアーキテクチャ**: コード生成の懸念事項のための独立パッケージ
- **複数の出力モード**: 基本とパフォーマンス最適化されたコード生成

## インストール

```bash
bun add @suzumiyaaoba/tpeg-generator
```

## 使用法

### 基本コード生成

```typescript
import { generateEtaTypeScriptParser } from "@suzumiyaaoba/tpeg-generator";
import type { GrammarDefinition } from "@suzumiyaaoba/tpeg-generator";

const grammar: GrammarDefinition = {
  type: "GrammarDefinition",
  name: "Calculator",
  annotations: [],
  rules: [
    {
      type: "RuleDefinition",
      name: "number",
      pattern: {
        type: "StringLiteral",
        value: "123",
      },
    },
  ],
};

const result = await generateEtaTypeScriptParser(grammar, {
  namePrefix: "calc_",
  includeTypes: true,
  optimize: true,
});

console.log(result.code); // 生成されたTypeScriptパーサーコード
```

### 高度な設定

```typescript
import { EtaTPEGCodeGenerator } from "@suzumiyaaoba/tpeg-generator";

const generator = new EtaTPEGCodeGenerator({
  language: "typescript",
  namePrefix: "parser_",
  includeTypes: true,
  optimize: true,
  enableMemoization: true,
  includeMonitoring: false,
  templatesDir: "./custom-templates",
  cache: true,
  debug: false,
});

const result = await generator.generateGrammar(grammar);
```

## テンプレートシステム

ジェネレーターは予測可能で保守可能なコード生成のために外部テンプレートファイルを使用します：

```
templates/
├── base/
│   ├── imports.eta          # 標準インポート
│   ├── parser-file.eta      # 基本パーサーファイル構造
│   ├── rule.eta            # 標準規則生成
│   └── rule-memoized.eta   # メモ化規則生成
└── optimized/
    ├── imports.eta          # パフォーマンス強化インポート
    ├── parser-file.eta      # 最適化されたパーサーファイル
    └── rule-optimized.eta   # パフォーマンス最適化された規則
```

## APIリファレンス

### 関数

#### `generateEtaTypeScriptParser(grammar, options?)`

TypeScriptパーサーコードを生成するための便利関数。

- `grammar`: GrammarDefinition - コード生成対象のTPEG文法
- `options`: Partial<CodeGenOptions> - 生成オプション
- 戻り値: Promise<GeneratedCode>

### クラス

#### `EtaTPEGCodeGenerator`

完全な設定オプションを持つメインコードジェネレータークラス。

### 型

#### `CodeGenOptions`

コード生成の設定オプション：

```typescript
interface CodeGenOptions {
  language: "typescript";
  namePrefix?: string;
  includeImports?: boolean;
  includeTypes?: boolean;
  optimize?: boolean;
  enableMemoization?: boolean;
  includeMonitoring?: boolean;
  templatesDir?: string;
  cache?: boolean;
  debug?: boolean;
}
```

#### `GeneratedCode`

コード生成の結果：

```typescript
interface GeneratedCode {
  code: string;
  imports: string[];
  exports: string[];
  performance: {
    estimatedComplexity: "low" | "medium" | "high";
    optimizationSuggestions: string[];
    generationTime: number;
    templateEngine: string;
  };
}
```

## パフォーマンス解析

ジェネレーターには包括的なパフォーマンス解析が含まれています：

```typescript
import { analyzeGrammarPerformance } from "@suzumiyaaoba/tpeg-generator";

const analysis = analyzeGrammarPerformance(grammar);
console.log(analysis.estimatedParseComplexity); // 'low' | 'medium' | 'high'
console.log(analysis.optimizationSuggestions); // 提案の配列
```

## テンプレートカスタマイズ

独自のテンプレートディレクトリを提供することでコード生成をカスタマイズできます：

```typescript
const generator = new EtaTPEGCodeGenerator({
  templatesDir: "./my-custom-templates",
  // ... その他のオプション
});
```

## テスト

パッケージにはコード生成の一貫性のためのスナップショットテストを含む包括的なテストが含まれています：

```bash
# すべてのテストを実行
bunx vp test

# スナップショットテストのみ実行
bunx vp test packages/generator/src/eta-generator.spec.ts

# コード変更後にスナップショットを更新
bunx vp test -u
```

### スナップショットテスト

スナップショットテストは、コード生成が一貫した期待される出力を生成することを保証します。以下を検証します：

- 生成されたTypeScriptコード構造
- import文
- export宣言
- パフォーマンスメタデータ

スナップショットテストの詳細については、[SNAPSHOT_TESTING.md](./SNAPSHOT_TESTING.md)を参照してください。

## 開発

```bash
# 依存関係をインストール
bun install

# パッケージをビルド
bun run build

# テストを実行
bun run test

# 型チェック
bun run typecheck
```

## ライセンス

MIT

## 多言語生成とプラグイン

`generateParser(grammar, { language })` は `typescript`・`javascript`・
`python`・`go`・`rust` に対応します。JavaScript 出力ではアクション・変換関数内の
型注釈も除去します。Python・Go・Rust の出力は各言語の標準ライブラリだけで動作します。

```typescript
import { bundleGrammarFile } from "@suzumiyaaoba/tpeg-parser";
import { generateParser } from "@suzumiyaaoba/tpeg-generator";

const grammar = bundleGrammarFile("./grammar.tpeg");
const output = await generateParser(grammar, { language: "python" });
```

ネイティブ版は PEG の各演算子、ラベル、再帰、span、cut、`@skip`/`@noskip`、
`@memoize` とキャッシュ件数制限を扱います。変換関数はメモ化した生の解析結果の外側で
実行し、キャッシュは解析呼び出しごとに分かれます。

| 言語   | 解析 API                                                                              | 値の表現                                |
| ------ | ------------------------------------------------------------------------------------- | --------------------------------------- |
| Python | `parse(text, rule=None, offset=0, *, complete=False, max_depth=256, transforms=None)` | 文字列、list、dict、`None`              |
| Go     | `Parse(input, options ...ParseOptions)`                                               | `any`、`[]any`、`map[string]any`、`nil` |
| Rust   | `parse(&str)` / `parse_with_options(&str, ParseOptions)`                              | `Value` 列挙型                          |

成功結果には `success`・`val`・`current`・`next`、失敗結果には位置と期待内容を含む
`error` が入ります。Rust の結果は `to_json()`、Go の結果は `encoding/json` で
JSON にできます。既定では前方一致し、`complete`/`Complete` を指定すると入力全体との
一致を要求します。位置は TypeScript 版と同じ UTF-16 オフセットです。
Go・Rust は Unicode スカラー値のリテラルとコードポイント境界の開始位置を要求します。
Go は不正な UTF-8 入力も拒否します。Python は単独サロゲートも扱えます。
エラーメッセージの文言は生成先によって異なる場合があります。

変換処理は `transforms Name@python`・`@go`・`@rust` に対象言語で記述します。
Python は `{"success": True, "value": ...}`、Go は `TransformResult`、Rust は
`Result<Value, String>` を返します。解析時に渡した変換コールバックは生成済みの変換を
上書きします。JavaScript/TypeScript のインラインアクションを他言語へ翻訳する機能は
なく、ネイティブ生成では明示的なエラーになります。

同期 API は `generateNativeParser(grammar, "go", { packageName: "parser" })`。
`header` で宣言・import、`namePrefix` で解析関数名の接頭辞を指定できます。
独自言語の追加には `createGeneratorRegistry().register(plugin)` を使います。
登録はレジストリごとに独立しています。詳しい変換例とプラグインの形は
[英語ガイド](./README.md#native-language-generators-and-plugins)を参照してください。

実行検証には `python3`・`go`・`rustc` を使います。パスは `TPEG_PYTHON`・
`TPEG_GO`・`TPEG_RUSTC` で指定できます。ローカルでは未導入の言語のテストを
スキップし、CI の `TPEG_NATIVE_REQUIRED=1` ではすべて必須になります。
