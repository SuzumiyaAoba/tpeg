import { u } from "unist-builder";

import type {
  Literal as UnistLiteral,
  Node as UnistNode,
  Parent as UnistParent,
  Data as UnistData,
} from "unist";

type ExprType<T> = T extends Expr<infer U> ? U : never;

export interface PegNode<T> extends UnistNode {
  type: (AnyChar | PegLiteral<string> | PegParent<T>)["type"];
}

export const isPegNode = (node: PegNode<unknown>): node is PegNode<unknown> => {
  return node.type === "anyChar" || isPegLiteral(node) || isPegParent(node);
};

export interface PegLiteral<T extends string> extends UnistLiteral, PegNode<T> {
  type: (Identifier<T> | Literal<T> | Char<T> | Range<T, T>)["type"];
}

export const isPegLiteral = <T extends string>(
  node: PegNode<T>,
): node is PegLiteral<T> => {
  return (
    node.type === "identifier" ||
    node.type === "literal" ||
    node.type === "char" ||
    node.type === "range"
  );
};

export interface PegParent<T> extends UnistParent, PegNode<T> {
  type: (
    | Sequence<Expr<unknown>[]>
    | Choice<Expr<unknown>[]>
    | Optional<Expr<T>>
    | CharClass<[]>
    | ZeroOrMore<Expr<T>>
    | OneOrMore<unknown>
    | AndPredicate<unknown>
    | NotPredicate<unknown>
    | Definition<string, unknown>
    | Grammar<unknown>
    | Mapping<Expr<unknown>, Expr<unknown>>
  )["type"];
}

export const isPegParent = <T>(node: PegNode<T>): node is PegParent<T> => {
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

export interface Expr<T> extends PegNode<T> {
  type: (
    | Identifier<T extends string ? T : string>
    | Literal<T extends string ? T : string>
    | Sequence<Expr<unknown>[]>
    | Choice<Expr<unknown>[]>
    | Optional<unknown>
    | AnyChar
    | CharClass<[]>
    | ZeroOrMore<Expr<unknown>>
    | OneOrMore<unknown>
    | AndPredicate<unknown>
    | NotPredicate<unknown>
    | Mapping<Expr<unknown>, Expr<T>>
  )["type"];
}

export const isExpr = <T>(node: PegNode<T>): node is Expr<T> => {
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

export interface Literal<T extends string> extends PegLiteral<T>, Expr<T> {
  type: "literal";
  value: T;
}

export function isLiteral<T extends string>(
  node: PegNode<T>,
  type: T,
): node is Literal<T>;

export function isLiteral<T>(node: PegNode<T>): node is Literal<string>;

export function isLiteral<T extends string>(
  node: PegNode<T>,
  type?: T,
): node is Literal<T> {
  return (
    node.type === "literal" &&
    (type ? (node as Literal<string>).value === type : true)
  );
}

export interface Identifier<T extends string> extends PegLiteral<T>, Expr<T> {
  type: "identifier";
  value: T;
}

export const isIdentifier = <T extends string>(
  node: PegNode<T>,
): node is Identifier<T> => {
  return node.type === "identifier";
};

export interface Sequence<E extends Expr<unknown>[]>
  extends PegParent<{ [K in keyof E]: E[K] extends Expr<infer T> ? T : never }>,
    Expr<{ [K in keyof E]: E[K] extends Expr<infer T> ? T : never }> {
  type: "sequence";
  children: E;
}

export const isSequence = <T>(node: PegNode<T>): node is Sequence<[]> => {
  return node.type === "sequence";
};

export interface Choice<E extends Expr<unknown>[]>
  extends PegParent<
      { [K in keyof E]: E[K] extends Expr<infer T> ? T : never }[number]
    >,
    Expr<{ [K in keyof E]: E[K] extends Expr<infer T> ? T : never }[number]> {
  type: "choice";
  children: E;
}

export const isChoice = <T>(node: PegNode<T>): node is Choice<[]> => {
  return node.type === "choice";
};

export interface Optional<E> extends PegParent<E>, Expr<E> {
  type: "optional";
  children: [Expr<E>];
}

export const isOptional = <T>(node: PegNode<T>): node is Optional<unknown> => {
  return node.type === "optional";
};

export interface CharClassElement extends PegLiteral<string> {
  type: "char" | "range";
  value: string | [string, string];
}

export const isCharClassElement = <T>(
  node: PegNode<T>,
): node is CharClassElement => {
  return node.type === "char" || node.type === "range";
};

export interface Char<T extends string> extends CharClassElement {
  type: "char";
  value: T;
}

export const isChar = <T extends string>(node: PegNode<T>): node is Char<T> => {
  return node.type === "char";
};

export interface Range<START extends string, STOP extends string>
  extends CharClassElement {
  type: "range";
  value: [START, STOP];
}

export const isRange = <T extends string>(
  node: PegNode<T>,
): node is Range<T, T> => {
  return node.type === "range";
};

export interface CharClass<T extends (string | [string, string])[]>
  extends PegParent<T>,
    Expr<T> {
  type: "charClass";
  children: {
    [K in keyof T]: T[K] extends string
      ? Char<T[K]>
      : T[K] extends [infer A extends string, infer B extends string]
        ? Range<A, B>
        : never;
  };
}

export const isCharClass = (
  node: PegNode<unknown>,
): node is CharClass<(string | [string, string])[]> => {
  return node.type === "charClass";
};

export interface AnyChar extends PegNode<string> {
  type: "anyChar";
}

export const isAnyChar = (node: PegNode<unknown>): node is AnyChar => {
  return node.type === "anyChar";
};

export interface ZeroOrMore<E extends Expr<unknown>> extends PegParent<E> {
  type: "zeroOrMore";
  children: [E];
}

export const isZeroOrMore = <T>(
  node: PegNode<T>,
): node is ZeroOrMore<Expr<T>> => {
  return node.type === "zeroOrMore";
};

export interface OneOrMore<E> extends PegParent<E> {
  type: "oneOrMore";
  children: [Expr<E>];
}

export const isOneOrMore = <T>(
  node: PegNode<T>,
): node is OneOrMore<unknown> => {
  return node.type === "oneOrMore";
};

export interface AndPredicate<E> extends PegParent<unknown> {
  type: "andPredicate";
  children: [Expr<E>];
}

export const isAndPredicate = <T>(
  node: PegNode<T>,
): node is AndPredicate<unknown> => {
  return node.type === "andPredicate";
};

export interface NotPredicate<E> extends PegParent<unknown> {
  type: "notPredicate";
  children: [Expr<E>];
}

export const isNotPredicate = <T>(
  node: PegNode<T>,
): node is NotPredicate<unknown> => {
  return node.type === "notPredicate";
};

export interface Definition<NAME extends string, T> extends PegParent<T> {
  type: "definition";
  children: [Identifier<NAME>, Expr<T>];
}

export const isDefinition = <NAME extends string>(
  node: PegNode<unknown>,
): node is Definition<NAME, unknown> => {
  return node.type === "definition";
};

export interface Grammar<T> extends PegParent<T> {
  type: "grammar";
  children: Definition<string, unknown>[];
}

export const isGrammar = <T>(node: PegNode<T>): node is Grammar<unknown> => {
  return node.type === "grammar";
};

export interface MappingData<T extends Expr<unknown>, U> extends UnistData {
  (value: T): U;
}

export interface Mapping<T extends Expr<unknown>, U>
  extends PegParent<U>,
    Expr<U> {
  type: "mapping";
  children: [T];
  data: MappingData<T, U>;
}

export const isMapping = (
  expr: Expr<unknown>,
): expr is Mapping<Expr<unknown>, Expr<unknown>> => {
  return expr.type === "mapping";
};

export const literal = <T extends string>(value: T): Literal<T> => {
  return u("literal", { value });
};

export const lit = literal;

export const identifier = <T extends string>(value: T): Identifier<T> => {
  return u("identifier", { value });
};

export const id = identifier;

export const sequence = <E extends Expr<unknown>[]>(
  ...exprs: E
): Sequence<E> => {
  return u("sequence", { children: exprs });
};

export const seq = sequence;

export const choice = <E extends Expr<unknown>[]>(...exprs: E): Choice<E> => {
  return u("choice", { children: exprs });
};

export const optional = (expr: Expr<unknown>): Optional<unknown> => {
  return u("optional", { children: [expr] satisfies [Expr<unknown>] });
};

export const opt = optional;

export const charClass = <const T extends (string | [string, string])[]>(
  ...elements: T
): CharClass<T> => {
  return u("charClass", {
    children: elements.map((child) =>
      typeof child === "string"
        ? u("char", { value: child })
        : u("range", { value: child }),
    ) as CharClass<T>["children"],
  });
};

export const anyChar = (): AnyChar => {
  return u("anyChar");
};

export const any = anyChar;

export const zeroOrMore = <E extends Expr<unknown>>(expr: E): ZeroOrMore<E> => {
  return u("zeroOrMore", { children: [expr] satisfies [E] });
};

export const star = zeroOrMore;

export const many = zeroOrMore;

export const oneOrMore = <E extends Expr<unknown>>(expr: E): OneOrMore<E> => {
  return u("oneOrMore", { children: [expr] satisfies [E] });
};

export const plus = oneOrMore;

export const many1 = oneOrMore;

export const andPredicate = (expr: Expr<unknown>): AndPredicate<unknown> => {
  return u("andPredicate", { children: [expr] satisfies [Expr<unknown>] });
};

export const and = andPredicate;

export const notPredicate = (expr: Expr<unknown>): NotPredicate<unknown> => {
  return u("notPredicate", { children: [expr] satisfies [Expr<unknown>] });
};

export const not = notPredicate;

export const definition = <NAME extends string, EXPR extends Expr<unknown>>(
  id: NAME,
  expr: EXPR,
): Definition<NAME, EXPR> => {
  return u("definition", {
    children: [identifier(id), expr] satisfies [Identifier<NAME>, EXPR],
  });
};

export const def = definition;

export const grammar = <T>(
  definitions: Definition<string, T>[],
): Grammar<T> => {
  return u("grammar", {
    children: definitions,
  });
};

export const map = <T extends Expr<unknown>, U>(
  expr: T,
  data: MappingData<T, U>,
): Mapping<T, U> => {
  return u("mapping", { children: [expr] satisfies [T], data });
};
