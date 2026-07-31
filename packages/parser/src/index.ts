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
  quotedString,
  singleLineComment,
  documentationComment,
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

// Export optimized code generation system
export {
  OptimizedTPEGCodeGenerator,
  generateOptimizedTypeScriptParser,
  type OptimizedCodeGenOptions,
  type OptimizedGeneratedCode,
} from "./codegen-optimized";

// NOTE: Eta template-based code generation moved to @SuzumiyaAoba/generator package

// Export performance utilities
export {
  hashString,
  stringInterner,
  createCharClassLookup,
  analyzeExpressionComplexity,
  analyzeGrammarPerformance,
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

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  choice as coreChoice,
  map,
  sequence,
  star,
} from "@suzumiyaaoba/tpeg-core";
import { characterClass } from "./character-class";
import { expression } from "./composition";
import { grammarDefinition } from "./grammar";
import { identifier } from "./identifier";
import { stringLiteral } from "./string-literal";
import { transformDefinition } from "./transforms";
import type { BasicSyntaxNode, GrammarDefinition } from "./types";
import { whitespace } from "./whitespace-utils";

/**
 * Combined parser for all basic TPEG syntax elements.
 * Attempts to parse string literals, character classes, or identifiers.
 *
 * @returns Parser<BasicSyntaxNode> Parser that matches any basic syntax element
 *
 * @example
 * ```typescript
 * const result1 = basicSyntax('"hello"', { offset: 0, line: 1, column: 1 });
 * // result1.success === true, result1.val.type === "StringLiteral"
 *
 * const result2 = basicSyntax('[a-z]', { offset: 0, line: 1, column: 1 });
 * // result2.success === true, result2.val.type === "CharacterClass"
 *
 * const result3 = basicSyntax('identifier', { offset: 0, line: 1, column: 1 });
 * // result3.success === true, result3.val.type === "Identifier"
 * ```
 */
export const basicSyntax: Parser<BasicSyntaxNode> = coreChoice(
  stringLiteral,
  characterClass,
  identifier,
);

/**
 * Combined parser for all TPEG expression elements including composition operators.
 * Supports sequences, choices, groups, and basic syntax elements.
 *
 * @returns Parser<Expression> Parser that matches any TPEG expression
 *
 * @example
 * ```typescript
 * // Parse basic syntax
 * const result1 = tpegExpression('"hello"', { offset: 0, line: 1, column: 1 });
 *
 * // Parse sequence
 * const result2 = tpegExpression('"hello" " " "world"', { offset: 0, line: 1, column: 1 });
 *
 * // Parse choice
 * const result3 = tpegExpression('"true" / "false"', { offset: 0, line: 1, column: 1 });
 *
 * // Parse group with complex precedence
 * const result4 = tpegExpression('("a" / "b") "c"', { offset: 0, line: 1, column: 1 });
 * ```
 */
export const tpegExpression = expression();

/**
 * Parses a complete `.tpeg` file: a single `grammar Name { ... }` block,
 * optionally followed by one or more `transforms Name@language { ... }`
 * blocks. The transforms are attached to the returned grammar's
 * `transforms` array, exactly as `GrammarDefinition.transforms` expects,
 * so the result can be passed directly to `generateTypeScriptParser` (or
 * the optimized/Eta generators) to get transform-aware generated code.
 *
 * @example
 * ```typescript
 * const result = parse(tpegFile)(`
 *   grammar Calculator {
 *     number = [0-9]+
 *   }
 *
 *   transforms Evaluator@typescript {
 *     number(captures: string) -> Result<number> {
 *       return { success: true, value: parseInt(captures, 10) };
 *     }
 *   }
 * `);
 * ```
 */
export const tpegFile: Parser<GrammarDefinition> = map(
  sequence(
    grammarDefinition,
    star(
      map(
        sequence(star(whitespace), transformDefinition),
        ([, transform]) => transform,
      ),
    ),
  ),
  ([grammar, transforms]) => ({
    ...grammar,
    ...(transforms.length > 0
      ? { transforms: [...(grammar.transforms ?? []), ...transforms] }
      : {}),
  }),
);

// Export module system parsers
export * from "./module";

// Export module resolution engine
export * from "./module-resolver";

// Export namespace management system
export * from "./namespace-manager";

// Export version management system
export * from "./version-manager";
