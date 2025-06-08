import { u } from "unist-builder";

import type {
  Literal as UnistLiteral,
  Node as UnistNode,
  Parent as UnistParent,
} from "unist";

export interface PegNode extends UnistNode {}

export interface PegLiteral extends UnistLiteral, PegNode {}

export interface PegParent extends UnistParent, PegNode {}

export interface Expr extends PegNode {}

export interface Literal extends PegLiteral, Expr {
  type: "literal";
  value: string;
}

export interface Identifier extends PegLiteral, Expr {
  type: "identifier";
  value: string;
}

export interface Sequence extends PegParent, Expr {
  type: "sequence";
  children: Expr[];
}

export interface Choice extends PegParent, Expr {
  type: "choice";
  children: Expr[];
}

export interface Optional extends PegParent, Expr {
  type: "optional";
  children: [Expr];
}

export interface Char extends PegLiteral {
  type: "char";
  value: string;
}

export interface Range extends PegLiteral {
  type: "range";
  value: [string, string];
}

export type CharClassElement = Char | Range;

export interface CharClass extends PegParent, Expr {
  type: "charClass";
  children: CharClassElement[];
}

export interface AnyChar extends PegLiteral, Expr {
  type: "anyChar";
}

export interface AndPredicate extends PegParent, Expr {
  type: "andPredicate";
  children: [Expr];
}

export interface NotPredicate extends PegParent, Expr {
  type: "notPredicate";
  children: [Expr];
}

export interface Definition extends PegParent {
  type: "definition";
  children: [Identifier, Expr];
}

export interface Grammar extends PegParent {
  type: "grammar";
  children: Definition[];
}

// タグ付きユニオン型でより型安全なExpr型を定義
export type ExprNode =
  | Literal
  | Identifier
  | Sequence
  | Choice
  | Optional
  | CharClass
  | AnyChar
  | AndPredicate
  | NotPredicate;

// すべてのノード型のユニオン
export type PegAstNode =
  | ExprNode
  | Char
  | Range
  | Definition
  | Grammar;

// 型ガード関数
export const isLiteral = (node: PegAstNode): node is Literal =>
  node.type === "literal";

export const isIdentifier = (node: PegAstNode): node is Identifier =>
  node.type === "identifier";

export const isSequence = (node: PegAstNode): node is Sequence =>
  node.type === "sequence";

export const isChoice = (node: PegAstNode): node is Choice =>
  node.type === "choice";

export const isOptional = (node: PegAstNode): node is Optional =>
  node.type === "optional";

export const isCharClass = (node: PegAstNode): node is CharClass =>
  node.type === "charClass";

export const isAnyChar = (node: PegAstNode): node is AnyChar =>
  node.type === "anyChar";

export const isAndPredicate = (node: PegAstNode): node is AndPredicate =>
  node.type === "andPredicate";

export const isNotPredicate = (node: PegAstNode): node is NotPredicate =>
  node.type === "notPredicate";

export const isChar = (node: PegAstNode): node is Char =>
  node.type === "char";

export const isRange = (node: PegAstNode): node is Range =>
  node.type === "range";

export const isDefinition = (node: PegAstNode): node is Definition =>
  node.type === "definition";

export const isGrammar = (node: PegAstNode): node is Grammar =>
  node.type === "grammar";

// ビルダー関数（型安全性を向上）
export const literal = (value: string): Literal => {
  return u("literal", { value }) as Literal;
};

export const identifier = (value: string): Identifier => {
  return u("identifier", { value }) as Identifier;
};

export const sequence = (...exprs: readonly ExprNode[]): Sequence => {
  return u("sequence", { children: [...exprs] }) as Sequence;
};

export const choice = (...exprs: readonly ExprNode[]): Choice => {
  return u("choice", { children: [...exprs] }) as Choice;
};

export const optional = (expr: ExprNode): Optional => {
  return u("optional", { children: [expr] }) as unknown as Optional;
};

export const char = (value: string): Char => {
  return u("char", { value }) as Char;
};

export const range = (from: string, to: string): Range => {
  return u("range", { value: [from, to] }) as Range;
};

export const charClass = (...elements: readonly CharClassElement[]): CharClass => {
  return u("charClass", { children: [...elements] }) as CharClass;
};

export const anyChar = (): AnyChar => {
  return u("anyChar") as AnyChar;
};

export const andPredicate = (expr: ExprNode): AndPredicate => {
  return u("andPredicate", { children: [expr] }) as unknown as AndPredicate;
};

export const notPredicate = (expr: ExprNode): NotPredicate => {
  return u("notPredicate", { children: [expr] }) as unknown as NotPredicate;
};

export const definition = (id: string, expr: ExprNode): Definition => {
  return u("definition", {
    children: [identifier(id), expr],
  }) as Definition;
};

export const grammar = (...definitions: readonly Definition[]): Grammar => {
  return u("grammar", {
    children: [...definitions],
  }) as Grammar;
};
