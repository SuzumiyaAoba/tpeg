/**
 * TPEG Code Generator
 *
 * Template-based code generation system for TPEG parsers.
 * Separated from parser package for modular architecture.
 */

// Export main generator classes and functions
export {
  EtaTPEGCodeGenerator,
  generateEtaTypeScriptParser,
} from "./eta-generator";

export { generateNativeParser } from "./native-generator";
export {
  generateJavaScriptParser,
  transpileGeneratedParser,
} from "./javascript-generator";
export type {
  NativeLanguage,
  NativeCodeGenOptions,
  NativeGeneratedCode,
} from "./native-generator";
export {
  CodeGeneratorRegistry,
  createGeneratorRegistry,
  generateParser,
} from "./generator-registry";
export type {
  CodeGeneratorPlugin,
  GeneratedParser,
  ParserGenerationOptions,
} from "./generator-registry";

// Export performance utilities
export {
  PerformanceMonitor,
  globalPerformanceMonitor,
  analyzeExpressionComplexity,
  analyzeGrammarPerformance,
} from "./performance-utils";

// Export type definitions
export type {
  Expression,
  GrammarDefinition,
  RuleDefinition,
  StringLiteral,
  CharacterClass,
  Identifier,
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
  ExpressionComplexity,
  GrammarPerformance,
  RuleTemplateData,
  ParserTemplateData,
  CodeGenOptions,
  GeneratedCode,
} from "./types";
