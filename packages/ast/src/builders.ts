import type {
  AndPredicate,
  AnyChar,
  Char,
  CharClass,
  CharClassElement,
  Choice,
  Definition,
  ExprNode,
  Grammar,
  Group,
  Identifier,
  Literal,
  MapNode,
  NotPredicate,
  OneOrMore,
  Optional,
  Range,
  Sequence,
  ZeroOrMore,
} from "./nodes";

/**
 * Builds a constructor for a "wraps one child expression" node shape
 * (`{ type, children: [expr] }`) -- shared by `optional`, `andPredicate`,
 * `notPredicate`, `zeroOrMore`, `oneOrMore`, and `group` below, which
 * differ only in their `type` tag.
 */
const createUnaryExprNode =
  <Tag extends string>(type: Tag) =>
  <T extends ExprNode>(expr: T): { type: Tag; children: [T] } => ({
    type,
    children: [expr],
  });

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
export const literal = <T extends string>(value: T): Literal<T> => ({
  type: "literal",
  value,
});

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
export const identifier = <T extends string>(value: T): Identifier<T> => ({
  type: "identifier",
  value,
});

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
): Sequence<T> => ({
  type: "sequence",
  children: [...exprs],
});

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
): Choice<T> => ({
  type: "choice",
  children: [...exprs],
});

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
export const optional: <T extends ExprNode>(expr: T) => Optional<T> =
  createUnaryExprNode("optional");

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
): MapNode<T, F> => ({
  type: "map",
  children: [expr],
  data: { mapper },
});

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
export const char = <T extends string>(value: T): Char<T> => ({
  type: "char",
  value,
});

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
): Range<F, T> => ({
  type: "range",
  value: [from, to],
});

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
): CharClass<T> => ({
  type: "charClass",
  children: [...elements],
});

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
export const anyChar = (): AnyChar => ({ type: "anyChar" });

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
export const andPredicate: <T extends ExprNode>(expr: T) => AndPredicate<T> =
  createUnaryExprNode("andPredicate");

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
export const notPredicate: <T extends ExprNode>(expr: T) => NotPredicate<T> =
  createUnaryExprNode("notPredicate");

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
export const zeroOrMore: <T extends ExprNode>(expr: T) => ZeroOrMore<T> =
  createUnaryExprNode("zeroOrMore");

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
export const oneOrMore: <T extends ExprNode>(expr: T) => OneOrMore<T> =
  createUnaryExprNode("oneOrMore");

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
export const group: <T extends ExprNode>(expr: T) => Group<T> =
  createUnaryExprNode("group");

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
): Definition<Identifier<I>, E> => ({
  type: "definition",
  children: [identifier(id), expr],
});

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
): Grammar<T> => ({
  type: "grammar",
  children: [...definitions],
});
