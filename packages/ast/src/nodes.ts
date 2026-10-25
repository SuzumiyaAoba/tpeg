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
  extends PegLiteral, Expr {
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
  extends PegParent, Expr {
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
  extends PegParent, Expr {
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
  extends PegParent, Expr {
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
  extends PegParent, Expr {
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
export interface Range<
  F extends string = string,
  T extends string = string,
> extends PegLiteral {
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
>
  extends PegParent, Expr {
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
  extends PegParent, Expr {
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
  extends PegParent, Expr {
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
  extends PegParent, Expr {
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
  extends PegParent, Expr {
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
export interface Grammar<
  T extends readonly Definition[] = Definition[],
> extends PegParent {
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
