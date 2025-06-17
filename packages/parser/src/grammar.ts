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
import {
  grammarBlockWhitespace,
  optionalWhitespace,
  whitespace,
} from "./whitespace-utils";

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
 */
export const ruleDefinition: Parser<RuleDefinition> = map(
  sequence(
    optionalWhitespace,
    identifier,
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.RULE_ASSIGNMENT),
    optionalWhitespace,
    expression(),
  ),
  (results) => createRuleDefinition(results[1].name, results[5]),
);

/**
 * Internal type for discriminating between grammar items during parsing
 */
type GrammarItemType =
  | { type: "annotation"; value: GrammarAnnotation }
  | { type: "rule"; value: RuleDefinition };

/**
 * Parse grammar item (annotation or rule)
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
);

/**
 * Parse a sequence of grammar items separated by optional whitespace
 */
const grammarItems: Parser<GrammarItemType[]> = zeroOrMore(
  map(sequence(grammarItem, optionalWhitespace), ([item, _]) => item),
);

/**
 * Separate grammar items into annotations and rules
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
  }

  return { annotations, rules };
};

/**
 * Parse complete grammar definition block
 * Format: grammar Name { @annotations... rule_definitions... }
 */
export const grammarDefinition: Parser<GrammarDefinition> = map(
  sequence(
    literal(GRAMMAR_KEYWORDS.GRAMMAR),
    whitespace,
    identifier,
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.GRAMMAR_BLOCK_OPEN),
    optionalWhitespace,
    grammarItems,
    literal(GRAMMAR_SYMBOLS.GRAMMAR_BLOCK_CLOSE),
  ),
  (results) => {
    const grammarName = results[2].name;
    const items = results[6];
    const { annotations, rules } = separateGrammarItems(items);

    return createGrammarDefinition(grammarName, annotations, rules);
  },
);
