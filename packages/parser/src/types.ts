/**
 * TPEG Grammar Parser Types
 *
 * Type definitions for TPEG basic syntax elements based on docs/peg-grammar.md specification.
 * Re-exports shared types from tpeg-core and adds parser-specific types.
 */

// Import and re-export all shared grammar types from core
import type {
  AnyChar,
  CharRange,
  CharacterClass,
  Choice,
  Expression,
  GrammarAnnotation,
  GrammarDefinition,
  Group,
  Identifier,
  LabeledExpression,
  NegativeLookahead,
  Optional,
  Plus,
  PositiveLookahead,
  Quantified,
  RuleDefinition,
  Sequence,
  Star,
  StringLiteral,
} from "tpeg-core";

export type {
  StringLiteral,
  CharacterClass,
  CharRange,
  Identifier,
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
  LabeledExpression,
  Expression,
  GrammarAnnotation,
  RuleDefinition,
  GrammarDefinition,
};

// ============================================================================
// Transform AST Types
// ============================================================================

/**
 * Represents a transform function parameter
 */
export interface TransformParameter {
  name: string;
  type: string;
  optional?: boolean;
}

/**
 * Represents a transform function return type
 */
export interface TransformReturnType {
  type: string;
  generic?: string;
}

/**
 * Represents a transform function definition
 */
export interface TransformFunction {
  name: string;
  parameters: TransformParameter[];
  returnType: TransformReturnType;
  body: string;
  documentation?: string[];
}

/**
 * Represents a transform set declaration
 */
export interface TransformSet {
  name: string;
  targetLanguage: string;
  functions: TransformFunction[];
}

/**
 * Represents a complete transform definition
 */
export interface TransformDefinition {
  type: "TransformDefinition";
  transformSet: TransformSet;
}

// ============================================================================
// Parser-specific derived types
// ============================================================================
export type BasicSyntaxNode =
  | StringLiteral
  | CharacterClass
  | Identifier
  | AnyChar;

export type CompositionNode = Sequence | Choice | Group;
export type RepetitionNode = Star | Plus | Optional | Quantified;
export type LookaheadNode = PositiveLookahead | NegativeLookahead;

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
// AST Node Factory Functions
// ============================================================================

/**
 * Factory functions for creating AST nodes with proper typing and validation.
 * These functions provide a consistent API for node creation and eliminate
 * the need for manual type assertions throughout the codebase.
 */

/**
 * Create a StringLiteral AST node
 * @param value The string content (without quotes)
 * @param quote The quote character used
 * @returns StringLiteral node
 */
export const createStringLiteral = (
  value: string,
  quote: '"' | "'",
): StringLiteral => ({
  type: "StringLiteral",
  value,
  quote,
});

/**
 * Create a CharacterClass AST node
 * @param ranges Array of character ranges
 * @param negated Whether the character class is negated (e.g., [^a-z])
 * @returns CharacterClass node
 */
export const createCharacterClass = (
  ranges: CharRange[],
  negated = false,
): CharacterClass => ({
  type: "CharacterClass",
  ranges,
  negated,
});

/**
 * Create a CharRange for use in character classes
 * @param start Start character
 * @param end End character (optional for single characters)
 * @returns CharRange object
 */
export const createCharRange = (start: string, end?: string): CharRange =>
  end ? { start, end } : { start };

/**
 * Create an Identifier AST node
 * @param name The identifier name
 * @returns Identifier node
 */
export const createIdentifier = (name: string): Identifier => ({
  type: "Identifier",
  name,
});

/**
 * Create an AnyChar AST node
 * @returns AnyChar node
 */
export const createAnyChar = (): AnyChar => ({
  type: "AnyChar",
});

/**
 * Create a Sequence AST node
 * @param elements Array of expressions in sequence
 * @returns Sequence node
 */
export const createSequence = (elements: Expression[]): Sequence => ({
  type: "Sequence",
  elements,
});

/**
 * Create a Choice AST node
 * @param alternatives Array of alternative expressions
 * @returns Choice node
 */
export const createChoice = (alternatives: Expression[]): Choice => ({
  type: "Choice",
  alternatives,
});

/**
 * Create a Group AST node
 * @param expression The expression to group
 * @returns Group node
 */
export const createGroup = (expression: Expression): Group => ({
  type: "Group",
  expression,
});

/**
 * Create a Star AST node (zero or more repetition)
 * @param expression The expression to repeat
 * @returns Star node
 */
export const createStar = (expression: Expression): Star => ({
  type: "Star",
  expression,
});

/**
 * Create a Plus AST node (one or more repetition)
 * @param expression The expression to repeat
 * @returns Plus node
 */
export const createPlus = (expression: Expression): Plus => ({
  type: "Plus",
  expression,
});

/**
 * Create an Optional AST node (zero or one occurrence)
 * @param expression The expression to make optional
 * @returns Optional node
 */
export const createOptional = (expression: Expression): Optional => ({
  type: "Optional",
  expression,
});

/**
 * Create a Quantified AST node (specific repetition count/range)
 * @param expression The expression to quantify
 * @param min Minimum repetitions
 * @param max Maximum repetitions (undefined for unlimited)
 * @returns Quantified node
 */
export const createQuantified = (
  expression: Expression,
  min: number,
  max?: number,
): Quantified =>
  max !== undefined
    ? {
        type: "Quantified",
        expression,
        min,
        max,
      }
    : {
        type: "Quantified",
        expression,
        min,
      };

/**
 * Create a PositiveLookahead AST node
 * @param expression The expression to check
 * @returns PositiveLookahead node
 */
export const createPositiveLookahead = (
  expression: Expression,
): PositiveLookahead => ({
  type: "PositiveLookahead",
  expression,
});

/**
 * Create a NegativeLookahead AST node
 * @param expression The expression to check against
 * @returns NegativeLookahead node
 */
export const createNegativeLookahead = (
  expression: Expression,
): NegativeLookahead => ({
  type: "NegativeLookahead",
  expression,
});

/**
 * Create a LabeledExpression AST node
 * @param label The label name
 * @param expression The expression to label
 * @returns LabeledExpression node
 */
export const createLabeledExpression = (
  label: string,
  expression: Expression,
): LabeledExpression => ({
  type: "LabeledExpression",
  label,
  expression,
});

/**
 * Create a GrammarAnnotation AST node
 * @param key The annotation key (e.g., "version")
 * @param value The annotation value (e.g., "1.0")
 * @returns GrammarAnnotation node
 */
export const createGrammarAnnotation = (
  key: string,
  value: string,
): GrammarAnnotation => ({
  type: "GrammarAnnotation",
  key,
  value,
});

/**
 * Create a RuleDefinition AST node
 * @param name The rule name
 * @param pattern The rule pattern
 * @param documentation Optional documentation lines
 * @returns RuleDefinition node
 */
export const createRuleDefinition = (
  name: string,
  pattern: Expression,
  documentation?: string[],
): RuleDefinition =>
  documentation
    ? {
        type: "RuleDefinition",
        name,
        pattern,
        documentation,
      }
    : {
        type: "RuleDefinition",
        name,
        pattern,
      };

/**
 * Create a GrammarDefinition AST node
 * @param name The grammar name
 * @param annotations Grammar annotations
 * @param rules Grammar rules
 * @param transforms Grammar transforms
 * @returns GrammarDefinition node
 */
export const createGrammarDefinition = (
  name: string,
  annotations: GrammarAnnotation[] = [],
  rules: RuleDefinition[] = [],
  transforms: TransformDefinition[] = [],
): GrammarDefinition => ({
  type: "GrammarDefinition",
  name,
  annotations,
  rules,
  transforms,
});

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
  generic !== undefined 
    ? { type, generic }
    : { type };

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
