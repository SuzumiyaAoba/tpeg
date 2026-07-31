/**
 * Constants and string literals used throughout the TPEG parser
 *
 * This module centralizes all magic strings, symbols, and constants
 * to ensure consistency and make the codebase easier to maintain.
 */

/**
 * AST node type constants
 * These correspond to the "type" field in AST nodes
 */
export const AST_NODE_TYPES = {
  // Basic syntax nodes
  STRING_LITERAL: "StringLiteral",
  CHARACTER_CLASS: "CharacterClass",
  IDENTIFIER: "Identifier",
  ANY_CHAR: "AnyChar",

  // Composition nodes
  SEQUENCE: "Sequence",
  CHOICE: "Choice",
  GROUP: "Group",

  // Repetition nodes
  STAR: "Star",
  PLUS: "Plus",
  OPTIONAL: "Optional",
  QUANTIFIED: "Quantified",

  // Lookahead nodes
  POSITIVE_LOOKAHEAD: "PositiveLookahead",
  NEGATIVE_LOOKAHEAD: "NegativeLookahead",

  // Label nodes
  LABELED_EXPRESSION: "LabeledExpression",

  // Grammar nodes
  GRAMMAR_ANNOTATION: "GrammarAnnotation",
  RULE_DEFINITION: "RuleDefinition",
  GRAMMAR_DEFINITION: "GrammarDefinition",
} as const;

/**
 * Grammar syntax symbols and operators
 */
export const GRAMMAR_SYMBOLS = {
  // Choice operator
  CHOICE_OPERATOR: "/",

  // Label separator
  LABEL_SEPARATOR: ":",

  // Grouping
  GROUP_OPEN: "(",
  GROUP_CLOSE: ")",

  // Grammar block delimiters
  GRAMMAR_BLOCK_OPEN: "{",
  GRAMMAR_BLOCK_CLOSE: "}",

  // Character class delimiters
  CHAR_CLASS_OPEN: "[",
  CHAR_CLASS_CLOSE: "]",
  CHAR_CLASS_NEGATION: "^",
  CHAR_RANGE_SEPARATOR: "-",

  // Repetition operators
  STAR: "*",
  PLUS: "+",
  OPTIONAL: "?",
  QUANTIFIER_OPEN: "{",
  QUANTIFIER_CLOSE: "}",
  QUANTIFIER_SEPARATOR: ",",

  // Lookahead operators
  POSITIVE_LOOKAHEAD: "&",
  NEGATIVE_LOOKAHEAD: "!",

  // Grammar annotation prefix
  ANNOTATION_PREFIX: "@",

  // Rule assignment
  RULE_ASSIGNMENT: "=",

  // Any character
  ANY_CHAR: ".",

  // Comment prefixes
  SINGLE_LINE_COMMENT: "//",
  DOCUMENTATION_COMMENT: "///",
} as const;

/**
 * Quote characters for string literals
 */
export const QUOTE_CHARS = {
  DOUBLE: '"',
  SINGLE: "'",
} as const;

/**
 * Whitespace character constants
 */
export const WHITESPACE_CHARS = [" ", "\t", "\n", "\r"] as const;

/**
 * Escape character constants
 */
export const ESCAPE_CHARS = {
  BACKSLASH: "\\",
  ESCAPED_QUOTE: '\\"',
  ESCAPED_SINGLE: "\\'",
  ESCAPED_NEWLINE: "\\n",
  ESCAPED_TAB: "\\t",
  ESCAPED_CARRIAGE_RETURN: "\\r",
  ESCAPED_BACKSLASH: "\\\\",
} as const;

/**
 * Named escapes for control characters that can't appear literally inside a
 * double-quoted TypeScript string. Grammar values commonly contain these
 * (e.g. a whitespace character class `[ \t\n\r]` decodes to actual tab/
 * newline/CR bytes, not the two-character `\t` etc. sequences), so
 * `escapeStringLiteral` must re-escape them, not just backslash/quote.
 */
const NAMED_CONTROL_CHAR_ESCAPES: Record<string, string> = {
  "\n": ESCAPE_CHARS.ESCAPED_NEWLINE,
  "\r": ESCAPE_CHARS.ESCAPED_CARRIAGE_RETURN,
  "\t": ESCAPE_CHARS.ESCAPED_TAB,
  "\b": "\\b",
  "\f": "\\f",
  "\v": "\\v",
  "\0": "\\0",
};

/**
 * Escapes a string literal's value for embedding in generated TypeScript
 * source (as the argument to `literal("...")`). Shared by the base and
 * optimized code generators.
 *
 * Beyond backslash/double-quote, this also re-escapes control characters
 * (newline, tab, CR, and other non-printable bytes) - without it, a value
 * containing an actual newline byte would emit as a raw newline inside a
 * `"..."` literal, which is invalid TypeScript (unterminated string).
 */
export const escapeStringLiteral = (value: string): string => {
  let result = "";
  for (const char of value) {
    if (char === ESCAPE_CHARS.BACKSLASH) {
      result += ESCAPE_CHARS.ESCAPED_BACKSLASH;
      continue;
    }
    if (char === QUOTE_CHARS.DOUBLE) {
      result += ESCAPE_CHARS.ESCAPED_QUOTE;
      continue;
    }
    const named = NAMED_CONTROL_CHAR_ESCAPES[char];
    if (named) {
      result += named;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      result += `\\x${code.toString(16).padStart(2, "0")}`;
      continue;
    }
    result += char;
  }
  return result;
};

/**
 * Grammar keywords
 */
export const GRAMMAR_KEYWORDS = {
  GRAMMAR: "grammar",
  TRANSFORMS: "transforms",
} as const;

/**
 * Transform-related symbols and operators
 */
export const TRANSFORM_SYMBOLS = {
  // Transform declaration
  TRANSFORM_DECLARATION: "transforms",

  // Language specification separator
  LANGUAGE_SEPARATOR: "@",

  // Function declaration
  FUNCTION_KEYWORD: "function",

  // Parameter and return type separators
  PARAMETER_START: "(",
  PARAMETER_END: ")",
  RETURN_TYPE_SEPARATOR: "->",

  // Block delimiters
  TRANSFORM_BLOCK_OPEN: "{",
  TRANSFORM_BLOCK_CLOSE: "}",

  // Type annotations
  TYPE_SEPARATOR: ":",
  OPTIONAL_TYPE: "?",
  ARRAY_TYPE: "[]",
  UNION_TYPE: "|",

  // Result type
  RESULT_TYPE: "Result",
} as const;

/**
 * Supported target languages for transforms
 */
export const SUPPORTED_LANGUAGES = {
  TYPESCRIPT: "typescript",
  PYTHON: "python",
  GO: "go",
  RUST: "rust",
  JAVA: "java",
  CPP: "cpp",
} as const;

/**
 * Common annotation keys used in grammar definitions
 */
export const ANNOTATION_KEYS = {
  VERSION: "version",
  DESCRIPTION: "description",
  START: "start",
  AUTHOR: "author",
  LICENSE: "license",
} as const;

/**
 * Error message templates for consistent error reporting
 */
export const ERROR_MESSAGES = {
  UNEXPECTED_EOF: "Unexpected end of input",
  EXPECTED_IDENTIFIER: "Expected identifier",
  EXPECTED_STRING: "Expected string literal",
  EXPECTED_CHAR_CLASS: "Expected character class",
  UNCLOSED_GROUP: "Unclosed group - missing ')'",
  UNCLOSED_CHAR_CLASS: "Unclosed character class - missing ']'",
  UNCLOSED_STRING: "Unclosed string literal",
  INVALID_ESCAPE: "Invalid escape sequence",
  INVALID_QUANTIFIER: "Invalid quantifier syntax",
  EMPTY_CHOICE: "Empty choice expression",
  EMPTY_SEQUENCE: "Empty sequence expression",
  INVALID_RULE_NAME: "Invalid rule name",
  DUPLICATE_RULE: "Duplicate rule definition",
  MISSING_RULE_ASSIGNMENT: "Missing '=' in rule definition",
  INVALID_ANNOTATION: "Invalid annotation syntax",
} as const;

/**
 * Parser configuration constants
 */
export const PARSER_CONFIG = {
  MAX_RECURSION_DEPTH: 1000,
  MAX_INPUT_LENGTH: 1_000_000,
  DEFAULT_POSITION: { offset: 0, line: 1, column: 1 },
} as const;

/**
 * Regular expression patterns used in parsing
 */
export const REGEX_PATTERNS = {
  IDENTIFIER: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
  NUMBER: /^\d+$/,
  WHITESPACE: /^\s+$/,
  NEWLINE: /^[\n\r]$/,
} as const;
