/**
 * TPEG Grammar Parser Types
 *
 * Type definitions for TPEG basic syntax elements based on docs/peg-grammar.md specification.
 */

/**
 * String literal node in TPEG grammar AST.
 * Represents string literals like "hello", 'world'
 * Note: Template literals (`template`) are planned for future extension
 */
export interface StringLiteral {
  type: "StringLiteral";
  value: string;
  quote: '"' | "'";
}

/**
 * Character class node in TPEG grammar AST.
 * Represents character classes like [a-z], [A-Z], [0-9], [^0-9], .
 */
export interface CharacterClass {
  type: "CharacterClass";
  ranges: CharRange[];
  negated: boolean;
}

/**
 * Character range specification within a character class.
 * Can be a single character or a range like 'a-z'
 */
export interface CharRange {
  start: string;
  end?: string; // undefined for single characters
}

/**
 * Identifier node in TPEG grammar AST.
 * Represents rule references like 'number', 'identifier', 'expression'
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
 * Represents sequential matching like: pattern1 pattern2 pattern3
 */
export interface Sequence {
  type: "Sequence";
  elements: Expression[];
}

/**
 * Choice node in TPEG grammar AST.
 * Represents alternative matching like: pattern1 / pattern2 / pattern3
 */
export interface Choice {
  type: "Choice";
  alternatives: Expression[];
}

/**
 * Group node in TPEG grammar AST.
 * Represents grouping for precedence control like: (pattern1 / pattern2)
 */
export interface Group {
  type: "Group";
  expression: Expression;
}

/**
 * Union type for all basic TPEG syntax elements.
 */
export type BasicSyntaxNode =
  | StringLiteral
  | CharacterClass
  | Identifier
  | AnyChar;

/**
 * Star repetition node in TPEG grammar AST.
 * Represents zero or more repetitions like: expr*
 */
export interface Star {
  type: "Star";
  expression: Expression;
}

/**
 * Plus repetition node in TPEG grammar AST.
 * Represents one or more repetitions like: expr+
 */
export interface Plus {
  type: "Plus";
  expression: Expression;
}

/**
 * Optional node in TPEG grammar AST.
 * Represents zero or one occurrence like: expr?
 */
export interface Optional {
  type: "Optional";
  expression: Expression;
}

/**
 * Quantified repetition node in TPEG grammar AST.
 * Represents exact count, range, or minimum repetitions like: expr{3}, expr{2,5}, expr{3,}
 */
export interface Quantified {
  type: "Quantified";
  expression: Expression;
  min: number;
  max?: number; // undefined means infinite (for {n,} syntax)
}

/**
 * Union type for composition operators.
 */
export type CompositionNode = Sequence | Choice | Group;

/**
 * Union type for repetition operators.
 */
export type RepetitionNode = Star | Plus | Optional | Quantified;

/**
 * Positive lookahead node in TPEG grammar AST.
 * Represents positive lookahead like: &expr
 * Succeeds if the expression matches without consuming input.
 */
export interface PositiveLookahead {
  type: "PositiveLookahead";
  expression: Expression;
}

/**
 * Negative lookahead node in TPEG grammar AST.
 * Represents negative lookahead like: !expr
 * Succeeds if the expression does not match without consuming input.
 */
export interface NegativeLookahead {
  type: "NegativeLookahead";
  expression: Expression;
}

/**
 * Union type for lookahead operators.
 */
export type LookaheadNode = PositiveLookahead | NegativeLookahead;

/**
 * Labeled expression node in TPEG grammar AST.
 * Represents labeled expressions like: name:expr
 * Associates a label with an expression for capture purposes.
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
  | BasicSyntaxNode
  | CompositionNode
  | RepetitionNode
  | LookaheadNode
  | LabeledExpression;

/**
 * Grammar metadata annotation in TPEG grammar AST.
 * Represents annotations like: @version: "1.0"
 */
export interface GrammarAnnotation {
  type: "GrammarAnnotation";
  key: string;
  value: string;
}

/**
 * Grammar rule definition in TPEG grammar AST.
 * Represents rule definitions like: rule_name = pattern
 */
export interface RuleDefinition {
  type: "RuleDefinition";
  name: string;
  pattern: Expression;
  documentation?: string[];
}

/**
 * Grammar block in TPEG grammar AST.
 * Represents complete grammar definitions like: grammar Name { ... }
 */
export interface GrammarDefinition {
  type: "GrammarDefinition";
  name: string;
  annotations: GrammarAnnotation[];
  rules: RuleDefinition[];
}

/**
 * Union type for grammar-level nodes.
 */
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
export const createStringLiteral = (value: string, quote: '"' | "'"): StringLiteral => ({
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
export const createCharacterClass = (ranges: CharRange[], negated = false): CharacterClass => ({
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
export const createQuantified = (expression: Expression, min: number, max?: number): Quantified => 
  max !== undefined ? {
    type: "Quantified",
    expression,
    min,
    max,
  } : {
    type: "Quantified",
    expression,
    min,
  };

/**
 * Create a PositiveLookahead AST node
 * @param expression The expression to check
 * @returns PositiveLookahead node
 */
export const createPositiveLookahead = (expression: Expression): PositiveLookahead => ({
  type: "PositiveLookahead",
  expression,
});

/**
 * Create a NegativeLookahead AST node
 * @param expression The expression to check against
 * @returns NegativeLookahead node
 */
export const createNegativeLookahead = (expression: Expression): NegativeLookahead => ({
  type: "NegativeLookahead",
  expression,
});

/**
 * Create a LabeledExpression AST node
 * @param label The label name
 * @param expression The expression to label
 * @returns LabeledExpression node
 */
export const createLabeledExpression = (label: string, expression: Expression): LabeledExpression => ({
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
export const createGrammarAnnotation = (key: string, value: string): GrammarAnnotation => ({
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
  documentation?: string[]
): RuleDefinition => 
  documentation ? {
    type: "RuleDefinition",
    name,
    pattern,
    documentation,
  } : {
    type: "RuleDefinition",
    name,
    pattern,
  };

/**
 * Create a GrammarDefinition AST node
 * @param name The grammar name
 * @param annotations Grammar annotations
 * @param rules Grammar rules
 * @returns GrammarDefinition node
 */
export const createGrammarDefinition = (
  name: string,
  annotations: GrammarAnnotation[] = [],
  rules: RuleDefinition[] = []
): GrammarDefinition => ({
  type: "GrammarDefinition",
  name,
  annotations,
  rules,
});
