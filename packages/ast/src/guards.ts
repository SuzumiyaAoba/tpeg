import type { PegAstNode } from "./nodes";

/** Narrow the tag while preserving the caller's value, children and metadata types. */
const createTypeGuard =
  <Tag extends PegAstNode["type"]>(type: Tag) =>
  <Node extends PegAstNode>(node: Node): node is Node & { type: Tag } =>
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
export const isLiteral = createTypeGuard("literal");

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
export const isIdentifier = createTypeGuard("identifier");

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
export const isSequence = createTypeGuard("sequence");

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
export const isChoice = createTypeGuard("choice");

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
export const isOptional = createTypeGuard("optional");

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
export const isMap = createTypeGuard("map");

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
export const isCharClass = createTypeGuard("charClass");

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
export const isAnyChar = createTypeGuard("anyChar");

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
export const isAndPredicate = createTypeGuard("andPredicate");

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
export const isNotPredicate = createTypeGuard("notPredicate");

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
export const isZeroOrMore = createTypeGuard("zeroOrMore");

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
export const isOneOrMore = createTypeGuard("oneOrMore");

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
export const isGroup = createTypeGuard("group");

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
export const isChar = createTypeGuard("char");

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
export const isRange = createTypeGuard("range");

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
export const isDefinition = createTypeGuard("definition");

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
export const isGrammar = createTypeGuard("grammar");
