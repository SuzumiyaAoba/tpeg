# TPEG 算術計算機の例

TPEGの`map`関数を使って算術計算機を構築する方法を示す例です。

## 概要

`map`関数を活用した2種類の異なるパース手法を実装しています。

1. **直接計算**: `map`関数を使ってパースと同時に結果を計算
2. **AST構築**: `map`関数で抽象構文木（AST）を構築し、後で評価

## サポートする機能

- **基本演算**: `+`、`-`、`*`、`/`、`%`
- **浮動小数点数**: `3.14`、`2.5`
- **演算子優先度**: 乗算・除算は加算・減算より優先
- **括弧によるグループ化**: `(1 + 2) * 3`
- **符号付き数値**: `+5`、`-3`
- **空白の扱い**: 空白はどこにあっても許可される

## サンプルの実行

### 1. 基本デモ

```bash
bun run arith
```

両方の手法による基本的な計算例を表示します。

### 2. 特定の式を計算

```bash
bun demo.ts "1 + 2 * 3"
# Expression: 1 + 2 * 3
# Direct calc: 7
# AST calc:    7
# ✓ Both calculation methods produced the same result
```

### 3. AST構造を表示

```bash
bun demo.ts --ast "(1 + 2) * 3"
# Expression: (1 + 2) * 3
# AST Structure:
# BinaryOp(*)
#   left:
#     Group
#       expression:
#         BinaryOp(+)
#           left:
#             Number(1)
#           right:
#             Number(2)
#   right:
#     Number(3)
#
# Result: 9
```

### 4. インタラクティブREPL

```bash
bun run arith:repl
```

式を入力すると結果が表示される対話型の計算機が起動します。

### 5. すべての例を実行

```bash
bun run arith:examples
```

各カテゴリの包括的な例を実行します。

## `map`関数の使用例

### `map`による直接計算

```typescript
// mapを使った数値パース
export const Integer = map(oneOrMore(Digit), (digits: string[]) =>
  Number.parseInt(digits.join(""), 10)
);

// Termパーサーでの直接計算
export function DirectTerm(input: string, pos: number): ParseResult<number> {
  return map(
    seq(DirectFactor, star(/* 乗算・除算・剰余 */)),
    ([first, rest]) => {
      // mapを使った直接計算
      return rest.reduce((left, [, operator, , right]) => {
        switch (operator) {
          case "*": return left * right;
          case "/": return left / right;
          case "%": return left % right;
        }
      }, first);
    }
  )(input, pos);
}
```

### `map`によるAST構築

```typescript
// TermパーサーでのAST構築
export function Term(input: string, pos: number): ParseResult<ExpressionNode> {
  return map(
    seq(Factor, star(/* 乗算・除算・剰余 */)),
    ([first, rest]) => {
      // mapを使ってASTを構築
      return rest.reduce((left, [, operator, , right]) =>
        createBinaryOp(operator, left, right),
        first
      );
    }
  )(input, pos);
}
```

## 式の例

### 基本演算
- `1 + 2` → 3
- `3 - 1` → 2
- `2 * 3` → 6
- `6 / 2` → 3
- `7 % 3` → 1

### 浮動小数点数
- `1.5 + 2.5` → 4
- `3.14 * 2` → 6.28
- `10.0 / 3.0` → 3.3333333333333335

### 演算子優先度
- `1 + 2 * 3` → 7
- `2 * 3 + 1` → 7
- `(1 + 2) * 3` → 9
- `2 * (3 + 1)` → 8

### 複雑な式
- `((1 + 2) * 3 - 4) / 2` → 2.5
- `2 * 3 + 4 * 5 - 6 / 2` → 23
- `1 + 2 * 3 + 4 * 5 + 6` → 33

### 符号付き数値
- `-5 + 3` → -2
- `+5 - 3` → 2

## エラーハンドリング

このパーサーは以下のようなエラー条件を処理します。

- **ゼロ除算**: `1 / 0`
- **ゼロ剰余**: `1 % 0`
- **不正な構文**: `1 +`（不完全な式）
- **サポートされない文字**: `1 & 2`

## 学習ポイント

1. **map関数の汎用性**: 直接計算とAST構築の両方に使える
2. **左結合**: `map`関数内の`reduce`で実装
3. **演算子優先度**: パーサー構造（TermとExpressionの分離）で処理
4. **エラーの伝播**: `map`関数内のエラーはパース処理チェーンを通じて伝播する
5. **型安全性**: TypeScriptによりパース処理全体で型の正しさが保証される
