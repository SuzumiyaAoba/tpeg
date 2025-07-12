# 算術計算機サンプル

TPEG（TypeScript Parsing Expression Grammar）を使用した算術式の解析と評価の実用的な例。

## 🎯 機能

### サポートされる演算
- **基本演算**: 加算（`+`）、減算（`-`）、乗算（`*`）、除算（`/`）
- **優先度**: 乗算・除算が加算・減算より優先
- **括弧**: 任意の深さの括弧によるグループ化
- **数値**: 整数と浮動小数点数
- **空白**: 任意の空白文字の無視

### 評価モード
- **直接計算**: パースしながら即座に計算
- **AST構築**: 抽象構文木を構築して後で評価
- **インタラクティブREPL**: 対話的な式入力と評価

## 🚀 使用法

### 基本的な使用

```typescript
import { parseArithmetic } from './calculator';

// 直接計算
const result1 = parseArithmetic('2 + 3 * 4');
console.log(result1); // 14

// AST構築
const ast = parseArithmetic('(1 + 2) * 3', { buildAST: true });
console.log(ast); // { type: 'BinaryExpression', operator: '*', ... }
```

### コマンドライン使用

```bash
# 基本デモ
bun run arith

# 特定の式を計算
bun run arith "1 + 2 * 3"

# AST構造を表示
bun run arith --ast "(1 + 2) * 3"

# すべての例を実行
bun run arith:examples

# インタラクティブREPL
bun run arith:repl
```

## 📚 例

### 基本演算
```bash
$ bun run arith "1 + 2"
3

$ bun run arith "10 - 3"
7

$ bun run arith "4 * 5"
20

$ bun run arith "15 / 3"
5
```

### 演算子優先度
```bash
$ bun run arith "2 + 3 * 4"
14  # 3 * 4 = 12, 2 + 12 = 14

$ bun run arith "10 - 2 * 3"
4   # 2 * 3 = 6, 10 - 6 = 4
```

### 括弧によるグループ化
```bash
$ bun run arith "(2 + 3) * 4"
20  # (2 + 3) = 5, 5 * 4 = 20

$ bun run arith "((1 + 2) * 3) + 4"
13  # 複雑なネストした括弧
```

### 浮動小数点数
```bash
$ bun run arith "3.14 * 2"
6.28

$ bun run arith "10 / 3"
3.3333333333333335
```

### 空白の無視
```bash
$ bun run arith "1 + 2"
3

$ bun run arith "1   +   2"
3

$ bun run arith "1 + 2 * 3"
7
```

## 🔧 実装詳細

### 文法定義

```typescript
// 式: 項 + 項 - 項
expression = term (("+" / "-") term)*

// 項: 因子 * 因子 / 因子
term = factor (("*" / "/") factor)*

// 因子: 数値 / (式)
factor = number / "(" expression ")"

// 数値: 整数部分 . 小数部分?
number = [0-9]+ ("." [0-9]+)?
```

### パーサーコンビネーター

```typescript
import { 
  literal, 
  choice, 
  seq, 
  zeroOrMore, 
  map,
  number,
  token 
} from 'tpeg-combinator';

// 数値パーサー
const numberParser = map(number, (val) => parseFloat(val));

// 演算子パーサー
const operator = choice(
  literal('+'),
  literal('-'),
  literal('*'),
  literal('/')
);

// 式パーサー
const expression = seq(
  term,
  zeroOrMore(seq(operator, term))
);
```

### AST構造

```typescript
interface BinaryExpression {
  type: 'BinaryExpression';
  operator: '+' | '-' | '*' | '/';
  left: Expression;
  right: Expression;
}

interface NumberLiteral {
  type: 'NumberLiteral';
  value: number;
}

type Expression = BinaryExpression | NumberLiteral;
```

## 🎮 インタラクティブREPL

REPLモードでは対話的に式を入力できます：

```bash
$ bun run arith:repl

> 2 + 3
5

> 10 * (2 + 3)
50

> 3.14 * 2
6.28

> exit
```

### REPLコマンド

- `exit` または `quit`: REPLを終了
- `help`: 利用可能なコマンドを表示
- `clear`: 画面をクリア
- `ast <expression>`: 式のAST構造を表示

## 🧪 テスト

```bash
# すべてのテストを実行
bun test

# 特定のテストファイルを実行
bun test calculator.spec.ts

# カバレッジ付きでテストを実行
bun test --coverage
```

### テストケース

- 基本演算の正確性
- 演算子優先度の確認
- 括弧の正しい処理
- エラーケースの処理
- 浮動小数点数の精度
- 空白文字の無視

## 🔍 デバッグ

### 詳細なパース情報

```typescript
import { parseArithmetic } from './calculator';

const result = parseArithmetic('1 + 2 * 3', { 
  debug: true,
  buildAST: true 
});

console.log(result);
// {
//   value: 7,
//   ast: { type: 'BinaryExpression', ... },
//   parseSteps: [...],
//   performance: { parseTime: 1.23, memoryUsage: 1024 }
// }
```

### パースステップの可視化

```bash
$ bun run arith --debug "1 + 2 * 3"
Parsing: 1 + 2 * 3
Step 1: Parse number '1'
Step 2: Parse operator '+'
Step 3: Parse number '2'
Step 4: Parse operator '*'
Step 5: Parse number '3'
Result: 7
```

## 🚀 パフォーマンス

### 最適化機能

- **メモ化**: 再帰パーサーのメモ化
- **早期終了**: 無効な式の早期検出
- **効率的なAST**: 最小限のメモリ使用量
- **遅延評価**: 必要時のみASTを構築

### ベンチマーク

```bash
$ bun run arith:benchmark

Simple expressions: 10,000 ops/sec
Complex expressions: 5,000 ops/sec
Large expressions: 1,000 ops/sec
```

## 🔗 関連ファイル

- `calculator.ts`: メインの計算機実装
- `demo.ts`: デモスクリプト
- `repl.ts`: インタラクティブREPL
- `*.spec.ts`: テストファイル

## 📖 学習ポイント

1. **演算子優先度**: パーサーコンビネーターでの優先度の実装
2. **再帰文法**: 左再帰の回避と適切な文法設計
3. **AST構築**: 抽象構文木の構築と評価
4. **エラーハンドリング**: 意味のあるエラーメッセージの提供
5. **パフォーマンス**: 効率的なパーサーの設計

## 🎉 次のステップ

このサンプルを基に、以下を試してみてください：

1. **新しい演算子の追加**: べき乗（`^`）、剰余（`%`）
2. **関数のサポート**: `sin(x)`、`cos(x)`、`sqrt(x)`
3. **変数のサポート**: `x = 5`、`x + 3`
4. **比較演算子**: `x > 5`、`y <= 10`
5. **論理演算子**: `and`、`or`、`not`

TPEGで楽しい計算を！🚀 