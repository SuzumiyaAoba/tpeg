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
  PegAstNode,
  Range,
  Sequence,
  ZeroOrMore,
} from "./nodes";

/**
 * Builds a type guard for a specific AST node `type` tag. Every `isX`
 * guard below differs only in which tag it checks and which node type it
 * narrows to, so that mechanical variation is factored out here rather
 * than hand-duplicated across all of them.
 */
const createTypeGuard =
  <T extends PegAstNode>(type: T["type"]) =>
  (node: PegAstNode): node is T =>
    node.type === type;

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
export const isLiteral = createTypeGuard<Literal<string>>("literal");

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
export const isIdentifier = createTypeGuard<Identifier<string>>("identifier");

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
export const isSequence =
  createTypeGuard<Sequence<readonly ExprNode[]>>("sequence");

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
export const isChoice = createTypeGuard<Choice<readonly ExprNode[]>>("choice");

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
export const isOptional = createTypeGuard<Optional<ExprNode>>("optional");

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
export const isMap = createTypeGuard<MapNode<ExprNode, unknown>>("map");

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
export const isCharClass =
  createTypeGuard<CharClass<readonly CharClassElement[]>>("charClass");

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
export const isAnyChar = createTypeGuard<AnyChar>("anyChar");

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
export const isAndPredicate =
  createTypeGuard<AndPredicate<ExprNode>>("andPredicate");

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
export const isNotPredicate =
  createTypeGuard<NotPredicate<ExprNode>>("notPredicate");

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
export const isZeroOrMore = createTypeGuard<ZeroOrMore<ExprNode>>("zeroOrMore");

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
export const isOneOrMore = createTypeGuard<OneOrMore<ExprNode>>("oneOrMore");

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
export const isGroup = createTypeGuard<Group<ExprNode>>("group");

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
export const isChar = createTypeGuard<Char<string>>("char");

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
export const isRange = createTypeGuard<Range<string, string>>("range");

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
export const isDefinition =
  createTypeGuard<Definition<Identifier<string>, ExprNode>>("definition");

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
export const isGrammar =
  createTypeGuard<Grammar<readonly Definition<Identifier<string>, ExprNode>[]>>(
    "grammar",
  );
