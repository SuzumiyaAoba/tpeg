import type { Pos } from "@SuzumiyaAoba/core";

/**
 * Base interface for all AST nodes with position information.
 *
 * All AST nodes in the PEG parser extend this interface to include
 * position information for error reporting and debugging.
 */
export interface BaseNode {
  pos: Pos;
}

/**
 * Type representing all possible expression types in the PEG AST.
 */
export type ExprType = Expr["type"];

/**
 * Union type representing all possible expression nodes in the PEG AST.
 *
 * This includes all basic expressions like sequences, choices, and literals,
 * as well as more complex expressions like predicates and repetitions.
 */
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

/**
 * Represents a sequence of expressions that must match in order.
 *
 * @property type - Always "Sequence"
 * @property value - Array of expressions that must match in sequence
 */
export type Sequence = BaseNode & {
  type: "Sequence";
  value: readonly Expr[];
};

/**
 * Represents a choice between expressions (ordered choice).
 *
 * @property type - Always "Choice"
 * @property value - Array of expressions to try in order
 */
export type Choice = BaseNode & {
  type: "Choice";
  value: readonly Expr[];
};

/**
 * Represents an optional expression that may or may not match.
 *
 * @property type - Always "Optional"
 * @property value - The expression that is optional
 */
export type Optional = BaseNode & {
  type: "Optional";
  value: Expr;
};

/**
 * Represents a positive lookahead predicate.
 *
 * @property type - Always "AndPredicate"
 * @property value - The expression to check without consuming
 */
export type AndPredicate = BaseNode & {
  type: "AndPredicate";
  value: Expr;
};

/**
 * Represents a negative lookahead predicate.
 *
 * @property type - Always "NotPredicate"
 * @property value - The expression that must not match
 */
export type NotPredicate = BaseNode & {
  type: "NotPredicate";
  value: Expr;
};

/**
 * Represents a zero-or-more repetition.
 *
 * @property type - Always "ZeroOrMore"
 * @property value - The expression to repeat zero or more times
 */
export type ZeroOrMore = BaseNode & {
  type: "ZeroOrMore";
  value: Expr;
};

/**
 * Represents a one-or-more repetition.
 *
 * @property type - Always "OneOrMore"
 * @property value - The expression to repeat one or more times
 */
export type OneOrMore = BaseNode & {
  type: "OneOrMore";
  value: Expr;
};

/**
 * Represents the "any character" expression.
 *
 * @property type - Always "AnyChar"
 */
export type AnyChar = BaseNode & {
  type: "AnyChar";
};

/**
 * Represents an identifier (rule name).
 *
 * @property type - Always "Identifier"
 * @property value - The identifier name
 */
export type Identifier = BaseNode & {
  type: "Identifier";
  value: string;
};

/**
 * Represents a literal string.
 *
 * @property type - Always "Literal"
 * @property value - The literal string value
 */
export type Literal = BaseNode & {
  type: "Literal";
  value: string;
};

/**
 * Represents a character class.
 *
 * @property type - Always "CharClass"
 * @property value - Array of characters or character ranges
 */
export type CharClass = BaseNode & {
  type: "CharClass";
  value: (string | readonly [string, string])[];
};

/**
 * Represents a rule definition.
 *
 * @property type - Always "Definition"
 * @property name - The rule name
 * @property expr - The rule's expression
 */
export type Definition = BaseNode & {
  type: "Definition";
  name: string;
  expr: Expr;
};

/**
 * Represents a complete grammar.
 *
 * @property type - Always "Grammar"
 * @property value - Array of rule definitions
 */
export type Grammar = BaseNode & {
  type: "Grammar";
  value: readonly Definition[];
};

// Type guard functions for runtime type checking

/**
 * Type guard to check if an expression is a Sequence.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Sequence
 */
export const isSequence = (expr: Expr): expr is Sequence =>
  expr.type === "Sequence";

/**
 * Type guard to check if an expression is a Choice.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Choice
 */
export const isChoice = (expr: Expr): expr is Choice => expr.type === "Choice";

/**
 * Type guard to check if an expression is an Optional.
 *
 * @param expr - The expression to check
 * @returns True if the expression is an Optional
 */
export const isOptional = (expr: Expr): expr is Optional =>
  expr.type === "Optional";

/**
 * Type guard to check if an expression is an AndPredicate.
 *
 * @param expr - The expression to check
 * @returns True if the expression is an AndPredicate
 */
export const isAndPredicate = (expr: Expr): expr is AndPredicate =>
  expr.type === "AndPredicate";

/**
 * Type guard to check if an expression is a NotPredicate.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a NotPredicate
 */
export const isNotPredicate = (expr: Expr): expr is NotPredicate =>
  expr.type === "NotPredicate";

/**
 * Type guard to check if an expression is a ZeroOrMore.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a ZeroOrMore
 */
export const isZeroOrMore = (expr: Expr): expr is ZeroOrMore =>
  expr.type === "ZeroOrMore";

/**
 * Type guard to check if an expression is a OneOrMore.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a OneOrMore
 */
export const isOneOrMore = (expr: Expr): expr is OneOrMore =>
  expr.type === "OneOrMore";

/**
 * Type guard to check if an expression is an AnyChar.
 *
 * @param expr - The expression to check
 * @returns True if the expression is an AnyChar
 */
export const isAnyChar = (expr: Expr): expr is AnyChar =>
  expr.type === "AnyChar";

/**
 * Type guard to check if an expression is an Identifier.
 *
 * @param expr - The expression to check
 * @returns True if the expression is an Identifier
 */
export const isIdentifier = (expr: Expr): expr is Identifier =>
  expr.type === "Identifier";

/**
 * Type guard to check if an expression is a Literal.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Literal
 */
export const isLiteral = (expr: Expr): expr is Literal =>
  expr.type === "Literal";

/**
 * Type guard to check if an expression is a CharClass.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a CharClass
 */
export const isCharClass = (expr: Expr): expr is CharClass =>
  expr.type === "CharClass";

/**
 * Type guard to check if an expression is a Definition.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Definition
 */
export const isDefinition = (expr: Expr): expr is Definition =>
  expr.type === "Definition";

/**
 * Type guard to check if an expression is a Grammar.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Grammar
 */
export const isGrammar = (expr: Expr): expr is Grammar =>
  expr.type === "Grammar";

// Helper function to create AST nodes with position information

/**
 * Creates an AST node with the specified type, position, and properties.
 *
 * This helper function ensures all AST nodes have consistent structure
 * with proper type information and position data.
 *
 * @template T - The specific expression type
 * @param type - The node type
 * @param pos - The position information
 * @param props - Additional properties for the node
 * @returns A properly typed AST node
 *
 * @example
 * ```typescript
 * const node = createNode("Literal", pos, { value: "hello" });
 * // Returns: { type: "Literal", pos: pos, value: "hello" }
 * ```
 */
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
