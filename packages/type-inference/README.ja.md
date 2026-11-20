# @suzumiyaaoba/tpeg-type-inference

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
npm install @suzumiyaaoba/tpeg-type-inference
```

## 使用方法

### 基本的な型推論

```typescript
import { TypeInferenceEngine } from "@suzumiyaaoba/tpeg-type-inference";
import {
  createGrammarDefinition,
  createRuleDefinition,
  createStringLiteral,
  createCharacterClass,
  createCharRange,
  createIdentifier,
  createPlus,
  createSequence,
  createChoice,
} from "@suzumiyaaoba/tpeg-core";

// シンプルな文法を作成
const grammar = createGrammarDefinition(
  "MyGrammar",
  [],
  [
    createRuleDefinition("greeting", createStringLiteral("hello", '"')),
    createRuleDefinition(
      "digit",
      createCharacterClass([createCharRange("0", "9")]),
    ),
    createRuleDefinition("number", createPlus(createIdentifier("digit"))),
    createRuleDefinition(
      "expression",
      createChoice([
        createStringLiteral("hello", '"'),
        createStringLiteral("world", '"'),
      ]),
    ),
  ],
);

// 型推論を実行
const engine = new TypeInferenceEngine();
const result = engine.inferGrammarTypes(grammar);

// 推論された型にアクセス
console.log(result.ruleTypes.get("greeting")?.typeString); // '"hello"'
console.log(result.ruleTypes.get("digit")?.typeString); // 'string'
console.log(result.ruleTypes.get("number")?.typeString); // 'string[]'
console.log(result.ruleTypes.get("expression")?.typeString); // '"hello" | "world"'
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
    ['"hello"', "string"],
    ['"world"', "string"],
  ]),
});
```

### コード生成との型統合

```typescript
import { TypeIntegrationEngine } from "@suzumiyaaoba/tpeg-type-inference";

const integrationEngine = new TypeIntegrationEngine({
  includeDocumentation: true,
  generateTypeGuards: true,
  typeNamespace: "MyGrammarTypes",
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
// import type { ParseResult } from "@suzumiyaaoba/tpeg-core";
//
// export interface MyGrammarParser {
//   greeting(input: string): ParseResult<MyGrammarTypes.GreetingResult>;
//   digit(input: string): ParseResult<MyGrammarTypes.DigitResult>;
//   number(input: string): ParseResult<MyGrammarTypes.NumberResult>;
//   expression(input: string): ParseResult<MyGrammarTypes.ExpressionResult>;
// }
```

生成された型ガードは、必須のキャプチャプロパティとその値を再帰的に検証し、
配列内のオブジェクトやオプション値にも対応します。配列の空き要素も検証対象です。
セマンティックアクションなどで `unknown` と推論されたルールは `undefined` を含む
すべての値を受け入れます。ラベル付きの `unknown` 値では、そのプロパティの存在が必要です。
各タプル要素の検証では、要素を一度だけ取得し、その値に対して入れ子の検証を行います。
後続の要素は、それまでの検証に成功した場合だけ取得します。
型だけで結果が決まる場合は値を取得しません。`unknown[]` は配列かどうか、`never[]` は
空の配列かどうか、`unknown` のキャプチャはプロパティが存在するかどうかを確認します。
`unknown` を含む共用体は、選択肢の値を検証せずにすべての値を受け入れます。
配列の検証には標準のメソッドを使用するため、配列自身の `findIndex` の差し替えは判定に影響しません。
`Array` や `undefined` を名前空間の一部に使った場合も型ガードは動作します。
名前空間にはドット区切りの識別子を指定でき、`class` などの予約語を先頭に置いた名前や
`yield` など strict モードで使えない名前は、型定義・インターフェースの生成時にエラーになります。
型ガードを生成する場合は、`await`、`eval`、`arguments` や、入れ子の `Types.class` など、
実行時の変数として使えない名前も拒否します。型定義のみの場合は TypeScript が許可する名前を使用できます。
入れ子の名前空間は自身のプロパティとして初期化するため、`Types.__proto__` や
`Types.constructor` を生成しても標準オブジェクトを書き換えません。既存の自身のプロパティは保持します。

`ParserResult` は、すべてのルールの結果を表す共用体用に予約されています。
`parser`、`Parser`、`_parser` など、PascalCase変換後の結果型名が `ParserResult` になるルールは、
理由を示した生成エラーになります。結果型名が重ならないように、そのルールを改名してください。
`parse` ルールと、先頭が `ParseResult` の名前空間は使用できます。
必要な場合はパーサーインターフェース内でコアの `ParseResult` を別名でimportし、
生成するルールの結果型名を保持します。

カスタム型マッピングのキーは、子の式を推論した後の型文字列と完全一致で照合します。
値は型全体を置き換えるため、`"a"[]` を `unknown` に置き換えると、型ガードに配列の制約は残りません。
マッピングは生成する型を変更します。パーサーの値は文法とアクションによって決まります。
型ガードは `string`、`number`、`boolean`、`bigint`、`symbol`、`object`、`unknown`、`any`、
`never`、`void`、`undefined`、`null` と、引用符で囲んだ単独の文字列リテラル型へのマッピングに対応します。
外部の型名、配列型、複合型など、それ以外の置換先には独自の検証関数が必要です。
それらの型ガードを生成すると、理由を示したエラーになります。`generateTypeGuards: false` を指定すると
型定義を生成でき、参照する型の宣言は別途用意します。同じ型へのマッピングでは元の形の検証を保持します。

渡した `customTypeMappings` のMapへの変更は、キャッシュ済みの式を含め、その後の推論に反映します。
キャッシュには、その式自身と子の推論が参照したマッピングを記録します。
参照した値が変わった場合は再推論し、無関係な項目の変更ではキャッシュを再利用します。
getterが推論中にマッピングを変更する場合や、同じエンジンで文法の推論を入れ子で呼ぶ場合にも適用します。

保持した文法のルールのパターンも、その後の式の推論で参照します。
参照先のパターンを置き換えたり、その内容を変更したりすると、間接的な参照や
外側の配列・タプル・キャプチャを含め、依存するキャッシュを再推論します。
推論に必要なパターンや式のアクセサーを読む参照は、親も含めてキャッシュを避け、getterと例外の動作を保持します。
新たに発生した循環と、深さの増加による再帰制限も再検証します。

直接のラベルがあるシーケンスでは、選択・任意・グループ・値をそのまま返す単一要素の
シーケンスが渡す同じ階層のキャプチャも合成します。後のキャプチャが先のフィールドを
上書きするため、`x:"a" (x:"b" / "c")` は `{ x: "b" } | { x: "a" }` と推論します。
ルールの境界、キャプチャの配列、入れ子で合成済みのオブジェクトからは、同じ階層の
フィールドを合流しません。`inferObjectTypes` が有効なら、通常の選択肢の値の
共用体推論を無効にしても、このフィールドの解析を行います。

ラベルのないセマンティックアクションや外部パーサーは、変更した値や新しいキーを
含む任意のキャプチャを返せます。ラベルのあるシーケンスでは、その分岐の型に
`unknown`の文字列インデックスシグネチャを含め、先のフィールドの値も`unknown`へ
広げます。必須のフィールドの存在は保持します。後の確実なキャプチャは値の型を
正確な型へ戻しますが、任意のキャプチャでは先の任意の値が見える可能性が残ります。
登録済みの規則の境界ではタグを外し、配列やアクション全体へのラベルの内部からも
フィールドを合成しません。アクションのコードは解析しないため、通常のオブジェクトや
スカラーを返すだけのアクションでも、このように型の精度を広げます。

ラベルのあるシーケンスの、ラベルのない要素では、グループ・選択・任意要素・値を
そのまま返す単一要素のシーケンスを通るキャプチャのタグを判定します。
フィールドを合流できないスカラー値・配列・入れ子で合成済みのオブジェクト・
登録済みの規則の値は推論しません。規則の境界では登録の有無だけを確認するため、
`start = x:"a" (start)?`でも不要な循環警告を出さず、結果を`{ x: "a" }`と推論します。
合流するフィールドの値には、通常の値の推論とカスタム型マッピングを適用します。
値とキャプチャの解析はキャッシュを分け、依存と深さを検証します。合流しない式でも、
その式自体の型を求めた場合は、通常どおり値を解析します。
循環の診断は、値の推論で遭遇した循環を表し、すべての再帰呼び出しを列挙するものでは
ありません。`getDependencies`は、合流しない値も含め、文法AST内の規則参照を返します。

途中の合成でキャプチャの組み合わせが256種類を超える場合は、必須・任意フィールドを
持つ単一のオブジェクト型へまとめます。フィールドが取りうる値と後の上書きを保持し、
フィールド間の相関を広げます。`InferredType.optionalObjectProperties` は
`objectProperties` の任意フィールドを示します。生成した型ガードは、そのフィールドの
欠如を許可し、存在する場合は値を検証します。明示的な `undefined` は、値の型が
許可する場合だけ受け入れます。

このまとめた型では、`constructor`・`__proto__`など`Object.prototype`から継承する
名前の任意フィールドに`unknown`を含めます。自身のキャプチャがない場合でも、
プロパティの取得で継承した値が見えるためです。後の確実なキャプチャが同じ名前を
上書きすると、その値の正確な型に戻ります。通常の任意フィールドは、存在する値を
引き続き検証します。

`InferredType.nullable` は、型全体が `null` または `undefined` を含むかを表します。
`unknown`、`void` と、nullable な型を含む共用体では true になります。
配列やキャプチャオブジェクトの内部に nullable な値があっても、その配列・オブジェクト自体は nullable にはなりません。

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
  createStar,
} from "@suzumiyaaoba/tpeg-core";

// JSONライクな文法
const jsonGrammar = createGrammarDefinition(
  "JSONGrammar",
  [],
  [
    createRuleDefinition("string", createStringLiteral('"', '"')),
    createRuleDefinition(
      "number",
      createCharacterClass([createCharRange("0", "9")]),
    ),
    createRuleDefinition(
      "boolean",
      createChoice([
        createStringLiteral("true", '"'),
        createStringLiteral("false", '"'),
      ]),
    ),
    createRuleDefinition(
      "array",
      createSequence([
        createStringLiteral("[", '"'),
        createOptional(
          createChoice([
            createCharacterClass([createCharRange("0", "9")]),
            createStringLiteral('"', '"'),
          ]),
        ),
        createStar(
          createSequence([
            createStringLiteral(",", '"'),
            createChoice([
              createCharacterClass([createCharRange("0", "9")]),
              createStringLiteral('"', '"'),
            ]),
          ]),
        ),
        createStringLiteral("]", '"'),
      ]),
    ),
  ],
);

const engine = new TypeInferenceEngine({
  inferArrayTypes: true,
  inferUnionTypes: true,
  inferObjectTypes: true,
  generateDocumentation: true,
});

const result = engine.inferGrammarTypes(jsonGrammar);

// 循環依存をチェック
console.log("循環依存:", result.circularDependencies);

// 特定のルールの型情報を取得
const stringType = result.ruleTypes.get("string");
console.log("Stringルールの型:", stringType?.typeString);
console.log("Stringルールのドキュメント:", stringType?.documentation);
```

### ユーティリティメソッド

```typescript
const integrationEngine = new TypeIntegrationEngine();
const typedGrammar = integrationEngine.createTypedGrammar(grammar);

// 特定のルールの型情報を取得
const typeInfo = integrationEngine.getTypeInfo(typedGrammar, "greeting");
console.log(typeInfo?.typeString); // '"hello"'

// 循環依存をチェック
const hasCircular = integrationEngine.hasCircularDependency(
  typedGrammar,
  "ruleName",
);
console.log("循環依存あり:", hasCircular);

// ルールの依存関係を取得
const dependencies = integrationEngine.getDependencies(typedGrammar, "number");
console.log("依存関係:", dependencies); // ['digit']
```

## API リファレンス

### TypeInferenceEngine

TPEG文法の型推論を実行するメインクラス。

#### コンストラクタオプション

- `inferArrayTypes` (boolean): 繰り返し演算子の配列型推論を行うかどうか (デフォルト: true)
- `inferUnionTypes` (boolean): 選択演算子のユニオン型推論を行うかどうか (デフォルト: true)
- `inferObjectTypes` (boolean): シーケンス演算子のオブジェクト型推論を行うかどうか (デフォルト: true)
- `customTypeMappings` (Map<string, string>): 推論した型文字列との完全一致による型の置換
- `generateDocumentation` (boolean): JSDocコメントを生成するかどうか (デフォルト: true)
- `maxRecursionDepth` (number): 再帰的な型推論の最大深度。0以上の安全な整数を指定 (デフォルト: 100)
- `enableCaching` (boolean): パフォーマンスのためのキャッシュを有効にするかどうか (デフォルト: true)
- `detectCircularDependencies` (boolean): 循環依存を検出するかどうか (デフォルト: true)

#### メソッド

- `inferGrammarTypes(grammar: GrammarDefinition): GrammarTypeInference`: 完全な文法の型推論
- `inferExpressionType(expression: Expression): InferredType`: 特定の式の型推論

`generateDocumentation: false` では、未知の型や推論失敗時の代替型を含め、
推論した型のドキュメントを生成しません。警告と循環依存の情報は、
文法の型推論結果から引き続き取得できます。

### TypeIntegrationEngine

型推論とコード生成を組み合わせて、型安全なパーサー生成を強化。

#### コンストラクタオプション

- `includeDocumentation` (boolean): 生成された型にJSDocコメントを含めるかどうか (デフォルト: true)
- `customTypeMappings` (Map<string, string>): 推論した型文字列との完全一致による型の置換
- `generateTypeGuards` (boolean): 推論された型の型ガードを生成するかどうか (デフォルト: false)
- `typeNamespace` (string): 生成された型の名前空間 (オプション)

#### メソッド

- `createTypedGrammar(grammar: GrammarDefinition): TypedGrammarDefinition`: 完全な型情報を持つ型付き文法定義を作成
- `generateParserInterface(typedGrammar: TypedGrammarDefinition): string`: パーサーの完全なTypeScriptインターフェースを生成
- `getTypeInfo(typedGrammar: TypedGrammarDefinition, ruleName: string): InferredType | undefined`: 特定のルールの型情報を取得
- `hasCircularDependency(typedGrammar: TypedGrammarDefinition, ruleName: string): boolean`: ルールに循環依存があるかチェック
- `getDependencies(typedGrammar: TypedGrammarDefinition, ruleName: string): string[]`: ルールの全ての依存関係を取得

`includeDocumentation: false` は、推論したドキュメントと、生成するすべてのJSDocを無効にします。
型ガードの説明、結果型の共用体、パーサーインターフェースのヘッダーにも適用します。
型定義・インターフェース・型ガードと診断情報は引き続き利用できます。

### 型定義

#### InferredType

```typescript
interface InferredType {
  typeString: string; // TypeScript型文字列
  nullable: boolean; // 型がnull/undefinedになりうるかどうか
  isArray: boolean; // 型が配列かどうか
  baseType: string; // 基本型（string、numberなど）
  imports: string[]; // 必要なインポート
  documentation?: string | undefined; // ドキュメント生成が有効な場合に設定
}
```

#### GrammarTypeInference

```typescript
interface GrammarTypeInference {
  ruleTypes: Map<string, InferredType>; // 各ルールの型情報
  circularDependencies: string[][]; // 検出された循環依存
  imports: string[]; // 必要なインポート
  warnings: string[]; // ドキュメント設定によらず返す推論の診断
  stats: {
    typesInferred: number;
    cacheHits: number;
    cacheMisses: number;
    inferenceTime: number;
  };
}
```

#### TypedGrammarDefinition

```typescript
interface TypedGrammarDefinition extends Omit<GrammarDefinition, "rules"> {
  originalGrammar: GrammarDefinition; // 元の文法定義
  rules: TypedRuleDefinition[]; // 型情報を持つルール
  typeInference: GrammarTypeInference; // 型推論結果
  typeDefinitions: string; // 生成されたTypeScript型定義
  imports: string[]; // 必要なインポート
}
```

## パフォーマンス考慮事項

- 型推論エンジンはキャッシュを使用して繰り返し操作のパフォーマンスを向上
- 循環依存検出は無限ループを避けるために最適化
- 大きな文法は設定可能な再帰制限で効率的に処理
- メモリ使用量は効率的なデータ構造で最適化

キャッシュキーには型推論に必要なフィールドを使用し、AST の追加メタデータや
`toJSON` は参照しません。必要なフィールドが getter の場合や、残りの再帰深度を超える
子がある場合はキャッシュを使用しません。`enableCaching: false` ではキーを作りません。
キャッシュの有無によらず、キャプチャのプロパティやドキュメントを含む推論結果は一致します。

キャッシュした結果には、参照先のルールを展開する深さを含め、必要な推論深度を記録します。
残りの深度に収まる場合だけ再利用するため、キャッシュやルールの順序によって
深度制限のエラーは変わりません。深さが異なる位置でも、余裕があれば再利用できます。
処理中のルール状態は失敗時も終了時に解除するため、文法の推論後に式を推論し、
同じ文法のルールを参照しても、古い状態による循環依存のエラーは発生しません。

`inferGrammarTypes` が入れ子になった場合、内側には独立したルール定義・型キャッシュ・
深度の記録・統計を用意します。解析対象の AST の getter が同じエンジンで別の文法を推論しても、
内側が終了または例外を送出した後に、外側は自身の状態で処理を再開します。
各文法の経過時間も自身の開始時刻から計測します。通常の推論を終えた文法は、
その後の `inferExpressionType` から引き続き参照できます。

深度制限は再帰的な型推論に適用します。セマンティックアクションや先読みなど、
演算子自身から型が決まる式では、子の型を推論する必要はありません。
キャプチャを包む透過的なグループの展開や依存関係の走査は、深い木でもコールスタックを使い切りません。

## エラーハンドリング

型推論システムは様々なエラー条件を適切に処理します：

- **未知のルール参照**: 未定義のルールに対して`unknown`型を返す
- **循環依存**: 循環依存を検出・報告
- **無効な式**: 不正な式を適切に処理
- **再帰制限**: 設定可能な制限でスタックオーバーフローを防止

## ライセンス

MIT
