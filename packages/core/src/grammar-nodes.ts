/**
 * Shared TPEG Grammar Types
 *
 * Core type definitions for TPEG grammar AST nodes, shared between
 * the parser and type inference systems to avoid circular dependencies.
 *
 * @fileoverview This module provides comprehensive type definitions for the TPEG grammar AST,
 * including all expression types, grammar structures, and factory functions for creating AST nodes.
 */

/**
 * String literal node in TPEG grammar AST.
 * Represents a quoted string literal like "hello" or 'world'.
 *
 * @example
 * ```typescript
 * const literal: StringLiteral = {
 *   type: "StringLiteral",
 *   value: "hello",
 *   quote: '"'
 * };
 * ```
 */
export interface StringLiteral {
  /** The node type identifier */
  type: "StringLiteral";
  /** The string content without quotes */
  value: string;
  /** The quote character used (double or single quote) */
  quote: '"' | "'";
}

/**
 * Character class node in TPEG grammar AST.
 * Represents character classes like [a-z], [abc], or [^0-9].
 *
 * @example
 * ```typescript
 * const charClass: CharacterClass = {
 *   type: "CharacterClass",
 *   ranges: [{ start: "a", end: "z" }],
 *   negated: false
 * };
 * ```
 */
export interface CharacterClass {
  /** The node type identifier */
  type: "CharacterClass";
  /** Array of character ranges within the class */
  ranges: CharRange[];
  /** Whether the character class is negated (starts with ^) */
  negated: boolean;
}

/**
 * Character range specification within a character class.
 * Can represent single characters or ranges like a-z.
 *
 * @example
 * ```typescript
 * // Single character
 * const singleChar: CharRange = { start: "a" };
 * // Character range
 * const range: CharRange = { start: "a", end: "z" };
 * ```
 */
export interface CharRange {
  /** The starting character of the range */
  start: string;
  /** The ending character of the range (optional for single characters) */
  end?: string;
}

/**
 * Identifier node in TPEG grammar AST.
 * Represents references to other grammar rules.
 *
 * @example
 * ```typescript
 * const id: Identifier = {
 *   type: "Identifier",
 *   name: "expression"
 * };
 * ```
 */
export interface Identifier {
  /** The node type identifier */
  type: "Identifier";
  /** The name of the referenced rule */
  name: string;
}

/**
 * Any character dot (.) node in TPEG grammar AST.
 * Matches any single Unicode code point (including newline); fails only
 * at end of input. See `anyChar` in `./basic.ts`.
 *
 * @example
 * ```typescript
 * const anyChar: AnyChar = { type: "AnyChar" };
 * ```
 */
export interface AnyChar {
  /** The node type identifier */
  type: "AnyChar";
}

/**
 * Sequence node in TPEG grammar AST.
 * Represents consecutive expressions that must all match in order.
 *
 * @example
 * ```typescript
 * const sequence: Sequence = {
 *   type: "Sequence",
 *   elements: [stringLiteral, identifier]
 * };
 * ```
 */
export interface Sequence {
  /** The node type identifier */
  type: "Sequence";
  /** The expressions that must match in sequence */
  elements: Expression[];
}

/**
 * Choice node in TPEG grammar AST.
 * Represents alternative expressions where any one can match.
 *
 * @example
 * ```typescript
 * const choice: Choice = {
 *   type: "Choice",
 *   alternatives: [stringLiteral, identifier]
 * };
 * ```
 */
export interface Choice {
  /** The node type identifier */
  type: "Choice";
  /** The alternative expressions to try */
  alternatives: Expression[];
}

/**
 * Group node in TPEG grammar AST.
 * Represents a parenthesized expression for grouping.
 *
 * @example
 * ```typescript
 * const group: Group = {
 *   type: "Group",
 *   expression: choice
 * };
 * ```
 */
export interface Group {
  /** The node type identifier */
  type: "Group";
  /** The grouped expression */
  expression: Expression;
}

/**
 * Star repetition node in TPEG grammar AST.
 * Represents zero or more repetitions of an expression (expr*).
 *
 * @example
 * ```typescript
 * const star: Star = {
 *   type: "Star",
 *   expression: identifier
 * };
 * ```
 */
export interface Star {
  /** The node type identifier */
  type: "Star";
  /** The expression to repeat */
  expression: Expression;
}

/**
 * Plus repetition node in TPEG grammar AST.
 * Represents one or more repetitions of an expression (expr+).
 *
 * @example
 * ```typescript
 * const plus: Plus = {
 *   type: "Plus",
 *   expression: identifier
 * };
 * ```
 */
export interface Plus {
  /** The node type identifier */
  type: "Plus";
  /** The expression to repeat */
  expression: Expression;
}

/**
 * Optional node in TPEG grammar AST.
 * Represents zero or one occurrence of an expression (expr?).
 *
 * @example
 * ```typescript
 * const optional: Optional = {
 *   type: "Optional",
 *   expression: identifier
 * };
 * ```
 */
export interface Optional {
  /** The node type identifier */
  type: "Optional";
  /** The optional expression */
  expression: Expression;
}

/**
 * Quantified repetition node in TPEG grammar AST.
 * Represents specific repetition counts like expr{2,5} or expr{3}.
 *
 * @example
 * ```typescript
 * // Exactly 3 repetitions
 * const exact: Quantified = {
 *   type: "Quantified",
 *   expression: identifier,
 *   min: 3
 * };
 * // 2 to 5 repetitions
 * const range: Quantified = {
 *   type: "Quantified",
 *   expression: identifier,
 *   min: 2,
 *   max: 5
 * };
 * ```
 */
export interface Quantified {
  /** The node type identifier */
  type: "Quantified";
  /** The expression to repeat */
  expression: Expression;
  /** Minimum number of repetitions */
  min: number;
  /** Maximum number of repetitions (optional for exact counts) */
  max?: number;
}

/**
 * Positive lookahead node in TPEG grammar AST.
 * Represents a positive lookahead assertion (&expr).
 *
 * @example
 * ```typescript
 * const lookahead: PositiveLookahead = {
 *   type: "PositiveLookahead",
 *   expression: identifier
 * };
 * ```
 */
export interface PositiveLookahead {
  /** The node type identifier */
  type: "PositiveLookahead";
  /** The expression to assert must follow */
  expression: Expression;
}

/**
 * Negative lookahead node in TPEG grammar AST.
 * Represents a negative lookahead assertion (!expr).
 *
 * @example
 * ```typescript
 * const negLookahead: NegativeLookahead = {
 *   type: "NegativeLookahead",
 *   expression: identifier
 * };
 * ```
 */
export interface NegativeLookahead {
  /** The node type identifier */
  type: "NegativeLookahead";
  /** The expression to assert must not follow */
  expression: Expression;
}

/**
 * Cut/commit node in TPEG grammar AST.
 * Represents the `~` cut point that may appear as one of a `Sequence`'s
 * `elements`, e.g. `"if" ~ condition "then" body`. Once every element
 * before the cut has matched, the elements after it are committed to: if
 * any of them then fails, the enclosing `Choice` (see `Choice.alternatives`)
 * must not try a sibling alternative, unlike ordinary PEG backtracking.
 * A bare marker with no `expression` field of its own -- it consumes no
 * input and contributes nothing to the enclosing sequence's capture (same
 * treatment as `PositiveLookahead`/`NegativeLookahead`, see the Capture
 * Structure Reference Table in docs/peg-grammar.md).
 *
 * @example
 * ```typescript
 * const cut: Cut = { type: "Cut" };
 * ```
 */
export interface Cut {
  /** The node type identifier */
  type: "Cut";
  /**
   * Set by `promoteGlobalCuts` (`packages/parser/src/ast-optimize.ts`,
   * global cut promotion) when this specific cut has been
   * proven safe to compile to `commitAtTopLevel` (packrat memo-table
   * truncation) rather than the ordinary, purely-local `commit`. Absent
   * (not merely `false`) on every `Cut` produced anywhere else in this
   * codebase -- `createCut()` below never sets it, so `undefined` means
   * "never analyzed for promotion," not "analyzed and rejected." Codegen
   * (`codegen.ts`/`codegen-optimized.ts`) treats both `undefined` and
   * `false` identically (ordinary `commit`); only `=== true` counts.
   */
  global?: boolean;
}

/**
 * Skip node in TPEG grammar AST.
 * Desugar-internal node: never produced by the grammar parser itself --
 * inserted by `applySkipDesugar` (`packages/parser/src/skip-desugar.ts`)
 * at sequence boundaries (start / between elements / end) for every
 * rule not exempted by `@noskip` or by the `@skip` rule's own
 * transitive reference closure, when the grammar block carries a
 * `@skip: <ruleName>` annotation.
 *
 * `expression` is the resolved reference to the grammar's skip rule.
 * Semantically the node is `optional(<rule>)` whose value is then
 * discarded: it always succeeds (consuming whatever the skip rule
 * matches, or nothing), and it contributes NOTHING to the enclosing
 * sequence's value -- codegen emits `ignore(optional(<ref>))`, whose
 * `IGNORED` sentinel `sequence`/`captureSequence` filter out before
 * building the result tuple or merged label object. A rule's own
 * value shape is therefore identical with and without `@skip`.
 *
 * @example
 * ```typescript
 * const skip: Skip = {
 *   type: "Skip",
 *   expression: { type: "Identifier", name: "whitespace" }
 * };
 * ```
 */
export interface Skip {
  /** The node type identifier */
  type: "Skip";
  /** Reference to the grammar's `@skip`-named skip rule */
  expression: Identifier;
}

/**
 * Span (source-text extraction) node in TPEG grammar AST.
 * Represents the `@expr` prefix operator: it evaluates `expression`
 * exactly as written, but replaces the match's value with the raw
 * source text the expression consumed (`input.slice(start, end)`),
 * whatever shape the expression's own value had. Consumption and
 * failure behavior are identical to the wrapped expression -- only the
 * produced value changes.
 *
 * `@` binds like the other prefix operators (`&`/`!`): it applies to a
 * whole postfix expression, so `@"a"+` extracts the text of the entire
 * repetition, not just one iteration. Write `@(e1 e2)` to extract a
 * sequence's full matched text including any `@skip`-inserted interior
 * whitespace.
 *
 * `@` collides with annotation syntax (`@key: value`, `@noskip`) only
 * where a grammarItem boundary is possible: a bare `@identifier` in
 * sequence-continuation position followed by another rule's header is
 * read as an annotation, not a span -- write `@(identifier)` to force
 * the span reading in that position. `@` followed by anything other
 * than an identifier start (`@"lit"`, `@[a-z]`, `@(...)`) is always
 * a span.
 *
 * @example
 * ```typescript
 * const span: Span = {
 *   type: "Span",
 *   expression: { type: "Identifier", name: "number" }
 * };
 * ```
 */
export interface Span {
  /** The node type identifier */
  type: "Span";
  /** The expression whose consumed source text becomes the value */
  expression: Expression;
}

/**
 * Word-boundary assertion node in TPEG grammar AST.
 * Represents `\b` (word boundary) / `\B` (non-word-boundary) at
 * expression level: a zero-width assertion that succeeds exactly when
 * the character immediately before the current position and the
 * character immediately after it differ in word-ness -- where a "word
 * character" is the ASCII regex set `[A-Za-z0-9_]`, matching JavaScript
 * `\b`/`\B` semantics (start and end of input count as non-word).
 *
 * Like the lookahead operators it consumes no input and contributes
 * `undefined` to an enclosing sequence's tuple (see the Capture
 * Structure Reference Table in docs/peg-grammar.md).
 *
 * @example
 * ```typescript
 * const boundary: WordBoundary = { type: "WordBoundary", negated: false };
 * ```
 */
export interface WordBoundary {
  /** The node type identifier */
  type: "WordBoundary";
  /** `true` for `\B` (assert NO boundary), `false` for `\b` */
  negated: boolean;
}

/**
 * Labeled expression node in TPEG grammar AST.
 * Represents a labeled expression for capturing results (label:expr).
 *
 * @example
 * ```typescript
 * const labeled: LabeledExpression = {
 *   type: "LabeledExpression",
 *   label: "name",
 *   expression: identifier
 * };
 * ```
 */
export interface LabeledExpression {
  /** The node type identifier */
  type: "LabeledExpression";
  /** The label for capturing the result */
  label: string;
  /** The expression being labeled */
  expression: Expression;
}

/**
 * Semantic action node in TPEG grammar AST.
 * Represents an expression followed by a `{ ... }` code block that runs on
 * a successful match, e.g. `digits:[0-9]+ { return parseInt(digits.join("")) }`.
 * The action's return value replaces the expression's own value as the
 * result of the enclosing alternative. Inside the code, `$$` is bound to the
 * raw match value, and (if the wrapped expression is a labeled expression,
 * or a sequence of them) each label is additionally bound as its own
 * variable, mirroring how `captureSequence` merges labels at runtime.
 *
 * @example
 * ```typescript
 * const action: ActionExpression = {
 *   type: "ActionExpression",
 *   expression: labeledDigits,
 *   code: "return parseInt(digits.join(\"\"), 10);"
 * };
 * ```
 */
export interface ActionExpression {
  /** The node type identifier */
  type: "ActionExpression";
  /** The expression that must match before the action runs */
  expression: Expression;
  /** Raw source text of the action's code block, minus the enclosing braces */
  code: string;
}

/**
 * Union type for all TPEG expression nodes.
 * This discriminated union allows type-safe handling of all expression types.
 */
export type Expression =
  | StringLiteral
  | CharacterClass
  | Identifier
  | QualifiedIdentifier
  | AnyChar
  | Sequence
  | Choice
  | Group
  | Star
  | Plus
  | Optional
  | Quantified
  | PositiveLookahead
  | NegativeLookahead
  | Cut
  | Skip
  | Span
  | WordBoundary
  | LabeledExpression
  | ActionExpression;

/**
 * Grammar annotation in TPEG grammar AST.
 * Represents metadata annotations like @version, @author, etc.
 *
 * @example
 * ```typescript
 * const annotation: GrammarAnnotation = {
 *   type: "GrammarAnnotation",
 *   key: "version",
 *   value: "1.0.0"
 * };
 * ```
 */
export interface GrammarAnnotation {
  /** The node type identifier */
  type: "GrammarAnnotation";
  /** The annotation key */
  key: string;
  /** The annotation value */
  value: string;
}

/**
 * Grammar rule definition in TPEG grammar AST.
 * Represents a named rule with its pattern and optional documentation.
 *
 * @example
 * ```typescript
 * const rule: RuleDefinition = {
 *   type: "RuleDefinition",
 *   name: "identifier",
 *   pattern: characterClass,
 *   documentation: ["Matches valid identifiers"]
 * };
 * ```
 */
export interface RuleDefinition {
  /** The node type identifier */
  type: "RuleDefinition";
  /** The name of the rule */
  name: string;
  /** The expression pattern for this rule */
  pattern: Expression;
  /** Optional documentation comments for the rule */
  documentation?: string[];
  /**
   * Optional rule-scoped annotations, e.g. `@memoize` / `@memoize: 256`
   * or `@noskip`, written directly before this rule's definition --
   * distinct from `GrammarDefinition.annotations`, which are
   * block-scoped (`@start`, `@skip`, etc.). See
   * `packages/parser/src/grammar.ts`'s `memoizeAnnotation` /
   * `noskipAnnotation` for the rule-level annotations currently
   * recognized by the parser.
   */
  annotations?: GrammarAnnotation[];
}

/**
 * Represents a transform function parameter
 */
export interface TransformParameter {
  name: string;
  type: string;
  optional?: boolean;
}

/**
 * Represents a transform function return type
 */
export interface TransformReturnType {
  type: string;
  generic?: string;
}

/**
 * Represents a transform function definition
 */
export interface TransformFunction {
  name: string;
  parameters: TransformParameter[];
  returnType: TransformReturnType;
  body: string;
  documentation?: string[];
}

/**
 * Represents a transform set declaration
 */
export interface TransformSet {
  name: string;
  targetLanguage: string;
  functions: TransformFunction[];
}

/**
 * Represents a complete transform definition
 */
export interface TransformDefinition {
  type: "TransformDefinition";
  transformSet: TransformSet;
}

// ============================================================================
// Module System Types
// ============================================================================

/**
 * Represents an import statement in TPEG module system.
 *
 * Supports various import patterns:
 * - Simple import: `import "module.tpeg" as alias`
 * - Selective import: `import "module.tpeg" { rule1, rule2 }`
 * - Versioned import: `import "module.tpeg" version "^1.0" as alias`
 *
 * @example
 * ```typescript
 * const importStmt: ImportStatement = {
 *   type: "ImportStatement",
 *   modulePath: "base.tpeg",
 *   alias: "base",
 *   selective: undefined,
 *   version: undefined
 * };
 * ```
 */
export interface ImportStatement {
  /** The node type identifier */
  type: "ImportStatement";
  /** The path to the module being imported */
  modulePath: string;
  /** Optional alias for the imported module */
  alias?: string;
  /** Optional selective import list (specific rules to import) */
  selective?: string[];
  /** Optional version constraint for the import */
  version?: string;
}

/**
 * Represents an export declaration in TPEG module system.
 *
 * Controls which rules are exported from a module:
 * - Default: all rules are exported
 * - Explicit: only specified rules are exported
 *
 * @example
 * ```typescript
 * const exportDecl: ExportDeclaration = {
 *   type: "ExportDeclaration",
 *   rules: ["identifier", "whitespace", "number"]
 * };
 * ```
 */
export interface ExportDeclaration {
  /** The node type identifier */
  type: "ExportDeclaration";
  /** List of rule names to export */
  rules: string[];
}

/**
 * Represents module-level metadata and dependencies.
 *
 * @example
 * ```typescript
 * const moduleInfo: ModuleInfo = {
 *   type: "ModuleInfo",
 *   namespace: "Math.Core",
 *   dependencies: ["base.tpeg", "utils.tpeg"],
 *   conflicts: ["legacy.tpeg"],
 *   version: "1.0.0"
 * };
 * ```
 */
export interface ModuleInfo {
  /** The node type identifier */
  type: "ModuleInfo";
  /** Optional namespace for the module */
  namespace?: string;
  /** List of required dependencies */
  dependencies?: string[];
  /** List of conflicting modules */
  conflicts?: string[];
  /** Module version */
  version?: string;
  /** Version constraints per dependency, from `@requires: { "mod.tpeg": "^1.0", ... }` */
  requires?: Record<string, string>;
}

/**
 * Represents a qualified identifier with module prefix.
 *
 * Used for referencing rules from imported modules:
 * - `base.identifier` - rule from base module
 * - `Math.Core.expression` - rule from namespaced module
 *
 * @example
 * ```typescript
 * const qualifiedId: QualifiedIdentifier = {
 *   type: "QualifiedIdentifier",
 *   module: "base",
 *   name: "identifier"
 * };
 * ```
 */
export interface QualifiedIdentifier {
  /** The node type identifier */
  type: "QualifiedIdentifier";
  /** The module prefix */
  module: string;
  /** The rule name within the module */
  name: string;
}

/**
 * Extended grammar definition with module system support.
 *
 * Includes import statements, export declarations, and module metadata
 * in addition to the standard grammar components.
 */
export interface ModularGrammarDefinition extends Omit<
  GrammarDefinition,
  "type"
> {
  /** The node type identifier */
  type: "ModularGrammarDefinition";
  /** Import statements for this grammar */
  imports?: ImportStatement[];
  /** Export declaration for this grammar */
  exports?: ExportDeclaration;
  /** Module metadata */
  moduleInfo?: ModuleInfo;
  /** Optional parent grammar this extends */
  extends?: string;
  /** Other grammars this grammar mixes in via `includes a.B, c.D` */
  includes?: string[];
}

/**
 * Represents a complete TPEG module file.
 *
 * A module file can contain multiple grammar definitions,
 * import statements, and shared module metadata.
 */
export interface ModuleFile {
  /** The node type identifier */
  type: "ModuleFile";
  /** The file path of this module */
  filePath: string;
  /** Import statements at module level */
  imports: ImportStatement[];
  /** Grammar definitions in this module */
  grammars: (GrammarDefinition | ModularGrammarDefinition)[];
  /** Module-level metadata */
  moduleInfo?: ModuleInfo;
}

/**
 * Represents a complete grammar definition.
 *
 * A grammar definition contains:
 * - A name for the grammar
 * - Optional annotations for metadata
 * - A collection of rule definitions
 * - Optional transform definitions
 *
 * @example
 * ```typescript
 * const grammar: GrammarDefinition = {
 *   type: "GrammarDefinition",
 *   name: "Calculator",
 *   annotations: [
 *     { type: "GrammarAnnotation", key: "version", value: "1.0" }
 *   ],
 *   rules: [identifierRule, expressionRule],
 *   transforms: [transformDefinition]
 * };
 * ```
 */
export interface GrammarDefinition {
  /** The node type identifier */
  type: "GrammarDefinition";
  /** The name of the grammar */
  name: string;
  /** Grammar-level annotations */
  annotations: GrammarAnnotation[];
  /** The rules that make up this grammar */
  rules: RuleDefinition[];
  /** Transform definitions for this grammar */
  transforms?: TransformDefinition[];
}

// ============================================================================
// Factory Functions for Testing
// ============================================================================
