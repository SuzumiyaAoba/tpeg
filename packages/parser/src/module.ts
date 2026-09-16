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
 * - Qualified identifiers: module.rule
 *
 * Module-metadata annotations (@namespace, @dependencies, @conflicts) described
 * in docs/peg-grammar.md are not parsed by this file yet; only @export and the
 * generic @version/@description annotations (via grammar.ts's grammarAnnotation)
 * are currently supported.
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
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
} from "@suzumiyaaoba/tpeg-core";
import { GRAMMAR_SYMBOLS } from "./constants";
import { identifier } from "./identifier";
import { stringLiteral } from "./string-literal";
import {
  optionalWhitespaceOrComment,
  requiredWhitespaceOrComment,
} from "./whitespace-utils";

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
 *
 * Comment-tolerant throughout (docs/peg-grammar.md's Comments section: a
 * comment is accepted between any two syntactic elements) --
 * `{ a <block-comment>, b }` parses the same as `{ a, b }`.
 */
const selectiveImportList: Parser<string[]> = map(
  sequence(
    literal(GRAMMAR_SYMBOLS.GRAMMAR_BLOCK_OPEN),
    optionalWhitespaceOrComment,
    optional(
      map(
        sequence(
          map(identifier, (id) => id.name),
          zeroOrMore(
            map(
              sequence(
                optionalWhitespaceOrComment,
                literal(","),
                optionalWhitespaceOrComment,
                identifier,
              ),
              ([, , , id]) => id.name,
            ),
          ),
        ),
        ([first, rest]) => [first, ...rest],
      ),
    ),
    optionalWhitespaceOrComment,
    literal(GRAMMAR_SYMBOLS.GRAMMAR_BLOCK_CLOSE),
  ),
  ([, , rules, ,]) => rules?.[0] ?? [],
);

/**
 * Parse simple import: import "module.tpeg" as alias
 *
 * Every separator position is comment-tolerant (requiredWhitespaceOrComment
 * is still a REQUIRED separator -- `import"x"` stays invalid -- it just also
 * accepts a comment as that separator): `import /* c *\/ "a.tpeg" as x`,
 * `import "a.tpeg" /* c *\/ as x`, and `import "a.tpeg" as /* c *\/ x` all
 * parse with the alias attached, instead of the comment being left as
 * trailing content that silently drops the `as` clause.
 */
const simpleImport: Parser<ImportStatement> = map(
  sequence(
    importKeyword,
    requiredWhitespaceOrComment,
    modulePath,
    optional(
      map(
        sequence(
          requiredWhitespaceOrComment,
          asKeyword,
          requiredWhitespaceOrComment,
          moduleAlias,
        ),
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
    requiredWhitespaceOrComment,
    modulePath,
    requiredWhitespaceOrComment,
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
    requiredWhitespaceOrComment,
    modulePath,
    requiredWhitespaceOrComment,
    versionKeyword,
    requiredWhitespaceOrComment,
    versionConstraint,
    optional(
      map(
        sequence(
          requiredWhitespaceOrComment,
          asKeyword,
          requiredWhitespaceOrComment,
          moduleAlias,
        ),
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
    optionalWhitespaceOrComment,
    optional(
      map(
        sequence(
          map(identifier, (id) => id.name),
          zeroOrMore(
            map(
              sequence(
                optionalWhitespaceOrComment,
                literal(","),
                optionalWhitespaceOrComment,
                identifier,
              ),
              ([, , , id]) => id.name,
            ),
          ),
        ),
        ([first, rest]) => [first, ...rest],
      ),
    ),
    optionalWhitespaceOrComment,
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
    optionalWhitespaceOrComment,
    literal(":"),
    optionalWhitespaceOrComment,
    exportRuleList,
  ),
  ([, , , , rules]) => createExportDeclaration(rules),
);

// ============================================================================
// Module-Metadata List Annotation Parser (@dependencies, @conflicts)
// ============================================================================

/**
 * A parsed `@key: ["a", "b"]` annotation - the array-of-quoted-strings form
 * docs/peg-grammar.md uses for `@dependencies` and `@conflicts`. Distinct
 * from `GrammarAnnotation` (single string value) and `ExportDeclaration`
 * (array of bare identifiers, always keyed "export"): this is generic over
 * the key so both `@dependencies` and `@conflicts` share one parser, with
 * the key->ModuleInfo-field mapping left to the caller (grammar.ts).
 */
export interface ModuleInfoListAnnotation {
  type: "ModuleInfoListAnnotation";
  key: string;
  values: string[];
}

/**
 * Parse a quoted-string list: ["a", "b", "c"]
 */
const quotedStringList: Parser<string[]> = map(
  sequence(
    literal("["),
    optionalWhitespaceOrComment,
    optional(
      map(
        sequence(
          stringLiteral,
          zeroOrMore(
            map(
              sequence(
                optionalWhitespaceOrComment,
                literal(","),
                optionalWhitespaceOrComment,
                stringLiteral,
              ),
              ([, , , str]) => str.value,
            ),
          ),
        ),
        ([first, rest]) => [first.value, ...rest],
      ),
    ),
    optionalWhitespaceOrComment,
    literal("]"),
  ),
  ([, , values, ,]) => values?.[0] ?? [],
);

/**
 * Parse a module-metadata list annotation: `@dependencies: [...]` or
 * `@conflicts: [...]`.
 */
export const moduleInfoListAnnotation: Parser<ModuleInfoListAnnotation> = map(
  sequence(
    literal("@"),
    identifier,
    optionalWhitespaceOrComment,
    literal(":"),
    optionalWhitespaceOrComment,
    quotedStringList,
  ),
  ([, key, , , , values]) => ({
    type: "ModuleInfoListAnnotation" as const,
    key: key.name,
    values,
  }),
);

// ============================================================================
// Module-Metadata Record Annotation Parser (@requires)
// ============================================================================

/**
 * A parsed `@key: { "a": "b", ... }` annotation - the quoted-string-keyed
 * object-literal form docs/peg-grammar.md uses for `@requires` (per-module
 * version constraints, e.g. `@requires: { "base.tpeg": "^1.0" }`).
 */
export interface ModuleInfoRecordAnnotation {
  type: "ModuleInfoRecordAnnotation";
  key: string;
  values: Record<string, string>;
}

/**
 * Parse one `"key": "value"` entry of a quoted-string record.
 */
const quotedStringRecordEntry: Parser<[string, string]> = map(
  sequence(
    stringLiteral,
    optionalWhitespaceOrComment,
    literal(":"),
    optionalWhitespaceOrComment,
    stringLiteral,
  ),
  ([key, , , , value]) => [key.value, value.value],
);

/**
 * Parse a quoted-string record: { "a": "b", "c": "d" }
 */
const quotedStringRecord: Parser<Record<string, string>> = map(
  sequence(
    literal("{"),
    optionalWhitespaceOrComment,
    optional(
      map(
        sequence(
          quotedStringRecordEntry,
          zeroOrMore(
            map(
              sequence(
                optionalWhitespaceOrComment,
                literal(","),
                optionalWhitespaceOrComment,
                quotedStringRecordEntry,
              ),
              ([, , , entry]) => entry,
            ),
          ),
        ),
        ([first, rest]) => [first, ...rest],
      ),
    ),
    optionalWhitespaceOrComment,
    literal("}"),
  ),
  ([, , entries]) => Object.fromEntries(entries?.[0] ?? []),
);

/**
 * Parse a module-metadata record annotation: `@requires: { "mod": "^1.0" }`.
 */
export const moduleInfoRecordAnnotation: Parser<ModuleInfoRecordAnnotation> =
  map(
    sequence(
      literal("@"),
      identifier,
      optionalWhitespaceOrComment,
      literal(":"),
      optionalWhitespaceOrComment,
      quotedStringRecord,
    ),
    ([, key, , , , values]) => ({
      type: "ModuleInfoRecordAnnotation" as const,
      key: key.name,
      values,
    }),
  );

// ============================================================================
// Qualified Identifier Parser
// ============================================================================

const qualifiedIdentifierCore: Parser<QualifiedIdentifier> = map(
  sequence(
    map(identifier, (id) => id.name),
    literal("."),
    map(identifier, (id) => id.name),
  ),
  ([module, , name]) => createQualifiedIdentifier(module, name),
);

/**
 * A "." immediately followed by an identifier-start character -- i.e. the
 * start of a second "."-segment that a qualified identifier must not have.
 */
const QUALIFIED_EXTRA_SEGMENT = /^\.[a-zA-Z_]/;

/**
 * Parse qualified identifier: module.rule
 *
 * A qualified identifier has exactly ONE dot. `a.b.c` is therefore a
 * syntax error, not `a.b` followed by an AnyChar `.` and an Identifier
 * `c` -- which is what a plain failure here would degrade to (the
 * enclosing `choice` would backtrack to `identifier` matching just `a`,
 * leaving `.b.c` to parse as AnyChar+Identifier+AnyChar+Identifier).
 * So a `.` immediately followed by an identifier-start character after
 * a successful `a.b` match is rejected FATALLY: no backtracking into a
 * silently wrong parse. A `.` followed by anything else (whitespace,
 * `]`, end of input) still lets the qualified match stand on its own,
 * leaving that `.` for a following AnyChar as before.
 */
export const qualifiedIdentifier: Parser<QualifiedIdentifier> = (
  input,
  pos,
) => {
  const result = qualifiedIdentifierCore(input, pos);
  if (!result.success) return result;
  const next = result.next;
  if (QUALIFIED_EXTRA_SEGMENT.test(input.slice(next, next + 2))) {
    return {
      success: false,
      error: {
        message:
          'A qualified identifier has exactly one dot ("module.rule"); a second "." segment is not allowed',
        pos: next,
        expected: ["end of qualified identifier"],
        found: input.slice(next, next + 2),
        parserName: "qualifiedIdentifier",
        fatal: true,
      },
    };
  }
  return result;
};

// ============================================================================
// Grammar Extension Parser
// ============================================================================

/**
 * Parse extends clause: extends base.Grammar
 */
export const extendsClause: Parser<string> = map(
  sequence(
    extendsKeyword,
    requiredWhitespaceOrComment,
    choice(
      map(qualifiedIdentifier, (qid) => `${qid.module}.${qid.name}`),
      map(identifier, (id) => id.name),
    ),
  ),
  ([, , name]) => name,
);
