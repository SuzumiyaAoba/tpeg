# スナップショットテストガイド

このドキュメントでは、TPEGジェネレーターのスナップショットテストシステムについて説明します。

## 概要

スナップショットテストは、コード生成が一貫した期待される出力を生成することを保証するための重要なテスト手法です。これにより、意図しない変更が生成されたコードに影響を与えることを防ぎます。

## スナップショットテストの目的

### 1. 一貫性の保証
- 生成されたコードの構造が期待通りであることを確認
- 意図しない変更の検出
- リグレッションの防止

### 2. 品質保証
- 生成されたコードの可読性を維持
- パフォーマンスメタデータの正確性を確保
- インポートとエクスポートの整合性を検証

### 3. 開発効率の向上
- 手動での出力検証の削減
- 変更の影響範囲の迅速な把握
- デバッグ時間の短縮

## テスト構造

### 基本テストケース

```typescript
describe('Snapshot Tests', () => {
  it('should generate consistent code for simple grammar', async () => {
    const grammar: GrammarDefinition = {
      type: 'GrammarDefinition',
      name: 'Simple',
      annotations: [],
      rules: [
        {
          type: 'RuleDefinition',
          name: 'number',
          pattern: { type: 'StringLiteral', value: '123' }
        }
      ]
    };

    const result = await generateEtaTypeScriptParser(grammar, {
      includeTypes: true,
      optimize: false
    });

    // スナップショットを検証（生成時間を除く）
    expect({
      code: result.code,
      imports: result.imports,
      exports: result.exports,
      performance: {
        ...result.performance,
        generationTime: expect.any(Number) // 生成時間は動的
      }
    }).toMatchSnapshot();
  });
});
```

### 複雑な文法テスト

```typescript
it('should generate consistent code for complex grammar', async () => {
  const grammar: GrammarDefinition = {
    type: 'GrammarDefinition',
    name: 'Calculator',
    annotations: [
      { type: 'GrammarAnnotation', key: 'version', value: '1.0' },
      { type: 'GrammarAnnotation', key: 'description', value: 'Arithmetic calculator' }
    ],
    rules: [
      {
        type: 'RuleDefinition',
        name: 'expression',
        pattern: {
          type: 'Sequence',
          elements: [
            { type: 'Identifier', name: 'term' },
            {
              type: 'Repetition',
              operator: '*',
              expression: {
                type: 'Sequence',
                elements: [
                  { type: 'Choice', alternatives: [
                    { type: 'StringLiteral', value: '+' },
                    { type: 'StringLiteral', value: '-' }
                  ]},
                  { type: 'Identifier', name: 'term' }
                ]
              }
            }
          ]
        }
      }
    ]
  };

  const result = await generateEtaTypeScriptParser(grammar, {
    includeTypes: true,
    optimize: true,
    namePrefix: 'calc_'
  });

  expect({
    code: result.code,
    imports: result.imports,
    exports: result.exports,
    performance: {
      estimatedComplexity: result.performance.estimatedComplexity,
      optimizationSuggestions: result.performance.optimizationSuggestions,
      templateEngine: result.performance.templateEngine,
      generationTime: expect.any(Number)
    }
  }).toMatchSnapshot();
});
```

## テストケースの種類

### 1. 基本文法テスト
- 単純な文字列リテラル
- 基本的な文字クラス
- 識別子参照

### 2. 複合表現テスト
- シーケンス演算子
- 選択演算子
- グループ化

### 3. 繰り返し演算子テスト
- 0回以上（`*`）
- 1回以上（`+`）
- オプショナル（`?`）
- 量化（`{n,m}`）

### 4. 先読み演算子テスト
- 肯定先読み（`&`）
- 否定先読み（`!`）

### 5. ラベル付き表現テスト
- 単一ラベル
- 複数ラベル
- ネストしたラベル

### 6. 設定オプションテスト
- 型生成の有効/無効
- インポートの有効/無効
- 名前プレフィックス
- 最適化設定

## スナップショットの管理

### スナップショットファイルの場所
```
__snapshots__/
├── eta-generator.spec.ts.snap
└── ...
```

### スナップショットの更新

```bash
# すべてのスナップショットを更新
bun test --update-snapshots

# 特定のテストファイルのスナップショットを更新
bun test --update-snapshots src/eta-generator.spec.ts
```

### スナップショットの検証

```bash
# スナップショットテストを実行
bun test src/eta-generator.spec.ts

# 詳細な出力でテストを実行
bun test src/eta-generator.spec.ts --verbose
```

## ベストプラクティス

### 1. テストケースの設計
- **包括的**: すべての重要な機能をカバー
- **明確**: テストケースの目的が明確
- **独立**: 各テストケースが独立している

### 2. スナップショットの管理
- **定期的な更新**: 意図した変更後にスナップショットを更新
- **レビュー**: スナップショットの変更をレビュー
- **ドキュメント**: 重要な変更をドキュメント化

### 3. パフォーマンス考慮事項
- **生成時間の除外**: 動的な生成時間はスナップショットから除外
- **メタデータの検証**: パフォーマンスメタデータの正確性を確保
- **最適化提案**: 最適化提案の一貫性を検証

## トラブルシューティング

### よくある問題

#### 1. スナップショットの不一致
```bash
# エラー: Received value does not match stored snapshot
```

**解決策**:
- 変更が意図的かどうかを確認
- 意図的な変更の場合はスナップショットを更新
- 意図しない変更の場合はコードを修正

#### 2. 生成時間の変動
```bash
# エラー: Generation time varies between runs
```

**解決策**:
- 生成時間をスナップショットから除外
- 代わりに正の数値であることを検証

#### 3. テンプレートの変更
```bash
# エラー: Template changes affect all snapshots
```

**解決策**:
- テンプレート変更の影響範囲を確認
- 必要に応じてスナップショットを更新
- 変更の理由をドキュメント化

### デバッグのヒント

#### 1. スナップショットの内容を確認
```bash
# スナップショットファイルを表示
cat __snapshots__/eta-generator.spec.ts.snap
```

#### 2. 生成されたコードを手動で確認
```typescript
// テスト内で生成されたコードをログ出力
console.log('Generated code:', result.code);
console.log('Imports:', result.imports);
console.log('Exports:', result.exports);
```

#### 3. 差分の詳細を確認
```bash
# 詳細な差分を表示
bun test src/eta-generator.spec.ts --verbose
```

## 継続的インテグレーション

このリポジトリのCI（`.github/workflows/ci.yml`、`check` → `build` → `typecheck` → `test`の順）は`bun test`を実行するだけで、スナップショットテストも通常のテストスイートの一部として実行されます。スナップショットの自動更新のような特別な自動化はCI上には存在しません——スナップショットの意図的な更新はローカルで行い、変更を通常のコミット・レビューフローに乗せてください。 