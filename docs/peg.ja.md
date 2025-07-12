# 構文解析表現文法（PEG）：定義と基礎

## 概要

構文解析表現文法（PEG）は、2004年にBryan Fordによって提案された形式文法の一種です。構文解析のための従来の文脈自由文法（CFG）のより決定論的で実装に適した代替案として開発されました。

## 歴史と背景

### 開発動機

1. **曖昧性の問題**: CFGは同じ文字列に対して複数の解析木を持つことができ、実装の複雑さを生み出します
2. **バックトラッキングの必要性**: 多くの実用的なパーサーはバックトラッキングを必要としますが、CFG理論はこれを適切に扱いません
3. **実装の複雑さ**: LRやLALRなどの解析技術は理論的には優れていますが、実装が複雑です

### 提案者とタイムライン

- **提案者**: Bryan Ford（MIT）
- **初期発表**: 2004年POPL（プログラミング言語の原理）
- **論文**: "Parsing Expression Grammars: A Recognition-Based Syntactic Foundation"

## 形式的定義

### 基本構成要素

PEGは以下の要素で構成されます：

1. **終端記号の集合** T
2. **非終端記号の集合** N  
3. **解析表現の集合** P
4. **開始記号** S ∈ N

### 解析表現

解析表現eは以下のいずれかの形式を取ります：

#### 原始表現

1. **空文字列**: ε
2. **終端記号**: a ∈ T
3. **非終端記号**: A ∈ N

#### 複合表現

1. **連接**: e₁ e₂ （e₁の後にe₂）
2. **順序付き選択**: e₁ / e₂ （e₁を試し、失敗したらe₂を試す）
3. **0回以上**: e*
4. **肯定先読み**: &e （eにマッチするが入力を消費しない）
5. **否定先読み**: !e （eがマッチしないことを確認）

### 認識関数の定義

入力文字列xと位置iに対する認識関数R(e, x, i)は以下のように定義されます：

```
R(ε, x, i) = i
R(a, x, i) = i+1 if x[i] = a, fail otherwise
R(A, x, i) = R(P[A], x, i)
R(e₁ e₂, x, i) = let j = R(e₁, x, i) in 
                  if j ≠ fail then R(e₂, x, j) else fail
R(e₁ / e₂, x, i) = let j = R(e₁, x, i) in 
                    if j ≠ fail then j else R(e₂, x, i)
R(e*, x, i) = let j = R(e, x, i) in 
              if j ≠ fail then R(e*, x, j) else i
R(&e, x, i) = if R(e, x, i) ≠ fail then i else fail
R(!e, x, i) = if R(e, x, i) = fail then i else fail
```

## CFGとの比較

### 主な違い

| 側面 | CFG | PEG |
|------|-----|-----|
| 選択 | 非決定論的 | 決定論的（順序付き選択） |
| 曖昧性 | 存在する可能性 | 存在しない |
| バックトラッキング | 理論的には不要 | 明示的にサポート |
| 実装 | 複雑（LR、LALRなど） | 直接的 |

### 順序付き選択の重要性

CFGの選択`A → α | β`は非決定論的ですが、PEGの順序付き選択`A ← α / β`は：

1. 最初にαを試す
2. αが失敗した場合のみβを試す
3. この順序付けにより曖昧性が排除される

## 左再帰の問題

### 問題の性質

左再帰はPEGで無限ループを引き起こします：

```
A ← A α / β
```

この場合、Aの認識は同じ位置でAを再び呼び出し、無限再帰を引き起こします。

### 解決アプローチ

**文法変換**: 左再帰を右再帰に変換

```
// 左再帰文法
Exp ← Exp "+" Term / Term

// 変換後
Exp ← Term ("+" Term)*
```

## 高度な機能

### 意味アクション

解析中に意味解析を実行するための機能：

```
Number ← [0-9]+ { parseInt($1) }
```

## 実装技術

### 再帰下降パーサー

最も直接的な実装方法：

```typescript
function parseA(input: string, pos: number): ParseResult {
  // A ← α / βの実装
  let result = parseAlpha(input, pos);
  if (result.success) return result;
  return parseBeta(input, pos);
}
```

## 応用分野

### プログラミング言語処理

1. **パーサージェネレーター**: ANTLR、PEG.jsなど
2. **DSL実装**: ドメイン固有言語の処理
3. **コード解析**: 静的解析ツール

### データ処理

1. **構造化データ解析**: JSON、XMLなど
2. **ログ解析**: 複雑なログ形式の処理
3. **プロトコル解析**: ネットワークプロトコル

## 参考文献

### 基礎論文

1. Ford, B. (2004). "Parsing Expression Grammars: A Recognition-Based Syntactic Foundation". *POPL '04*.

2. Ford, B. (2002). "Packrat Parsing: Simple, Powerful, Lazy, Linear Time". *ICFP '02*.

### 拡張研究

3. Warth, A., Douglass, J., & Millstein, T. (2008). "Packrat Parsers Can Support Left Recursion". *PEPM '08*.

4. Redziejowski, R. R. (2007). "Parsing Expression Grammar as a Primitive Recursive-Descent Parser with Backtracking". *Fundamenta Informaticae*. 