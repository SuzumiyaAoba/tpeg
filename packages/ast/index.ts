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

export interface CharClassElement extends PegLiteral {
  type: "char" | "range";
  value: string | [string, string];
}

export interface Char extends CharClassElement {
  type: "char";
  value: string;
}

export interface Range extends CharClassElement {
  type: "range";
  value: [string, string];
}

export interface CharClass extends PegParent, Expr {
  type: "charClass";
  children: (Char | Range)[];
}

export interface AnyChar extends PegNode {
  type: "anyChar";
}

export interface AndPredicate extends PegNode {
  type: "andPredicate";
  children: [Expr];
}

export interface NotPredicate extends PegNode {
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

export const literal = (value: string): Literal => {
  return u("literal", { value });
};

export const identifier = (value: string): Identifier => {
  return u("identifier", { value });
};

export const sequence = (exprs: Expr[]): Sequence => {
  return u("sequence", { children: exprs });
};

export const choice = (exprs: Expr[]): Choice => {
  return u("choice", { children: exprs });
};

export const optional = (expr: Expr): Optional => {
  return u("optional", { children: [expr] satisfies [Expr] });
};

export const charClass = (
  elements: (string | [string, string])[],
): CharClass => {
  return u("charClass", {
    children: elements.map((child) =>
      typeof child === "string"
        ? u("char", { value: child })
        : u("range", { value: child }),
    ),
  });
};

export const anyChar = (): AnyChar => {
  return u("anyChar");
};

export const andPredicate = (expr: Expr): AndPredicate => {
  return u("andPredicate", { children: [expr] satisfies [Expr] });
};

export const notPredicate = (expr: Expr): NotPredicate => {
  return u("notPredicate", { children: [expr] satisfies [Expr] });
};

export const definition = (id: string, expr: Expr): Definition => {
  return u("definition", {
    children: [identifier(id), expr] satisfies [Identifier, Expr],
  });
};

export const grammar = (definitions: Definition[]): Grammar => {
  return u("grammar", {
    children: definitions,
  });
};
