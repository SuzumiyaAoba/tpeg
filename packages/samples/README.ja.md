# TPEGサンプル

このパッケージには、TPEG（TypeScript Parsing Expression Grammar）ライブラリの実用的な例が含まれています。各サンプルは異なる解析機能とユースケースを実証します。

## 📋 利用可能なサンプル

### 🧮 算術計算機

- **場所**: `src/arith/`
- **機能**: 算術式の解析と評価
- **特徴**:
  - 直接計算とAST構築の両方のアプローチ
  - 演算子優先度の処理
  - 括弧によるグループ化
  - 浮動小数点数のサポート
  - インタラクティブREPL

### 📊 CSVパーサー

- **場所**: `src/csv/`
- **機能**: CSV形式データの解析
- **特徴**:
  - 引用符付きフィールドのサポート
  - エスケープ引用符の処理
  - ヘッダーベースのオブジェクト変換
  - CSV生成機能
  - 空フィールドの適切な処理

### 📋 JSONパーサー

- **場所**: `src/json/`
- **機能**: JSON形式データの解析
- **特徴**:
  - 完全なJSON仕様サポート
  - ネストした構造の処理
  - すべてのデータ型のサポート（文字列、数値、ブール値、null、オブジェクト、配列）
  - 適切な空白処理

### 📝 PEGメタ文法

- **場所**: `src/peg/`
- **機能**: PEG文法自体の解析
- **特徴**:
  - PEG文法構造の実証
  - メタ文法概念の説明
  - 複雑な解析表現の例

### ⚙️ INI設定ファイルパーサー

- **場所**: `src/ini/`
- **機能**: INI形式の設定ファイルの解析
- **特徴**:
  - `[section]`ヘッダーとグローバルキー
  - `;`/`#`による行コメントと行内コメント
  - CRLF/LF/CRの改行コード対応
  - `formatINI`によるラウンドトリップシリアライズ

### 🧬 S式パーサー

- **場所**: `src/sexpr/`
- **機能**: Lisp形式のS式の解析
- **特徴**:
  - `recursive()`によるネストしたリストの再帰処理
  - シンボル・数値・引用符付き文字列を区別するアトム
  - `'x`クォート糖衣を`(quote x)`へ変換
  - `;`行コメント
  - `printSExp`による表示・ラウンドトリップ

### 🔗 URLパーサー

- **場所**: `src/url/`
- **機能**: 絶対URLの構成要素への分解
- **特徴**:
  - `scheme://userinfo@host:port/path?query#fragment`
  - オーソリティ省略により`mailto:`形式のURLにも対応
  - `commit`による不正なオーソリティの厳密なエラー化
  - `parseQueryParams`によるクエリ文字列デコード

### 🏗️ コード生成（`.tpeg` → TypeScript）

- **場所**: `src/codegen/`（同ディレクトリの`README.md`も参照）
- **機能**: `.tpeg`文法ファイルからスタンドアロンのTypeScriptパーサーを生成
- **特徴**:
  - 完全なパイプライン: 文法ファイルの読み込み → 解析 → 生成 → インポート → 実行
  - `generateTypeScriptParser`と`generateOptimizedTypeScriptParser`の両方
  - `@start`/`@skip`/`@noskip`アノテーションと`{ ... }`セマンティックアクション
  - 同等のCLI使用方法も併記

## 🚀 使用法

### すべてのサンプルを実行

```bash
# メインサンプルランナーを使用
bun run samples

# 特定のサンプルを実行
bun run samples arith
bun run samples csv
bun run samples json
bun run samples peg
bun run samples ini
bun run samples sexpr
bun run samples url
bun run samples codegen

# すべてのサンプルを順次実行
bun run samples --all
```

### 個別サンプルを実行

```bash
# 算術計算機
bun run arith              # 基本デモ
bun run arith:examples     # 包括的な例
bun run arith:repl         # インタラクティブREPL

# CSVパーサー
bun run csv                # CSV解析デモ

# JSONパーサー
bun run json               # JSON解析デモ

# PEG文法
bun run peg                # PEG文法デモ

# INI設定ファイルパーサー
bun run ini                # INI解析デモ

# S式パーサー
bun run sexpr              # S式解析デモ

# URLパーサー
bun run url                # URL解析デモ

# コード生成
bun run codegen            # .tpeg -> TypeScriptパーサー生成デモ
bun run codegen:regen      # src/codegen/generated/ のみ再生成
```

### テストを実行

```bash
# すべてのテストを実行
bun run test

# ウォッチモードでテストを実行
bun run test:watch

# 特定のテストファイルを実行
bunx vp test packages/samples/src/csv/csv.spec.ts
```

## 📚 学習ポイント

### 1. パーサーコンビネーター

各サンプルはTPEGの基本パーサーコンビネーターの使用方法を実証します：

- `literal()` - リテラル文字列マッチング
- `choice()` - 代替処理
- `seq()` - シーケンス処理
- `map()` - パース結果変換
- `zeroOrMore()`、`oneOrMore()` - 繰り返しパターン

### 2. エラーハンドリング

- 意味のあるエラーメッセージの提供
- パース失敗の適切な処理
- 位置情報を含むエラー報告

### 3. パフォーマンス考慮事項

- メモ化の使用
- 効率的なパーサー構造
- 大規模データセットの処理

### 4. 実用的なパターン

- 再帰文法の処理
- 適切な空白処理
- データ変換とAST構築

## 🔧 開発

### プロジェクト構造

```
src/
├── arith/          # 算術計算機サンプル
│   ├── calculator.ts
│   ├── demo.ts
│   ├── repl.ts
│   └── *.spec.ts
├── csv/            # CSVパーサーサンプル
│   ├── csv.ts
│   ├── demo.ts
│   └── *.spec.ts
├── json/           # JSONパーサーサンプル
│   ├── json.ts
│   ├── demo.ts
│   └── *.spec.ts
├── peg/            # PEG文法サンプル
│   ├── index.ts
│   ├── demo.ts
│   └── *.spec.ts
├── ini/            # INI設定ファイルパーサーサンプル
│   ├── ini.ts
│   ├── demo.ts
│   └── *.spec.ts
├── sexpr/          # S式パーサーサンプル
│   ├── sexpr.ts
│   ├── demo.ts
│   └── *.spec.ts
├── url/            # URLパーサーサンプル
│   ├── url.ts
│   ├── demo.ts
│   └── *.spec.ts
├── codegen/        # .tpeg -> TypeScript生成サンプル
│   ├── calc.tpeg
│   ├── demo.ts
│   ├── generated/
│   ├── README.md
│   └── *.spec.ts
├── index.ts        # メインエントリーポイント
└── combinator.spec.ts  # 統合テスト
```

### 新しいサンプルの追加

1. `src/`の下に新しいディレクトリを作成
2. パーサー実装ファイルを作成
3. デモファイル（`demo.ts`）を作成
4. テストファイル（`*.spec.ts`）を作成
5. `package.json`にスクリプトを追加
6. `src/index.ts`でサンプルを登録

### コーディング標準

- TypeScript strictモードを使用
- 適切な型注釈を提供
- 包括的なテストカバレッジを維持
- 意味のあるエラーメッセージを実装

## 📖 参考文献

- [TPEGコアドキュメント](../core/README.md)
- [TPEGコンビネータードキュメント](../combinator/README.md)
- [PEG（構文解析表現文法）について](https://en.wikipedia.org/wiki/Parsing_expression_grammar)

## 🤝 貢献

新しいサンプルとサンプルの改善を歓迎します！以下のガイドラインに従ってください：

1. 実用的で教育的価値のあるサンプルを作成
2. 包括的なテストを含める
3. 明確なドキュメントを提供
4. 既存のコーディング標準に従う

## 📄 ライセンス

MITライセンス - 詳細は[LICENSE](../../LICENSE)ファイルを参照してください。
