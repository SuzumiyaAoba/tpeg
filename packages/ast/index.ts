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

export interface Literal<T extends string = string> extends PegLiteral, Expr {
  type: "literal";
  value: T;
}

export interface Identifier<T extends string = string> extends PegLiteral, Expr {
  type: "identifier";
  value: T;
}

export interface Sequence<T extends readonly ExprNode[] = ExprNode[]> extends PegParent, Expr {
  type: "sequence";
  children: [...T];
}

export interface Choice<T extends readonly ExprNode[] = ExprNode[]> extends PegParent, Expr {
  type: "choice";
  children: [...T];
}

export interface Optional<T extends ExprNode = ExprNode> extends PegParent, Expr {
  type: "optional";
  children: [T];
}

export interface MapNode<T extends ExprNode = ExprNode, F = unknown> extends PegParent, Expr {
  type: "map";
  children: [T];
  data: {
    mapper: F;
  };
}

export interface Char<T extends string = string> extends PegLiteral {
  type: "char";
  value: T;
}

export interface Range<F extends string = string, T extends string = string> extends PegLiteral {
  type: "range";
  value: [F, T];
}

export type CharClassElement = Char | Range;

export interface CharClass<T extends readonly CharClassElement[] = CharClassElement[]> extends PegParent, Expr {
  type: "charClass";
  children: [...T];
}

export interface AnyChar extends PegNode, Expr {
  type: "anyChar";
}

export interface AndPredicate<T extends ExprNode = ExprNode> extends PegParent, Expr {
  type: "andPredicate";
  children: [T];
}

export interface NotPredicate<T extends ExprNode = ExprNode> extends PegParent, Expr {
  type: "notPredicate";
  children: [T];
}

export interface ZeroOrMore<T extends ExprNode = ExprNode> extends PegParent, Expr {
  type: "zeroOrMore";
  children: [T];
}

export interface OneOrMore<T extends ExprNode = ExprNode> extends PegParent, Expr {
  type: "oneOrMore";
  children: [T];
}

export interface Group<T extends ExprNode = ExprNode> extends PegParent, Expr {
  type: "group";
  children: [T];
}

export interface Definition<
  I extends Identifier = Identifier,
  E extends ExprNode = ExprNode
> extends PegParent {
  type: "definition";
  children: [I, E];
}

export interface Grammar<T extends readonly Definition[] = Definition[]> extends PegParent {
  type: "grammar";
  children: [...T];
}

// Tagged union type for more type-safe Expr types
export type ExprNode =
  | Literal<string>
  | Identifier<string>
  | Sequence<readonly ExprNode[]>
  | Choice<readonly ExprNode[]>
  | Optional<ExprNode>
  | MapNode<ExprNode, unknown>
  | CharClass<readonly CharClassElement[]>
  | AnyChar
  | AndPredicate<ExprNode>
  | NotPredicate<ExprNode>
  | ZeroOrMore<ExprNode>
  | OneOrMore<ExprNode>
  | Group<ExprNode>;

// Union of all node types
export type PegAstNode =
  | ExprNode
  | Char<string>
  | Range<string, string>
  | Definition<Identifier<string>, ExprNode>
  | Grammar<readonly Definition<Identifier<string>, ExprNode>[]>;

// 型ガード関数
export const isLiteral = (node: PegAstNode): node is Literal<string> =>
  node.type === "literal";

export const isIdentifier = (node: PegAstNode): node is Identifier<string> =>
  node.type === "identifier";

export const isSequence = (node: PegAstNode): node is Sequence<readonly ExprNode[]> =>
  node.type === "sequence";

export const isChoice = (node: PegAstNode): node is Choice<readonly ExprNode[]> =>
  node.type === "choice";

export const isOptional = (node: PegAstNode): node is Optional<ExprNode> =>
  node.type === "optional";

export const isMap = (node: PegAstNode): node is MapNode<ExprNode, unknown> =>
  node.type === "map";

export const isCharClass = (node: PegAstNode): node is CharClass<readonly CharClassElement[]> =>
  node.type === "charClass";

export const isAnyChar = (node: PegAstNode): node is AnyChar =>
  node.type === "anyChar";

export const isAndPredicate = (node: PegAstNode): node is AndPredicate<ExprNode> =>
  node.type === "andPredicate";

export const isNotPredicate = (node: PegAstNode): node is NotPredicate<ExprNode> =>
  node.type === "notPredicate";

export const isZeroOrMore = (node: PegAstNode): node is ZeroOrMore<ExprNode> =>
  node.type === "zeroOrMore";

export const isOneOrMore = (node: PegAstNode): node is OneOrMore<ExprNode> =>
  node.type === "oneOrMore";

export const isGroup = (node: PegAstNode): node is Group<ExprNode> =>
  node.type === "group";

export const isChar = (node: PegAstNode): node is Char<string> =>
  node.type === "char";

export const isRange = (node: PegAstNode): node is Range<string, string> =>
  node.type === "range";

export const isDefinition = (node: PegAstNode): node is Definition<Identifier<string>, ExprNode> =>
  node.type === "definition";

export const isGrammar = (node: PegAstNode): node is Grammar<readonly Definition<Identifier<string>, ExprNode>[]> =>
  node.type === "grammar";

// Builder functions with improved type safety
export const literal = <T extends string>(value: T): Literal<T> => {
  return u("literal", { value }) as Literal<T>;
};

export const identifier = <T extends string>(value: T): Identifier<T> => {
  return u("identifier", { value }) as Identifier<T>;
};

export const sequence = <T extends readonly ExprNode[]>(...exprs: T): Sequence<T> => {
  return u("sequence", { children: [...exprs] }) as Sequence<T>;
};

export const choice = <T extends readonly ExprNode[]>(...exprs: T): Choice<T> => {
  return u("choice", { children: [...exprs] }) as Choice<T>;
};

export const optional = <T extends ExprNode>(expr: T): Optional<T> => {
  return u("optional", { children: [expr] }) as unknown as Optional<T>;
};

export const map = <T extends ExprNode, F>(expr: T, mapper: F): MapNode<T, F> => {
  return u("map", { children: [expr], data: { mapper } }) as unknown as MapNode<T, F>;
};

export const char = <T extends string>(value: T): Char<T> => {
  return u("char", { value }) as Char<T>;
};

export const range = <F extends string, T extends string>(from: F, to: T): Range<F, T> => {
  return u("range", { value: [from, to] }) as Range<F, T>;
};

export const charClass = <T extends readonly CharClassElement[]>(...elements: T): CharClass<T> => {
  return u("charClass", { children: [...elements] }) as CharClass<T>;
};

export const anyChar = (): AnyChar => {
  return u("anyChar", {}) as AnyChar;
};

export const andPredicate = <T extends ExprNode>(expr: T): AndPredicate<T> => {
  return u("andPredicate", { children: [expr] }) as unknown as AndPredicate<T>;
};

export const notPredicate = <T extends ExprNode>(expr: T): NotPredicate<T> => {
  return u("notPredicate", { children: [expr] }) as unknown as NotPredicate<T>;
};

export const zeroOrMore = <T extends ExprNode>(expr: T): ZeroOrMore<T> => {
  return u("zeroOrMore", { children: [expr] }) as ZeroOrMore<T>;
};

export const oneOrMore = <T extends ExprNode>(expr: T): OneOrMore<T> => {
  return u("oneOrMore", { children: [expr] }) as OneOrMore<T>;
};

export const group = <T extends ExprNode>(expr: T): Group<T> => {
  return u("group", { children: [expr] }) as Group<T>;
};

export const definition = <I extends string, E extends ExprNode>(id: I, expr: E): Definition<Identifier<I>, E> => {
  return u("definition", {
    children: [identifier(id), expr],
  }) as Definition<Identifier<I>, E>;
};

export const grammar = <T extends readonly Definition[]>(...definitions: T): Grammar<T> => {
  return u("grammar", {
    children: [...definitions],
  }) as Grammar<T>;
};


