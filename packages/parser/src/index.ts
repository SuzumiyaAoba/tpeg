/**
 * TPEG Parser - Entry Point
 *
 * Main entry point for the TPEG Grammar Parser.
 * Exports all basic syntax parsers, composition operators, and types.
 */

// Export types
export * from "./types";

// Export individual parsers
export { stringLiteral } from "./string-literal";
export { characterClass } from "./character-class";
export { identifier } from "./identifier";

// Export composition operators
export {
  expression,
  sequenceOperator,
  choiceOperator,
  groupOperator,
} from "./composition";

// Export grammar definition parsers (Phase 1.6)
export {
  grammarAnnotation,
  ruleDefinition,
  grammarDefinition,
  modularGrammarDefinition,
  tpegModuleFile,
  quotedString,
  singleLineComment,
  documentationComment,
  skipTrailingWhitespaceAndComments,
} from "./grammar";

// Export transform definition parser
export { transformDefinition } from "./transforms";

// Export whitespace utilities
export { whitespace, optionalWhitespace } from "./whitespace-utils";

// Export code generation system
export {
  TPEGCodeGenerator,
  generateTypeScriptParser,
  type CodeGenOptions,
  type GeneratedCode,
} from "./codegen";

// Export codegen building blocks shared with @suzumiyaaoba/tpeg-generator's
// Eta-template generator, so it can defer to these instead of maintaining
// its own (previously divergent - see that package's `eta-generator.ts`
// module doc comment) copies of the same PEG-semantics-sensitive logic:
// forward/self/mutual rule references need `lazy(() => ...)` to avoid a
// TDZ `ReferenceError`, a string/char-class literal's value needs control
// characters escaped to stay valid TypeScript source, and an
// `ActionExpression`'s labels need the same collect/filter/wrap steps.
export {
  generateIdentifierCode,
  generateQualifiedIdentifierCode,
  generateStringLiteralCode,
  generateCharacterClassCode,
  generateQuantifiedCode,
  generateLabeledExpressionCode,
  generateChoiceCode,
  collectTopLevelLabels,
  filterReferencedLabels,
  collectTransformFunctions,
  wrapWithAction,
  wrapWithMonitoring,
  wrapWithTransform,
  buildQualifiedIdentifierWarnings,
  forEachSequenceElement,
  sequenceCombinatorFor,
  sequenceHasCutFollowedByElement,
  quantifiedCombinatorFor,
  collectUsedCombinators,
  type UsedCombinatorsContext,
} from "./codegen";
export { escapeStringLiteral } from "@suzumiyaaoba/tpeg-core";

// Export optimized code generation system
export {
  OptimizedTPEGCodeGenerator,
  generateOptimizedTypeScriptParser,
  type OptimizedCodeGenOptions,
  type OptimizedGeneratedCode,
} from "./codegen-optimized";

// NOTE: Eta template-based code generation moved to @SuzumiyaAoba/generator package

// Export static grammar analyses (FIRST sets, nullability, reentrancy) --
// these back the performance-optimized codegen path but are also useful
// standalone, e.g. for a caller that wants to run `applyAstOptimizations`
// or `insertAutomaticCuts` ahead of `generateTypeScriptParser` instead of
// `generateOptimizedTypeScriptParser`.
export {
  isNullable,
  firstSetOfExpression,
  analyzeFirstSets,
  computeFirstSets,
  predictiveFilterForExpression,
  firstSetsDisjoint,
  assertNoNullableRepetition,
  type CharRangeLiteral,
  type FirstSet,
  type GrammarFirstSetAnalysis,
} from "./first-sets";

export { analyzeReentrancy, type ReentrancyAnalysis } from "./reentrancy";

// Export grammar-level structural validation (duplicate rule names, left
// recursion) -- run automatically by both `generateTypeScriptParser` and
// `generateOptimizedTypeScriptParser` before any analysis or code
// generation, but also exported standalone for a caller that wants to
// validate a grammar ahead of time (e.g. a linter, or before applying an
// AST rewrite pass). See `grammar-validation.ts`'s doc comment.
export {
  validateGrammar,
  validateGeneratedIdentifiers,
  assertValidTransformFunctionNames,
  findQualifiedIdentifierReferences,
} from "./grammar-validation";
export type {
  GeneratedIdentifierCheckOptions,
  QualifiedIdentifierReference,
} from "./grammar-validation";

// Export the reference PEG interpreter -- a differential-testing oracle,
// independent of codegen, used by `codegen-differential.spec.ts`. See
// that module's doc comment for why an independent implementation (not
// just comparing codegen variants against each other) is needed.
export {
  makeReferenceInterpreter,
  referenceRecognize,
  ReferenceInterpreterLimitError,
} from "./reference-interpreter";

// Export the random-grammar/random-input differential-fuzzing plumbing
// this package's own `codegen-differential.spec.ts` is built on, so
// `@suzumiyaaoba/tpeg-generator`'s `eta-differential.spec.ts` can drive the
// exact same (grammar, input) space against its Eta-based generator without
// keeping a second, driftable copy. See `differential-fuzz.ts`'s own module
// doc comment.
export {
  makeRng,
  pick,
  LEAVES,
  genExpr,
  genRecursiveRuleBody,
  genMemoizeAnnotation,
  genGrammarSource,
  FIXED_TEST_INPUTS,
  RANDOM_TEST_INPUTS,
  ALL_TEST_INPUTS,
  compileStart,
  keySuccessOnly,
  keyWithValue,
  type ResultKey,
} from "./differential-fuzz";

// Export AST rewrite passes (left-factoring, character-class merging,
// negative-lookahead degeneration, automatic cut insertion). None of
// these run by default in either codegen path -- see each function's
// doc comment for why (mainly: `leftFactorChoices` and friends gate on
// `isShapeSensitiveRule` but don't check ancestor rules' actions, so they
// aren't safe to force on unconditionally). A caller opts in by applying
// them to a `GrammarDefinition` before passing it to a code generator.
export {
  leftFactorChoices,
  mergeCharacterClasses,
  degenerateNegativeLookaheads,
  applyAstOptimizations,
  insertAutomaticCuts,
  promoteGlobalCuts,
} from "./ast-optimize";

// Export performance utilities. `collectRuleDependencies` and
// `findRecursiveRuleNames` are the dependency-graph machinery
// `analyzeGrammarPerformance` is built on -- exported (not just the
// analysis wrappers) so `@suzumiyaaoba/tpeg-generator`'s own, differently-
// thresholded analysis can share this exact walk rather than
// hand-maintaining a driftable copy.
export {
  hashString,
  stringInterner,
  analyzeExpressionComplexity,
  analyzeGrammarPerformance,
  collectRuleDependencies,
  findRecursiveRuleNames,
  PerformanceMonitor,
  globalPerformanceMonitor,
} from "./performance-utils";

// Re-export core parsers that might be useful
export {
  choice,
  seq,
  map,
  optional,
  zeroOrMore,
  oneOrMore,
} from "@suzumiyaaoba/tpeg-core";

// Re-export combinator parsers for backward compatibility
// Note: sepBy and sepBy1 are stable exports, token may have compatibility issues
export { sepBy, sepBy1 } from "@suzumiyaaoba/tpeg-combinator";

// Export the combined entry-level parsers (defined in `combined.ts` so
// this module stays a pure re-export barrel)
export { basicSyntax, tpegExpression, tpegFile } from "./combined";

// Export module system parsers
export * from "./module";

// Export module resolution engine
export * from "./module-resolver";

// Export namespace management system
export * from "./namespace-manager";

// Export version management system
export * from "./version-manager";
