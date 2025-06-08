/**
 * TPEG Parser - Entry Point
 * 
 * Main entry point for the TPEG Grammar Parser.
 * Exports all basic syntax parsers and types.
 */

// Export types
export * from './types';

// Export individual parsers
export { stringLiteral } from './string-literal';
export { characterClass } from './character-class';
export { identifier } from './identifier';

// Re-export core and combinator parsers that might be useful
export { choice, seq, map, optional, zeroOrMore, oneOrMore } from 'tpeg-core';
export { token, sepBy, sepBy1 } from 'tpeg-combinator';

import type { Parser } from 'tpeg-core';
import type { BasicSyntaxNode } from './types';
import { choice } from 'tpeg-core';
import { stringLiteral } from './string-literal';
import { characterClass } from './character-class';
import { identifier } from './identifier';

/**
 * Combined parser for all basic TPEG syntax elements.
 * Attempts to parse string literals, character classes, or identifiers.
 * 
 * @returns Parser<BasicSyntaxNode> Parser that matches any basic syntax element
 * 
 * @example
 * ```typescript
 * const result1 = basicSyntax()('"hello"', { offset: 0, line: 1, column: 1 });
 * // result1.success === true, result1.val.type === "StringLiteral"
 * 
 * const result2 = basicSyntax()('[a-z]', { offset: 0, line: 1, column: 1 });
 * // result2.success === true, result2.val.type === "CharacterClass"
 * 
 * const result3 = basicSyntax()('identifier', { offset: 0, line: 1, column: 1 });
 * // result3.success === true, result3.val.type === "Identifier"
 * ```
 */
export const basicSyntax = (): Parser<BasicSyntaxNode> => {
  return choice(
    stringLiteral(),
    characterClass(),
    identifier()
  );
}; 