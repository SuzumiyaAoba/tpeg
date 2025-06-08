/**
 * TPEG String Literal Parser
 * 
 * Implements parsing of string literals: "hello", 'world', `template`
 * Based on docs/peg-grammar.md specification.
 */

import type { Parser } from 'tpeg-core';
import type { StringLiteral } from './types';
import { literal, charClass, map, choice, seq, zeroOrMore } from 'tpeg-core';
import { between } from 'tpeg-combinator';

/**
 * Parses escape sequences within string literals.
 * Supports: \n, \r, \t, \\, \", \', \`
 */
const escapeSequence = (): Parser<string> => {
  return map(
    seq(literal('\\'), charClass('n', 'r', 't', '\\', '"', "'", '`')),
    ([_, char]) => {
      switch (char) {
        case 'n': return '\n';
        case 'r': return '\r';
        case 't': return '\t';
        case '\\': return '\\';
        case '"': return '"';
        case "'": return "'";
        case '`': return '`';
        default: return char;
      }
    }
  );
};

/**
 * Parses a character within a double-quoted string.
 * Handles escape sequences and regular characters.
 */
const doubleQuoteChar = (): Parser<string> => {
  return choice(
    escapeSequence(),
    // Any character except " and \
    charClass([' ', '!'], ['#', '['], [']', '~'])
  );
};

/**
 * Parses a character within a single-quoted string.
 * Handles escape sequences and regular characters.
 */
const singleQuoteChar = (): Parser<string> => {
  return choice(
    escapeSequence(),
    // Any character except ' and \
    charClass([' ', '&'], ['(', '['], [']', '~'])
  );
};

/**
 * Parses a character within a template literal.
 * Handles escape sequences and regular characters.
 */
const templateChar = (): Parser<string> => {
  return choice(
    escapeSequence(),
    // Any character except ` and \
    charClass([' ', '_'], ['a', '~'])
  );
};

/**
 * Parses double-quoted string literals: "hello world"
 */
const doubleQuotedString = (): Parser<StringLiteral> => {
  return map(
    seq(
      literal('"'),
      map(zeroOrMore(doubleQuoteChar()), chars => chars.join('')),
      literal('"')
    ),
    ([_, content, __]) => ({
      type: 'StringLiteral' as const,
      value: content,
      quote: '"' as const
    })
  );
};

/**
 * Parses single-quoted string literals: 'hello world'
 */
const singleQuotedString = (): Parser<StringLiteral> => {
  return map(
    seq(
      literal("'"),
      map(zeroOrMore(singleQuoteChar()), chars => chars.join('')),
      literal("'")
    ),
    ([_, content, __]) => ({
      type: 'StringLiteral' as const,
      value: content,
      quote: "'" as const
    })
  );
};

/**
 * Parses template literals: `hello world`
 */
const templateLiteral = (): Parser<StringLiteral> => {
  return map(
    seq(
      literal('`'),
      map(zeroOrMore(templateChar()), chars => chars.join('')),
      literal('`')
    ),
    ([_, content, __]) => ({
      type: 'StringLiteral' as const,
      value: content,
      quote: '`' as const
    })
  );
};

/**
 * Parses any valid TPEG string literal.
 * Supports double quotes, single quotes, and template literals.
 * 
 * @returns Parser<StringLiteral> Parser that matches string literals
 * 
 * @example
 * ```typescript
 * const result1 = stringLiteral()("\"hello\"", { offset: 0, line: 1, column: 1 });
 * // result1.success === true, result1.val.value === "hello", result1.val.quote === '"'
 * 
 * const result2 = stringLiteral()("'world'", { offset: 0, line: 1, column: 1 });
 * // result2.success === true, result2.val.value === "world", result2.val.quote === "'"
 * 
 * const result3 = stringLiteral()("`template`", { offset: 0, line: 1, column: 1 });
 * // result3.success === true, result3.val.value === "template", result3.val.quote === "`"
 * ```
 */
export const stringLiteral = (): Parser<StringLiteral> => {
  return choice(
    doubleQuotedString(),
    singleQuotedString(),
    templateLiteral()
  );
}; 