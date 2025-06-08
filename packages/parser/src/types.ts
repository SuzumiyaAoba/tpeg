/**
 * TPEG Grammar Parser Types
 * 
 * Type definitions for TPEG basic syntax elements based on docs/peg-grammar.md specification.
 */

/**
 * String literal node in TPEG grammar AST.
 * Represents string literals like "hello", 'world', `template`
 */
export interface StringLiteral {
  type: 'StringLiteral';
  value: string;
  quote: '"' | "'" | '`';
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
 * Union type for all basic TPEG syntax elements.
 */
export type BasicSyntaxNode = 
  | StringLiteral 
  | CharacterClass 
  | Identifier 
  | AnyChar;

/**
 * Token represents a parsed basic syntax element with position information.
 */
export interface Token<T extends BasicSyntaxNode = BasicSyntaxNode> {
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