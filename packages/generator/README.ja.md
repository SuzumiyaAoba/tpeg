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

`includeTypes: true` の場合、アクションと変換には厳密な TypeScript コンパイルに必要な型注釈を付与します。`includeTypes: false` の場合は JavaScript を生成します。変換が失敗したときは、キャプチャ値を JSON に変換できなくても元のエラーメッセージを保持し、診断の `found` を `<unserializable value>` とします。

生成するアクションと変換は、値の取得やユーザーコードの実行前に子パーサーの一致位置を保存します。成功結果のオブジェクトを再利用するカスタムパーサーを再度呼び出しても、外側の解析が消費した位置は変わりません。変換の入力値は一度だけ取得し、拒否時の診断にも同じ値を使います。オブジェクト値は複製せず共有します。キャプチャへの参照も、単独の識別子としての `eval` への参照もないアクションは、子の値を取得しません。位置保存用の `__current` と `__next` は生成コードの予約名なので、規則名や外部パーサー名には別の名前を使うか、規則には `namePrefix` を指定してください。

アクションは、ラベルやユーザーの変数を宣言するスコープへ入る前に、生のキャプチャを取得します。`__result` をラベル名やアクション内の宣言に使っても、キャプチャを取得するための解析結果を隠すことはありません。

直接見えるラベルの名前に対応する列挙可能なフィールドが一致値自身にない場合、その裸の変数は `undefined` になります。欠ける可能性があるラベルはキャプチャ自身の列挙可能なフィールドだけから取得し、継承したプロパティや文字列・配列の `length` などの内部フィールドは含めません。`$$` は元の値を保持します。ラベルの収集では、任意の深さの括弧を透過的に扱います。すべての候補にあるラベルは従来の直接取得を維持し、参照したラベルだけのgetterを読みます。

アクションに単独の識別子としての `eval` への参照がある場合、実行時に計算した名前で値を参照できるよう、`$$` と直接見えるラベルの変数をすべて保持します。型付きの出力では無害な読み取りも生成し、`noUnusedLocals` を満たします。識別子名の Unicode エスケープも認識します。文字列・コメント・正規表現中の名前や、別のオブジェクトのプロパティ名をキャプチャへの参照として扱いません。

`JSON` などの規則名は、生成した診断が使う標準オブジェクトに影響しません。TypeScript の変換を生成する場合、宣言名が `globalThis` となる規則は、診断が使うグローバルオブジェクトと衝突するため拒否します。`namePrefix` を指定するか規則名を変更してください。parser パッケージの最適化生成器は、インラインの性能監視を有効にした場合にも同じ検証を行います。

`undefined` と `Infinity` も規則名として使用できます。生成する未定義値の判定は、parser パッケージの正規表現統合とインライン性能監視を含め、`undefined` という束縛を参照しません。APIで作成した `Quantified` ASTの `max: Infinity` は反復コンビネーターの既定の無限上限を使うため、`Infinity` という規則が範囲に影響することはありません。JSONの文字列化が値を返さない場合、変換の診断は `found` を省略します。

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

`generationTime` は、同じ生成器で並行して実行した場合も、呼び出しごとに独立して計測します。計測開始後に失敗した生成も `globalPerformanceMonitor` の回数に含め、エラーを返す前に計測を終了します。

非同期処理には `PerformanceMonitor.startTimer(operation)` を使用できます。戻り値の終了関数を `finally` で呼び出すと、その呼び出しの時間を記録します。終了関数を再度呼んでも同じ時間を返し、回数は増えません。`clear()` は未終了の計測を取り消します。同期処理の入れ子の計測には `start(operation)` / `end(operation)` を引き続き使用できます。

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
