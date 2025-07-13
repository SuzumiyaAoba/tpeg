import { u } from "unist-builder";

import type {
  Literal as UnistLiteral,
  Node as UnistNode,
  Parent as UnistParent,
} from "unist";

/**
 * Base interface for all PEG AST nodes.
 * Extends the unist Node interface to provide a foundation for PEG-specific nodes.
 */
export interface PegNode extends UnistNode {}

/**
 * Interface for PEG literal nodes.
 * Represents nodes that contain literal values like strings or characters.
 */
export interface PegLiteral extends UnistLiteral, PegNode {}

/**
 * Interface for PEG parent nodes.
 * Represents nodes that can contain other nodes as children.
 */
export interface PegParent extends UnistParent, PegNode {}

/**
 * Base interface for all PEG expression nodes.
 * All expression types in the PEG AST extend this interface.
 */
export interface Expr extends PegNode {}

/**
 * Represents a literal string in a PEG grammar.
 *
 * @template T - The string literal type
 * @property type - Always "literal"
 * @property value - The literal string value
 *
 * @example
 * ```typescript
 * const lit: Literal<"hello"> = {
 *   type: "literal",
 *   value: "hello"
 * };
 * ```
 */
export interface Literal<T extends string = string> extends PegLiteral, Expr {
  type: "literal";
  value: T;
}

/**
 * Represents an identifier (rule name) in a PEG grammar.
 *
 * @template T - The identifier string type
 * @property type - Always "identifier"
 * @property value - The identifier name
 *
 * @example
 * ```typescript
 * const id: Identifier<"digit"> = {
 *   type: "identifier",
 *   value: "digit"
 * };
 * ```
 */
export interface Identifier<T extends string = string>
  extends PegLiteral,
    Expr {
  type: "identifier";
  value: T;
}

/**
 * Represents a sequence of expressions in a PEG grammar.
 * All expressions in the sequence must match in order.
 *
 * @template T - The array of expression node types
 * @property type - Always "sequence"
 * @property children - Array of expressions that must match in sequence
 *
 * @example
 * ```typescript
 * const seq: Sequence<[Literal<"a">, Literal<"b">]> = {
 *   type: "sequence",
 *   children: [
 *     { type: "literal", value: "a" },
 *     { type: "literal", value: "b" }
 *   ]
 * };
 * ```
 */
export interface Sequence<T extends readonly ExprNode[] = ExprNode[]>
  extends PegParent,
    Expr {
  type: "sequence";
  children: [...T];
}

/**
 * Represents a choice between expressions in a PEG grammar.
 * The first matching expression in the choice is used.
 *
 * @template T - The array of expression node types
 * @property type - Always "choice"
 * @property children - Array of expressions to try in order
 *
 * @example
 * ```typescript
 * const ch: Choice<[Literal<"a">, Literal<"b">]> = {
 *   type: "choice",
 *   children: [
 *     { type: "literal", value: "a" },
 *     { type: "literal", value: "b" }
 *   ]
 * };
 * ```
 */
export interface Choice<T extends readonly ExprNode[] = ExprNode[]>
  extends PegParent,
    Expr {
  type: "choice";
  children: [...T];
}

/**
 * Represents an optional expression in a PEG grammar.
 * The expression may or may not match.
 *
 * @template T - The expression node type
 * @property type - Always "optional"
 * @property children - Single expression that is optional
 *
 * @example
 * ```typescript
 * const opt: Optional<Literal<"a">> = {
 *   type: "optional",
 *   children: [{ type: "literal", value: "a" }]
 * };
 * ```
 */
export interface Optional<T extends ExprNode = ExprNode>
  extends PegParent,
    Expr {
  type: "optional";
  children: [T];
}

/**
 * Represents a mapped expression in a PEG grammar.
 * The expression is parsed and then transformed by a mapper function.
 *
 * @template T - The expression node type
 * @template F - The mapper function type
 * @property type - Always "map"
 * @property children - Single expression to be mapped
 * @property data.mapper - The mapper function to transform the result
 *
 * @example
 * ```typescript
 * const mapped: MapNode<Literal<"123">, (val: string) => number> = {
 *   type: "map",
 *   children: [{ type: "literal", value: "123" }],
 *   data: { mapper: (val: string) => parseInt(val) }
 * };
 * ```
 */
export interface MapNode<T extends ExprNode = ExprNode, F = unknown>
  extends PegParent,
    Expr {
  type: "map";
  children: [T];
  data: {
    mapper: F;
  };
}

/**
 * Represents a single character in a character class.
 *
 * @template T - The character string type
 * @property type - Always "char"
 * @property value - The character value
 *
 * @example
 * ```typescript
 * const char: Char<"a"> = {
 *   type: "char",
 *   value: "a"
 * };
 * ```
 */
export interface Char<T extends string = string> extends PegLiteral {
  type: "char";
  value: T;
}

/**
 * Represents a character range in a character class.
 *
 * @template F - The from character string type
 * @template T - The to character string type
 * @property type - Always "range"
 * @property value - Tuple of [from, to] characters
 *
 * @example
 * ```typescript
 * const range: Range<"a", "z"> = {
 *   type: "range",
 *   value: ["a", "z"]
 * };
 * ```
 */
export interface Range<F extends string = string, T extends string = string>
  extends PegLiteral {
  type: "range";
  value: [F, T];
}

/**
 * Union type for character class elements.
 * Can be either a single character or a character range.
 */
export type CharClassElement = Char<string> | Range<string, string>;

/**
 * Represents a character class in a PEG grammar.
 * Matches any character that falls within the specified ranges or characters.
 *
 * @template T - The array of character class element types
 * @property type - Always "charClass"
 * @property children - Array of character class elements
 *
 * @example
 * ```typescript
 * const cc: CharClass<[Char<"a">, Range<"0", "9">]> = {
 *   type: "charClass",
 *   children: [
 *     { type: "char", value: "a" },
 *     { type: "range", value: ["0", "9"] }
 *   ]
 * };
 * ```
 */
export interface CharClass<
  T extends readonly CharClassElement[] = CharClassElement[],
> extends PegParent,
    Expr {
  type: "charClass";
  children: [...T];
}

/**
 * Represents the "any character" expression in a PEG grammar.
 * Matches any single character from the input.
 *
 * @property type - Always "anyChar"
 *
 * @example
 * ```typescript
 * const any: AnyChar = {
 *   type: "anyChar"
 * };
 * ```
 */
export interface AnyChar extends PegNode, Expr {
  type: "anyChar";
}

/**
 * Represents a positive lookahead predicate in a PEG grammar.
 * The expression must match but is not consumed from the input.
 *
 * @template T - The expression node type
 * @property type - Always "andPredicate"
 * @property children - Single expression to check
 *
 * @example
 * ```typescript
 * const pred: AndPredicate<Literal<"a">> = {
 *   type: "andPredicate",
 *   children: [{ type: "literal", value: "a" }]
 * };
 * ```
 */
export interface AndPredicate<T extends ExprNode = ExprNode>
  extends PegParent,
    Expr {
  type: "andPredicate";
  children: [T];
}

/**
 * Represents a negative lookahead predicate in a PEG grammar.
 * The expression must not match for the predicate to succeed.
 *
 * @template T - The expression node type
 * @property type - Always "notPredicate"
 * @property children - Single expression to check
 *
 * @example
 * ```typescript
 * const pred: NotPredicate<Literal<"a">> = {
 *   type: "notPredicate",
 *   children: [{ type: "literal", value: "a" }]
 * };
 * ```
 */
export interface NotPredicate<T extends ExprNode = ExprNode>
  extends PegParent,
    Expr {
  type: "notPredicate";
  children: [T];
}

/**
 * Represents a zero-or-more repetition in a PEG grammar.
 * The expression may match zero or more times.
 *
 * @template T - The expression node type
 * @property type - Always "zeroOrMore"
 * @property children - Single expression to repeat
 *
 * @example
 * ```typescript
 * const rep: ZeroOrMore<Literal<"a">> = {
 *   type: "zeroOrMore",
 *   children: [{ type: "literal", value: "a" }]
 * };
 * ```
 */
export interface ZeroOrMore<T extends ExprNode = ExprNode>
  extends PegParent,
    Expr {
  type: "zeroOrMore";
  children: [T];
}

/**
 * Represents a one-or-more repetition in a PEG grammar.
 * The expression must match at least once.
 *
 * @template T - The expression node type
 * @property type - Always "oneOrMore"
 * @property children - Single expression to repeat
 *
 * @example
 * ```typescript
 * const rep: OneOrMore<Literal<"a">> = {
 *   type: "oneOrMore",
 *   children: [{ type: "literal", value: "a" }]
 * };
 * ```
 */
export interface OneOrMore<T extends ExprNode = ExprNode>
  extends PegParent,
    Expr {
  type: "oneOrMore";
  children: [T];
}

/**
 * Represents a grouped expression in a PEG grammar.
 * Used to control precedence and grouping of expressions.
 *
 * @template T - The expression node type
 * @property type - Always "group"
 * @property children - Single expression in the group
 *
 * @example
 * ```typescript
 * const grp: Group<Choice<[Literal<"a">, Literal<"b">]>> = {
 *   type: "group",
 *   children: [{
 *     type: "choice",
 *     children: [
 *       { type: "literal", value: "a" },
 *       { type: "literal", value: "b" }
 *     ]
 *   }]
 * };
 * ```
 */
export interface Group<T extends ExprNode = ExprNode> extends PegParent, Expr {
  type: "group";
  children: [T];
}

/**
 * Represents a rule definition in a PEG grammar.
 * Associates an identifier with an expression.
 *
 * @template I - The identifier type
 * @template E - The expression type
 * @property type - Always "definition"
 * @property children - Tuple of [identifier, expression]
 *
 * @example
 * ```typescript
 * const def: Definition<Identifier<"digit">, CharClass<[Range<"0", "9">]>> = {
 *   type: "definition",
 *   children: [
 *     { type: "identifier", value: "digit" },
 *     { type: "charClass", children: [{ type: "range", value: ["0", "9"] }] }
 *   ]
 * };
 * ```
 */
export interface Definition<
  I extends Identifier = Identifier,
  E extends ExprNode = ExprNode,
> extends PegParent {
  type: "definition";
  children: [I, E];
}

/**
 * Represents a complete PEG grammar.
 * Contains a collection of rule definitions.
 *
 * @template T - The array of definition types
 * @property type - Always "grammar"
 * @property children - Array of rule definitions
 *
 * @example
 * ```typescript
 * const grammar: Grammar<[Definition<Identifier<"digit">, CharClass<[Range<"0", "9">]>]> = {
 *   type: "grammar",
 *   children: [{
 *     type: "definition",
 *     children: [
 *       { type: "identifier", value: "digit" },
 *       { type: "charClass", children: [{ type: "range", value: ["0", "9"] }] }
 *     ]
 *   }]
 * };
 * ```
 */
export interface Grammar<T extends readonly Definition[] = Definition[]>
  extends PegParent {
  type: "grammar";
  children: [...T];
}

/**
 * Tagged union type for all expression node types.
 * Provides type safety when working with different expression types.
 */
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

/**
 * Union of all PEG AST node types.
 * Includes all expression types, character class elements, and grammar structures.
 */
export type PegAstNode =
  | ExprNode
  | Char<string>
  | Range<string, string>
  | Definition<Identifier<string>, ExprNode>
  | Grammar<readonly Definition<Identifier<string>, ExprNode>[]>;

/**
 * Type guard function to check if a node is a Literal.
 *
 * @param node - The node to check
 * @returns True if the node is a Literal, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = { type: "literal", value: "hello" };
 * if (isLiteral(node)) {
 *   console.log(node.value); // "hello"
 * }
 * ```
 */
export const isLiteral = (node: PegAstNode): node is Literal<string> =>
  node.type === "literal";

/**
 * Type guard function to check if a node is an Identifier.
 *
 * @param node - The node to check
 * @returns True if the node is an Identifier, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = { type: "identifier", value: "digit" };
 * if (isIdentifier(node)) {
 *   console.log(node.value); // "digit"
 * }
 * ```
 */
export const isIdentifier = (node: PegAstNode): node is Identifier<string> =>
  node.type === "identifier";

/**
 * Type guard function to check if a node is a Sequence.
 *
 * @param node - The node to check
 * @returns True if the node is a Sequence, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = {
 *   type: "sequence",
 *   children: [
 *     { type: "literal", value: "a" },
 *     { type: "literal", value: "b" }
 *   ]
 * };
 * if (isSequence(node)) {
 *   console.log(node.children.length); // 2
 * }
 * ```
 */
export const isSequence = (
  node: PegAstNode,
): node is Sequence<readonly ExprNode[]> => node.type === "sequence";

/**
 * Type guard function to check if a node is a Choice.
 *
 * @param node - The node to check
 * @returns True if the node is a Choice, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = {
 *   type: "choice",
 *   children: [
 *     { type: "literal", value: "a" },
 *     { type: "literal", value: "b" }
 *   ]
 * };
 * if (isChoice(node)) {
 *   console.log(node.children.length); // 2
 * }
 * ```
 */
export const isChoice = (
  node: PegAstNode,
): node is Choice<readonly ExprNode[]> => node.type === "choice";

/**
 * Type guard function to check if a node is an Optional.
 *
 * @param node - The node to check
 * @returns True if the node is an Optional, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = {
 *   type: "optional",
 *   children: [{ type: "literal", value: "a" }]
 * };
 * if (isOptional(node)) {
 *   console.log(node.children[0].value); // "a"
 * }
 * ```
 */
export const isOptional = (node: PegAstNode): node is Optional<ExprNode> =>
  node.type === "optional";

/**
 * Type guard function to check if a node is a MapNode.
 *
 * @param node - The node to check
 * @returns True if the node is a MapNode, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = {
 *   type: "map",
 *   children: [{ type: "literal", value: "123" }],
 *   data: { mapper: (val: string) => parseInt(val) }
 * };
 * if (isMap(node)) {
 *   console.log(typeof node.data.mapper); // "function"
 * }
 * ```
 */
export const isMap = (node: PegAstNode): node is MapNode<ExprNode, unknown> =>
  node.type === "map";

/**
 * Type guard function to check if a node is a CharClass.
 *
 * @param node - The node to check
 * @returns True if the node is a CharClass, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = {
 *   type: "charClass",
 *   children: [
 *     { type: "char", value: "a" },
 *     { type: "range", value: ["0", "9"] }
 *   ]
 * };
 * if (isCharClass(node)) {
 *   console.log(node.children.length); // 2
 * }
 * ```
 */
export const isCharClass = (
  node: PegAstNode,
): node is CharClass<readonly CharClassElement[]> => node.type === "charClass";

/**
 * Type guard function to check if a node is an AnyChar.
 *
 * @param node - The node to check
 * @returns True if the node is an AnyChar, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = { type: "anyChar" };
 * if (isAnyChar(node)) {
 *   console.log(node.type); // "anyChar"
 * }
 * ```
 */
export const isAnyChar = (node: PegAstNode): node is AnyChar =>
  node.type === "anyChar";

/**
 * Type guard function to check if a node is an AndPredicate.
 *
 * @param node - The node to check
 * @returns True if the node is an AndPredicate, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = {
 *   type: "andPredicate",
 *   children: [{ type: "literal", value: "a" }]
 * };
 * if (isAndPredicate(node)) {
 *   console.log(node.children[0].value); // "a"
 * }
 * ```
 */
export const isAndPredicate = (
  node: PegAstNode,
): node is AndPredicate<ExprNode> => node.type === "andPredicate";

/**
 * Type guard function to check if a node is a NotPredicate.
 *
 * @param node - The node to check
 * @returns True if the node is a NotPredicate, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = {
 *   type: "notPredicate",
 *   children: [{ type: "literal", value: "a" }]
 * };
 * if (isNotPredicate(node)) {
 *   console.log(node.children[0].value); // "a"
 * }
 * ```
 */
export const isNotPredicate = (
  node: PegAstNode,
): node is NotPredicate<ExprNode> => node.type === "notPredicate";

/**
 * Type guard function to check if a node is a ZeroOrMore.
 *
 * @param node - The node to check
 * @returns True if the node is a ZeroOrMore, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = {
 *   type: "zeroOrMore",
 *   children: [{ type: "literal", value: "a" }]
 * };
 * if (isZeroOrMore(node)) {
 *   console.log(node.children[0].value); // "a"
 * }
 * ```
 */
export const isZeroOrMore = (node: PegAstNode): node is ZeroOrMore<ExprNode> =>
  node.type === "zeroOrMore";

/**
 * Type guard function to check if a node is a OneOrMore.
 *
 * @param node - The node to check
 * @returns True if the node is a OneOrMore, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = {
 *   type: "oneOrMore",
 *   children: [{ type: "literal", value: "a" }]
 * };
 * if (isOneOrMore(node)) {
 *   console.log(node.children[0].value); // "a"
 * }
 * ```
 */
export const isOneOrMore = (node: PegAstNode): node is OneOrMore<ExprNode> =>
  node.type === "oneOrMore";

/**
 * Type guard function to check if a node is a Group.
 *
 * @param node - The node to check
 * @returns True if the node is a Group, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = {
 *   type: "group",
 *   children: [{ type: "literal", value: "a" }]
 * };
 * if (isGroup(node)) {
 *   console.log(node.children[0].value); // "a"
 * }
 * ```
 */
export const isGroup = (node: PegAstNode): node is Group<ExprNode> =>
  node.type === "group";

/**
 * Type guard function to check if a node is a Char.
 *
 * @param node - The node to check
 * @returns True if the node is a Char, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = { type: "char", value: "a" };
 * if (isChar(node)) {
 *   console.log(node.value); // "a"
 * }
 * ```
 */
export const isChar = (node: PegAstNode): node is Char<string> =>
  node.type === "char";

/**
 * Type guard function to check if a node is a Range.
 *
 * @param node - The node to check
 * @returns True if the node is a Range, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = { type: "range", value: ["a", "z"] };
 * if (isRange(node)) {
 *   console.log(node.value[0], node.value[1]); // "a", "z"
 * }
 * ```
 */
export const isRange = (node: PegAstNode): node is Range<string, string> =>
  node.type === "range";

/**
 * Type guard function to check if a node is a Definition.
 *
 * @param node - The node to check
 * @returns True if the node is a Definition, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = {
 *   type: "definition",
 *   children: [
 *     { type: "identifier", value: "digit" },
 *     { type: "charClass", children: [{ type: "range", value: ["0", "9"] }] }
 *   ]
 * };
 * if (isDefinition(node)) {
 *   console.log(node.children[0].value); // "digit"
 * }
 * ```
 */
export const isDefinition = (
  node: PegAstNode,
): node is Definition<Identifier<string>, ExprNode> =>
  node.type === "definition";

/**
 * Type guard function to check if a node is a Grammar.
 *
 * @param node - The node to check
 * @returns True if the node is a Grammar, false otherwise
 *
 * @example
 * ```typescript
 * const node: PegAstNode = {
 *   type: "grammar",
 *   children: [{
 *     type: "definition",
 *     children: [
 *       { type: "identifier", value: "digit" },
 *       { type: "charClass", children: [{ type: "range", value: ["0", "9"] }] }
 *     ]
 *   }]
 * };
 * if (isGrammar(node)) {
 *   console.log(node.children.length); // 1
 * }
 * ```
 */
export const isGrammar = (
  node: PegAstNode,
): node is Grammar<readonly Definition<Identifier<string>, ExprNode>[]> =>
  node.type === "grammar";

/**
 * Creates a literal node with the specified value.
 *
 * @template T - The string literal type
 * @param value - The literal string value
 * @returns A Literal node with the specified value
 *
 * @example
 * ```typescript
 * const lit = literal("hello");
 * // { type: "literal", value: "hello" }
 * ```
 */
export const literal = <T extends string>(value: T): Literal<T> => {
  return u("literal", { value }) as Literal<T>;
};

/**
 * Creates an identifier node with the specified value.
 *
 * @template T - The string literal type
 * @param value - The identifier name
 * @returns An Identifier node with the specified value
 *
 * @example
 * ```typescript
 * const id = identifier("digit");
 * // { type: "identifier", value: "digit" }
 * ```
 */
export const identifier = <T extends string>(value: T): Identifier<T> => {
  return u("identifier", { value }) as Identifier<T>;
};

/**
 * Creates a sequence node with the specified expressions.
 *
 * @template T - The array of expression node types
 * @param exprs - The expressions to sequence
 * @returns A Sequence node containing the expressions
 *
 * @example
 * ```typescript
 * const seq = sequence(
 *   literal("a"),
 *   literal("b")
 * );
 * // { type: "sequence", children: [{ type: "literal", value: "a" }, { type: "literal", value: "b" }] }
 * ```
 */
export const sequence = <T extends readonly ExprNode[]>(
  ...exprs: T
): Sequence<T> => {
  return u("sequence", { children: [...exprs] }) as Sequence<T>;
};

/**
 * Creates a choice node with the specified expressions.
 *
 * @template T - The array of expression node types
 * @param exprs - The expressions to choose from
 * @returns A Choice node containing the expressions
 *
 * @example
 * ```typescript
 * const ch = choice(
 *   literal("a"),
 *   literal("b")
 * );
 * // { type: "choice", children: [{ type: "literal", value: "a" }, { type: "literal", value: "b" }] }
 * ```
 */
export const choice = <T extends readonly ExprNode[]>(
  ...exprs: T
): Choice<T> => {
  return u("choice", { children: [...exprs] }) as Choice<T>;
};

/**
 * Creates an optional node with the specified expression.
 *
 * @template T - The expression node type
 * @param expr - The expression to make optional
 * @returns An Optional node containing the expression
 *
 * @example
 * ```typescript
 * const opt = optional(literal("a"));
 * // { type: "optional", children: [{ type: "literal", value: "a" }] }
 * ```
 */
export const optional = <T extends ExprNode>(expr: T): Optional<T> => {
  return u("optional", [expr]) as Optional<T>;
};

/**
 * Creates a map node with the specified expression and mapper.
 *
 * @template T - The expression node type
 * @template F - The mapper function type
 * @param expr - The expression to map
 * @param mapper - The mapper function
 * @returns A MapNode containing the expression and mapper
 *
 * @example
 * ```typescript
 * const mapped = map(
 *   literal("123"),
 *   (val: string) => parseInt(val)
 * );
 * // { type: "map", children: [{ type: "literal", value: "123" }], data: { mapper: (val: string) => parseInt(val) } }
 * ```
 */
export const map = <T extends ExprNode, F>(
  expr: T,
  mapper: F,
): MapNode<T, F> => {
  return u("map", { children: [expr], data: { mapper } }) as unknown as MapNode<
    T,
    F
  >;
};

/**
 * Creates a char node with the specified value.
 *
 * @template T - The string literal type
 * @param value - The character value
 * @returns A Char node with the specified value
 *
 * @example
 * ```typescript
 * const ch = char("a");
 * // { type: "char", value: "a" }
 * ```
 */
export const char = <T extends string>(value: T): Char<T> => {
  return u("char", { value }) as Char<T>;
};

/**
 * Creates a range node with the specified from and to values.
 *
 * @template F - The from character string type
 * @template T - The to character string type
 * @param from - The starting character
 * @param to - The ending character
 * @returns A Range node with the specified range
 *
 * @example
 * ```typescript
 * const range = range("a", "z");
 * // { type: "range", value: ["a", "z"] }
 * ```
 */
export const range = <F extends string, T extends string>(
  from: F,
  to: T,
): Range<F, T> => {
  return u("range", { value: [from, to] }) as Range<F, T>;
};

/**
 * Creates a charClass node with the specified elements.
 *
 * @template T - The array of character class element types
 * @param elements - The character class elements
 * @returns A CharClass node containing the elements
 *
 * @example
 * ```typescript
 * const cc = charClass(
 *   char("a"),
 *   range("0", "9")
 * );
 * // { type: "charClass", children: [{ type: "char", value: "a" }, { type: "range", value: ["0", "9"] }] }
 * ```
 */
export const charClass = <T extends readonly CharClassElement[]>(
  ...elements: T
): CharClass<T> => {
  return u("charClass", { children: [...elements] }) as CharClass<T>;
};

/**
 * Creates an anyChar node.
 *
 * @returns An AnyChar node
 *
 * @example
 * ```typescript
 * const any = anyChar();
 * // { type: "anyChar" }
 * ```
 */
export const anyChar = (): AnyChar => {
  return u("anyChar") as AnyChar;
};

/**
 * Creates an andPredicate node with the specified expression.
 *
 * @template T - The expression node type
 * @param expr - The expression to check
 * @returns An AndPredicate node containing the expression
 *
 * @example
 * ```typescript
 * const pred = andPredicate(literal("a"));
 * // { type: "andPredicate", children: [{ type: "literal", value: "a" }] }
 * ```
 */
export const andPredicate = <T extends ExprNode>(expr: T): AndPredicate<T> => {
  return u("andPredicate", [expr]) as AndPredicate<T>;
};

/**
 * Creates a notPredicate node with the specified expression.
 *
 * @template T - The expression node type
 * @param expr - The expression to check
 * @returns A NotPredicate node containing the expression
 *
 * @example
 * ```typescript
 * const pred = notPredicate(literal("a"));
 * // { type: "notPredicate", children: [{ type: "literal", value: "a" }] }
 * ```
 */
export const notPredicate = <T extends ExprNode>(expr: T): NotPredicate<T> => {
  return u("notPredicate", [expr]) as NotPredicate<T>;
};

/**
 * Creates a zeroOrMore node with the specified expression.
 *
 * @template T - The expression node type
 * @param expr - The expression to repeat
 * @returns A ZeroOrMore node containing the expression
 *
 * @example
 * ```typescript
 * const rep = zeroOrMore(literal("a"));
 * // { type: "zeroOrMore", children: [{ type: "literal", value: "a" }] }
 * ```
 */
export const zeroOrMore = <T extends ExprNode>(expr: T): ZeroOrMore<T> => {
  return u("zeroOrMore", [expr]) as ZeroOrMore<T>;
};

/**
 * Creates a oneOrMore node with the specified expression.
 *
 * @template T - The expression node type
 * @param expr - The expression to repeat
 * @returns A OneOrMore node containing the expression
 *
 * @example
 * ```typescript
 * const rep = oneOrMore(literal("a"));
 * // { type: "oneOrMore", children: [{ type: "literal", value: "a" }] }
 * ```
 */
export const oneOrMore = <T extends ExprNode>(expr: T): OneOrMore<T> => {
  return u("oneOrMore", [expr]) as OneOrMore<T>;
};

/**
 * Creates a group node with the specified expression.
 *
 * @template T - The expression node type
 * @param expr - The expression to group
 * @returns A Group node containing the expression
 *
 * @example
 * ```typescript
 * const grp = group(choice(literal("a"), literal("b")));
 * // { type: "group", children: [{ type: "choice", children: [{ type: "literal", value: "a" }, { type: "literal", value: "b" }] }] }
 * ```
 */
export const group = <T extends ExprNode>(expr: T): Group<T> => {
  return u("group", [expr]) as Group<T>;
};

/**
 * Creates a definition node with the specified identifier and expression.
 *
 * @template I - The identifier string type
 * @template E - The expression node type
 * @param id - The identifier name
 * @param expr - The expression to associate with the identifier
 * @returns A Definition node containing the identifier and expression
 *
 * @example
 * ```typescript
 * const def = definition("digit", charClass(range("0", "9")));
 * // { type: "definition", children: [{ type: "identifier", value: "digit" }, { type: "charClass", children: [{ type: "range", value: ["0", "9"] }] }] }
 * ```
 */
export const definition = <I extends string, E extends ExprNode>(
  id: I,
  expr: E,
): Definition<Identifier<I>, E> => {
  return u("definition", [identifier(id), expr]) as Definition<
    Identifier<I>,
    E
  >;
};

/**
 * Creates a grammar node with the specified definitions.
 *
 * @template T - The array of definition types
 * @param definitions - The rule definitions
 * @returns A Grammar node containing the definitions
 *
 * @example
 * ```typescript
 * const grammar = grammar(
 *   definition("digit", charClass(range("0", "9"))),
 *   definition("letter", charClass(range("a", "z"), range("A", "Z")))
 * );
 * // { type: "grammar", children: [...] }
 * ```
 */
export const grammar = <T extends readonly Definition[]>(
  ...definitions: T
): Grammar<T> => {
  return u("grammar", { children: [...definitions] }) as Grammar<T>;
};
