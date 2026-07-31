/**
 * Grammar Definition Block parsing implementation for TPEG
 *
 * This module implements Phase 1.6 of the TPEG parser:
 * - Grammar metadata annotations (@version, @description, etc.)
 * - Rule definitions (rule_name = pattern)
 * - Grammar block structure (grammar Name { ... })
 * - Comment handling (// and /// documentation)
 */

import type {
  ExportDeclaration,
  ModularGrammarDefinition,
} from "@suzumiyaaoba/tpeg-core";
import {
  choice,
  createModularGrammarDefinition,
  createModuleInfo,
  literal,
  map,
  seq as sequence,
  star as zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { expression } from "./composition";
import { GRAMMAR_KEYWORDS, GRAMMAR_SYMBOLS } from "./constants";
import { identifier } from "./identifier";
import { exportDeclaration } from "./module";
import { stringLiteral } from "./string-literal";
import { transformDefinition } from "./transforms";
import type {
  Expression,
  GrammarAnnotation,
  GrammarDefinition,
  RuleDefinition,
  TransformDefinition,
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

const IDENTIFIER_START_CHAR = /[a-zA-Z_]/;
const IDENTIFIER_CONT_CHAR = /[a-zA-Z0-9_]/;

const isSpaceOrTab = (char: string | undefined): boolean =>
  char === " " || char === "\t";

const isLineBreakOrSpaceOrTab = (char: string | undefined): boolean =>
  isSpaceOrTab(char) || char === "\n" || char === "\r";

/**
 * Bounded expression parser for grammar rules.
 *
 * This parser stops at the next rule definition or the enclosing grammar
 * block's closing "}", to prevent `expression()`'s sequence operator (which
 * treats newlines as ordinary inter-element whitespace) from greedily
 * consuming subsequent rules. The boundary check runs on *any* whitespace
 * run (including newlines), not just same-line spaces/tabs, so a rule body
 * can legitimately span multiple lines (e.g. a labeled choice with `/`
 * alternatives on their own lines) as long as what follows isn't actually
 * the start of another rule or the block's end.
 */
const grammarRuleExpression: Parser<Expression> = (input: string, pos) => {
  let endPos = pos.offset;
  let foundEnd = false;

  while (endPos < input.length && !foundEnd) {
    const char = input[endPos];

    if (isLineBreakOrSpaceOrTab(char)) {
      // Look ahead past this whitespace run (without committing to
      // consuming it) to see whether the current rule ends here: either the
      // next rule definition ("identifier whitespace* =") or the grammar
      // block's closing brace.
      let checkPos = endPos;
      let crossedLineBreak = false;
      while (
        checkPos < input.length &&
        isLineBreakOrSpaceOrTab(input[checkPos])
      ) {
        if (input[checkPos] === "\n" || input[checkPos] === "\r") {
          crossedLineBreak = true;
        }
        checkPos++;
      }

      if (checkPos < input.length) {
        const boundaryChar = input[checkPos];

        // Only treat "}" as the block's closing brace when it's preceded by
        // a line break: every real grammar block closes on its own line, so
        // this can't confuse a "}" that appears same-line inside a string
        // literal or character class (e.g. `sep = " }"`), which has no
        // line break to cross before reaching it.
        if (boundaryChar === "}" && crossedLineBreak) {
          foundEnd = true;
          break;
        }

        if (boundaryChar && IDENTIFIER_START_CHAR.test(boundaryChar)) {
          let identEnd = checkPos + 1;
          while (
            identEnd < input.length &&
            IDENTIFIER_CONT_CHAR.test(input[identEnd] ?? "")
          ) {
            identEnd++;
          }

          // Same-line whitespace only: "identifier\n=" isn't recognized as
          // the next rule's start, matching the original implementation.
          let afterIdent = identEnd;
          while (afterIdent < input.length && isSpaceOrTab(input[afterIdent])) {
            afterIdent++;
          }

          // "=" means a rule definition follows ("name = pattern"). Note
          // this deliberately does *not* also treat "identifier(" as a
          // boundary: `grammarItem`'s transform alternative is
          // transformDefinition, which requires a literal "transforms"
          // keyword (see transforms.ts) - a bare "name(params) -> Type {...}"
          // is never a valid grammarItem on its own, so there's nothing to
          // guard against there, and treating "(" as a boundary would
          // instead break a legitimate multi-line sequence whose next line
          // happens to start with "identifier (...)" (e.g. a rule reference
          // immediately followed by a group).
          if (afterIdent < input.length && input[afterIdent] === "=") {
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
    // Only offset needs adjusting back to the original input - line/column
    // are already correct absolute positions, since the sub-parse was
    // seeded with the outer pos.line/pos.column and every core combinator
    // that consumes a "\n" (see nextPos/advancePos in tpeg-core) advances
    // line and resets column accordingly. Recomputing them here from
    // pos.line/pos.column instead (as this used to) is wrong for any rule
    // body that spans multiple lines.
    return {
      success: true,
      val: result.val,
      current: pos,
      next: {
        offset: pos.offset + result.next.offset,
        line: result.next.line,
        column: result.next.column,
      },
    };
  }
  return {
    success: false,
    error: {
      message: result.error.message,
      pos: {
        offset: pos.offset + result.error.pos.offset,
        line: result.error.pos.line,
        column: result.error.pos.column,
      },
    },
  };
};

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
 * Parse a bare (unquoted) identifier as an annotation value, e.g. the
 * `expression` in `@start: expression` or the `whitespace` in
 * `@skip: whitespace` - docs/peg-grammar.md uses this form for annotations
 * that name a rule, as opposed to `@version`/`@description`-style annotations
 * that hold an arbitrary string.
 */
const bareAnnotationValue: Parser<string> = map(identifier, (id) => id.name);

/**
 * Parse an annotation value: a quoted string (tried first, so existing
 * `@key: "value"` annotations are unaffected) or a bare identifier.
 */
const annotationValue: Parser<string> = choice(
  quotedString,
  bareAnnotationValue,
);

/**
 * Parse a `@key: value` annotation (with optional leading whitespace),
 * where value is a quoted string or a bare identifier.
 * Returns a GrammarAnnotation AST node with the key and value extracted.
 */
const keyValueAnnotation: Parser<GrammarAnnotation> = map(
  sequence(
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.ANNOTATION_PREFIX),
    identifier,
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.LABEL_SEPARATOR),
    optionalWhitespace,
    annotationValue,
  ),
  (results) => createGrammarAnnotation(results[2].name, results[6]),
);

/**
 * Parse a flag-only annotation with no value, e.g. `@private` or `@override`.
 * Represented as a GrammarAnnotation with an empty string value.
 *
 * Must be tried after keyValueAnnotation (see grammarAnnotation below): since
 * it doesn't require a ":", trying it first would match just the "@key" part
 * of a real "@key: value" annotation and leave ": value" as unparsed trailing
 * input, hard-failing the enclosing grammar block.
 */
const flagAnnotation: Parser<GrammarAnnotation> = map(
  sequence(
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.ANNOTATION_PREFIX),
    identifier,
  ),
  (results) => createGrammarAnnotation(results[2].name, ""),
);

/**
 * Parse any grammar annotation: `@key: "value"`, `@key: value`, or the
 * flag-only `@key` form.
 */
export const grammarAnnotation: Parser<GrammarAnnotation> = choice(
  keyValueAnnotation,
  flagAnnotation,
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
  | { type: "export"; value: ExportDeclaration }
  | { type: "rule"; value: RuleDefinition }
  | { type: "transform"; value: TransformDefinition }
  | { type: "comment"; value: string };

/**
 * Parse grammar item (export declaration, annotation, rule, transform, or comment)
 * Returns a tagged union for easier processing in the main grammar parser.
 *
 * exportDeclaration is tried before grammarAnnotation: both start with "@",
 * but exportDeclaration only matches the specific "@export: [...]" array-value
 * form, so ordering doesn't create ambiguity with other "@key: \"value\"" annotations.
 */
const grammarItem: Parser<GrammarItemType> = choice(
  map(
    exportDeclaration,
    (decl): GrammarItemType => ({ type: "export", value: decl }),
  ),
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
    transformDefinition,
    (transform): GrammarItemType => ({ type: "transform", value: transform }),
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
 * Separate grammar items into annotations, rules, and transforms
 * Comments are ignored as they don't contribute to the AST
 * @param items Array of mixed grammar items
 * @returns Separated annotations, rules, and transforms arrays
 */
const separateGrammarItems = (
  items: GrammarItemType[],
): {
  annotations: GrammarAnnotation[];
  rules: RuleDefinition[];
  transforms: TransformDefinition[];
  exportedRules: string[];
} => {
  const annotations: GrammarAnnotation[] = [];
  const rules: RuleDefinition[] = [];
  const transforms: TransformDefinition[] = [];
  const exportedRules: string[] = [];

  for (const item of items) {
    if (item.type === "annotation") {
      annotations.push(item.value);
    } else if (item.type === "export") {
      exportedRules.push(...item.value.rules);
    } else if (item.type === "rule") {
      rules.push(item.value);
    } else if (item.type === "transform") {
      transforms.push(item.value);
    }
    // Comments are ignored - they don't contribute to the grammar structure
  }

  return { annotations, rules, transforms, exportedRules };
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
 * Parse a grammar's own name, which docs/peg-grammar.md's module-resolution
 * examples (e.g. `grammar Math.Core { ... }`) allow to be dotted for
 * namespacing. Only used here - rule names and rule-body references use the
 * plain `identifier` parser, since a dot there means a qualified reference
 * (`module.rule`), an unrelated construct.
 */
const dottedGrammarName: Parser<string> = map(
  sequence(
    identifier,
    zeroOrMore(map(sequence(literal("."), identifier), ([, id]) => id.name)),
  ),
  ([first, rest]) => [first.name, ...rest].join("."),
);

/**
 * Shared parser for the "grammar Name { ...items... }" block, used by both
 * grammarDefinition and modularGrammarDefinition below so the two stay in
 * sync on grammar/block syntax.
 * Format: [comments...] grammar Name { @annotations... rule_definitions... }
 */
const grammarBlock: Parser<{ name: string; items: GrammarItemType[] }> = map(
  sequence(
    leadingContent,
    literal(GRAMMAR_KEYWORDS.GRAMMAR),
    whitespace,
    dottedGrammarName,
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.GRAMMAR_BLOCK_OPEN),
    grammarItems,
    grammarBlockWhitespace,
    literal(GRAMMAR_SYMBOLS.GRAMMAR_BLOCK_CLOSE),
  ),
  (results) => ({ name: results[3], items: results[6] }),
);

/**
 * Parse complete grammar definition block with optional leading comments.
 * Any `@export: [...]` declarations are parsed but discarded here - use
 * modularGrammarDefinition when the exports need to be preserved.
 */
export const grammarDefinition: Parser<GrammarDefinition> = map(
  grammarBlock,
  ({ name, items }) => {
    const { annotations, rules, transforms } = separateGrammarItems(items);

    return createGrammarDefinition(name, annotations, rules, transforms);
  },
);

/**
 * Parse a grammar definition block, preserving `@export: [...]` declarations
 * as a ModularGrammarDefinition (used by the module system to know which
 * rules a module makes available to importers). A `moduleInfo.version` is
 * populated from the `@version` annotation when present, since that's the
 * only module-metadata annotation with parser support today.
 */
export const modularGrammarDefinition: Parser<ModularGrammarDefinition> = map(
  grammarBlock,
  ({ name, items }) => {
    const { annotations, rules, transforms, exportedRules } =
      separateGrammarItems(items);
    const version = annotations.find((a) => a.key === "version")?.value;

    return createModularGrammarDefinition(
      name,
      annotations,
      rules,
      transforms,
      undefined,
      exportedRules.length > 0
        ? { type: "ExportDeclaration", rules: exportedRules }
        : undefined,
      version
        ? createModuleInfo(undefined, undefined, undefined, version)
        : undefined,
    );
  },
);
