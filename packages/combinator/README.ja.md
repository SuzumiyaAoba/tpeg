# tpeg-combinator

tpeg-coreの上に構築されたパーサーコンビネーター。このパッケージは、複雑なパーサーを簡単に構築するための高レベルパーサーコンビネーターを提供します。

## 機能

- **豊富なコンビネーターライブラリ**: 包括的なパーサーコンビネーターセット
- **型安全**: 厳密な型チェックを備えた完全なTypeScriptサポート
- **パフォーマンス最適化**: 組み込みメモ化と最適化
- **エラーハンドリング**: 高度なエラー報告とデバッグ
- **空白処理**: 組み込みの空白とトークン管理
- **リストパース**: リストとシーケンスのパース用の専用コンビネーター

## インストール

```bash
npm install @suzumiyaaoba/tpeg-combinator
# または
bun add @suzumiyaaoba/tpeg-combinator
```

`tpeg-combinator`は`tpeg-core`を何も再エクスポートしません。`literal`、`choice`、`seq`、`zeroOrMore`、`parse`などのプリミティブは`@suzumiyaaoba/tpeg-core`から直接importする必要があり、以下で説明する高レベルコンビネーターだけが`@suzumiyaaoba/tpeg-combinator`にあります。

## クイックスタート

```typescript
import { literal, choice, seq, zeroOrMore, parse } from "@suzumiyaaoba/tpeg-core";
import { quotedString, number, sepBy, memoize } from "@suzumiyaaoba/tpeg-combinator";

// "hello"または"world"の簡単なパーサー
const helloOrWorld = choice(literal("hello"), literal("world"));

// 繰り返し付きシーケンスをパース
const parser = seq(helloOrWorld, zeroOrMore(seq(literal(" "), helloOrWorld)));

const result = parse(parser)("hello world hello");
console.log(result);
```

## パーサーコンビネーター

### 文字列パース

#### `quotedString`
エスケープシーケンス付きのJavaScript/JSONスタイルの二重引用符付き文字列をパースします。

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { quotedString } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(quotedString)('"Hello, \\"world\\"!"');
// 結果: { success: true, val: 'Hello, "world"!' }
```

#### `singleQuotedString`
単一引用符付き文字列をパースします。

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { singleQuotedString } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(singleQuotedString)("'Hello, world!'");
// 結果: { success: true, val: 'Hello, world!' }
```

#### `anyQuotedString`
単一または二重引用符の文字列をパースします。

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { anyQuotedString } from "@suzumiyaaoba/tpeg-combinator";

const result1 = parse(anyQuotedString)('"double quoted"');
const result2 = parse(anyQuotedString)("'single quoted'");
```

#### `takeUntil(condition)`
条件が満たされるまで文字を消費します。

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { takeUntil } from "@suzumiyaaoba/tpeg-combinator";

const parser = takeUntil(literal(","));
const result = parse(parser)("hello,world");
// 結果: { success: true, val: "hello" }
```

#### `between(open, close)`
2つのパーサー間のコンテンツにマッチします。

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { between } from "@suzumiyaaoba/tpeg-combinator";

const parser = between(literal("("), literal(")"));
const result = parse(parser)("(content)");
// 結果: { success: true, val: "content" }
```

### 数値パース

#### `number`
分数と指数を含むJavaScript/JSONスタイルの数値をパースします。

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { number } from "@suzumiyaaoba/tpeg-combinator";

const result1 = parse(number)("123");
const result2 = parse(number)("3.14");
const result3 = parse(number)("1.23e-4");
```

#### `int`
整数をパースします。

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { int } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(int)("42");
// 結果: { success: true, val: 42 }
```

### リストパース

#### `sepBy(value, separator)`
区切り文字で区切られた値をパースします（0回以上）。

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { sepBy, number } from "@suzumiyaaoba/tpeg-combinator";

const parser = sepBy(number, literal(","));
const result = parse(parser)("1,2,3,4");
// 結果: { success: true, val: [1, 2, 3, 4] }
```

#### `sepBy1(value, separator)`
区切り文字で区切られた値をパースします（1回以上）。

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { sepBy1, number } from "@suzumiyaaoba/tpeg-combinator";

const parser = sepBy1(number, literal(","));
const result = parse(parser)("1,2,3");
// 結果: { success: true, val: [1, 2, 3] }
```

#### `commaSeparated(value)`
オプションの末尾カンマを持つカンマ区切り値をパースします。

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { commaSeparated, number } from "@suzumiyaaoba/tpeg-combinator";

const parser = commaSeparated(number);
const result = parse(parser)("1, 2, 3,");
// 結果: { success: true, val: [1, 2, 3] }
```

### エラーハンドリング

#### `labeled(parser, message)`
カスタムエラーメッセージを提供します。

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { labeled } from "@suzumiyaaoba/tpeg-combinator";

const parser = labeled(literal("hello"), "Expected 'hello'");
const result = parse(parser)("world");
// 結果: { success: false, error: { message: "Expected 'hello'" } }
```

#### `withDetailedError(parser, name)`
入力抜粋を含む詳細なエラーレポートを作成します。

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { withDetailedError } from "@suzumiyaaoba/tpeg-combinator";

const parser = withDetailedError(literal("hello"), "hello_parser");
const result = parse(parser)("world");
// コンテキスト付きの詳細なエラーを提供
```

#### `withPosition(parser)`
より良いエラー報告のために行と列を追跡します。

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { withPosition } from "@suzumiyaaoba/tpeg-combinator";

const parser = withPosition(literal("hello"));
const result = parse(parser)("world");
// エラーに行と列の情報を含む
```

### パフォーマンスとデバッグ

#### `memoize(parser, options)`
キャッシュサイズ制御を持つパーサーのメモ化版を作成します。

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { memoize } from "@suzumiyaaoba/tpeg-combinator";

const parser = memoize(literal("hello"), { cacheSize: 100 });
const result = parse(parser)("hello");
```

#### `recursive()`
再帰パーサーを作成します。`[パーサー, セッター]`のペアを返すので、他のコンビネーターで本体を組み立ててから`setter`を呼んで再帰の結び目を閉じます。

```typescript
import { literal, choice, seq, parse } from "@suzumiyaaoba/tpeg-core";
import { recursive } from "@suzumiyaaoba/tpeg-combinator";

const [expression, setExpression] = recursive<string>();
setExpression(
  choice(
    literal("x"),
    seq(literal("("), expression, literal(")")),
  ),
);

const result = parse(expression)("((x))");
```

#### `debug(parser, name, options)`
デバッグのためにパースプロセスをログ出力します。

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { debug } from "@suzumiyaaoba/tpeg-combinator";

const parser = debug(literal("hello"), "hello_debug");
const result = parse(parser)("hello");
// パースステップをコンソールにログ出力
```

### 空白とトークン

#### `token(parser)`
前後の空白を消費するパーサーをラップします。

```typescript
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { token } from "@suzumiyaaoba/tpeg-combinator";

const parser = token(literal("hello"));
const result = parse(parser)("  hello  ");
// 空白を自動的に消費
```

#### `whitespace`
空白文字を消費します。

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { whitespace } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(whitespace)("   \t\n");
// すべての空白文字を消費
```

#### `spaces`
0回以上の空白文字を消費します。

```typescript
import { parse } from "@suzumiyaaoba/tpeg-core";
import { spaces } from "@suzumiyaaoba/tpeg-combinator";

const result = parse(spaces)("   \t\n");
// オプショナルな空白を消費
```

## 高度な例

### JSON値パーサー

```typescript
import { choice, seq, zeroOrMore, literal, parse } from "@suzumiyaaoba/tpeg-core";
import { quotedString, number } from "@suzumiyaaoba/tpeg-combinator";

const jsonValue = choice(
  quotedString,
  number,
  literal("true"),
  literal("false"),
  literal("null"),
);

const jsonArray = seq(
  literal("["),
  zeroOrMore(seq(jsonValue, literal(","))),
  jsonValue,
  literal("]"),
);

const result = parse(jsonArray)('[1,2,3]');
```

この最小文法は要素間の空白を読み飛ばしません。入力に空白が含まれる場合は、`jsonValue`やリテラルを下記の`token()`でラップしてください。

### CSVパーサー

```typescript
import { choice, literal, parse } from "@suzumiyaaoba/tpeg-core";
import { sepBy1, quotedString, takeUntil } from "@suzumiyaaoba/tpeg-combinator";

const csvField = choice(
  quotedString,
  // 次のフィールド/行区切りまでの任意の文字列
  takeUntil(choice(literal(","), literal("\n"))),
);

const csvRow = sepBy1(csvField, literal(","));
const csvParser = sepBy1(csvRow, literal("\n"));

const result = parse(csvParser)('name,age\n"John",30\n"Jane",25');
```

## テスト

パッケージには、モジュール（`primitive`、`string`、`list`、`logic`、`error`、`debug`）ごとに1つずつ、包括的なテストが含まれています。

```bash
# すべてのテストを実行
bun test

# 特定モジュールのテストを実行
bun test src/primitive.spec.ts

# モジュール横断の統合テストを実行
bun test src/integration.spec.ts
```

## APIリファレンス

完全なAPIドキュメントについては、ソースコードのTypeScript定義を参照してください。

## ライセンス

MIT
