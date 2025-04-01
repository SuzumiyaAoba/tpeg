import type { Pos } from "tpeg-combinator";

export type ExprType = Expr["type"];

export type Expr =
  | Literal
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

export type Sequence = {
  type: "Sequence";
  value: readonly Expr[];
  pos: Pos;
};

export type Choice = {
  type: "Choice";
  value: readonly Expr[];
};

export type Optional = {
  type: "Optional";
  value: Expr;
};

export type AndPredicate = {
  type: "AndPredicate";
  value: Expr;
  pos: Pos;
};

export type NotPredicate = {
  type: "NotPredicate";
  value: Expr;
  pos: Pos;
};

export type ZeroOrMore = {
  type: "ZeroOrMore";
  value: Expr;
  pos: Pos;
};

export type OneOrMore = {
  type: "OneOrMore";
  value: Expr;
  pos: Pos;
};

export type AnyChar = {
  type: "AnyChar";
  pos: Pos;
};

export type Identifier = {
  type: "Identifier";
  value: string;
  pos: Pos;
};

export type Literal = {
  type: "Literal";
  value: string;
  pos: Pos;
};

export type CharClass = {
  type: "CharClass";
  value: (string | readonly [string, string])[];
  pos: Pos;
};

export type Definition = {
  type: "Definition";
  name: string;
  expr: Expr;
};

export type Grammar = {
  type: "Grammar";
  value: readonly Definition[];
};
