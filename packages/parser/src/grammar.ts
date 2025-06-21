/**
 * Grammar Definition Block parsing implementation for TPEG
 *
 * This module implements Phase 1.6 of the TPEG parser:
 * - Grammar metadata annotations (@version, @description, etc.)
 * - Rule definitions (rule_name = pattern)
 * - Grammar block structure (grammar Name { ... })
 * - Comment handling (// and /// documentation)
 */

import type { Parser } from "tpeg-core";
import {
  choice,
  literal,
  map,
  seq as sequence,
  star as zeroOrMore,
} from "tpeg-core";
import { expression } from "./composition";
import { GRAMMAR_KEYWORDS, GRAMMAR_SYMBOLS } from "./constants";
import { identifier } from "./identifier";
import { stringLiteral } from "./string-literal";
import type {
  GrammarAnnotation,
  GrammarDefinition,
  RuleDefinition,
} from "./types";
import {
  createGrammarAnnotation,
  createGrammarDefinition,
  createRuleDefinition,
} from "./types";
import { optionalWhitespace, whitespace } from "./whitespace-utils";

/**
 * Bounded expression parser for grammar rules
 * This parser stops at newlines or the next rule definition to prevent consuming the next rule
 */
const grammarRuleExpression: Parser<Expression> = (input: string, pos) => {
  // Find the end of the current rule expression
  // Look for newlines or the next rule definition pattern (identifier followed by =)
  let endPos = pos.offset;
  let foundEnd = false;

  while (endPos < input.length && !foundEnd) {
    const char = input[endPos];

    // Stop at newlines
    if (char === "\n" || char === "\r") {
      foundEnd = true;
      break;
    }

    // Look ahead to see if we're at the start of a new rule definition
    // A rule definition starts with: whitespace* identifier whitespace* "="
    if (char === " " || char === "\t") {
      // Skip whitespace and look for identifier pattern
      let checkPos = endPos;
      while (
        checkPos < input.length &&
        (input[checkPos] === " " || input[checkPos] === "\t")
      ) {
        checkPos++;
      }

      // Check if we have an identifier followed by =
      if (checkPos < input.length) {
        // Look for identifier pattern: [a-zA-Z_][a-zA-Z0-9_]*
        const currentChar = input[checkPos];
        if (currentChar && /[a-zA-Z_]/.test(currentChar)) {
          checkPos++;
          while (checkPos < input.length) {
            const nextChar = input[checkPos];
            if (nextChar && /[a-zA-Z0-9_]/.test(nextChar)) {
              checkPos++;
            } else {
              break;
            }
          }

          // Skip whitespace after identifier
          while (
            checkPos < input.length &&
            (input[checkPos] === " " || input[checkPos] === "\t")
          ) {
            checkPos++;
          }

          // Check if we have an = sign
          if (checkPos < input.length && input[checkPos] === "=") {
            // We found the start of the next rule, stop here
            foundEnd = true;
            break;
          }
        }
      }
    }

    endPos++;
  }

  // Create a substring that only includes the current rule expression
  const ruleContent = input.slice(pos.offset, endPos);

  // Parse the expression within this bounded content
  const result = expression()(ruleContent, {
    offset: 0,
    line: pos.line,
    column: pos.column,
  });

  if (result.success) {
    // Adjust the position back to the original input context
    return {
      success: true,
      val: result.val,
      current: pos,
      next: {
        offset: pos.offset + result.next.offset,
        line: pos.line,
        column: pos.column + result.next.offset,
      },
    };
  }
  return {
    success: false,
    error: {
      message: result.error.message,
      pos: {
        offset: pos.offset + result.error.pos.offset,
        line: pos.line,
        column: pos.column + result.error.pos.offset,
      },
    },
  };
};

/**
 * Parse line-oriented whitespace including newlines for grammar blocks
 * This handles whitespace, newlines, and comments between grammar items
 */
const grammarBlockWhitespace: Parser<string> = map(
  zeroOrMore(
    choice(
      literal(" "),
      literal("\t"),
      literal("\r\n"),
      literal("\n"),
      literal("\r"),
    ),
  ),
  (chars) => chars.join(""),
);

/**
 * Parse any character except newline
 * Uses a simple approach by rejecting newline characters
 */
const nonNewlineChar: Parser<string> = (input: string, pos) => {
  if (pos.offset >= input.length) {
    return { success: false, error: { message: "EOF", pos } };
  }
  const char = input[pos.offset];
  if (!char || char === "\n" || char === "\r") {
    return { success: false, error: { message: "Newline or EOF", pos } };
  }
  return {
    success: true,
    val: char,
    current: pos,
    next: { offset: pos.offset + 1, line: pos.line, column: pos.column + 1 },
  };
};

/**
 * Parse single-line comments starting with //
 * Extracts and trims the comment content after the // prefix
 */
export const singleLineComment: Parser<string> = map(
  sequence(
    literal(GRAMMAR_SYMBOLS.SINGLE_LINE_COMMENT),
    zeroOrMore(nonNewlineChar),
  ),
  ([_, content]) => content.join("").trim(),
);

/**
 * Parse documentation comments starting with ///
 * Extracts and trims the documentation content after the /// prefix
 */
export const documentationComment: Parser<string> = map(
  sequence(
    literal(GRAMMAR_SYMBOLS.DOCUMENTATION_COMMENT),
    zeroOrMore(nonNewlineChar),
  ),
  ([_, content]) => content.join("").trim(),
);

/**
 * Parse a quoted string value for annotations
 * Reuses the existing stringLiteral parser and extracts the value
 */
export const quotedString: Parser<string> = map(
  stringLiteral,
  (node) => node.value,
);

/**
 * Parse grammar annotation like @version: "1.0" (with optional leading whitespace)
 * Returns a GrammarAnnotation AST node with the key and value extracted
 */
export const grammarAnnotation: Parser<GrammarAnnotation> = map(
  sequence(
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.ANNOTATION_PREFIX),
    identifier,
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.LABEL_SEPARATOR),
    optionalWhitespace,
    quotedString,
  ),
  (results) => createGrammarAnnotation(results[2].name, results[6]),
);

/**
 * Parse rule definition like rule_name = pattern (with optional leading whitespace)
 * Returns a RuleDefinition AST node with the rule name and pattern
 * Uses bounded expression parser to prevent consuming newlines
 */
export const ruleDefinition: Parser<RuleDefinition> = map(
  sequence(
    optionalWhitespace,
    identifier,
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.RULE_ASSIGNMENT),
    optionalWhitespace,
    grammarRuleExpression,
  ),
  (results) => createRuleDefinition(results[1].name, results[5]),
);

/**
 * Internal type for discriminating between grammar items during parsing
 */
type GrammarItemType =
  | { type: "annotation"; value: GrammarAnnotation }
  | { type: "rule"; value: RuleDefinition }
  | { type: "comment"; value: string };

/**
 * Parse grammar item (annotation, rule, or comment)
 * Returns a tagged union for easier processing in the main grammar parser
 */
const grammarItem: Parser<GrammarItemType> = choice(
  map(
    grammarAnnotation,
    (annotation): GrammarItemType => ({
      type: "annotation",
      value: annotation,
    }),
  ),
  map(
    ruleDefinition,
    (rule): GrammarItemType => ({ type: "rule", value: rule }),
  ),
  map(
    singleLineComment,
    (comment): GrammarItemType => ({ type: "comment", value: comment }),
  ),
  map(
    documentationComment,
    (comment): GrammarItemType => ({ type: "comment", value: comment }),
  ),
);

/**
 * Parse a sequence of grammar items separated by optional whitespace
 */
const grammarItems: Parser<GrammarItemType[]> = map(
  sequence(
    grammarBlockWhitespace,
    zeroOrMore(
      map(sequence(grammarItem, grammarBlockWhitespace), ([item, _]) => item),
    ),
  ),
  ([_, items]) => items,
);

/**
 * Separate grammar items into annotations and rules
 * Comments are ignored as they don't contribute to the AST
 * @param items Array of mixed grammar items
 * @returns Separated annotations and rules arrays
 */
const separateGrammarItems = (
  items: GrammarItemType[],
): {
  annotations: GrammarAnnotation[];
  rules: RuleDefinition[];
} => {
  const annotations: GrammarAnnotation[] = [];
  const rules: RuleDefinition[] = [];

  for (const item of items) {
    if (item.type === "annotation") {
      annotations.push(item.value);
    } else if (item.type === "rule") {
      rules.push(item.value);
    }
    // Comments are ignored - they don't contribute to the grammar structure
  }

  return { annotations, rules };
};

/**
 * Parse one unit of leading content (comment or whitespace line)
 * Each choice must consume at least one character to avoid infinite loops
 */
const leadingContentItem: Parser<void> = map(
  choice(
    singleLineComment, // Consumes // + content + implicit newline handling
    documentationComment, // Consumes /// + content + implicit newline handling
    literal("\n"), // Consumes newline
    literal("\r\n"), // Consumes CRLF
    literal("\r"), // Consumes CR
    literal(" "), // Consumes space
    literal("\t"), // Consumes tab
  ),
  () => undefined,
);

/**
 * Parse leading comments and whitespace before grammar definition
 * This handles comments and whitespace that appear before the grammar keyword
 */
const leadingContent: Parser<void> = map(
  zeroOrMore(leadingContentItem),
  () => undefined,
);

/**
 * Parse complete grammar definition block with optional leading comments
 * Format: [comments...] grammar Name { @annotations... rule_definitions... }
 */
export const grammarDefinition: Parser<GrammarDefinition> = map(
  sequence(
    leadingContent,
    literal(GRAMMAR_KEYWORDS.GRAMMAR),
    whitespace,
    identifier,
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.GRAMMAR_BLOCK_OPEN),
    grammarItems,
    grammarBlockWhitespace,
    literal(GRAMMAR_SYMBOLS.GRAMMAR_BLOCK_CLOSE),
  ),
  (results) => {
    const grammarName = results[3].name;
    const items = results[6];
    const { annotations, rules } = separateGrammarItems(items);

    return createGrammarDefinition(grammarName, annotations, rules);
  },
);
