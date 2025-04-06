import { u } from "unist-builder";

import type {
  Literal as UnistLiteral,
  Node as UnistNode,
  Parent as UnistParent,
  Data as UnistData,
} from "unist";

export interface PegNode extends UnistNode {
  type: (AnyChar | PegLiteral | PegParent)["type"];
}

export const isPegNode = (node: PegNode): node is PegNode => {
  return node.type === "anyChar" || isPegLiteral(node) || isPegParent(node);
};

export interface PegLiteral extends UnistLiteral, PegNode {
  type: (Identifier<string> | Literal<string> | Char | Range)["type"];
}

export const isPegLiteral = (node: PegNode): node is PegLiteral => {
  return (
    node.type === "identifier" ||
    node.type === "literal" ||
    node.type === "char" ||
    node.type === "range"
  );
};

export interface PegParent extends UnistParent, PegNode {
  type: (
    | Sequence
    | Choice
    | Optional
    | CharClass
    | ZeroOrMore
    | OneOrMore
    | AndPredicate
    | NotPredicate
    | Definition
    | Grammar
    | Mapping<unknown, unknown>
  )["type"];
}

export const isPegParent = (node: PegNode): node is PegParent => {
  return (
    node.type === "sequence" ||
    node.type === "choice" ||
    node.type === "optional" ||
    node.type === "charClass" ||
    node.type === "zeroOrMore" ||
    node.type === "oneOrMore" ||
    node.type === "andPredicate" ||
    node.type === "notPredicate" ||
    node.type === "definition" ||
    node.type === "grammar"
  );
};

export interface Expr extends PegNode {
  type: (
    | Identifier<string>
    | Literal<string>
    | Sequence
    | Choice
    | Optional
    | AnyChar
    | CharClass
    | ZeroOrMore
    | OneOrMore
    | AndPredicate
    | NotPredicate
    | Mapping<unknown, unknown>
  )["type"];
}

export const isExpr = (node: PegNode): node is Expr => {
  return (
    node.type === "identifier" ||
    node.type === "literal" ||
    node.type === "sequence" ||
    node.type === "choice" ||
    node.type === "optional" ||
    node.type === "anyChar" ||
    node.type === "charClass" ||
    node.type === "zeroOrMore" ||
    node.type === "oneOrMore" ||
    node.type === "andPredicate" ||
    node.type === "notPredicate" ||
    node.type === "mapping"
  );
};

export interface Literal<T extends string> extends PegLiteral, Expr {
  type: "literal";
  value: T;
}

export function isLiteral<T extends string>(
  node: PegNode,
  type: T
): node is Literal<T>;

export function isLiteral(
  node: PegNode
): node is Literal<string>;

export function isLiteral<T extends string>(
  node: PegNode,
  type?: T
): node is Literal<T> {
  return node.type === "literal" &&
    (type ? (node as Literal<string>).value === type : true);
}

export interface Identifier<T extends string> extends PegLiteral, Expr {
  type: "identifier";
  value: T;
}

export const isIdentifier = (node: PegNode): node is Identifier<string> => {
  return node.type === "identifier";
};

export interface Sequence extends PegParent, Expr {
  type: "sequence";
  children: Expr[];
}

export const isSequence = (node: PegNode): node is Sequence => {
  return node.type === "sequence";
};

export interface Choice extends PegParent, Expr {
  type: "choice";
  children: Expr[];
}

export const isChoice = (node: PegNode): node is Choice => {
  return node.type === "choice";
};

export interface Optional extends PegParent, Expr {
  type: "optional";
  children: [Expr];
}

export const isOptional = (node: PegNode): node is Optional => {
  return node.type === "optional";
};

export interface CharClassElement extends PegLiteral {
  type: "char" | "range";
  value: string | [string, string];
}

export const isCharClassElement = (node: PegNode): node is CharClassElement => {
  return node.type === "char" || node.type === "range";
};

export interface Char extends CharClassElement {
  type: "char";
  value: string;
}

export const isChar = (node: PegNode): node is Char => {
  return node.type === "char";
};

export interface Range extends CharClassElement {
  type: "range";
  value: [string, string];
}

export const isRange = (node: PegNode): node is Range => {
  return node.type === "range";
};

export interface CharClass extends PegParent, Expr {
  type: "charClass";
  children: (Char | Range)[];
}

export const isCharClass = (node: PegNode): node is CharClass => {
  return node.type === "charClass";
};

export interface AnyChar extends PegNode {
  type: "anyChar";
}

export const isAnyChar = (node: PegNode): node is AnyChar => {
  return node.type === "anyChar";
};

export interface ZeroOrMore extends PegParent {
  type: "zeroOrMore";
  children: [Expr];
}

export const isZeroOrMore = (node: PegNode): node is ZeroOrMore => {
  return node.type === "zeroOrMore";
}

export interface OneOrMore extends PegParent {
  type: "oneOrMore";
  children: [Expr];
}

export interface AndPredicate extends PegParent {
  type: "andPredicate";
  children: [Expr];
}

export const isAndPredicate = (node: PegNode): node is AndPredicate => {
  return node.type === "andPredicate";
};

export interface NotPredicate extends PegParent {
  type: "notPredicate";
  children: [Expr];
}

export const isNotPredicate = (node: PegNode): node is NotPredicate => {
  return node.type === "notPredicate";
};

export interface Definition extends PegParent {
  type: "definition";
  children: [Identifier<string>, Expr];
}

export const isDefinition = (node: PegNode): node is Definition => {
  return node.type === "definition";
};

export interface Grammar extends PegParent {
  type: "grammar";
  children: Definition[];
}

export const isGrammar = (node: PegNode): node is Grammar => {
  return node.type === "grammar";
};

export interface MappingData<T, U> extends UnistData {
  (value: T): U;
}

export interface Mapping<T, U> extends PegParent, Expr {
  type: "mapping";
  children: [Expr];
  data: MappingData<T, U>;
}

export const isMapping = (node: PegNode): node is Mapping<unknown, unknown> => {
  return node.type === "mapping";
}

export const literal = <T extends string>(value: T): Literal<T> => {
  return u("literal", { value });
};

export const lit = literal;

export const identifier = <T extends string>(value: T): Identifier<T> => {
  return u("identifier", { value });
};

export const id = identifier;

export const sequence = (...exprs: Expr[]): Sequence => {
  return u("sequence", { children: exprs });
};

export const seq = sequence;

export const choice = (...exprs: Expr[]): Choice => {
  return u("choice", { children: exprs });
};

export const optional = (expr: Expr): Optional => {
  return u("optional", { children: [expr] satisfies [Expr] });
};

export const opt = optional;

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

export const any = anyChar;

export const zeroOrMore = (expr: Expr): ZeroOrMore => {
  return u("zeroOrMore", { children: [expr] satisfies [Expr] });
}

export const star = zeroOrMore;

export const many = zeroOrMore;

export const oneOrMore = (expr: Expr): OneOrMore => {
  return u("oneOrMore", { children: [expr] satisfies [Expr] });
}

export const plus = oneOrMore;

export const many1 = oneOrMore;

export const andPredicate = (expr: Expr): AndPredicate => {
  return u("andPredicate", { children: [expr] satisfies [Expr] });
};

export const and = andPredicate;

export const notPredicate = (expr: Expr): NotPredicate => {
  return u("notPredicate", { children: [expr] satisfies [Expr] });
};

export const not = notPredicate;

export const definition = (id: string, expr: Expr): Definition => {
  return u("definition", {
    children: [identifier(id), expr] satisfies [Identifier<string>, Expr],
  });
};

export const def = definition;

export const grammar = (definitions: Definition[]): Grammar => {
  return u("grammar", {
    children: definitions,
  });
};
