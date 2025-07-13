/**
 * TPEG Module System Parser
 *
 * Implements parsing of module system constructs for TPEG grammar.
 * Based on docs/peg-grammar.md specification.
 *
 * Supports parsing:
 * - Import statements: import "module.tpeg" as alias
 * - Selective imports: import "module.tpeg" { rule1, rule2 }
 * - Versioned imports: import "module.tpeg" version "^1.0" as alias
 * - Export declarations: @export: [rule1, rule2]
 * - Module metadata: @namespace, @dependencies, @conflicts
 * - Qualified identifiers: module.rule
 */

import type { Parser } from "tpeg-core";
import {
  type ExportDeclaration,
  type ImportStatement,
  type QualifiedIdentifier,
  choice,
  createExportDeclaration,
  createImportStatement,
  createQualifiedIdentifier,
  literal,
  map,
  optional,
  seq as sequence,
  star as zeroOrMore,
} from "tpeg-core";
import { GRAMMAR_SYMBOLS } from "./constants";
import { identifier } from "./identifier";
import { stringLiteral } from "./string-literal";
import { optionalWhitespace, whitespace } from "./whitespace-utils";

// ============================================================================
// Basic Module System Parsers
// ============================================================================

/**
 * Parse the "import" keyword
 */
const importKeyword: Parser<string> = literal("import");

/**
 * Parse the "as" keyword
 */
const asKeyword: Parser<string> = literal("as");

/**
 * Parse the "version" keyword
 */
const versionKeyword: Parser<string> = literal("version");

/**
 * Parse the "extends" keyword
 */
const extendsKeyword: Parser<string> = literal("extends");

/**
 * Parse module path (string literal)
 */
const modulePath: Parser<string> = map(stringLiteral, (str) => str.value);

/**
 * Parse version constraint (string literal)
 */
const versionConstraint: Parser<string> = map(
  stringLiteral,
  (str) => str.value,
);

/**
 * Parse module alias (identifier)
 */
const moduleAlias: Parser<string> = map(identifier, (id) => id.name);

// ============================================================================
// Import Statement Parsers
// ============================================================================

/**
 * Parse selective import list: { rule1, rule2, rule3 }
 */
const selectiveImportList: Parser<string[]> = map(
  sequence(
    literal(GRAMMAR_SYMBOLS.GRAMMAR_BLOCK_OPEN),
    optionalWhitespace,
    optional(
      map(
        sequence(
          map(identifier, (id) => id.name),
          zeroOrMore(
            map(
              sequence(
                optionalWhitespace,
                literal(","),
                optionalWhitespace,
                identifier,
              ),
              ([, , , id]) => id.name,
            ),
          ),
        ),
        ([first, rest]) => [first, ...rest],
      ),
    ),
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.GRAMMAR_BLOCK_CLOSE),
  ),
  ([, , rules, ,]) => rules?.[0] ?? [],
);

/**
 * Parse simple import: import "module.tpeg" as alias
 */
const simpleImport: Parser<ImportStatement> = map(
  sequence(
    importKeyword,
    whitespace,
    modulePath,
    optional(
      map(
        sequence(whitespace, asKeyword, whitespace, moduleAlias),
        ([, , , alias]) => alias,
      ),
    ),
  ),
  ([, , path, alias]) => createImportStatement(path, alias?.[0]),
);

/**
 * Parse selective import: import "module.tpeg" { rule1, rule2 }
 */
const selectiveImport: Parser<ImportStatement> = map(
  sequence(
    importKeyword,
    whitespace,
    modulePath,
    whitespace,
    selectiveImportList,
  ),
  ([, , path, , selective]) =>
    createImportStatement(path, undefined, selective),
);

/**
 * Parse versioned import: import "module.tpeg" version "^1.0" as alias
 */
const versionedImport: Parser<ImportStatement> = map(
  sequence(
    importKeyword,
    whitespace,
    modulePath,
    whitespace,
    versionKeyword,
    whitespace,
    versionConstraint,
    optional(
      map(
        sequence(whitespace, asKeyword, whitespace, moduleAlias),
        ([, , , alias]) => alias,
      ),
    ),
  ),
  ([, , path, , , , version, alias]) =>
    createImportStatement(path, alias?.[0], undefined, version),
);

/**
 * Parse any import statement
 */
export const importStatement: Parser<ImportStatement> = choice(
  versionedImport,
  selectiveImport,
  simpleImport,
);

// ============================================================================
// Export Declaration Parsers
// ============================================================================

/**
 * Parse export rule list: [rule1, rule2, rule3]
 */
const exportRuleList: Parser<string[]> = map(
  sequence(
    literal("["),
    optionalWhitespace,
    optional(
      map(
        sequence(
          map(identifier, (id) => id.name),
          zeroOrMore(
            map(
              sequence(
                optionalWhitespace,
                literal(","),
                optionalWhitespace,
                identifier,
              ),
              ([, , , id]) => id.name,
            ),
          ),
        ),
        ([first, rest]) => [first, ...rest],
      ),
    ),
    optionalWhitespace,
    literal("]"),
  ),
  ([, , rules, ,]) => rules?.[0] ?? [],
);

/**
 * Parse export annotation: @export: [rule1, rule2]
 */
export const exportDeclaration: Parser<ExportDeclaration> = map(
  sequence(
    literal("@export"),
    optionalWhitespace,
    literal(":"),
    optionalWhitespace,
    exportRuleList,
  ),
  ([, , , , rules]) => createExportDeclaration(rules),
);

// ============================================================================
// Qualified Identifier Parser
// ============================================================================

/**
 * Parse qualified identifier: module.rule
 */
export const qualifiedIdentifier: Parser<QualifiedIdentifier> = map(
  sequence(
    map(identifier, (id) => id.name),
    literal("."),
    map(identifier, (id) => id.name),
  ),
  ([module, , name]) => createQualifiedIdentifier(module, name),
);

// ============================================================================
// Grammar Extension Parser
// ============================================================================

/**
 * Parse extends clause: extends base.Grammar
 */
export const extendsClause: Parser<string> = map(
  sequence(
    extendsKeyword,
    whitespace,
    choice(
      map(qualifiedIdentifier, (qid) => `${qid.module}.${qid.name}`),
      map(identifier, (id) => id.name),
    ),
  ),
  ([, , name]) => name,
);
