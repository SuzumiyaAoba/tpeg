# @tpeg/type-inference

TPEG文法定義のための型推論システム。

## 概要

このパッケージは、TPEG文法定義の包括的な型推論機能を提供します。文法構造を分析し、より良い型安全性のためにTypeScript型情報を生成します。

## 機能

- **自動型推論**: TPEG式を分析し、適切なTypeScript型を生成
- **循環依存検出**: 文法ルールの循環依存を検出・処理
- **設定可能な推論戦略**: オプションを通じて型推論の動作をカスタマイズ
- **パフォーマンス最適化**: パフォーマンス向上のためのキャッシュ機構
- **ドキュメント生成**: 推論された型の自動JSDocコメント生成

## インストール

```bash
npm install @tpeg/type-inference
```

## 使用方法

### 基本的な型推論

```typescript
import { TypeInferenceEngine } from '@tpeg/type-inference';
import { createGrammarDefinition, createStringLiteral } from '@tpeg/core';

const grammar = createGrammarDefinition('MyGrammar', [
  createRuleDefinition('greeting', createStringLiteral('hello', '"'))
]);

const engine = new TypeInferenceEngine();
const result = engine.inferGrammarTypes(grammar);

console.log(result.ruleTypes.get('greeting')?.typeString); // '"hello"'
```

### 高度な設定

```typescript
const engine = new TypeInferenceEngine({
  inferArrayTypes: true,
  inferUnionTypes: true,
  inferObjectTypes: true,
  generateDocumentation: true,
  maxRecursionDepth: 100,
  enableCaching: true,
  detectCircularDependencies: true
});
```

### 型統合

```typescript
import { TypeIntegrationEngine } from '@tpeg/type-inference';

const integrationEngine = new TypeIntegrationEngine({
  strictTypes: true,
  includeDocumentation: true,
  generateTypeGuards: true
});

const typedGrammar = integrationEngine.createTypedGrammar(grammar);
console.log(typedGrammar.typeDefinitions);
```

## API リファレンス

### TypeInferenceEngine

TPEG文法の型推論を実行するメインクラス。

#### コンストラクタオプション

- `inferArrayTypes`: 繰り返し演算子の配列型推論を行うかどうか
- `inferUnionTypes`: 選択演算子のユニオン型推論を行うかどうか
- `inferObjectTypes`: シーケンス演算子のオブジェクト型推論を行うかどうか
- `includePositions`: 型に位置情報を含めるかどうか
- `customTypeMappings`: 特定のパターンのカスタム型マッピング
- `generateDocumentation`: JSDocコメントを生成するかどうか
- `maxRecursionDepth`: スタックオーバーフローを防ぐ最大再帰深度
- `enableCaching`: パフォーマンスのためのキャッシュを有効にするかどうか
- `detectCircularDependencies`: 循環依存を検出するかどうか

#### メソッド

- `inferGrammarTypes(grammar)`: 完全な文法の型推論
- `inferExpressionType(expression)`: 特定の式の型推論

### TypeIntegrationEngine

型推論とコード生成を組み合わせて、型安全なパーサー生成を強化。

#### コンストラクタオプション

- `strictTypes`: 厳密な型を生成するかどうか（'any'や'unknown'なし）
- `includeDocumentation`: 生成された型にJSDocコメントを含めるかどうか
- `customTypeMappings`: 特定のパターンのカスタム型マッピング
- `generateTypeGuards`: 推論された型の型ガードを生成するかどうか
- `typeNamespace`: 生成された型の名前空間

#### メソッド

- `createTypedGrammar(grammar)`: 完全な型情報を持つ型付き文法定義を作成
- `generateParserInterface(typedGrammar)`: パーサーの完全なTypeScriptインターフェースを生成

## ライセンス

MIT 