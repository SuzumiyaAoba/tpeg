import type {
  ActionExpression,
  AnyChar,
  CharRange,
  CharacterClass,
  Choice,
  Cut,
  ExportDeclaration,
  Expression,
  GrammarAnnotation,
  GrammarDefinition,
  Group,
  Identifier,
  ImportStatement,
  LabeledExpression,
  ModularGrammarDefinition,
  ModuleFile,
  ModuleInfo,
  NegativeLookahead,
  Optional,
  Plus,
  PositiveLookahead,
  QualifiedIdentifier,
  Quantified,
  RuleDefinition,
  Sequence,
  Skip,
  Span,
  WordBoundary,
  Star,
  StringLiteral,
  TransformDefinition,
} from "./grammar-nodes";

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
  end !== undefined ? { start, end } : { start };

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
 * Create a Skip AST node -- the desugar-internal marker
 * `applySkipDesugar` inserts at sequence boundaries for grammars
 * carrying `@skip: <ruleName>`. Never emitted by the grammar parser.
 *
 * @param expression - Reference to the grammar's skip rule
 * @returns A new Skip AST node
 *
 * @example
 * ```typescript
 * const skip = createSkip(createIdentifier("whitespace"));
 * // Returns: { type: "Skip", expression: { type: "Identifier", name: "whitespace" } }
 * ```
 */
export const createSkip = (expression: Identifier): Skip => ({
  type: "Skip",
  expression,
});

/**
 * Create a Span AST node -- the `@expr` source-text extraction
 * operator: the wrapped expression matches exactly as written, but the
 * produced value is the consumed source text.
 *
 * @param expression - The expression whose consumed source text becomes the value
 * @returns A new Span AST node
 *
 * @example
 * ```typescript
 * const span = createSpan(createIdentifier("number"));
 * // Returns: { type: "Span", expression: { type: "Identifier", name: "number" } }
 * ```
 */
export const createSpan = (expression: Expression): Span => ({
  type: "Span",
  expression,
});

/**
 * Create a WordBoundary AST node -- the `\b`/`\B` zero-width
 * word-boundary assertion.
 *
 * @param negated - `true` for `\B` (assert no boundary), `false` for `\b`
 * @returns A new WordBoundary AST node
 *
 * @example
 * ```typescript
 * const boundary = createWordBoundary();
 * // Returns: { type: "WordBoundary", negated: false }
 * ```
 */
export const createWordBoundary = (negated = false): WordBoundary => ({
  type: "WordBoundary",
  negated,
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
