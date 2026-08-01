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
 * Matches any single character except newline.
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
   * written directly before this rule's definition -- distinct from
   * `GrammarDefinition.annotations`, which are block-scoped (`@start`,
   * `@skip`, etc.). See `packages/parser/src/grammar.ts`'s
   * `memoizeAnnotation` for the only rule-level annotation currently
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
export interface ModularGrammarDefinition
  extends Omit<GrammarDefinition, "type"> {
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

/**
 * Create a StringLiteral AST node.
 *
 * @param value - The string content without quotes
 * @param quote - The quote character used (double or single quote)
 * @returns A new StringLiteral AST node
 *
 * @example
 * ```typescript
 * const literal = createStringLiteral("hello", '"');
 * // Returns: { type: "StringLiteral", value: "hello", quote: '"' }
 * ```
 */
export const createStringLiteral = (
  value: string,
  quote: '"' | "'",
): StringLiteral => ({
  type: "StringLiteral",
  value,
  quote,
});

/**
 * Create a CharacterClass AST node.
 *
 * @param ranges - Array of character ranges within the class
 * @param negated - Whether the character class is negated (defaults to false)
 * @returns A new CharacterClass AST node
 *
 * @example
 * ```typescript
 * const charClass = createCharacterClass([{ start: "a", end: "z" }], false);
 * // Returns: { type: "CharacterClass", ranges: [...], negated: false }
 * ```
 */
export const createCharacterClass = (
  ranges: CharRange[],
  negated = false,
): CharacterClass => ({
  type: "CharacterClass",
  ranges,
  negated,
});

/**
 * Create a CharRange for use in character classes.
 *
 * @param start - The starting character of the range
 * @param end - The ending character of the range (optional for single characters)
 * @returns A new CharRange object
 *
 * @example
 * ```typescript
 * const singleChar = createCharRange("a");
 * const range = createCharRange("a", "z");
 * ```
 */
export const createCharRange = (start: string, end?: string): CharRange =>
  end ? { start, end } : { start };

/**
 * Create an Identifier AST node.
 *
 * @param name - The name of the referenced rule
 * @returns A new Identifier AST node
 *
 * @example
 * ```typescript
 * const id = createIdentifier("expression");
 * // Returns: { type: "Identifier", name: "expression" }
 * ```
 */
export const createIdentifier = (name: string): Identifier => ({
  type: "Identifier",
  name,
});

/**
 * Create a QualifiedIdentifier AST node.
 *
 * @param module - The module prefix
 * @param name - The rule name within the module
 * @returns A new QualifiedIdentifier AST node
 *
 * @example
 * ```typescript
 * const qualifiedId = createQualifiedIdentifier("base", "identifier");
 * // Returns: { type: "QualifiedIdentifier", module: "base", name: "identifier" }
 * ```
 */
export const createQualifiedIdentifier = (
  module: string,
  name: string,
): QualifiedIdentifier => ({
  type: "QualifiedIdentifier",
  module,
  name,
});

/**
 * Create an AnyChar AST node.
 *
 * @returns A new AnyChar AST node
 *
 * @example
 * ```typescript
 * const anyChar = createAnyChar();
 * // Returns: { type: "AnyChar" }
 * ```
 */
export const createAnyChar = (): AnyChar => ({
  type: "AnyChar",
});

/**
 * Create a Sequence AST node.
 *
 * @param elements - The expressions that must match in sequence
 * @returns A new Sequence AST node
 *
 * @example
 * ```typescript
 * const seq = createSequence([literal, identifier]);
 * // Returns: { type: "Sequence", elements: [...] }
 * ```
 */
export const createSequence = (elements: Expression[]): Sequence => ({
  type: "Sequence",
  elements,
});

/**
 * Create a Choice AST node.
 *
 * @param alternatives - The alternative expressions to try
 * @returns A new Choice AST node
 *
 * @example
 * ```typescript
 * const choice = createChoice([literal, identifier]);
 * // Returns: { type: "Choice", alternatives: [...] }
 * ```
 */
export const createChoice = (alternatives: Expression[]): Choice => ({
  type: "Choice",
  alternatives,
});

/**
 * Create a Group AST node.
 *
 * @param expression - The grouped expression
 * @returns A new Group AST node
 *
 * @example
 * ```typescript
 * const group = createGroup(choice);
 * // Returns: { type: "Group", expression: choice }
 * ```
 */
export const createGroup = (expression: Expression): Group => ({
  type: "Group",
  expression,
});

/**
 * Create a Star AST node (zero or more repetition).
 *
 * @param expression - The expression to repeat
 * @returns A new Star AST node
 *
 * @example
 * ```typescript
 * const star = createStar(identifier);
 * // Returns: { type: "Star", expression: identifier }
 * ```
 */
export const createStar = (expression: Expression): Star => ({
  type: "Star",
  expression,
});

/**
 * Create a Plus AST node (one or more repetition).
 *
 * @param expression - The expression to repeat
 * @returns A new Plus AST node
 *
 * @example
 * ```typescript
 * const plus = createPlus(identifier);
 * // Returns: { type: "Plus", expression: identifier }
 * ```
 */
export const createPlus = (expression: Expression): Plus => ({
  type: "Plus",
  expression,
});

/**
 * Create an Optional AST node (zero or one occurrence).
 *
 * @param expression - The optional expression
 * @returns A new Optional AST node
 *
 * @example
 * ```typescript
 * const optional = createOptional(identifier);
 * // Returns: { type: "Optional", expression: identifier }
 * ```
 */
export const createOptional = (expression: Expression): Optional => ({
  type: "Optional",
  expression,
});

/**
 * Create a Quantified AST node (specific repetition count/range).
 *
 * @param expression - The expression to repeat
 * @param min - Minimum number of repetitions
 * @param max - Maximum number of repetitions (optional for exact counts)
 * @returns A new Quantified AST node
 *
 * @example
 * ```typescript
 * const exact = createQuantified(identifier, 3);
 * const range = createQuantified(identifier, 2, 5);
 * ```
 */
export const createQuantified = (
  expression: Expression,
  min: number,
  max?: number,
): Quantified =>
  max !== undefined
    ? {
        type: "Quantified",
        expression,
        min,
        max,
      }
    : {
        type: "Quantified",
        expression,
        min,
      };

/**
 * Create a PositiveLookahead AST node.
 *
 * @param expression - The expression to assert must follow
 * @returns A new PositiveLookahead AST node
 *
 * @example
 * ```typescript
 * const lookahead = createPositiveLookahead(identifier);
 * // Returns: { type: "PositiveLookahead", expression: identifier }
 * ```
 */
export const createPositiveLookahead = (
  expression: Expression,
): PositiveLookahead => ({
  type: "PositiveLookahead",
  expression,
});

/**
 * Create a NegativeLookahead AST node.
 *
 * @param expression - The expression to assert must not follow
 * @returns A new NegativeLookahead AST node
 *
 * @example
 * ```typescript
 * const negLookahead = createNegativeLookahead(identifier);
 * // Returns: { type: "NegativeLookahead", expression: identifier }
 * ```
 */
export const createNegativeLookahead = (
  expression: Expression,
): NegativeLookahead => ({
  type: "NegativeLookahead",
  expression,
});

/**
 * Create a Cut AST node.
 *
 * @returns A new Cut AST node
 *
 * @example
 * ```typescript
 * const cut = createCut();
 * // Returns: { type: "Cut" }
 * ```
 */
export const createCut = (): Cut => ({
  type: "Cut",
});

/**
 * Create a LabeledExpression AST node.
 *
 * @param label - The label for capturing the result
 * @param expression - The expression being labeled
 * @returns A new LabeledExpression AST node
 *
 * @example
 * ```typescript
 * const labeled = createLabeledExpression("name", identifier);
 * // Returns: { type: "LabeledExpression", label: "name", expression: identifier }
 * ```
 */
export const createLabeledExpression = (
  label: string,
  expression: Expression,
): LabeledExpression => ({
  type: "LabeledExpression",
  label,
  expression,
});

/**
 * Create an ActionExpression AST node.
 *
 * @param expression - The expression that must match before the action runs
 * @param code - Raw source text of the action's code block, minus the braces
 * @returns A new ActionExpression AST node
 *
 * @example
 * ```typescript
 * const action = createActionExpression(labeledDigits, "return parseInt(digits.join(\"\"));");
 * // Returns: { type: "ActionExpression", expression: labeledDigits, code: "..." }
 * ```
 */
export const createActionExpression = (
  expression: Expression,
  code: string,
): ActionExpression => ({
  type: "ActionExpression",
  expression,
  code,
});

/**
 * Create a GrammarAnnotation AST node.
 *
 * @param key - The annotation key
 * @param value - The annotation value
 * @returns A new GrammarAnnotation AST node
 *
 * @example
 * ```typescript
 * const annotation = createGrammarAnnotation("version", "1.0.0");
 * // Returns: { type: "GrammarAnnotation", key: "version", value: "1.0.0" }
 * ```
 */
export const createGrammarAnnotation = (
  key: string,
  value: string,
): GrammarAnnotation => ({
  type: "GrammarAnnotation",
  key,
  value,
});

/**
 * Create a RuleDefinition AST node.
 *
 * @param name - The name of the rule
 * @param pattern - The expression pattern for this rule
 * @param documentation - Optional documentation comments for the rule
 * @param annotations - Optional rule-scoped annotations (e.g. `@memoize`)
 * @returns A new RuleDefinition AST node
 *
 * @example
 * ```typescript
 * const rule = createRuleDefinition("identifier", charClass, ["Matches identifiers"]);
 * // Returns: { type: "RuleDefinition", name: "identifier", pattern: charClass, documentation: [...] }
 * ```
 */
export const createRuleDefinition = (
  name: string,
  pattern: Expression,
  documentation?: string[],
  annotations?: GrammarAnnotation[],
): RuleDefinition => ({
  type: "RuleDefinition",
  name,
  pattern,
  ...(documentation ? { documentation } : {}),
  ...(annotations ? { annotations } : {}),
});

/**
 * Create a GrammarDefinition AST node.
 *
 * @param name - The name of the grammar
 * @param annotations - Grammar-level annotations (defaults to empty array)
 * @param rules - The rules that make up this grammar (defaults to empty array)
 * @param transforms - Transform definitions for this grammar (defaults to empty array)
 * @returns A new GrammarDefinition AST node
 *
 * @example
 * ```typescript
 * const grammar = createGrammarDefinition("MyGrammar", [annotation], [rule], [transform]);
 * // Returns: { type: "GrammarDefinition", name: "MyGrammar", annotations: [...], rules: [...], transforms: [...] }
 * ```
 */
export const createGrammarDefinition = (
  name: string,
  annotations: GrammarAnnotation[] = [],
  rules: RuleDefinition[] = [],
  transforms: TransformDefinition[] = [],
): GrammarDefinition => ({
  type: "GrammarDefinition",
  name,
  annotations,
  rules,
  transforms,
});

// ============================================================================
// Module System Factory Functions
// ============================================================================

/**
 * Create an ImportStatement AST node.
 *
 * @param modulePath - The path to the module being imported
 * @param alias - Optional alias for the imported module
 * @param selective - Optional selective import list
 * @param version - Optional version constraint
 * @returns A new ImportStatement AST node
 */
export const createImportStatement = (
  modulePath: string,
  alias?: string,
  selective?: string[],
  version?: string,
): ImportStatement => {
  const result: ImportStatement = {
    type: "ImportStatement",
    modulePath,
  };
  if (alias !== undefined) result.alias = alias;
  if (selective !== undefined) result.selective = selective;
  if (version !== undefined) result.version = version;
  return result;
};

/**
 * Create an ExportDeclaration AST node.
 *
 * @param rules - List of rule names to export
 * @returns A new ExportDeclaration AST node
 */
export const createExportDeclaration = (
  rules: string[],
): ExportDeclaration => ({
  type: "ExportDeclaration",
  rules,
});

/**
 * Create a ModuleInfo AST node.
 *
 * @param namespace - Optional namespace for the module
 * @param dependencies - List of required dependencies
 * @param conflicts - List of conflicting modules
 * @param version - Module version
 * @param requires - Version constraints per dependency
 * @returns A new ModuleInfo AST node
 */
export const createModuleInfo = (
  namespace?: string,
  dependencies?: string[],
  conflicts?: string[],
  version?: string,
  requires?: Record<string, string>,
): ModuleInfo => {
  const result: ModuleInfo = {
    type: "ModuleInfo",
  };
  if (namespace !== undefined) result.namespace = namespace;
  if (dependencies !== undefined) result.dependencies = dependencies;
  if (conflicts !== undefined) result.conflicts = conflicts;
  if (version !== undefined) result.version = version;
  if (requires !== undefined) result.requires = requires;
  return result;
};

/**
 * Create a ModularGrammarDefinition AST node.
 *
 * @param name - The name of the grammar
 * @param annotations - Grammar-level annotations
 * @param rules - The rules that make up this grammar
 * @param transforms - Transform definitions for this grammar
 * @param imports - Import statements for this grammar
 * @param exports - Export declaration for this grammar
 * @param moduleInfo - Module metadata
 * @param extendsGrammar - Optional parent grammar this extends
 * @returns A new ModularGrammarDefinition AST node
 */
export const createModularGrammarDefinition = (
  name: string,
  annotations: GrammarAnnotation[] = [],
  rules: RuleDefinition[] = [],
  transforms: TransformDefinition[] = [],
  imports?: ImportStatement[],
  exports?: ExportDeclaration,
  moduleInfo?: ModuleInfo,
  extendsGrammar?: string,
  includes?: string[],
): ModularGrammarDefinition => {
  const result: ModularGrammarDefinition = {
    type: "ModularGrammarDefinition",
    name,
    annotations,
    rules,
    transforms,
  };
  if (imports !== undefined) result.imports = imports;
  if (exports !== undefined) result.exports = exports;
  if (moduleInfo !== undefined) result.moduleInfo = moduleInfo;
  if (extendsGrammar !== undefined) result.extends = extendsGrammar;
  if (includes !== undefined) result.includes = includes;
  return result;
};

/**
 * Create a ModuleFile AST node.
 *
 * @param filePath - The file path of this module
 * @param imports - Import statements at module level
 * @param grammars - Grammar definitions in this module
 * @param moduleInfo - Module-level metadata
 * @returns A new ModuleFile AST node
 */
export const createModuleFile = (
  filePath: string,
  imports: ImportStatement[] = [],
  grammars: (GrammarDefinition | ModularGrammarDefinition)[] = [],
  moduleInfo?: ModuleInfo,
): ModuleFile => {
  const result: ModuleFile = {
    type: "ModuleFile",
    filePath,
    imports,
    grammars,
  };
  if (moduleInfo !== undefined) result.moduleInfo = moduleInfo;
  return result;
};

// ============================================================================
// Type Guards for Enhanced Type Safety
// ============================================================================

/**
 * Type guard to check if an expression is a StringLiteral.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a StringLiteral
 *
 * @example
 * ```typescript
 * if (isStringLiteral(expr)) {
 *   // expr is now typed as StringLiteral
 *   console.log(expr.value);
 * }
 * ```
 */
const hasNodeType = <T extends string>(
  expr: unknown,
  type: T,
): expr is { type: T } =>
  typeof expr === "object" &&
  expr !== null &&
  (expr as { type?: unknown }).type === type;

export const isStringLiteral = (expr: unknown): expr is StringLiteral =>
  hasNodeType(expr, "StringLiteral");

/**
 * Type guard to check if an expression is a CharacterClass.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a CharacterClass
 */
export const isCharacterClass = (expr: unknown): expr is CharacterClass =>
  hasNodeType(expr, "CharacterClass");

/**
 * Type guard to check if an expression is an Identifier.
 *
 * @param expr - The expression to check
 * @returns True if the expression is an Identifier
 */
export const isIdentifier = (expr: unknown): expr is Identifier =>
  hasNodeType(expr, "Identifier");

/**
 * Type guard to check if an expression is a QualifiedIdentifier.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a QualifiedIdentifier
 */
export const isQualifiedIdentifier = (
  expr: unknown,
): expr is QualifiedIdentifier => hasNodeType(expr, "QualifiedIdentifier");

/**
 * Type guard to check if an expression is an AnyChar.
 *
 * @param expr - The expression to check
 * @returns True if the expression is an AnyChar
 */
export const isAnyChar = (expr: unknown): expr is AnyChar =>
  hasNodeType(expr, "AnyChar");

/**
 * Type guard to check if an expression is a Sequence.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Sequence
 */
export const isSequence = (expr: unknown): expr is Sequence =>
  hasNodeType(expr, "Sequence");

/**
 * Type guard to check if an expression is a Choice.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Choice
 */
export const isChoice = (expr: unknown): expr is Choice =>
  hasNodeType(expr, "Choice");

/**
 * Type guard to check if an expression is a Group.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Group
 */
export const isGroup = (expr: unknown): expr is Group =>
  hasNodeType(expr, "Group");

/**
 * Type guard to check if an expression is a Star.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Star
 */
export const isStar = (expr: unknown): expr is Star =>
  hasNodeType(expr, "Star");

/**
 * Type guard to check if an expression is a Plus.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Plus
 */
export const isPlus = (expr: unknown): expr is Plus =>
  hasNodeType(expr, "Plus");

/**
 * Type guard to check if an expression is an Optional.
 *
 * @param expr - The expression to check
 * @returns True if the expression is an Optional
 */
export const isOptional = (expr: unknown): expr is Optional =>
  hasNodeType(expr, "Optional");

/**
 * Type guard to check if an expression is a Quantified.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Quantified
 */
export const isQuantified = (expr: unknown): expr is Quantified =>
  hasNodeType(expr, "Quantified");

/**
 * Type guard to check if an expression is a PositiveLookahead.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a PositiveLookahead
 */
export const isPositiveLookahead = (expr: unknown): expr is PositiveLookahead =>
  hasNodeType(expr, "PositiveLookahead");

/**
 * Type guard to check if an expression is a NegativeLookahead.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a NegativeLookahead
 */
export const isNegativeLookahead = (expr: unknown): expr is NegativeLookahead =>
  hasNodeType(expr, "NegativeLookahead");

/**
 * Type guard to check if an expression is a Cut.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a Cut
 */
export const isCut = (expr: unknown): expr is Cut => hasNodeType(expr, "Cut");

/**
 * Type guard to check if an expression is a LabeledExpression.
 *
 * @param expr - The expression to check
 * @returns True if the expression is a LabeledExpression
 */
export const isLabeledExpression = (expr: unknown): expr is LabeledExpression =>
  hasNodeType(expr, "LabeledExpression");

/**
 * Type guard to check if an expression is an ActionExpression.
 *
 * @param expr - The expression to check
 * @returns True if the expression is an ActionExpression
 */
export const isActionExpression = (expr: unknown): expr is ActionExpression =>
  hasNodeType(expr, "ActionExpression");

/**
 * Type guard to check if a grammar definition is a ModularGrammarDefinition.
 *
 * @param grammar - The grammar definition to check
 * @returns True if the grammar is a ModularGrammarDefinition
 */
export const isModularGrammarDefinition = (
  grammar: GrammarDefinition | ModularGrammarDefinition,
): grammar is ModularGrammarDefinition =>
  grammar.type === "ModularGrammarDefinition";

/**
 * Type guard to check if a grammar definition is a standard GrammarDefinition.
 *
 * @param grammar - The grammar definition to check
 * @returns True if the grammar is a standard GrammarDefinition
 */
export const isStandardGrammarDefinition = (
  grammar: GrammarDefinition | ModularGrammarDefinition,
): grammar is GrammarDefinition => grammar.type === "GrammarDefinition";
