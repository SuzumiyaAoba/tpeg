/**
 * Type definitions for TPEG Code Generator
 *
 * These types are used for code generation and template rendering.
 * They import the core TPEG types and extend them with generation-specific interfaces.
 */

/**
 * Core TPEG AST node types for code generation
 * These are simplified versions of the full AST types
 */

// Expression type literals
export type ExpressionType = 
  | "StringLiteral"
  | "CharacterClass"
  | "Identifier"
  | "AnyChar"
  | "Sequence"
  | "Choice"
  | "Group"
  | "Star"
  | "Plus"
  | "Optional"
  | "Quantified"
  | "PositiveLookahead"
  | "NegativeLookahead"
  | "LabeledExpression";

export interface Expression {
  type: ExpressionType;
}

export interface StringLiteral extends Expression {
  type: "StringLiteral";
  value: string;
}

export interface CharacterClass extends Expression {
  type: "CharacterClass";
  ranges: Array<{ start: string; end?: string }>;
  negated: boolean;
}

export interface Identifier extends Expression {
  type: "Identifier";
  name: string;
}

export interface AnyChar extends Expression {
  type: "AnyChar";
}

export interface Sequence extends Expression {
  type: "Sequence";
  elements: Expression[];
}

export interface Choice extends Expression {
  type: "Choice";
  alternatives: Expression[];
}

export interface Group extends Expression {
  type: "Group";
  expression: Expression;
}

export interface Star extends Expression {
  type: "Star";
  expression: Expression;
}

export interface Plus extends Expression {
  type: "Plus";
  expression: Expression;
}

export interface Optional extends Expression {
  type: "Optional";
  expression: Expression;
}

export interface Quantified extends Expression {
  type: "Quantified";
  expression: Expression;
  min: number;
  max?: number;
}

export interface PositiveLookahead extends Expression {
  type: "PositiveLookahead";
  expression: Expression;
}

export interface NegativeLookahead extends Expression {
  type: "NegativeLookahead";
  expression: Expression;
}

export interface LabeledExpression extends Expression {
  type: "LabeledExpression";
  label: string;
  expression: Expression;
}

// Union type for all specific expression types
export type SpecificExpression =
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

// Type guard functions for type narrowing
export function isStringLiteral(expr: Expression): expr is StringLiteral {
  return expr.type === "StringLiteral";
}

export function isCharacterClass(expr: Expression): expr is CharacterClass {
  return expr.type === "CharacterClass";
}

export function isIdentifier(expr: Expression): expr is Identifier {
  return expr.type === "Identifier";
}

export function isAnyChar(expr: Expression): expr is AnyChar {
  return expr.type === "AnyChar";
}

export function isSequence(expr: Expression): expr is Sequence {
  return expr.type === "Sequence";
}

export function isChoice(expr: Expression): expr is Choice {
  return expr.type === "Choice";
}

export function isGroup(expr: Expression): expr is Group {
  return expr.type === "Group";
}

export function isStar(expr: Expression): expr is Star {
  return expr.type === "Star";
}

export function isPlus(expr: Expression): expr is Plus {
  return expr.type === "Plus";
}

export function isOptional(expr: Expression): expr is Optional {
  return expr.type === "Optional";
}

export function isQuantified(expr: Expression): expr is Quantified {
  return expr.type === "Quantified";
}

export function isPositiveLookahead(expr: Expression): expr is PositiveLookahead {
  return expr.type === "PositiveLookahead";
}

export function isNegativeLookahead(expr: Expression): expr is NegativeLookahead {
  return expr.type === "NegativeLookahead";
}

export function isLabeledExpression(expr: Expression): expr is LabeledExpression {
  return expr.type === "LabeledExpression";
}

// Generic type guard for any expression type
export function isExpressionType<T extends ExpressionType>(
  expr: Expression,
  type: T
): expr is Extract<SpecificExpression, { type: T }> {
  return expr.type === type;
}

export interface RuleDefinition {
  type: "RuleDefinition";
  name: string;
  pattern: Expression;
}

export interface GrammarDefinition {
  type: "GrammarDefinition";
  name: string;
  annotations: unknown[];
  rules: RuleDefinition[];
}

/**
 * Performance analysis result for expressions
 */
export interface ExpressionComplexity {
  depth: number;
  nodeCount: number;
  hasRecursion: boolean;
  estimatedComplexity: "low" | "medium" | "high";
}

/**
 * Performance analysis result for entire grammars
 */
export interface GrammarPerformance {
  ruleCount: number;
  estimatedParseComplexity: "low" | "medium" | "high";
  optimizationSuggestions: string[];
  ruleComplexity: Map<string, ExpressionComplexity>;
}

/**
 * Template data interface for rules
 */
export interface RuleTemplateData {
  namePrefix: string;
  name: string;
  type: string;
  implementation: string;
  memoized: boolean;
  includeTypes: boolean;
  comment?: string | undefined;
  complexity?: ExpressionComplexity | undefined;
}

/**
 * Template data interface for complete parser file
 */
export interface ParserTemplateData {
  imports: string[];
  performanceImports?: string[];
  rules: RuleTemplateData[];
  header?: string;
  footer?: string;
  options: CodeGenOptions;
}

/**
 * Base code generation options
 */
export interface CodeGenOptions {
  /** Target language (currently only TypeScript) */
  language: "typescript";
  /** Generated parser name prefix */
  namePrefix?: string;
  /** Include runtime imports */
  includeImports?: boolean;
  /** Generate with type annotations */
  includeTypes?: boolean;
  /** Enable performance optimizations */
  optimize?: boolean;
  /** Enable memoization for complex expressions */
  enableMemoization?: boolean;
  /** Include performance monitoring code */
  includeMonitoring?: boolean;
  /** Custom template directory */
  templatesDir?: string;
  /** Enable template caching */
  cache?: boolean;
  /** Debug mode */
  debug?: boolean;
}

/**
 * Generated code result with metadata
 */
export interface GeneratedCode {
  /** Generated TypeScript code */
  code: string;
  /** Required imports */
  imports: string[];
  /** Export declarations */
  exports: string[];
  /** Performance analysis */
  performance: {
    estimatedComplexity: "low" | "medium" | "high";
    optimizationSuggestions: string[];
    generationTime: number;
    templateEngine: string;
  };
}
