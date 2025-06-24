/**
 * Shared TPEG Grammar Types
 * 
 * Core type definitions for TPEG grammar AST nodes, shared between
 * the parser and type inference systems to avoid circular dependencies.
 */

/**
 * String literal node in TPEG grammar AST.
 */
export interface StringLiteral {
  type: "StringLiteral";
  value: string;
  quote: '"' | "'";
}

/**
 * Character class node in TPEG grammar AST.
 */
export interface CharacterClass {
  type: "CharacterClass";
  ranges: CharRange[];
  negated: boolean;
}

/**
 * Character range specification within a character class.
 */
export interface CharRange {
  start: string;
  end?: string;
}

/**
 * Identifier node in TPEG grammar AST.
 */
export interface Identifier {
  type: "Identifier";
  name: string;
}

/**
 * Any character dot (.) node in TPEG grammar AST.
 */
export interface AnyChar {
  type: "AnyChar";
}

/**
 * Sequence node in TPEG grammar AST.
 */
export interface Sequence {
  type: "Sequence";
  elements: Expression[];
}

/**
 * Choice node in TPEG grammar AST.
 */
export interface Choice {
  type: "Choice";
  alternatives: Expression[];
}

/**
 * Group node in TPEG grammar AST.
 */
export interface Group {
  type: "Group";
  expression: Expression;
}

/**
 * Star repetition node in TPEG grammar AST.
 */
export interface Star {
  type: "Star";
  expression: Expression;
}

/**
 * Plus repetition node in TPEG grammar AST.
 */
export interface Plus {
  type: "Plus";
  expression: Expression;
}

/**
 * Optional node in TPEG grammar AST.
 */
export interface Optional {
  type: "Optional";
  expression: Expression;
}

/**
 * Quantified repetition node in TPEG grammar AST.
 */
export interface Quantified {
  type: "Quantified";
  expression: Expression;
  min: number;
  max?: number;
}

/**
 * Positive lookahead node in TPEG grammar AST.
 */
export interface PositiveLookahead {
  type: "PositiveLookahead";
  expression: Expression;
}

/**
 * Negative lookahead node in TPEG grammar AST.
 */
export interface NegativeLookahead {
  type: "NegativeLookahead";
  expression: Expression;
}

/**
 * Labeled expression node in TPEG grammar AST.
 */
export interface LabeledExpression {
  type: "LabeledExpression";
  label: string;
  expression: Expression;
}

/**
 * Union type for all TPEG expression nodes.
 */
export type Expression =
  | StringLiteral
  | CharacterClass
  | Identifier
  | AnyChar
  | Sequence
  | Choice
  | Group
  | Star
  | Plus
  | Optional
  | Quantified
  | PositiveLookahead
  | NegativeLookahead
  | LabeledExpression;

/**
 * Grammar annotation in TPEG grammar AST.
 */
export interface GrammarAnnotation {
  type: "GrammarAnnotation";
  key: string;
  value: string;
}

/**
 * Grammar rule definition in TPEG grammar AST.
 */
export interface RuleDefinition {
  type: "RuleDefinition";
  name: string;
  pattern: Expression;
  documentation?: string[];
}

/**
 * Grammar definition in TPEG grammar AST.
 */
export interface GrammarDefinition {
  type: "GrammarDefinition";
  name: string;
  annotations: GrammarAnnotation[];
  rules: RuleDefinition[];
}

// ============================================================================
// Factory Functions for Testing
// ============================================================================

/**
 * Create a StringLiteral AST node
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
 */
export const createCharRange = (start: string, end?: string): CharRange =>
  end ? { start, end } : { start };

/**
 * Create an Identifier AST node
 */
export const createIdentifier = (name: string): Identifier => ({
  type: "Identifier",
  name,
});

/**
 * Create an AnyChar AST node
 */
export const createAnyChar = (): AnyChar => ({
  type: "AnyChar",
});

/**
 * Create a Sequence AST node
 */
export const createSequence = (elements: Expression[]): Sequence => ({
  type: "Sequence",
  elements,
});

/**
 * Create a Choice AST node
 */
export const createChoice = (alternatives: Expression[]): Choice => ({
  type: "Choice",
  alternatives,
});

/**
 * Create a Group AST node
 */
export const createGroup = (expression: Expression): Group => ({
  type: "Group",
  expression,
});

/**
 * Create a Star AST node (zero or more repetition)
 */
export const createStar = (expression: Expression): Star => ({
  type: "Star",
  expression,
});

/**
 * Create a Plus AST node (one or more repetition)
 */
export const createPlus = (expression: Expression): Plus => ({
  type: "Plus",
  expression,
});

/**
 * Create an Optional AST node (zero or one occurrence)
 */
export const createOptional = (expression: Expression): Optional => ({
  type: "Optional",
  expression,
});

/**
 * Create a Quantified AST node (specific repetition count/range)
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
 */
export const createPositiveLookahead = (
  expression: Expression,
): PositiveLookahead => ({
  type: "PositiveLookahead",
  expression,
});

/**
 * Create a NegativeLookahead AST node
 */
export const createNegativeLookahead = (
  expression: Expression,
): NegativeLookahead => ({
  type: "NegativeLookahead",
  expression,
});

/**
 * Create a LabeledExpression AST node
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
 */
export const createGrammarDefinition = (
  name: string,
  annotations: GrammarAnnotation[] = [],
  rules: RuleDefinition[] = [],
): GrammarDefinition => ({
  type: "GrammarDefinition",
  name,
  annotations,
  rules,
});