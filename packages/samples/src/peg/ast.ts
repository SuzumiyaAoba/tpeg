import type { Pos } from "tpeg-core";

/**
 * Base interface for all AST nodes with position information
 */
export interface BaseNode {
  pos: Pos;
}

export type ExprType = Expr["type"];

export type Expr =
  | Sequence
  | Choice
  | Optional
  | AndPredicate
  | NotPredicate
  | ZeroOrMore
  | OneOrMore
  | AnyChar
  | Identifier
  | Literal
  | CharClass
  | Definition
  | Grammar;

export type Sequence = BaseNode & {
  type: "Sequence";
  value: readonly Expr[];
};

export type Choice = BaseNode & {
  type: "Choice";
  value: readonly Expr[];
};

export type Optional = BaseNode & {
  type: "Optional";
  value: Expr;
};

export type AndPredicate = BaseNode & {
  type: "AndPredicate";
  value: Expr;
};

export type NotPredicate = BaseNode & {
  type: "NotPredicate";
  value: Expr;
};

export type ZeroOrMore = BaseNode & {
  type: "ZeroOrMore";
  value: Expr;
};

export type OneOrMore = BaseNode & {
  type: "OneOrMore";
  value: Expr;
};

export type AnyChar = BaseNode & {
  type: "AnyChar";
};

export type Identifier = BaseNode & {
  type: "Identifier";
  value: string;
};

export type Literal = BaseNode & {
  type: "Literal";
  value: string;
};

export type CharClass = BaseNode & {
  type: "CharClass";
  value: (string | readonly [string, string])[];
};

export type Definition = BaseNode & {
  type: "Definition";
  name: string;
  expr: Expr;
};

export type Grammar = BaseNode & {
  type: "Grammar";
  value: readonly Definition[];
};

// Type guard functions for runtime type checking
export const isSequence = (expr: Expr): expr is Sequence =>
  expr.type === "Sequence";
export const isChoice = (expr: Expr): expr is Choice => expr.type === "Choice";
export const isOptional = (expr: Expr): expr is Optional =>
  expr.type === "Optional";
export const isAndPredicate = (expr: Expr): expr is AndPredicate =>
  expr.type === "AndPredicate";
export const isNotPredicate = (expr: Expr): expr is NotPredicate =>
  expr.type === "NotPredicate";
export const isZeroOrMore = (expr: Expr): expr is ZeroOrMore =>
  expr.type === "ZeroOrMore";
export const isOneOrMore = (expr: Expr): expr is OneOrMore =>
  expr.type === "OneOrMore";
export const isAnyChar = (expr: Expr): expr is AnyChar =>
  expr.type === "AnyChar";
export const isIdentifier = (expr: Expr): expr is Identifier =>
  expr.type === "Identifier";
export const isLiteral = (expr: Expr): expr is Literal =>
  expr.type === "Literal";
export const isCharClass = (expr: Expr): expr is CharClass =>
  expr.type === "CharClass";
export const isDefinition = (expr: Expr): expr is Definition =>
  expr.type === "Definition";
export const isGrammar = (expr: Expr): expr is Grammar =>
  expr.type === "Grammar";

// Helper function to create AST nodes with position information
export const createNode = <T extends Expr>(
  type: T["type"],
  pos: Pos,
  props: Omit<T, "type" | "pos">,
): T =>
  ({
    type,
    pos,
    ...props,
  }) as T;
