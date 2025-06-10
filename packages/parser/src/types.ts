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
  type: 'StringLiteral';
  value: string;
  quote: '"' | "'";
}

/**
 * Character class node in TPEG grammar AST.
 * Represents character classes like [a-z], [A-Z], [0-9], [^0-9], .
 */
export interface CharacterClass {
  type: 'CharacterClass';
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
  type: 'Identifier';
  name: string;
}

/**
 * Any character dot (.) node in TPEG grammar AST.
 */
export interface AnyChar {
  type: 'AnyChar';
}

/**
 * Sequence node in TPEG grammar AST.
 * Represents sequential matching like: pattern1 pattern2 pattern3
 */
export interface Sequence {
  type: 'Sequence';
  elements: Expression[];
}

/**
 * Choice node in TPEG grammar AST.
 * Represents alternative matching like: pattern1 / pattern2 / pattern3
 */
export interface Choice {
  type: 'Choice';
  alternatives: Expression[];
}

/**
 * Group node in TPEG grammar AST.
 * Represents grouping for precedence control like: (pattern1 / pattern2)
 */
export interface Group {
  type: 'Group';
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
  type: 'Star';
  expression: Expression;
}

/**
 * Plus repetition node in TPEG grammar AST.
 * Represents one or more repetitions like: expr+
 */
export interface Plus {
  type: 'Plus';
  expression: Expression;
}

/**
 * Optional node in TPEG grammar AST.
 * Represents zero or one occurrence like: expr?
 */
export interface Optional {
  type: 'Optional';
  expression: Expression;
}

/**
 * Quantified repetition node in TPEG grammar AST.
 * Represents exact count, range, or minimum repetitions like: expr{3}, expr{2,5}, expr{3,}
 */
export interface Quantified {
  type: 'Quantified';
  expression: Expression;
  min: number;
  max?: number; // undefined means infinite (for {n,} syntax)
}

/**
 * Union type for composition operators.
 */
export type CompositionNode = 
  | Sequence
  | Choice
  | Group;

/**
 * Union type for repetition operators.
 */
export type RepetitionNode = 
  | Star
  | Plus
  | Optional
  | Quantified;

/**
 * Positive lookahead node in TPEG grammar AST.
 * Represents positive lookahead like: &expr
 * Succeeds if the expression matches without consuming input.
 */
export interface PositiveLookahead {
  type: 'PositiveLookahead';
  expression: Expression;
}

/**
 * Negative lookahead node in TPEG grammar AST.
 * Represents negative lookahead like: !expr
 * Succeeds if the expression does not match without consuming input.
 */
export interface NegativeLookahead {
  type: 'NegativeLookahead';
  expression: Expression;
}

/**
 * Union type for lookahead operators.
 */
export type LookaheadNode = 
  | PositiveLookahead
  | NegativeLookahead;

/**
 * Union type for all TPEG expression nodes.
 */
export type Expression = 
  | BasicSyntaxNode
  | CompositionNode
  | RepetitionNode
  | LookaheadNode;

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