# @tpeg/type-inference

TPEG文法定義のための型推論システム。

## 概要

このパッケージは、TPEG文法定義の包括的な型推論機能を提供します。文法構造を分析し、より良い型安全性と開発者体験のためにTypeScript型情報を生成します。

## 機能

- **自動型推論**: TPEG式を分析し、適切なTypeScript型を生成
- **循環依存検出**: 文法ルールの循環依存を検出・処理
- **設定可能な推論戦略**: オプションを通じて型推論の動作をカスタマイズ
- **パフォーマンス最適化**: パフォーマンス向上のためのキャッシュ機構
- **ドキュメント生成**: 推論された型の自動JSDocコメント生成
- **型統合**: 型安全なパーサーのためのコード生成とのシームレスな統合
- **型ガード**: 型ガード関数の自動生成
- **依存関係分析**: ルール依存関係の包括的な分析

## インストール

```bash
npm install @tpeg/type-inference
```

## 使用方法

### 基本的な型推論

```typescript
import { TypeInferenceEngine } from '@tpeg/type-inference';
import { 
  createGrammarDefinition, 
  createRuleDefinition, 
  createStringLiteral,
  createCharacterClass,
  createCharRange,
  createPlus,
  createSequence,
  createChoice
} from '@tpeg/core';

// シンプルな文法を作成
const grammar = createGrammarDefinition('MyGrammar', [], [
  createRuleDefinition('greeting', createStringLiteral('hello', '"')),
  createRuleDefinition('digit', createCharacterClass([createCharRange('0', '9')])),
  createRuleDefinition('number', createPlus(createCharacterClass([createCharRange('0', '9')]))),
  createRuleDefinition('expression', createChoice([
    createStringLiteral('hello', '"'),
    createStringLiteral('world', '"')
  ]))
]);

// 型推論を実行
const engine = new TypeInferenceEngine();
const result = engine.inferGrammarTypes(grammar);

// 推論された型にアクセス
console.log(result.ruleTypes.get('greeting')?.typeString); // '"hello"'
console.log(result.ruleTypes.get('digit')?.typeString); // 'string'
console.log(result.ruleTypes.get('number')?.typeString); // 'string[]'
console.log(result.ruleTypes.get('expression')?.typeString); // '"hello" | "world"'
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
  detectCircularDependencies: true,
  customTypeMappings: new Map([
    ['email', 'string'],
    ['url', 'string'],
    ['uuid', 'string']
  ])
});
```

### コード生成との型統合

```typescript
import { TypeIntegrationEngine } from '@tpeg/type-inference';

const integrationEngine = new TypeIntegrationEngine({
  strictTypes: true,
  includeDocumentation: true,
  generateTypeGuards: true,
  typeNamespace: 'MyGrammarTypes'
});

const typedGrammar = integrationEngine.createTypedGrammar(grammar);

// 型定義を生成
console.log(typedGrammar.typeDefinitions);
// 出力:
// export namespace MyGrammarTypes {
//   export type GreetingResult = "hello";
//   export type DigitResult = string;
//   export type NumberResult = string[];
//   export type ExpressionResult = "hello" | "world";
//   
//   export function isGreetingResult(value: unknown): value is GreetingResult {
//     return typeof value === "string" && value === "hello";
//   }
//   // ... その他の型ガード
// }

// パーサーインターフェースを生成
const parserInterface = integrationEngine.generateParserInterface(typedGrammar);
console.log(parserInterface);
// 出力:
// export interface MyGrammarParser {
//   greeting(input: string): ParseResult<GreetingResult>;
//   digit(input: string): ParseResult<DigitResult>;
//   number(input: string): ParseResult<NumberResult>;
//   expression(input: string): ParseResult<ExpressionResult>;
// }
```

### 複雑な文法の例

```typescript
import { 
  createGrammarDefinition, 
  createRuleDefinition, 
  createStringLiteral,
  createCharacterClass,
  createCharRange,
  createPlus,
  createSequence,
  createChoice,
  createOptional,
  createStar
} from '@tpeg/core';

// JSONライクな文法
const jsonGrammar = createGrammarDefinition('JSONGrammar', [], [
  createRuleDefinition('string', createStringLiteral('"', '"')),
  createRuleDefinition('number', createCharacterClass([createCharRange('0', '9')])),
  createRuleDefinition('boolean', createChoice([
    createStringLiteral('true', '"'),
    createStringLiteral('false', '"')
  ])),
  createRuleDefinition('array', createSequence([
    createStringLiteral('[', '"'),
    createOptional(createChoice([
      createCharacterClass([createCharRange('0', '9')]),
      createStringLiteral('"', '"')
    ])),
    createStar(createSequence([
      createStringLiteral(',', '"'),
      createChoice([
        createCharacterClass([createCharRange('0', '9')]),
        createStringLiteral('"', '"')
      ])
    ])),
    createStringLiteral(']', '"')
  ]))
]);

const engine = new TypeInferenceEngine({
  inferArrayTypes: true,
  inferUnionTypes: true,
  inferObjectTypes: true,
  generateDocumentation: true
});

const result = engine.inferGrammarTypes(jsonGrammar);

// 循環依存をチェック
console.log('循環依存:', result.circularDependencies);

// 特定のルールの型情報を取得
const stringType = result.ruleTypes.get('string');
console.log('Stringルールの型:', stringType?.typeString);
console.log('Stringルールのドキュメント:', stringType?.documentation);
```

### ユーティリティメソッド

```typescript
const integrationEngine = new TypeIntegrationEngine();
const typedGrammar = integrationEngine.createTypedGrammar(grammar);

// 特定のルールの型情報を取得
const typeInfo = integrationEngine.getTypeInfo(typedGrammar, 'greeting');
console.log(typeInfo?.typeString); // '"hello"'

// 循環依存をチェック
const hasCircular = integrationEngine.hasCircularDependency(typedGrammar, 'ruleName');
console.log('循環依存あり:', hasCircular);

// ルールの依存関係を取得
const dependencies = integrationEngine.getDependencies(typedGrammar, 'number');
console.log('依存関係:', dependencies); // ['digit']
```

## API リファレンス

### TypeInferenceEngine

TPEG文法の型推論を実行するメインクラス。

#### コンストラクタオプション

- `inferArrayTypes` (boolean): 繰り返し演算子の配列型推論を行うかどうか (デフォルト: true)
- `inferUnionTypes` (boolean): 選択演算子のユニオン型推論を行うかどうか (デフォルト: true)
- `inferObjectTypes` (boolean): シーケンス演算子のオブジェクト型推論を行うかどうか (デフォルト: true)
- `includePositions` (boolean): 型に位置情報を含めるかどうか (デフォルト: false)
- `customTypeMappings` (Map<string, string>): 特定のパターンのカスタム型マッピング
- `generateDocumentation` (boolean): JSDocコメントを生成するかどうか (デフォルト: true)
- `maxRecursionDepth` (number): スタックオーバーフローを防ぐ最大再帰深度 (デフォルト: 50)
- `enableCaching` (boolean): パフォーマンスのためのキャッシュを有効にするかどうか (デフォルト: true)
- `detectCircularDependencies` (boolean): 循環依存を検出するかどうか (デフォルト: true)

#### メソッド

- `inferGrammarTypes(grammar: GrammarDefinition): GrammarTypeInference`: 完全な文法の型推論
- `inferExpressionType(expression: Expression): InferredType`: 特定の式の型推論

### TypeIntegrationEngine

型推論とコード生成を組み合わせて、型安全なパーサー生成を強化。

#### コンストラクタオプション

- `strictTypes` (boolean): 厳密な型を生成するかどうか（'any'や'unknown'なし） (デフォルト: true)
- `includeDocumentation` (boolean): 生成された型にJSDocコメントを含めるかどうか (デフォルト: true)
- `customTypeMappings` (Map<string, string>): 特定のパターンのカスタム型マッピング
- `generateTypeGuards` (boolean): 推論された型の型ガードを生成するかどうか (デフォルト: false)
- `typeNamespace` (string): 生成された型の名前空間 (オプション)

#### メソッド

- `createTypedGrammar(grammar: GrammarDefinition): TypedGrammarDefinition`: 完全な型情報を持つ型付き文法定義を作成
- `generateParserInterface(typedGrammar: TypedGrammarDefinition): string`: パーサーの完全なTypeScriptインターフェースを生成
- `getTypeInfo(typedGrammar: TypedGrammarDefinition, ruleName: string): InferredType | undefined`: 特定のルールの型情報を取得
- `hasCircularDependency(typedGrammar: TypedGrammarDefinition, ruleName: string): boolean`: ルールに循環依存があるかチェック
- `getDependencies(typedGrammar: TypedGrammarDefinition, ruleName: string): string[]`: ルールの全ての依存関係を取得

### 型定義

#### InferredType

```typescript
interface InferredType {
  typeString: string;           // TypeScript型文字列
  nullable: boolean;           // 型がnull/undefinedになりうるかどうか
  isArray: boolean;           // 型が配列かどうか
  baseType: string;           // 基本型（string、numberなど）
  imports: string[];          // 必要なインポート
  documentation: string;      // 生成されたドキュメント
}
```

#### GrammarTypeInference

```typescript
interface GrammarTypeInference {
  ruleTypes: Map<string, InferredType>;           // 各ルールの型情報
  circularDependencies: string[][];               // 検出された循環依存
  imports: string[];                              // 必要なインポート
  documentation: string;                          // 生成されたドキュメント
}
```

#### TypedGrammarDefinition

```typescript
interface TypedGrammarDefinition extends Omit<GrammarDefinition, "rules"> {
  originalGrammar: GrammarDefinition;             // 元の文法定義
  rules: TypedRuleDefinition[];                   // 型情報を持つルール
  typeInference: GrammarTypeInference;           // 型推論結果
  typeDefinitions: string;                        // 生成されたTypeScript型定義
  imports: string[];                              // 必要なインポート
}
```

## パフォーマンス考慮事項

- 型推論エンジンはキャッシュを使用して繰り返し操作のパフォーマンスを向上
- 循環依存検出は無限ループを避けるために最適化
- 大きな文法は設定可能な再帰制限で効率的に処理
- メモリ使用量は効率的なデータ構造で最適化

## エラーハンドリング

型推論システムは様々なエラー条件を適切に処理します：

- **未知のルール参照**: 未定義のルールに対して`unknown`型を返す
- **循環依存**: 循環依存を検出・報告
- **無効な式**: 不正な式を適切に処理
- **再帰制限**: 設定可能な制限でスタックオーバーフローを防止

## ライセンス

MIT 