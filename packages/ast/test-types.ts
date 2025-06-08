/**
 * TypeScript型レベルテストのためのヘルパー型定義
 *
 * 参考文献:
 * - https://www.totaltypescript.com/how-to-test-your-types
 * - https://frontendmasters.com/blog/testing-types-in-typescript/
 */

/**
 * 型がtrueであることを要求するヘルパー型
 *
 * @example
 * ```typescript
 * type Test = Expect<Equal<string, string>>; // OK
 * type Test = Expect<Equal<string, number>>; // エラー
 * ```
 */
export type Expect<T extends true> = T;

/**
 * Not type - inverts the result of a type test
 *
 * Examples:
 * type Test = Not<Equal<string, number>>; // OK (expects false)
 * type Test = Not<Equal<string, string>>; // Error (true is NG)
 */
export type Not<T extends false> = true;

/**
 * 2つの型が完全に一致するかをチェックする型
 * 分散ユニオン型の問題を回避するために高度な条件型を使用
 *
 * @example
 * ```typescript
 * type Test1 = Equal<string, string>; // true
 * type Test2 = Equal<string, number>; // false
 * type Test3 = Equal<string | number, string | number>; // true
 * ```
 */
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <
  T,
>() => T extends Y ? 1 : 2
  ? true
  : false;

/**
 * 2つの型の形状が一致するかをチェックするヘルパー型
 * ユニオン型の分散を防ぐためにタプル型を使用
 */
export type ShapesMatch<T, U> = [T] extends [U]
  ? [U] extends [T]
    ? true
    : false
  : false;

/**
 * より厳密な型マッチング（オプショナルプロパティも考慮）
 * 型の形状とキーの両方をチェックして完全な一致を確認
 *
 * @example
 * ```typescript
 * type Test1 = TypesMatch<{a: string}, {a: string}>; // true
 * type Test2 = TypesMatch<{a: string}, {a: string; b?: number}>; // false
 * ```
 */
export type TypesMatch<T, U> = ShapesMatch<T, U> extends true
  ? ShapesMatch<keyof T, keyof U> extends true
    ? true
    : false
  : false;

/**
 * 型がneverかどうかをチェックする型
 */
export type IsNever<T> = [T] extends [never] ? true : false;

/**
 * 型がanyかどうかをチェックする型
 */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * 型がunknownかどうかをチェックする型
 */
export type IsUnknown<T> = IsAny<T> extends true
  ? false
  : unknown extends T
    ? T extends unknown
      ? true
      : false
    : false;

/**
 * 関数の戻り値の型を取得するヘルパー型（TypeScript組み込みのReturnTypeの代替）
 */
export type GetReturnType<T> = T extends (
  ...args: readonly unknown[]
) => infer R
  ? R
  : never;

/**
 * 配列の要素の型を取得するヘルパー型
 */
export type ArrayElement<T> = T extends readonly (infer U)[] ? U : never;

/**
 * プロミスの解決型を取得するヘルパー型
 */
export type Awaited<T> = T extends Promise<infer U> ? U : T;

/**
 * 型テストの結果をタプル配列として保存する型
 * 使用されない警告を抑制しつつ、型チェックは有効にする
 */
export type TestSuite<T extends readonly true[]> = T;

// TPEG AST-specific type test helpers

/**
 * 型がExprNodeのサブタイプかどうかをチェックする型
 */
export type IsExprNode<T> = T extends { type: string; children?: unknown }
  ? true
  : false;

/**
 * 型がPegLiteralのサブタイプかどうかをチェックする型
 */
export type IsPegLiteral<T> = T extends { type: string; value: unknown }
  ? true
  : false;

/**
 * 型がPegParentのサブタイプかどうかをチェックする型
 */
export type IsPegParent<T> = T extends {
  type: string;
  children: readonly unknown[];
}
  ? true
  : false;

/**
 * リテラル型の値を抽出する型
 */
export type ExtractLiteralValue<T> = T extends { value: infer V } ? V : never;

/**
 * ノードの型名を抽出する型
 */
export type ExtractNodeType<T> = T extends { type: infer U } ? U : never;

/**
 * 特定のノード型かどうかをチェックするヘルパー型
 */
export type IsNodeType<
  T,
  NodeType extends string,
> = ExtractNodeType<T> extends NodeType ? true : false;
