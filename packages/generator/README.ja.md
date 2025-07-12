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
bun add tpeg-generator
```

## 使用法

### 基本コード生成

```typescript
import { generateEtaTypeScriptParser } from 'tpeg-generator';
import type { GrammarDefinition } from 'tpeg-generator';

const grammar: GrammarDefinition = {
  type: 'GrammarDefinition',
  name: 'Calculator',
  annotations: [],
  rules: [
    {
      type: 'RuleDefinition',
      name: 'number',
      pattern: {
        type: 'StringLiteral',
        value: '123'
      }
    }
  ]
};

const result = await generateEtaTypeScriptParser(grammar, {
  namePrefix: 'calc_',
  includeTypes: true,
  optimize: true
});

console.log(result.code); // 生成されたTypeScriptパーサーコード
```

### 高度な設定

```typescript
import { EtaTPEGCodeGenerator } from 'tpeg-generator';

const generator = new EtaTPEGCodeGenerator({
  language: 'typescript',
  namePrefix: 'parser_',
  includeTypes: true,
  optimize: true,
  enableMemoization: true,
  includeMonitoring: false,
  templatesDir: './custom-templates',
  cache: true,
  debug: false
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
├── optimized/
│   ├── imports.eta          # パフォーマンス強化インポート
│   ├── parser-file.eta      # 最適化されたパーサーファイル
│   └── rule-optimized.eta   # パフォーマンス最適化された規則
└── helpers/
    └── format-utils.eta     # フォーマットユーティリティ
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
  language: 'typescript';
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
    estimatedComplexity: 'low' | 'medium' | 'high';
    optimizationSuggestions: string[];
    generationTime: number;
    templateEngine: string;
  };
}
```

## パフォーマンス解析

ジェネレーターには包括的なパフォーマンス解析が含まれています：

```typescript
import { analyzeGrammarPerformance } from 'tpeg-generator';

const analysis = analyzeGrammarPerformance(grammar);
console.log(analysis.estimatedParseComplexity); // 'low' | 'medium' | 'high'
console.log(analysis.optimizationSuggestions); // 提案の配列
```

## テンプレートカスタマイズ

独自のテンプレートディレクトリを提供することでコード生成をカスタマイズできます：

```typescript
const generator = new EtaTPEGCodeGenerator({
  templatesDir: './my-custom-templates',
  // ... その他のオプション
});
```

## テスト

パッケージにはコード生成の一貫性のためのスナップショットテストを含む包括的なテストが含まれています：

```bash
# すべてのテストを実行
bun test

# スナップショットテストのみ実行
bun test src/eta-generator.spec.ts

# コード変更後にスナップショットを更新
bun test --update-snapshots
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
bun test

# 型チェック
bun run typecheck
```

## ライセンス

MIT 