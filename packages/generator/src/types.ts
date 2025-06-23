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

export interface Expression {
  type: string;
}

export interface StringLiteral extends Expression {
  type: 'StringLiteral';
  value: string;
}

export interface CharacterClass extends Expression {
  type: 'CharacterClass';
  ranges: Array<{ start: string; end?: string }>;
  negated: boolean;
}

export interface Identifier extends Expression {
  type: 'Identifier';
  name: string;
}

export interface Sequence extends Expression {
  type: 'Sequence';
  elements: Expression[];
}

export interface Choice extends Expression {
  type: 'Choice';
  alternatives: Expression[];
}

export interface Group extends Expression {
  type: 'Group';
  expression: Expression;
}

export interface Star extends Expression {
  type: 'Star';
  expression: Expression;
}

export interface Plus extends Expression {
  type: 'Plus';
  expression: Expression;
}

export interface Optional extends Expression {
  type: 'Optional';
  expression: Expression;
}

export interface Quantified extends Expression {
  type: 'Quantified';
  expression: Expression;
  min: number;
  max?: number;
}

export interface PositiveLookahead extends Expression {
  type: 'PositiveLookahead';
  expression: Expression;
}

export interface NegativeLookahead extends Expression {
  type: 'NegativeLookahead';
  expression: Expression;
}

export interface LabeledExpression extends Expression {
  type: 'LabeledExpression';
  label: string;
  expression: Expression;
}

// Union type for all specific expression types
export type SpecificExpression = 
  | StringLiteral 
  | CharacterClass 
  | Identifier 
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

export interface RuleDefinition {
  type: 'RuleDefinition';
  name: string;
  pattern: Expression;
}

export interface GrammarDefinition {
  type: 'GrammarDefinition';
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
  estimatedComplexity: 'low' | 'medium' | 'high';
}

/**
 * Performance analysis result for entire grammars
 */
export interface GrammarPerformance {
  ruleCount: number;
  estimatedParseComplexity: 'low' | 'medium' | 'high';
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
  language: 'typescript';
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
    estimatedComplexity: 'low' | 'medium' | 'high';
    optimizationSuggestions: string[];
    generationTime: number;
    templateEngine: string;
  };
}