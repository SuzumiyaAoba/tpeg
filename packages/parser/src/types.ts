/** Grammar AST definitions are shared with core. Token and lexer types are parser-specific. */
import { createStringLiteral as coreStringLiteral } from "@suzumiyaaoba/tpeg-core";
import type {
  AnyChar,
  CharacterClass,
  Choice,
  Expression,
  GrammarAnnotation,
  GrammarDefinition,
  Group,
  Identifier,
  NegativeLookahead,
  Optional,
  Plus,
  PositiveLookahead,
  QualifiedIdentifier,
  Quantified,
  RuleDefinition,
  Sequence,
  Span,
  Star,
  StringLiteral,
  TransformDefinition,
  TransformFunction,
  TransformParameter,
  TransformReturnType,
  TransformSet,
  WordBoundary,
} from "@suzumiyaaoba/tpeg-core";

export type {
  StringLiteral,
  CharacterClass,
  CharRange,
  Identifier,
  QualifiedIdentifier,
  AnyChar,
  Sequence,
  Choice,
  Group,
  Star,
  Plus,
  Optional,
  Quantified,
  PositiveLookahead,
  NegativeLookahead,
  Cut,
  Skip,
  Span,
  WordBoundary,
  LabeledExpression,
  ActionExpression,
  Expression,
  GrammarAnnotation,
  RuleDefinition,
  GrammarDefinition,
  TransformDefinition,
  TransformFunction,
  TransformParameter,
  TransformReturnType,
  TransformSet,
} from "@suzumiyaaoba/tpeg-core";

export {
  createCharacterClass,
  createCharRange,
  createIdentifier,
  createQualifiedIdentifier,
  createAnyChar,
  createSequence,
  createChoice,
  createGroup,
  createStar,
  createPlus,
  createOptional,
  createQuantified,
  createPositiveLookahead,
  createNegativeLookahead,
  createCut,
  createSpan,
  createWordBoundary,
  createLabeledExpression,
  createActionExpression,
  createGrammarAnnotation,
  createRuleDefinition,
  createGrammarDefinition,
} from "@suzumiyaaoba/tpeg-core";

/** Parser callers may omit the quote to use a double-quoted literal. */
export const createStringLiteral = (
  value: string,
  quote: '"' | "'" = '"',
): StringLiteral => coreStringLiteral(value, quote);

// ============================================================================
// Parser-specific derived types
// ============================================================================
export type BasicSyntaxNode =
  | StringLiteral
  | CharacterClass
  | QualifiedIdentifier
  | Identifier
  | AnyChar
  | WordBoundary;

export type CompositionNode = Sequence | Choice | Group;
export type RepetitionNode = Star | Plus | Optional | Quantified;
export type LookaheadNode = PositiveLookahead | NegativeLookahead | Span;

export type GrammarNode =
  | GrammarDefinition
  | RuleDefinition
  | GrammarAnnotation;

/**
 * Token represents a parsed expression with position information.
 */
export interface Token<T extends Expression = Expression> {
  node: T;
  start: number;
  end: number;
  text: string;
}

/**
 * Lexer state for tokenizing TPEG grammar input.
 */
export interface LexerState {
  input: string;
  position: number;
  line: number;
  column: number;
}

/**
 * Result of tokenization process.
 */
export interface TokenizeResult {
  tokens: Token[];
  errors: TokenizeError[];
}

/**
 * Error during tokenization.
 */
export interface TokenizeError {
  message: string;
  position: number;
  line: number;
  column: number;
}

// ============================================================================
// Transform Factory Functions
// ============================================================================

/**
 * Create a TransformParameter AST node
 * @param name Parameter name
 * @param type Parameter type
 * @param optional Whether the parameter is optional
 * @returns TransformParameter node
 */
export const createTransformParameter = (
  name: string,
  type: string,
  optional = false,
): TransformParameter => ({
  name,
  type,
  optional,
});

/**
 * Create a TransformReturnType AST node
 * @param type Return type
 * @param generic Generic type parameter (optional)
 * @returns TransformReturnType node
 */
export const createTransformReturnType = (
  type: string,
  generic?: string,
): TransformReturnType =>
  generic !== undefined ? { type, generic } : { type };

/**
 * Create a TransformFunction AST node
 * @param name Function name
 * @param parameters Function parameters
 * @param returnType Function return type
 * @param body Function body
 * @param documentation Optional documentation
 * @returns TransformFunction node
 */
export const createTransformFunction = (
  name: string,
  parameters: TransformParameter[],
  returnType: TransformReturnType,
  body: string,
  documentation?: string[],
): TransformFunction =>
  documentation !== undefined
    ? { name, parameters, returnType, body, documentation }
    : { name, parameters, returnType, body };

/**
 * Create a TransformSet AST node
 * @param name Transform set name
 * @param targetLanguage Target language
 * @param functions Transform functions
 * @returns TransformSet node
 */
export const createTransformSet = (
  name: string,
  targetLanguage: string,
  functions: TransformFunction[],
): TransformSet => ({
  name,
  targetLanguage,
  functions,
});

/**
 * Create a TransformDefinition AST node
 * @param transformSet The transform set
 * @returns TransformDefinition node
 */
export const createTransformDefinition = (
  transformSet: TransformSet,
): TransformDefinition => ({
  type: "TransformDefinition",
  transformSet,
});
