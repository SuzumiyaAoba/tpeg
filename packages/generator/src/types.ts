/**
 * Type definitions for TPEG Code Generator
 *
 * These types are used for code generation and template rendering.
 * The grammar AST types are the canonical ones from @suzumiyaaoba/tpeg-core;
 * this module only adds generation-specific interfaces on top of them.
 */

import type {
  AnyChar,
  CharacterClass,
  Choice,
  Expression,
  GrammarDefinition,
  Group,
  Identifier,
  LabeledExpression,
  NegativeLookahead,
  Optional,
  Plus,
  PositiveLookahead,
  QualifiedIdentifier,
  Quantified,
  RuleDefinition,
  Sequence,
  Star,
  StringLiteral,
} from "@suzumiyaaoba/tpeg-core";

/** Discriminant values of {@link Expression}, derived from core's AST union. */
export type ExpressionType = Expression["type"];

export type {
  Expression,
  StringLiteral,
  CharacterClass,
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
  LabeledExpression,
  RuleDefinition,
  GrammarDefinition,
};

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
