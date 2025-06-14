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
  oneOrMore,
  optional,
  seq as sequence,
  star as zeroOrMore
} from "tpeg-core";
import type { 
  GrammarDefinition, 
  GrammarAnnotation, 
  RuleDefinition, 
  Expression 
} from "./types";
import { identifier } from "./identifier";
import { stringLiteral } from "./string-literal";
import { expression } from "./composition";

/**
 * Parse whitespace (spaces, tabs, newlines, carriage returns)
 */
export const whitespace: Parser<string> = map(
  oneOrMore(choice(literal(" "), literal("\t"), literal("\n"), literal("\r"))),
  (chars) => chars.join("")
);

/**
 * Optional whitespace parser
 */
export const optionalWhitespace: Parser<string> = map(
  optional(whitespace),
  (ws) => ws.length > 0 && ws[0] !== undefined ? ws[0] : ""
);

/**
 * Parse any character except newline
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
    next: { offset: pos.offset + 1, line: pos.line, column: pos.column + 1 }
  };
};

/**
 * Parse single-line comments starting with //
 */
export const singleLineComment: Parser<string> = map(
  sequence(
    literal("//"),
    zeroOrMore(nonNewlineChar)
  ),
  ([_, content]) => content.join("").trim()
);

/**
 * Parse documentation comments starting with ///
 */
export const documentationComment: Parser<string> = map(
  sequence(
    literal("///"),
    zeroOrMore(nonNewlineChar)
  ),
  ([_, content]) => content.join("").trim()
);

/**
 * Parse a quoted string value for annotations
 * Reuses the existing stringLiteral parser and extracts the value
 */
export const quotedString: Parser<string> = map(
  stringLiteral,
  (node) => node.value
);

/**
 * Parse grammar annotation like @version: "1.0" (with optional leading whitespace)
 */
export const grammarAnnotation: Parser<GrammarAnnotation> = map(
  sequence(
    optionalWhitespace,
    literal("@"),
    identifier,
    optionalWhitespace,
    literal(":"),
    optionalWhitespace,
    quotedString
  ),
  ([_, __, keyNode, ___, ____, _____, value]) => ({
    type: "GrammarAnnotation" as const,
    key: keyNode.name,
    value
  })
);

/**
 * Parse rule definition like rule_name = pattern (with optional leading whitespace)
 */
export const ruleDefinition: Parser<RuleDefinition> = map(
  sequence(
    optionalWhitespace,
    identifier,
    optionalWhitespace,
    literal("="),
    optionalWhitespace,
    expression()
  ),
  ([_, nameNode, __, ___, ____, pattern]) => ({
    type: "RuleDefinition" as const,
    name: nameNode.name,
    pattern
  } as RuleDefinition)
);


/**
 * Parse grammar item (annotation or rule)
 */
const grammarItem = choice(
  map(grammarAnnotation, (a) => ({ type: "annotation" as const, value: a })),
  map(ruleDefinition, (r) => ({ type: "rule" as const, value: r }))
);

/**
 * Parse complete grammar definition block
 */
export const grammarDefinition: Parser<GrammarDefinition> = map(
  sequence(
    literal("grammar"),
    whitespace,
    identifier,
    optionalWhitespace,
    literal("{"),
    optionalWhitespace,
    zeroOrMore(
      map(
        sequence(grammarItem, optionalWhitespace),
        ([item, _]) => item
      )
    ),
    literal("}")
  ),
  ([_, __, nameNode, ___, ____, _____, items, _______]) => {
    const annotations: GrammarAnnotation[] = [];
    const rules: RuleDefinition[] = [];
    
    for (const item of items) {
      if (item.type === "annotation") {
        annotations.push(item.value);
      } else if (item.type === "rule") {
        rules.push(item.value);
      }
    }
    
    return {
      type: "GrammarDefinition" as const,
      name: nameNode.name,
      annotations,
      rules
    };
  }
);