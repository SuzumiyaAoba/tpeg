/**
 * Shared TPEG Grammar Types
 *
 * Core type definitions for TPEG grammar AST nodes, shared between
 * the parser and type inference systems to avoid circular dependencies.
 *
 * @fileoverview This module provides comprehensive type definitions for the TPEG grammar AST,
 * including all expression types, grammar structures, and factory functions for creating AST nodes.
 */

/**
 * String literal node in TPEG grammar AST.
 * Represents a quoted string literal like "hello" or 'world'.
 *
 * @example
 * ```typescript
 * const literal: StringLiteral = {
 *   type: "StringLiteral",
 *   value: "hello",
 *   quote: '"'
 * };
 * ```
 */
export interface StringLiteral {
  /** The node type identifier */
  type: "StringLiteral";
  /** The string content without quotes */
  value: string;
  /** The quote character used (double or single quote) */
  quote: '"' | "'";
}

/**
 * Character class node in TPEG grammar AST.
 * Represents character classes like [a-z], [abc], or [^0-9].
 *
 * @example
 * ```typescript
 * const charClass: CharacterClass = {
 *   type: "CharacterClass",
 *   ranges: [{ start: "a", end: "z" }],
 *   negated: false
 * };
 * ```
 */
export interface CharacterClass {
  /** The node type identifier */
  type: "CharacterClass";
  /** Array of character ranges within the class */
  ranges: CharRange[];
  /** Whether the character class is negated (starts with ^) */
  negated: boolean;
}

/**
 * Character range specification within a character class.
 * Can represent single characters or ranges like a-z.
 *
 * @example
 * ```typescript
 * // Single character
 * const singleChar: CharRange = { start: "a" };
 * // Character range
 * const range: CharRange = { start: "a", end: "z" };
 * ```
 */
export interface CharRange {
  /** The starting character of the range */
  start: string;
  /** The ending character of the range (optional for single characters) */
  end?: string;
}

/**
 * Identifier node in TPEG grammar AST.
 * Represents references to other grammar rules.
 *
 * @example
 * ```typescript
 * const id: Identifier = {
 *   type: "Identifier",
 *   name: "expression"
 * };
 * ```
 */
export interface Identifier {
  /** The node type identifier */
  type: "Identifier";
  /** The name of the referenced rule */
  name: string;
}

/**
 * Any character dot (.) node in TPEG grammar AST.
 * Matches any single character except newline.
 *
 * @example
 * ```typescript
 * const anyChar: AnyChar = { type: "AnyChar" };
 * ```
 */
export interface AnyChar {
  /** The node type identifier */
  type: "AnyChar";
}

/**
 * Sequence node in TPEG grammar AST.
 * Represents consecutive expressions that must all match in order.
 *
 * @example
 * ```typescript
 * const sequence: Sequence = {
 *   type: "Sequence",
 *   elements: [stringLiteral, identifier]
 * };
 * ```
 */
export interface Sequence {
  /** The node type identifier */
  type: "Sequence";
  /** The expressions that must match in sequence */
  elements: Expression[];
}

/**
 * Choice node in TPEG grammar AST.
 * Represents alternative expressions where any one can match.
 *
 * @example
 * ```typescript
 * const choice: Choice = {
 *   type: "Choice",
 *   alternatives: [stringLiteral, identifier]
 * };
 * ```
 */
export interface Choice {
  /** The node type identifier */
  type: "Choice";
  /** The alternative expressions to try */
  alternatives: Expression[];
}

/**
 * Group node in TPEG grammar AST.
 * Represents a parenthesized expression for grouping.
 *
 * @example
 * ```typescript
 * const group: Group = {
 *   type: "Group",
 *   expression: choice
 * };
 * ```
 */
export interface Group {
  /** The node type identifier */
  type: "Group";
  /** The grouped expression */
  expression: Expression;
}

/**
 * Star repetition node in TPEG grammar AST.
 * Represents zero or more repetitions of an expression (expr*).
 *
 * @example
 * ```typescript
 * const star: Star = {
 *   type: "Star",
 *   expression: identifier
 * };
 * ```
 */
export interface Star {
  /** The node type identifier */
  type: "Star";
  /** The expression to repeat */
  expression: Expression;
}

/**
 * Plus repetition node in TPEG grammar AST.
 * Represents one or more repetitions of an expression (expr+).
 *
 * @example
 * ```typescript
 * const plus: Plus = {
 *   type: "Plus",
 *   expression: identifier
 * };
 * ```
 */
export interface Plus {
  /** The node type identifier */
  type: "Plus";
  /** The expression to repeat */
  expression: Expression;
}

/**
 * Optional node in TPEG grammar AST.
 * Represents zero or one occurrence of an expression (expr?).
 *
 * @example
 * ```typescript
 * const optional: Optional = {
 *   type: "Optional",
 *   expression: identifier
 * };
 * ```
 */
export interface Optional {
  /** The node type identifier */
  type: "Optional";
  /** The optional expression */
  expression: Expression;
}

/**
 * Quantified repetition node in TPEG grammar AST.
 * Represents specific repetition counts like expr{2,5} or expr{3}.
 *
 * @example
 * ```typescript
 * // Exactly 3 repetitions
 * const exact: Quantified = {
 *   type: "Quantified",
 *   expression: identifier,
 *   min: 3
 * };
 * // 2 to 5 repetitions
 * const range: Quantified = {
 *   type: "Quantified",
 *   expression: identifier,
 *   min: 2,
 *   max: 5
 * };
 * ```
 */
export interface Quantified {
  /** The node type identifier */
  type: "Quantified";
  /** The expression to repeat */
  expression: Expression;
  /** Minimum number of repetitions */
  min: number;
  /** Maximum number of repetitions (optional for exact counts) */
  max?: number;
}

/**
 * Positive lookahead node in TPEG grammar AST.
 * Represents a positive lookahead assertion (&expr).
 *
 * @example
 * ```typescript
 * const lookahead: PositiveLookahead = {
 *   type: "PositiveLookahead",
 *   expression: identifier
 * };
 * ```
 */
export interface PositiveLookahead {
  /** The node type identifier */
  type: "PositiveLookahead";
  /** The expression to assert must follow */
  expression: Expression;
}

/**
 * Negative lookahead node in TPEG grammar AST.
 * Represents a negative lookahead assertion (!expr).
 *
 * @example
 * ```typescript
 * const negLookahead: NegativeLookahead = {
 *   type: "NegativeLookahead",
 *   expression: identifier
 * };
 * ```
 */
export interface NegativeLookahead {
  /** The node type identifier */
  type: "NegativeLookahead";
  /** The expression to assert must not follow */
  expression: Expression;
}

/**
 * Labeled expression node in TPEG grammar AST.
 * Represents a labeled expression for capturing results (label:expr).
 *
 * @example
 * ```typescript
 * const labeled: LabeledExpression = {
 *   type: "LabeledExpression",
 *   label: "name",
 *   expression: identifier
 * };
 * ```
 */
export interface LabeledExpression {
  /** The node type identifier */
  type: "LabeledExpression";
  /** The label for capturing the result */
  label: string;
  /** The expression being labeled */
  expression: Expression;
}

/**
 * Union type for all TPEG expression nodes.
 * This discriminated union allows type-safe handling of all expression types.
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
 * Represents metadata annotations like @version, @author, etc.
 *
 * @example
 * ```typescript
 * const annotation: GrammarAnnotation = {
 *   type: "GrammarAnnotation",
 *   key: "version",
 *   value: "1.0.0"
 * };
 * ```
 */
export interface GrammarAnnotation {
  /** The node type identifier */
  type: "GrammarAnnotation";
  /** The annotation key */
  key: string;
  /** The annotation value */
  value: string;
}

/**
 * Grammar rule definition in TPEG grammar AST.
 * Represents a named rule with its pattern and optional documentation.
 *
 * @example
 * ```typescript
 * const rule: RuleDefinition = {
 *   type: "RuleDefinition",
 *   name: "identifier",
 *   pattern: characterClass,
 *   documentation: ["Matches valid identifiers"]
 * };
 * ```
 */
export interface RuleDefinition {
  /** The node type identifier */
  type: "RuleDefinition";
  /** The name of the rule */
  name: string;
  /** The expression pattern for this rule */
  pattern: Expression;
  /** Optional documentation comments for the rule */
  documentation?: string[];
}

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

/**
 * Represents a complete grammar definition.
 *
 * A grammar definition contains:
 * - A name for the grammar
 * - Optional annotations for metadata
 * - A collection of rule definitions
 * - Optional transform definitions
 *
 * @example
 * ```typescript
 * const grammar: GrammarDefinition = {
 *   type: "GrammarDefinition",
 *   name: "Calculator",
 *   annotations: [
 *     { type: "GrammarAnnotation", key: "version", value: "1.0" }
 *   ],
 *   rules: [identifierRule, expressionRule],
 *   transforms: [transformDefinition]
 * };
 * ```
 */
export interface GrammarDefinition {
  /** The node type identifier */
  type: "GrammarDefinition";
  /** The name of the grammar */
  name: string;
  /** Grammar-level annotations */
  annotations: GrammarAnnotation[];
  /** The rules that make up this grammar */
  rules: RuleDefinition[];
  /** Transform definitions for this grammar */
  transforms?: TransformDefinition[];
}

// ============================================================================
// Factory Functions for Testing
// ============================================================================

/**
 * Create a StringLiteral AST node.
 *
 * @param value - The string content without quotes
 * @param quote - The quote character used (double or single quote)
 * @returns A new StringLiteral AST node
 *
 * @example
 * ```typescript
 * const literal = createStringLiteral("hello", '"');
 * // Returns: { type: "StringLiteral", value: "hello", quote: '"' }
 * ```
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
 * Create a CharacterClass AST node.
 *
 * @param ranges - Array of character ranges within the class
 * @param negated - Whether the character class is negated (defaults to false)
 * @returns A new CharacterClass AST node
 *
 * @example
 * ```typescript
 * const charClass = createCharacterClass([{ start: "a", end: "z" }], false);
 * // Returns: { type: "CharacterClass", ranges: [...], negated: false }
 * ```
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
 * Create a CharRange for use in character classes.
 *
 * @param start - The starting character of the range
 * @param end - The ending character of the range (optional for single characters)
 * @returns A new CharRange object
 *
 * @example
 * ```typescript
 * const singleChar = createCharRange("a");
 * const range = createCharRange("a", "z");
 * ```
 */
export const createCharRange = (start: string, end?: string): CharRange =>
  end ? { start, end } : { start };

/**
 * Create an Identifier AST node.
 *
 * @param name - The name of the referenced rule
 * @returns A new Identifier AST node
 *
 * @example
 * ```typescript
 * const id = createIdentifier("expression");
 * // Returns: { type: "Identifier", name: "expression" }
 * ```
 */
export const createIdentifier = (name: string): Identifier => ({
  type: "Identifier",
  name,
});

/**
 * Create an AnyChar AST node.
 *
 * @returns A new AnyChar AST node
 *
 * @example
 * ```typescript
 * const anyChar = createAnyChar();
 * // Returns: { type: "AnyChar" }
 * ```
 */
export const createAnyChar = (): AnyChar => ({
  type: "AnyChar",
});

/**
 * Create a Sequence AST node.
 *
 * @param elements - The expressions that must match in sequence
 * @returns A new Sequence AST node
 *
 * @example
 * ```typescript
 * const seq = createSequence([literal, identifier]);
 * // Returns: { type: "Sequence", elements: [...] }
 * ```
 */
export const createSequence = (elements: Expression[]): Sequence => ({
  type: "Sequence",
  elements,
});

/**
 * Create a Choice AST node.
 *
 * @param alternatives - The alternative expressions to try
 * @returns A new Choice AST node
 *
 * @example
 * ```typescript
 * const choice = createChoice([literal, identifier]);
 * // Returns: { type: "Choice", alternatives: [...] }
 * ```
 */
export const createChoice = (alternatives: Expression[]): Choice => ({
  type: "Choice",
  alternatives,
});

/**
 * Create a Group AST node.
 *
 * @param expression - The grouped expression
 * @returns A new Group AST node
 *
 * @example
 * ```typescript
 * const group = createGroup(choice);
 * // Returns: { type: "Group", expression: choice }
 * ```
 */
export const createGroup = (expression: Expression): Group => ({
  type: "Group",
  expression,
});

/**
 * Create a Star AST node (zero or more repetition).
 *
 * @param expression - The expression to repeat
 * @returns A new Star AST node
 *
 * @example
 * ```typescript
 * const star = createStar(identifier);
 * // Returns: { type: "Star", expression: identifier }
 * ```
 */
export const createStar = (expression: Expression): Star => ({
  type: "Star",
  expression,
});

/**
 * Create a Plus AST node (one or more repetition).
 *
 * @param expression - The expression to repeat
 * @returns A new Plus AST node
 *
 * @example
 * ```typescript
 * const plus = createPlus(identifier);
 * // Returns: { type: "Plus", expression: identifier }
 * ```
 */
export const createPlus = (expression: Expression): Plus => ({
  type: "Plus",
  expression,
});

/**
 * Create an Optional AST node (zero or one occurrence).
 *
 * @param expression - The optional expression
 * @returns A new Optional AST node
 *
 * @example
 * ```typescript
 * const optional = createOptional(identifier);
 * // Returns: { type: "Optional", expression: identifier }
 * ```
 */
export const createOptional = (expression: Expression): Optional => ({
  type: "Optional",
  expression,
});

/**
 * Create a Quantified AST node (specific repetition count/range).
 *
 * @param expression - The expression to repeat
 * @param min - Minimum number of repetitions
 * @param max - Maximum number of repetitions (optional for exact counts)
 * @returns A new Quantified AST node
 *
 * @example
 * ```typescript
 * const exact = createQuantified(identifier, 3);
 * const range = createQuantified(identifier, 2, 5);
 * ```
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
 * Create a PositiveLookahead AST node.
 *
 * @param expression - The expression to assert must follow
 * @returns A new PositiveLookahead AST node
 *
 * @example
 * ```typescript
 * const lookahead = createPositiveLookahead(identifier);
 * // Returns: { type: "PositiveLookahead", expression: identifier }
 * ```
 */
export const createPositiveLookahead = (
  expression: Expression,
): PositiveLookahead => ({
  type: "PositiveLookahead",
  expression,
});

/**
 * Create a NegativeLookahead AST node.
 *
 * @param expression - The expression to assert must not follow
 * @returns A new NegativeLookahead AST node
 *
 * @example
 * ```typescript
 * const negLookahead = createNegativeLookahead(identifier);
 * // Returns: { type: "NegativeLookahead", expression: identifier }
 * ```
 */
export const createNegativeLookahead = (
  expression: Expression,
): NegativeLookahead => ({
  type: "NegativeLookahead",
  expression,
});

/**
 * Create a LabeledExpression AST node.
 *
 * @param label - The label for capturing the result
 * @param expression - The expression being labeled
 * @returns A new LabeledExpression AST node
 *
 * @example
 * ```typescript
 * const labeled = createLabeledExpression("name", identifier);
 * // Returns: { type: "LabeledExpression", label: "name", expression: identifier }
 * ```
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
 * Create a GrammarAnnotation AST node.
 *
 * @param key - The annotation key
 * @param value - The annotation value
 * @returns A new GrammarAnnotation AST node
 *
 * @example
 * ```typescript
 * const annotation = createGrammarAnnotation("version", "1.0.0");
 * // Returns: { type: "GrammarAnnotation", key: "version", value: "1.0.0" }
 * ```
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
 * Create a RuleDefinition AST node.
 *
 * @param name - The name of the rule
 * @param pattern - The expression pattern for this rule
 * @param documentation - Optional documentation comments for the rule
 * @returns A new RuleDefinition AST node
 *
 * @example
 * ```typescript
 * const rule = createRuleDefinition("identifier", charClass, ["Matches identifiers"]);
 * // Returns: { type: "RuleDefinition", name: "identifier", pattern: charClass, documentation: [...] }
 * ```
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
 * Create a GrammarDefinition AST node.
 *
 * @param name - The name of the grammar
 * @param annotations - Grammar-level annotations (defaults to empty array)
 * @param rules - The rules that make up this grammar (defaults to empty array)
 * @param transforms - Transform definitions for this grammar (defaults to empty array)
 * @returns A new GrammarDefinition AST node
 *
 * @example
 * ```typescript
 * const grammar = createGrammarDefinition("MyGrammar", [annotation], [rule], [transform]);
 * // Returns: { type: "GrammarDefinition", name: "MyGrammar", annotations: [...], rules: [...], transforms: [...] }
 * ```
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
