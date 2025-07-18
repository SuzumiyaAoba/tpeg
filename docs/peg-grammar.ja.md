# TPEG文法定義言語仕様

TPEG（TypeScript Parsing Expression Grammar）は、単一の文法定義から**任意のプログラミング言語にパーサーコードをトランスパイル**できる拡張PEG文法定義言語です。

## 仕様範囲

この仕様は以下をカバーします：
- **PEG文法定義構文** - 言語に依存しない文法規則
- **変換定義構文** - 言語固有の意味アクション
- **型推論システム** - 変換からの自動型導出

この仕様は以下を**カバーしません**：
- ターゲット言語での生成されたパーサーコード
- ターゲット言語固有のAPI
- 生成されたパーサーの実行時動作
- 生成されたコードのパフォーマンス特性

## 設計哲学：言語に依存しない文法定義

TPEGは以下の設計原則に基づいて構築されています：

1. **言語独立性** - 文法定義はターゲット言語から独立
2. **コード生成** - 単一の文法定義から複数の言語のパーサーを生成
3. **拡張性** - 新しいターゲット言語のサポートを簡単に追加
4. **型安全性** - 生成されたコードは各言語の型システムを活用

## 型システム哲学

TPEGは言語に依存しない文法を維持しながら型安全なコード生成を可能にするため、文法定義と型情報を分離します：

1. **文法の純粋性** - 文法定義に型注釈を含まない
2. **変換ベースの型付け** - 型は変換関数でのみ指定
3. **型推論** - 自動型推論により明示的な型宣言を削減
4. **言語ネイティブ型** - 生成されたコードは各言語の自然な型システムを使用

## サポートされるターゲット言語

- TypeScript/JavaScript
- Python
- Go
- Rust
- Java
- C++
- その他（プラグイン経由で拡張可能）

## 基本構文要素

### リテラル
直接文字列マッチング

```tpeg
"hello"        // 文字列リテラル
'world'        // 単一引用符も許可
`template`     // テンプレートリテラル（将来の拡張用）
```

### 文字クラス
文字セットマッチング

```tpeg
[a-z]          // 小文字
[A-Z]          // 大文字  
[0-9]          // 数字
[a-zA-Z0-9_]   // 識別子文字
[^0-9]         // 非数字
.              // 任意の文字
```

### 識別子
定義された規則への参照

```tpeg
number         // 規則参照
identifier     // 規則参照
expression     // 規則参照
```

## 構成演算子

### 連接
順次マッチング

```tpeg
"hello" " " "world"
number "+" number
identifier "(" arguments ")"
```

### 選択
代替マッチング

```tpeg
"true" / "false"
number / string / identifier
```

### グループ
優先度制御とグループ化

```tpeg
("+" / "-") number          // グループ化されていない
sign:("+" / "-") number     // ラベル付きグループ
chars:(letter / digit)*     // 繰り返し付きラベル付きグループ
```

## 繰り返し演算子

```tpeg
expr*          // 0回以上
expr+          // 1回以上
expr?          // 0回または1回
expr{3}        // 正確に3回
expr{2,5}      // 2回から5回
expr{3,}       // 3回以上
```

## 先読み演算子

```tpeg
&expr          // 肯定先読み（非消費）
!expr          // 否定先読み（非消費）
```

## ラベルとキャプチャ

### 基本ラベル
```tpeg
name:identifier          // 単一キャプチャ
left:expr op:"+" right:expr  // 複数キャプチャ
```

### グループラベル
```tpeg
sign:("+" / "-")         // ラベル付き選択グループ
chars:(letter / digit)*  // ラベル付き繰り返しグループ
value:("0x" [0-9a-fA-F]+) // ラベル付き連接グループ
```

### キャプチャ推論
型は文法パターンから自動的に推論されます：

```tpeg
// 型推論の例：
number = digits:[0-9]+              // → キャプチャ: { digits: string }
expression = left:term right:term   // → キャプチャ: { left: T, right: T }
optional = value?                   // → キャプチャ: { value?: T }
repeated = item*                    // → キャプチャ: { item: T[] }
choice = a:first / b:second         // → キャプチャ: { a?: T1, b?: T2 }
group = sign:("+" / "-")           // → キャプチャ: { sign: string }
```

### キャプチャ機能の実装

TPEGパーサーは、ラベル付き式を使用してパースされたデータを構造化された形式でキャプチャできます：

```typescript
// 基本的なキャプチャ使用例
import { capture, captureSequence } from "tpeg-core";

// 単一値のキャプチャ
const nameParser = capture("name", literal("hello"));
const result = nameParser("hello", pos);
// result.val = { name: "hello" }

// 複数値のキャプチャ
const userParser = captureSequence(
  capture("firstName", literal("John")),
  literal(" "),
  capture("lastName", literal("Doe"))
);
const result = userParser("John Doe", pos);
// result.val = { firstName: "John", lastName: "Doe" }
```

### コード生成でのキャプチャ

ラベル付き式は生成されるコードで自動的にキャプチャ関数に変換されます：

```tpeg
// 文法定義
greeting = name:"hello" " " target:"world"

// 生成されるコード
export const greeting = sequence(
  capture("name", literal("hello")),
  literal(" "),
  capture("target", literal("world"))
);
```

### キャプチャ構造参照表

| 文法パターン | キャプチャ構造 | 説明 |
|-------------|---------------|------|
| `"literal"` | `"literal"` | 文字列リテラルはリテラル型をキャプチャ |
| `[a-z]` | `string` | 文字クラスは単一文字をキャプチャ |
| `[a-z]+` | `string` | 繰り返し付き文字クラスは連結された文字列をキャプチャ |
| `rule_name` | `T` | 規則参照は規則が返すものをキャプチャ |
| `label:pattern` | `{ label: T }` | ラベル付きパターンは名前付きキャプチャを作成 |
| `pattern1 pattern2` | `[T1, T2]` | ラベルなし連接は要素の配列をキャプチャ |
| `left:pattern1 right:pattern2` | `{ left: T1, right: T2 }` | ラベル付き連接は名前付きフィールドを持つオブジェクトを作成 |
| `pattern1 / pattern2` | `T1 \| T2` | ラベルなし選択は共用体型をキャプチャ |
| `a:pattern1 / b:pattern2` | `{ a?: T1, b?: T2 }` | ラベル付き選択はオプショナルフィールドを作成 |
| `pattern*` | `T[]` | ラベルなし繰り返しはマッチの配列をキャプチャ |
| `items:pattern*` | `{ items: T[] }` | ラベル付き繰り返しは名前付き配列をキャプチャ |
| `pattern+` | `T[]` | 1回以上は非空配列をキャプチャ |
| `pattern?` | `T?` | ラベルなしオプショナルはオプショナル型をキャプチャ |
| `value:pattern?` | `{ value?: T }` | ラベル付きオプショナルはオプショナルフィールドを作成 |
| `(pattern1 / pattern2)` | `T1 \| T2` | ラベルなしグループは内容と同じ型をキャプチャ |
| `group:(pattern1 / pattern2)` | `{ group: T1 \| T2 }` | ラベル付きグループは名前付きキャプチャを作成 |
| `&pattern` | `null` | 肯定先読みはキャプチャしない |
| `!pattern` | `null` | 否定先読みはキャプチャしない |

## 文法定義

### 規則定義
```tpeg
// 基本規則
rule_name = pattern

// ドキュメント付き規則
/// 四つの基本算術演算
/// @param left 左オペランド
/// @param right 右オペランド
/// @returns 計算結果（変換から型推論）
expression = left:term op:("+" / "-") right:term
```

### 文法ブロック
```tpeg
grammar ArithmeticCalculator {
  // メタデータ
  @language_version: "1.0"
  @description: "簡単な算術計算機"
  @author: "TPEG Team"
  
  // エントリーポイント
  @start: expression
``` 