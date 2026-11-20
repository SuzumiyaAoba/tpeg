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
bun run test
```

## 使用法

### 基本構文パーサー

`basicSyntax`、`stringLiteral`、`characterClass`、`identifier`はファクトリー関数ではなく`Parser<T>`の値そのものです。`(input, pos)`の形でそのまま呼び出してください。`pos`は`{ offset, line, column }`のようなオブジェクトではなく、0始まりのプレーンな数値オフセットです。

```typescript
import { basicSyntax } from "@suzumiyaaoba/tpeg-parser";

// 文字列リテラルをパース
const stringResult = basicSyntax('"hello world"', 0);
if (stringResult.success) {
  console.log(stringResult.val);
  // { type: 'StringLiteral', value: 'hello world', quote: '"' }
}

// 文字クラスをパース
const charClassResult = basicSyntax("[a-z]", 0);
if (charClassResult.success) {
  console.log(charClassResult.val);
  // { type: 'CharacterClass', ranges: [{ start: 'a', end: 'z' }], negated: false }
}

// 識別子をパース
const identifierResult = basicSyntax("expression", 0);
if (identifierResult.success) {
  console.log(identifierResult.val);
  // { type: 'Identifier', name: 'expression' }
}
```

### 個別パーサー

```typescript
import {
  stringLiteral,
  characterClass,
  identifier,
} from "@suzumiyaaoba/tpeg-parser";

// 文字列リテラルパーサー
const result1 = stringLiteral("'hello'", 0);

// 文字クラスパーサー
const result2 = characterClass("[^0-9]", 0);

// 識別子パーサー
const result3 = identifier("my_rule_123", 0);
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
  type: "StringLiteral";
  value: string;
  quote: '"' | "'";
}
```

#### `CharacterClass`

```typescript
interface CharacterClass {
  type: "CharacterClass";
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
  type: "Identifier";
  name: string;
}
```

#### `AnyChar`

```typescript
interface AnyChar {
  type: "AnyChar";
}
```

### パーサー

#### `basicSyntax: Parser<BasicSyntaxNode>`

すべての基本TPEG構文要素の組み合わせパーサー。

#### `stringLiteral: Parser<StringLiteral>`

以下のサポートを持つ文字列リテラルパーサー：

- 二重引用符: `"hello"`
- 単一引用符: `'world'`
- エスケープシーケンス: `\n`、`\r`、`\t`、`\\`、`\"`、`\'`

注意: テンプレートリテラル（`` `template` ``）は将来の拡張で計画されています。

#### `characterClass: Parser<CharacterClass | AnyChar>`

文字クラスと任意文字ドットのパーサー：

- 文字範囲: `[a-z]`、`[A-Z]`、`[0-9]`
- 複数範囲: `[a-zA-Z0-9_]`
- 否定クラス: `[^0-9]`
- 単一文字: `[abc]`
- 任意文字: `.`
- エスケープ文字: `[\]\\^]`

#### `identifier: Parser<Identifier>`

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
  current: number; // パース開始前のオフセット
  next: number; // パース完了後のオフセット
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
bun run test
```

差分テスト用の `compileStart`、`evaluateGeneratedModule`、ベンチマークの実行処理は、生成済み
JavaScript を、モジュール直下の `this`、`arguments`、`new.target` の振る舞いを保って
実行します。同梱の `runtime/native-evaluator.mjs` をバンドルせずに読み込むため、
パッケージをコピーするときは `dist` とともにこのファイルも保持してください。
これらの検証用ヘルパーには、ESM を同期的に `require()` できる実行環境が必要です。
Node.js 20.19 以降、22.12 以降、Bun などが該当します。Node.js の対応状況は
[モジュール読み込みの公式ドキュメント](https://nodejs.org/download/release/v20.19.0/docs/api/modules.html#loading-ecmascript-modules-using-require)
を参照してください。文法の解析やソースコードの生成では、この実行処理を読み込みません。
検証用ヘルパーは本プロジェクトの生成する JavaScript を対象とします。
`tpeg-core` と `tpeg-combinator` の別名を使わない名前付き import には、渡された補助関数の
値を使用します。import する名前は、渡されたスコープ自身のプロパティに存在する必要があります。
その他の import と `import.meta` には対応していません。TypeScript は実行前に変換してください。
渡された補助関数の値は構築時に名前ごとに取得し、定数として束縛します。
直接の `eval` を含め、補助関数の変数への再代入は例外になります。
参照先のオブジェクトのプロパティは引き続き変更できます。補助関数の getter は束縛の準備前に読み取り、
生成コードの初期化は一時的な評価データを復元してから実行します。

`evaluateGeneratedModule(code, scope)` は、モジュールの export した値を返します。
第3引数で解析規則を選択すると、各 export が関数であることを確認し、戻り値の型に規則名を保持します。

```typescript
const { start } = evaluateGeneratedModule(generated.code, helpers, ["start"]);
const result = start("input", 0);
```

## 依存関係

- `@suzumiyaaoba/tpeg-core`: コア解析機能と型
- `@suzumiyaaoba/tpeg-combinator`: パーサーコンビネーターとユーティリティ

## 貢献

このパッケージはTPEGプロジェクトの一部です。貢献ガイドラインについてはメインプロジェクトのREADMEを参照してください。

## ライセンス

MIT

## 文法モジュールの結合

`bundleGrammarFile(path)` はローカルの `.tpeg` と推移的な import を読み、生成器に
渡せる単一の `GrammarDefinition` を返します。`parseGrammarFile(path, source)` は
文字列からファイル全体を解析します。先頭の BOM、import、transforms に対応し、
エラー位置の行と列を 1 始まりで返します。ローカルファイルの場合、成功時の `result.val` を
`bundleGrammarFile` に渡すと、その解析結果を使い、依存ファイルをディスクから読みます。
依存先も解析済みの場合は `bundleGrammarModules(entry, dependencies)` を使います。export・選択 import・別名・
バージョン制約・`@requires` を検証し、ファイル読み込みでは循環 import も拒否します。
異なるディレクトリに同名ファイルがあっても別々のモジュールとして扱います。

`extends`・`includes` で継承したルールはローカル宣言で上書きできます。継承ルール内の
参照は派生側の上書きを使い、明示的な `base.rule` は元の実装を使います。mixin 間で
ルール名が衝突した場合は明示的な上書きが必要です。変換関数・ルール注釈・定義元の
空白スキップ方針を保ち、ローカルルールのない派生文法では親の明示的な `@start` を
引き継ぎます。

```typescript
import {
  bundleGrammarFile,
  generateTypeScriptParser,
} from "@suzumiyaaoba/tpeg-parser";

const grammar = bundleGrammarFile("./grammar.tpeg");
const generated = generateTypeScriptParser(grammar);
```
