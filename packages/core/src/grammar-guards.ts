import type {
  ActionExpression,
  AnyChar,
  CharacterClass,
  Choice,
  Cut,
  GrammarDefinition,
  Group,
  Identifier,
  LabeledExpression,
  ModularGrammarDefinition,
  NegativeLookahead,
  Optional,
  Plus,
  PositiveLookahead,
  QualifiedIdentifier,
  Quantified,
  Sequence,
  Star,
  StringLiteral,
} from "./grammar-nodes";

/**
 * Type guard to check if an expression is a StringLiteral.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a StringLiteral
 *
 * @example
 * ```typescript
 * if (isStringLiteral(expr)) {
 *   // expr is now typed as StringLiteral
 *   console.log(expr.value);
 * }
 * ```
 */
const hasNodeType = <T extends string>(
  expr: unknown,
  type: T,
): expr is { type: T } =>
  typeof expr === "object" &&
  expr !== null &&
  (expr as { type?: unknown }).type === type;

export const isStringLiteral = (expr: unknown): expr is StringLiteral =>
  hasNodeType(expr, "StringLiteral");

/**
 * Type guard to check if an expression is a CharacterClass.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a CharacterClass
 */
export const isCharacterClass = (expr: unknown): expr is CharacterClass =>
  hasNodeType(expr, "CharacterClass");

/**
 * Type guard to check if an expression is an Identifier.
 *
 * @param expr - The expression to check
 * @returns True if the expression is an Identifier
 */
export const isIdentifier = (expr: unknown): expr is Identifier =>
  hasNodeType(expr, "Identifier");

/**
 * Type guard to check if an expression is a QualifiedIdentifier.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a QualifiedIdentifier
 */
export const isQualifiedIdentifier = (
  expr: unknown,
): expr is QualifiedIdentifier => hasNodeType(expr, "QualifiedIdentifier");

/**
 * Type guard to check if an expression is an AnyChar.
 *
 * @param expr - The expression to check
 * @returns True if the expression is an AnyChar
 */
export const isAnyChar = (expr: unknown): expr is AnyChar =>
  hasNodeType(expr, "AnyChar");

/**
 * Type guard to check if an expression is a Sequence.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Sequence
 */
export const isSequence = (expr: unknown): expr is Sequence =>
  hasNodeType(expr, "Sequence");

/**
 * Type guard to check if an expression is a Choice.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Choice
 */
export const isChoice = (expr: unknown): expr is Choice =>
  hasNodeType(expr, "Choice");

/**
 * Type guard to check if an expression is a Group.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Group
 */
export const isGroup = (expr: unknown): expr is Group =>
  hasNodeType(expr, "Group");

/**
 * Type guard to check if an expression is a Star.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Star
 */
export const isStar = (expr: unknown): expr is Star =>
  hasNodeType(expr, "Star");

/**
 * Type guard to check if an expression is a Plus.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Plus
 */
export const isPlus = (expr: unknown): expr is Plus =>
  hasNodeType(expr, "Plus");

/**
 * Type guard to check if an expression is an Optional.
 *
 * @param expr - The expression to check
 * @returns True if the expression is an Optional
 */
export const isOptional = (expr: unknown): expr is Optional =>
  hasNodeType(expr, "Optional");

/**
 * Type guard to check if an expression is a Quantified.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Quantified
 */
export const isQuantified = (expr: unknown): expr is Quantified =>
  hasNodeType(expr, "Quantified");

/**
 * Type guard to check if an expression is a PositiveLookahead.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a PositiveLookahead
 */
export const isPositiveLookahead = (expr: unknown): expr is PositiveLookahead =>
  hasNodeType(expr, "PositiveLookahead");

/**
 * Type guard to check if an expression is a NegativeLookahead.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a NegativeLookahead
 */
export const isNegativeLookahead = (expr: unknown): expr is NegativeLookahead =>
  hasNodeType(expr, "NegativeLookahead");

/**
 * Type guard to check if an expression is a Cut.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Cut
 */
export const isCut = (expr: unknown): expr is Cut => hasNodeType(expr, "Cut");

/**
 * Type guard to check if an expression is a LabeledExpression.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a LabeledExpression
 */
export const isLabeledExpression = (expr: unknown): expr is LabeledExpression =>
  hasNodeType(expr, "LabeledExpression");

/**
 * Type guard to check if an expression is an ActionExpression.
 *
 * @param expr - The expression to check
 * @returns True if the expression is an ActionExpression
 */
export const isActionExpression = (expr: unknown): expr is ActionExpression =>
  hasNodeType(expr, "ActionExpression");

/**
 * Type guard to check if a grammar definition is a ModularGrammarDefinition.
 *
 * @param grammar - The grammar definition to check
 * @returns True if the grammar is a ModularGrammarDefinition
 */
export const isModularGrammarDefinition = (
  grammar: GrammarDefinition | ModularGrammarDefinition,
): grammar is ModularGrammarDefinition =>
  grammar.type === "ModularGrammarDefinition";

/**
 * Type guard to check if a grammar definition is a standard GrammarDefinition.
 *
 * @param grammar - The grammar definition to check
 * @returns True if the grammar is a standard GrammarDefinition
 */
export const isStandardGrammarDefinition = (
  grammar: GrammarDefinition | ModularGrammarDefinition,
): grammar is GrammarDefinition => grammar.type === "GrammarDefinition";
