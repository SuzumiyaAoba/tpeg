/**
 * TPEG Code Generation System
 *
 * Generates TypeScript parsers from TPEG grammar AST nodes.
 * This is a basic implementation supporting core TPEG features.
 */

import { escapeStringLiteral } from "./constants";
import type {
  ActionExpression,
  AnyChar,
  CharacterClass,
  Choice,
  Expression,
  GrammarAnnotation,
  GrammarDefinition,
  Group,
  Identifier,
  LabeledExpression,
  NegativeLookahead,
  Optional,
  Plus,
  PositiveLookahead,
  QualifiedIdentifier,
  Quantified,
  RuleDefinition,
  Sequence,
  Star,
  StringLiteral,
  TransformFunction,
} from "./types";

/** Identity string transform, the default `intern` for the leaf-generation
 * helpers below when a caller (codegen.ts itself) has no string-interning
 * table to route through. */
const identity = (s: string): string => s;

/**
 * Target language transform functions are matched against when a grammar
 * carries multiple `transforms ... @language { ... }` blocks.
 */
const CODEGEN_TARGET_LANGUAGE = "typescript";

/**
 * Builds a rule-name -> TransformFunction lookup for the TypeScript-targeted
 * transform set on a grammar. If more than one TypeScript transform set is
 * present, the first one (in declaration order) wins.
 */
export const collectTransformFunctions = (
  grammar: GrammarDefinition,
): Map<string, TransformFunction> => {
  const byName = new Map<string, TransformFunction>();
  const transformSet = grammar.transforms?.find(
    (t) => t.transformSet.targetLanguage === CODEGEN_TARGET_LANGUAGE,
  )?.transformSet;

  if (!transformSet) {
    return byName;
  }

  for (const fn of transformSet.functions) {
    byName.set(fn.name, fn);
  }

  return byName;
};

/**
 * Finds a rule's `@memoize` annotation (see `packages/parser/src/grammar.ts`'s
 * `memoizeAnnotation`), if any. If `@memoize` appears more than once on the
 * same rule, the first one wins.
 */
export const findMemoizeAnnotation = (
  rule: RuleDefinition,
): GrammarAnnotation | undefined =>
  rule.annotations?.find((a) => a.key === "memoize");

/**
 * Wraps `parserCode` in a `memoize(...)` call (`@suzumiyaaoba/tpeg-combinator`)
 * per `annotation`'s value: a bare `@memoize` (empty value) memoizes with an
 * unbounded cache, while `@memoize: N` passes `{ maxCacheSize: N }` so the
 * generated rule's memo table never tracks more than N cached positions at
 * once (packages/combinator/src/logic.ts's `memoize` bounds cached
 * positions *for the input currently being parsed*, not across inputs).
 */
export const wrapWithMemoize = (
  parserCode: string,
  annotation: GrammarAnnotation,
): string =>
  annotation.value
    ? `memoize(${parserCode}, { maxCacheSize: ${Number(annotation.value)} })`
    : `memoize(${parserCode})`;

/**
 * Wraps a rule's generated parser expression so that, on a successful parse,
 * the matching TypeScript transform function's body runs against the parse
 * result (the rule's capture structure) and its Result<T> return value
 * becomes the parser's own success/failure outcome.
 */
export const wrapWithTransform = (
  ruleName: string,
  parserCode: string,
  transformFn: TransformFunction,
): string => {
  const paramName = transformFn.parameters[0]?.name ?? "captures";
  return `(input, pos) => {
  const __base = (${parserCode});
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __transformed = ((${paramName}) => {
${transformFn.body}
  })(__result.val);
  if (!__transformed.success) {
    return {
      success: false,
      error: {
        message: __transformed.error ?? "Transform failed",
        pos: __result.current,
        parserName: "${ruleName}",
        expected: "successful transform",
        found: JSON.stringify(__result.val),
      },
    };
  }
  return {
    success: true,
    val: __transformed.value,
    current: __result.current,
    next: __result.next,
  };
}`;
};

/**
 * Does `expr` contain a `Cut` marked `global: true` (by `promoteGlobalCuts`,
 * `packages/parser/src/ast-optimize.ts`, Pillar 7 of the perf plan)
 * anywhere in its subtree? Used to decide whether `commitAtTopLevel`
 * (`@suzumiyaaoba/tpeg-combinator`) needs importing beyond the existing
 * start-rule-top-level-Sequence case this module already handles.
 */
const containsGlobalCut = (expr: Expression): boolean => {
  switch (expr.type) {
    case "Cut":
      return expr.global === true;
    case "Sequence":
      return expr.elements.some(containsGlobalCut);
    case "Choice":
      return expr.alternatives.some(containsGlobalCut);
    case "Group":
    case "Star":
    case "Plus":
    case "Optional":
    case "Quantified":
    case "PositiveLookahead":
    case "NegativeLookahead":
    case "LabeledExpression":
    case "ActionExpression":
      return containsGlobalCut(expr.expression);
    default:
      return false;
  }
};

/** Does any rule in `grammar` contain a `Cut` marked `global: true`?
 * Exported for reuse by `codegen-optimized.ts`, which needs the identical
 * check. */
export const grammarHasGlobalCut = (grammar: GrammarDefinition): boolean =>
  grammar.rules.some((rule) => containsGlobalCut(rule.pattern));

/**
 * Returns the label a single expression is bound to, unwrapping a `Group`
 * (which is transparent at codegen time) - or undefined if the expression
 * isn't a (possibly grouped) `LabeledExpression`.
 */
const labelOf = (expr: Expression): string | undefined => {
  if (expr.type === "LabeledExpression") {
    return (expr as LabeledExpression).label;
  }
  if (expr.type === "Group") {
    return labelOf((expr as Group).expression);
  }
  return undefined;
};

/**
 * Collects the label names directly visible on an expression: either the
 * expression itself is a (possibly grouped) `LabeledExpression`, or - if
 * it's a `Sequence` - each of its immediate elements that is one. This
 * mirrors the runtime merge performed by `captureSequence`/`mergeCaptures`
 * (`@suzumiyaaoba/tpeg-core`'s `capture.ts`), which merges each direct
 * child's captured object into one - so the label set computed here always
 * matches the keys actually present on the merged value at runtime.
 */
export const collectTopLevelLabels = (expr: Expression): string[] => {
  if (expr.type === "Sequence") {
    return (expr as Sequence).elements
      .map(labelOf)
      .filter((label): label is string => label !== undefined);
  }
  const single = labelOf(expr);
  return single !== undefined ? [single] : [];
};

/**
 * Narrows a label list down to the ones an action's code actually mentions
 * (matched as a whole word, so a label named `char` doesn't false-match
 * inside `charAt`). An unconditionally-destructured label the action ignores
 * would otherwise be a real `tsc --noEmit` failure on a saved generated file
 * under `noUnusedLocals` - never surfaced by dynamically `new Function`-eval'd
 * generated code in this package's own tests, which skips type-checking
 * entirely.
 */
export const filterReferencedLabels = (
  code: string,
  labels: string[],
): string[] =>
  labels.filter((label) => new RegExp(`\\b${label}\\b`).test(code));

/**
 * Wraps an alternative's generated parser expression so that, on a
 * successful parse, the semantic action code runs with `$$` bound to the
 * raw match value and (if the wrapped expression carries labeled captures)
 * each label destructured as its own named variable, then returns the
 * action's own return value as the parser's result.
 */
export const wrapWithAction = (
  parserCode: string,
  actionCode: string,
  labels: string[],
  includeTypes: boolean,
): string => {
  // Only declare `$$` when something can actually reference it - a label
  // destructure reads it, and the substring check covers a bare `$$` in the
  // action body (e.g. `return $$.join("")` for an unlabeled expression). An
  // action that ignores its match entirely (e.g. `{ return { type: "X" }; }`)
  // would otherwise leave `$$` unused, which fails a real generated file's
  // own `tsc --noEmit` under `noUnusedLocals` (never surfaced by this
  // package's own tests, which execute generated code via `new Function`
  // rather than saving and compiling it as a file).
  const needsCaptureValue = labels.length > 0 || actionCode.includes("$$");
  // captureSequence()'s return type is a union of the merged capture object
  // and a positional tuple (it can't statically know which one a given call
  // produces), so an untyped $$ fails to typecheck a destructure of any
  // label below - the action's arbitrary code is untyped anyway (same as a
  // transform function body), so this is deliberate, not merely convenient.
  // Only added under `includeTypes`, matching every other type annotation
  // this generator emits: with `includeTypes: false` the output has no type
  // syntax at all (plain JS, safe to run via `new Function` without a TS
  // transpile step), so a `: any` annotation here would be the only such
  // syntax in that mode and would break exactly that use case.
  const captureBinding = needsCaptureValue
    ? `    const $$${includeTypes ? ": any" : ""} = __result.val;\n`
    : "";
  const destructure =
    labels.length > 0 ? `    const { ${labels.join(", ")} } = $$;\n` : "";
  return `(input, pos) => {
  const __base = (${parserCode});
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
${captureBinding}${destructure}${actionCode}
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}`;
};

/**
 * Generates a `literal(...)` call for a `StringLiteral` node. Shared between
 * `codegen.ts` and `codegen-optimized.ts` (which passes `stringInterner.intern`
 * as `intern` to dedupe the escaped literal text across a grammar).
 */
export const generateStringLiteralCode = (
  value: string,
  intern: (s: string) => string = identity,
): string => `literal("${intern(escapeStringLiteral(value))}")`;

/**
 * Renders a `CharacterClass` node's `ranges` as the comma-joined argument
 * list `charClass(...)`/`charClassRun(...)` both expect (without the
 * enclosing call) -- shared by `generateCharacterClassCode` and
 * `tryGenerateCharClassRunCode` so the two can never drift on how a
 * range/single-char spec gets escaped.
 */
const characterClassRangesCode = (expr: CharacterClass): string =>
  expr.ranges
    .map((range) =>
      range.end
        ? `["${escapeStringLiteral(range.start)}", "${escapeStringLiteral(range.end)}"]`
        : `"${escapeStringLiteral(range.start)}"`,
    )
    .join(", ");

/**
 * Generates a `charClass(...)`/`negatedCharClass(...)` call for a
 * `CharacterClass` node. Identical between the base and optimized
 * generators, so shared here rather than duplicated.
 */
export const generateCharacterClassCode = (expr: CharacterClass): string => {
  const ranges = characterClassRangesCode(expr);
  return expr.negated ? `negatedCharClass(${ranges})` : `charClass(${ranges})`;
};

/**
 * Generates a `charClassRun(...)` call (`packages/core/src/char-class.ts`)
 * collapsing a `Star`/`Plus`/`Quantified{0,}`/`Quantified{1,}` whose
 * repeated element is a bare `CharacterClass` into a single scan -- one
 * `ParseSuccess` and one exact-size array instead of the repetition
 * combinator driving `charClass`/`negatedCharClass` one character at a
 * time (see `charClassRun`'s own doc comment for why this produces the
 * EXACT same value `zeroOrMore`/`oneOrMore` over the same class would).
 *
 * Returns `null` when `inner` isn't a bare `CharacterClass` -- nothing to
 * do here, the caller falls back to generating `inner` normally and
 * wrapping it in `zeroOrMore`/`oneOrMore`. Shared between `codegen.ts`
 * and `codegen-optimized.ts`, and also consulted by both generators'
 * `collectUsedCombinators` so the import decision and the codegen
 * decision can never disagree (they call this exact function).
 */
export const tryGenerateCharClassRunCode = (
  inner: Expression,
  min: 0 | 1,
): string | null => {
  if (inner.type !== "CharacterClass") return null;
  const ranges = characterClassRangesCode(inner);
  return `charClassRun([${ranges}], ${min}${inner.negated ? ", true" : ""})`;
};

/**
 * Generates the reference expression for an `Identifier` node: either the
 * rule's own (possibly prefixed) name, a `lazy(() => ...)`-deferred lookup
 * if the referenced rule hasn't been declared yet (forward/self/mutual
 * reference - see the callers' doc comments), or the bare name for an
 * external reference. Shared between `codegen.ts` and
 * `codegen-optimized.ts` (which passes `stringInterner.intern` as `intern`).
 */
export const generateIdentifierCode = (
  expr: Identifier,
  ctx: {
    ruleNames: Set<string>;
    ruleIndex: Map<string, number>;
    currentRuleIndex: number;
    namePrefix: string;
  },
  intern: (s: string) => string = identity,
): string => {
  const name = intern(expr.name);
  if (!ctx.ruleNames.has(name)) {
    return name;
  }
  const prefixedName = intern(ctx.namePrefix + name);
  const targetIndex = ctx.ruleIndex.get(name);
  if (targetIndex !== undefined && targetIndex >= ctx.currentRuleIndex) {
    return `lazy(() => ${prefixedName})`;
  }
  return prefixedName;
};

/**
 * Generates the reference expression for a `QualifiedIdentifier` node
 * (e.g. `math.expr`, a reference to a rule exported from another module -
 * see `namespace-manager.ts`'s import resolution). Shared between
 * `codegen.ts` and `codegen-optimized.ts`.
 */
export const generateQualifiedIdentifierCode = (
  expr: QualifiedIdentifier,
  intern: (s: string) => string = identity,
): string => intern(`${expr.module}.${expr.name}`);

/**
 * Generates the combinator call for a `Quantified` node, given its
 * already-generated inner expression. Identical between the base and
 * optimized generators (only how `inner` itself was produced differs), so
 * shared here rather than duplicated. `enableCharClassRun` mirrors
 * `CodeGenOptions`/`OptimizedCodeGenOptions`'s option of the same name
 * (default `true`) -- both generators pass their own resolved option
 * value through here for the `{0,}`/`{1,}` cases, which are the only
 * ones `tryGenerateCharClassRunCode` can apply to.
 */
export const generateQuantifiedCode = (
  expr: Quantified,
  inner: string,
  enableCharClassRun = true,
): string => {
  if (expr.max === undefined) {
    // {n,} - at least n
    if (expr.min === 0) {
      const run = enableCharClassRun
        ? tryGenerateCharClassRunCode(expr.expression, 0)
        : null;
      return run ?? `zeroOrMore(${inner})`;
    }
    if (expr.min === 1) {
      const run = enableCharClassRun
        ? tryGenerateCharClassRunCode(expr.expression, 1)
        : null;
      return run ?? `oneOrMore(${inner})`;
    }
    return `quantified(${inner}, ${expr.min})`;
  }

  if (expr.min === expr.max) {
    // {n} - exactly n
    if (expr.min === 0) {
      // {0} always matches zero repetitions, producing an empty array --
      // not "choice()", which always fails.
      return `quantified(${inner}, 0, 0)`;
    }
    if (expr.min === 1) return inner;
    return `quantified(${inner}, ${expr.min}, ${expr.max})`;
  }

  // {n,m} - between n and m
  if (expr.min === 0 && expr.max === 1) {
    return `optional(${inner})`;
  }
  return `quantified(${inner}, ${expr.min}, ${expr.max})`;
};

/**
 * Generates a `capture(...)` call for a `LabeledExpression` node, given its
 * already-generated inner expression. Identical between the base and
 * optimized generators, so shared here rather than duplicated.
 */
export const generateLabeledExpressionCode = (
  label: string,
  inner: string,
): string => `capture("${label}", ${inner})`;

/**
 * Code generation options
 */
export interface CodeGenOptions {
  /** Target language (currently only TypeScript) */
  language: "typescript";
  /** Generated parser name prefix */
  namePrefix?: string;
  /** Include runtime imports */
  includeImports?: boolean;
  /** Generate with type annotations */
  includeTypes?: boolean;
  /**
   * Emit `charClassRun(...)` (`packages/core/src/char-class.ts`) instead
   * of `zeroOrMore`/`oneOrMore` driving `charClass`/`negatedCharClass`
   * one character at a time, for a `Star`/`Plus`/`Quantified{0,}`/
   * `Quantified{1,}` whose repeated element is a bare `CharacterClass`.
   * See `tryGenerateCharClassRunCode`'s doc comment for why this produces
   * the exact same value.
   *
   * Default `true`, like `enablePredictiveDispatch`
   * (`OptimizedCodeGenOptions`) and unlike this package's opt-in AST
   * rewrites: the emitted value is byte-identical to the unfused shape
   * (no proof obligation the way `enableRegexFusion` has, and no
   * "does an ancestor's action read this rule's value shape" caveat the
   * way `./ast-optimize.ts`'s rewrites have), so there's no risk surface
   * to gate behind an opt-in. Exists as a real (not synthetic) toggle
   * mainly so `packages/parser/bench/`'s harness can isolate the axis --
   * ordinary callers should never need to set this.
   */
  enableCharClassRun?: boolean;
}

/**
 * Generated parser code result
 */
export interface GeneratedCode {
  /** Generated TypeScript code */
  code: string;
  /** Required imports */
  imports: string[];
  /** Export declarations */
  exports: string[];
}

/**
 * Main code generator class
 */
export class TPEGCodeGenerator {
  private options: Required<CodeGenOptions>;
  private ruleNames: Set<string> = new Set();
  /** Rule name -> declaration index, used to detect forward/self/mutual references. */
  private ruleIndex: Map<string, number> = new Map();
  /** Declaration index of the rule currently being generated. */
  private currentRuleIndex = -1;

  constructor(options: CodeGenOptions = { language: "typescript" }) {
    this.options = {
      language: options.language,
      namePrefix: options.namePrefix ?? "",
      includeImports: options.includeImports ?? true,
      includeTypes: options.includeTypes ?? true,
      enableCharClassRun: options.enableCharClassRun ?? true,
    };
  }

  /**
   * Generate TypeScript parser code from a TPEG grammar
   */
  generateGrammar(grammar: GrammarDefinition): GeneratedCode {
    const imports: string[] = [];
    const exports: string[] = [];
    const parts: string[] = [];

    // Collect used combinators
    const usedCombinators = new Set<string>();

    // Collect all rule names and their declaration order first, since a
    // reference to a rule needs to know both (whether it's a rule at all,
    // and whether generating it as a plain identifier would read a `const`
    // that hasn't been initialized yet - see generateIdentifier).
    grammar.rules.forEach((rule, index) => {
      this.ruleNames.add(rule.name);
      this.ruleIndex.set(rule.name, index);
    });
    grammar.rules.forEach((rule, index) => {
      this.collectUsedCombinators(
        rule.pattern,
        usedCombinators,
        index,
        index === 0,
      );
    });

    // Add imports based on what's actually used
    if (this.options.includeImports) {
      imports.push('import type { Parser } from "@suzumiyaaoba/tpeg-core";');
      const combinators = Array.from(usedCombinators).sort();
      if (combinators.length > 0) {
        imports.push(
          `import { ${combinators.join(", ")} } from "@suzumiyaaoba/tpeg-core";`,
        );
      }
      // memoize and commitAtTopLevel both live in tpeg-combinator, not
      // tpeg-core, so they share one import line there rather than being
      // folded into `combinators` above. memoize is only ever emitted for
      // a rule carrying an explicit `@memoize` annotation (see
      // generateRule) -- this generator has no automatic memoization
      // heuristic of its own (unlike codegen-optimized.ts).
      // commitAtTopLevel is emitted (in place of the ordinary `commit`,
      // see generateSequence) only for a `Cut` that is a direct element
      // of the grammar's start rule's own top-level Sequence -- see
      // `packages/combinator/src/logic.ts`'s `commitAtTopLevel` doc
      // comment for why only that specific shape is safe.
      const combinatorPackageImports: string[] = [];
      if (grammar.rules.some((rule) => findMemoizeAnnotation(rule))) {
        combinatorPackageImports.push("memoize");
      }
      const startRule = grammar.rules[0];
      if (
        (startRule?.pattern.type === "Sequence" &&
          startRule.pattern.elements.some((el) => el.type === "Cut")) ||
        grammarHasGlobalCut(grammar)
      ) {
        combinatorPackageImports.push("commitAtTopLevel");
      }
      if (combinatorPackageImports.length > 0) {
        imports.push(
          `import { ${combinatorPackageImports.join(", ")} } from "@suzumiyaaoba/tpeg-combinator";`,
        );
      }
    }

    // Generate parser for each rule, applying a matching TypeScript
    // transform function (if the grammar declares one) to the rule's result
    const transformsByRuleName = collectTransformFunctions(grammar);
    grammar.rules.forEach((rule, index) => {
      this.currentRuleIndex = index;
      const ruleCode = this.generateRule(
        rule,
        transformsByRuleName.get(rule.name),
        index === 0,
      );
      parts.push(ruleCode);
      exports.push(rule.name);
    });

    // Combine all parts
    let code = "";

    if (this.options.includeImports && imports.length > 0) {
      code += `${imports.join("\n")}\n\n`;
    }

    code += parts.join("\n\n");

    return {
      code,
      imports,
      exports,
    };
  }

  /**
   * Generate code for a single rule definition
   */
  private generateRule(
    rule: RuleDefinition,
    transformFn?: TransformFunction,
    isStartRule = false,
  ): string {
    let parserCode = this.generateExpression(rule.pattern, isStartRule);
    const memoizeAnnotation = findMemoizeAnnotation(rule);
    if (memoizeAnnotation) {
      parserCode = wrapWithMemoize(parserCode, memoizeAnnotation);
    }
    if (transformFn) {
      parserCode = wrapWithTransform(rule.name, parserCode, transformFn);
    }
    const name = this.options.namePrefix + rule.name;

    if (this.options.includeTypes) {
      return `export const ${name}: Parser<any> = ${parserCode};`;
    }
    return `export const ${name} = ${parserCode};`;
  }

  /**
   * Generate code for any expression type. `isStartRuleTopLevelSequence`
   * is forwarded ONLY to the `Sequence` case, and only ever `true` for
   * the single top-level call from `generateRule` on the start rule's
   * own pattern -- every other call site (including `generateSequence`'s
   * own per-element loop) implicitly passes `false`, since anything
   * reached recursively is no longer "top-level, unnested" (see
   * `generateSequence`'s doc comment).
   */
  private generateExpression(
    expr: Expression,
    isStartRuleTopLevelSequence = false,
  ): string {
    switch (expr.type) {
      case "StringLiteral":
        return this.generateStringLiteral(expr as StringLiteral);
      case "CharacterClass":
        return this.generateCharacterClass(expr as CharacterClass);
      case "Identifier":
        return this.generateIdentifier(expr as Identifier);
      case "QualifiedIdentifier":
        return this.generateQualifiedIdentifier(expr as QualifiedIdentifier);
      case "AnyChar":
        return this.generateAnyChar(expr as AnyChar);
      case "Sequence":
        return this.generateSequence(
          expr as Sequence,
          isStartRuleTopLevelSequence,
        );
      case "Choice":
        return this.generateChoice(expr as Choice);
      case "Group":
        return this.generateGroup(expr as Group);
      case "Star":
        return this.generateStar(expr as Star);
      case "Plus":
        return this.generatePlus(expr as Plus);
      case "Optional":
        return this.generateOptional(expr as Optional);
      case "Quantified":
        return this.generateQuantified(expr as Quantified);
      case "PositiveLookahead":
        return this.generatePositiveLookahead(expr as PositiveLookahead);
      case "NegativeLookahead":
        return this.generateNegativeLookahead(expr as NegativeLookahead);
      case "LabeledExpression":
        return this.generateLabeledExpression(expr as LabeledExpression);
      case "ActionExpression":
        return this.generateActionExpression(expr as ActionExpression);
      default:
        throw new Error(
          `Unsupported expression type: ${(expr as { type: string }).type}`,
        );
    }
  }

  private generateStringLiteral(expr: StringLiteral): string {
    return generateStringLiteralCode(expr.value);
  }

  private generateCharacterClass(expr: CharacterClass): string {
    return generateCharacterClassCode(expr);
  }

  private generateIdentifier(expr: Identifier): string {
    return generateIdentifierCode(expr, {
      ruleNames: this.ruleNames,
      ruleIndex: this.ruleIndex,
      currentRuleIndex: this.currentRuleIndex,
      namePrefix: this.options.namePrefix,
    });
  }

  private generateQualifiedIdentifier(expr: QualifiedIdentifier): string {
    return generateQualifiedIdentifierCode(expr);
  }

  private generateAnyChar(_expr: AnyChar): string {
    return "anyChar()";
  }

  private generateSequence(
    expr: Sequence,
    isStartRuleTopLevel = false,
  ): string {
    // A `~` cut marker (see the `Cut` node in grammar-types.ts) is dropped
    // entirely rather than emitted as a sequence()/captureSequence()
    // argument - it consumes no input and contributes no value of its own.
    // Every element *after* it is instead individually wrapped in
    // `commit(...)` (tpeg-core's combinators.ts): once everything before
    // the cut has matched, a failure in any of them must not let the
    // enclosing `choice(...)` fall back to a sibling alternative. Wrapping
    // each element individually (rather than nesting the tail in its own
    // sub-sequence) keeps the generated tuple/capture-merge shape
    // identical to the cut-free case - only failure behavior changes.
    //
    // `isStartRuleTopLevel` is `true` only when `expr` IS the grammar's
    // start rule's own top-level pattern (set once, in `generateRule`,
    // and never forwarded to any recursive call below -- see
    // `generateExpression`) -- a cut here is provably at backtrack depth
    // 0 (see `commitAtTopLevel`'s doc comment in
    // `packages/combinator/src/logic.ts` for why that's the condition
    // that matters), so `commitAtTopLevel(...)` is emitted instead of the
    // ordinary `commit(...)`, letting `memoize` discard now-unreachable
    // cache entries as the parse commits past them. A `Cut` marked
    // `global: true` by `promoteGlobalCuts` (`ast-optimize.ts`, Pillar 7)
    // gets the same treatment regardless of `isStartRuleTopLevel` -- that
    // function only sets the flag where the broader promotion argument
    // holds (see its module doc comment).
    const parts: string[] = [];
    let committed = false;
    let committingCutIsGlobal = false;
    for (const el of expr.elements) {
      if (el.type === "Cut") {
        committed = true;
        committingCutIsGlobal = el.global === true;
        continue;
      }
      const code = this.generateExpression(el);
      if (!committed) {
        parts.push(code);
      } else {
        parts.push(
          isStartRuleTopLevel || committingCutIsGlobal
            ? `commitAtTopLevel(${code})`
            : `commit(${code})`,
        );
      }
    }
    const elements = parts.join(", ");
    // A sequence with labeled elements needs its per-element captured
    // objects merged into one - `sequence()` returns a positional tuple
    // instead, which would leave labels unreachable by name.
    return collectTopLevelLabels(expr).length > 0
      ? `captureSequence(${elements})`
      : `sequence(${elements})`;
  }

  private generateChoice(expr: Choice): string {
    const alternatives = expr.alternatives
      .map((alt) => this.generateExpression(alt))
      .join(", ");
    return `choice(${alternatives})`;
  }

  private generateGroup(expr: Group): string {
    return this.generateExpression(expr.expression);
  }

  private generateStar(expr: Star): string {
    const run = this.options.enableCharClassRun
      ? tryGenerateCharClassRunCode(expr.expression, 0)
      : null;
    if (run !== null) return run;
    const inner = this.generateExpression(expr.expression);
    return `zeroOrMore(${inner})`;
  }

  private generatePlus(expr: Plus): string {
    const run = this.options.enableCharClassRun
      ? tryGenerateCharClassRunCode(expr.expression, 1)
      : null;
    if (run !== null) return run;
    const inner = this.generateExpression(expr.expression);
    return `oneOrMore(${inner})`;
  }

  private generateOptional(expr: Optional): string {
    const inner = this.generateExpression(expr.expression);
    return `optional(${inner})`;
  }

  private generateQuantified(expr: Quantified): string {
    const inner = this.generateExpression(expr.expression);
    return generateQuantifiedCode(expr, inner, this.options.enableCharClassRun);
  }

  private generatePositiveLookahead(expr: PositiveLookahead): string {
    const inner = this.generateExpression(expr.expression);
    return `andPredicate(${inner})`;
  }

  private generateNegativeLookahead(expr: NegativeLookahead): string {
    const inner = this.generateExpression(expr.expression);
    return `notPredicate(${inner})`;
  }

  private generateLabeledExpression(expr: LabeledExpression): string {
    const inner = this.generateExpression(expr.expression);
    return generateLabeledExpressionCode(expr.label, inner);
  }

  private generateActionExpression(expr: ActionExpression): string {
    const inner = this.generateExpression(expr.expression);
    const labels = filterReferencedLabels(
      expr.code,
      collectTopLevelLabels(expr.expression),
    );
    return wrapWithAction(inner, expr.code, labels, this.options.includeTypes);
  }

  /**
   * Collect all combinators used in an expression. `isStartRuleTopLevel`
   * mirrors `generateExpression`'s flag of the same shape: `true` only
   * for the single top-level call on the start rule's own pattern, never
   * forwarded to any recursive call. When a `Sequence` with that flag set
   * contains a `Cut`, `commitAtTopLevel` will be emitted there instead of
   * `commit` (see `generateSequence`) -- from tpeg-combinator, not
   * tpeg-core -- so `commit` must NOT be added to `combinators` (the
   * tpeg-core import set) in that specific case.
   */
  private collectUsedCombinators(
    expr: Expression,
    combinators: Set<string>,
    currentRuleIndex: number,
    isStartRuleTopLevel = false,
  ): void {
    switch (expr.type) {
      case "StringLiteral":
        combinators.add("literal");
        break;
      case "CharacterClass":
        combinators.add(expr.negated ? "negatedCharClass" : "charClass");
        break;
      case "AnyChar":
        combinators.add("anyChar");
        break;
      case "Identifier": {
        // Mirrors generateIdentifier's decision: a forward/self/mutual
        // reference is generated as `lazy(() => name)`, which needs the
        // import.
        const targetIndex = this.ruleIndex.get(expr.name);
        if (targetIndex !== undefined && targetIndex >= currentRuleIndex) {
          combinators.add("lazy");
        }
        break;
      }
      case "Sequence":
        combinators.add(
          collectTopLevelLabels(expr).length > 0
            ? "captureSequence"
            : "sequence",
        );
        // A Sequence can contain at most one Cut in practice (see
        // ast-optimize.ts), but this checks every one found, mirroring
        // generateSequence's per-cut `.global` decision rather than
        // assuming there's exactly one.
        if (
          expr.elements.some(
            (el) =>
              el.type === "Cut" && !isStartRuleTopLevel && el.global !== true,
          )
        ) {
          combinators.add("commit");
        }
        for (const element of expr.elements) {
          if (element.type === "Cut") continue;
          this.collectUsedCombinators(element, combinators, currentRuleIndex);
        }
        break;
      case "Choice":
        combinators.add("choice");
        for (const alternative of expr.alternatives) {
          this.collectUsedCombinators(
            alternative,
            combinators,
            currentRuleIndex,
          );
        }
        break;
      case "Star":
        // Mirrors generateStar's decision exactly (same option check,
        // same `tryGenerateCharClassRunCode` call), so the import set and
        // the generated code can never disagree: a `charClassRun` call
        // with no import, or an unused `zeroOrMore` import.
        if (
          this.options.enableCharClassRun &&
          tryGenerateCharClassRunCode(expr.expression, 0) !== null
        ) {
          combinators.add("charClassRun");
        } else {
          combinators.add("zeroOrMore");
          this.collectUsedCombinators(
            expr.expression,
            combinators,
            currentRuleIndex,
          );
        }
        break;
      case "Plus":
        // Mirrors generatePlus's decision exactly -- see the Star case's
        // comment just above.
        if (
          this.options.enableCharClassRun &&
          tryGenerateCharClassRunCode(expr.expression, 1) !== null
        ) {
          combinators.add("charClassRun");
        } else {
          combinators.add("oneOrMore");
          this.collectUsedCombinators(
            expr.expression,
            combinators,
            currentRuleIndex,
          );
        }
        break;
      case "Optional":
        combinators.add("optional");
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "PositiveLookahead":
        combinators.add("andPredicate");
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "NegativeLookahead":
        combinators.add("notPredicate");
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "Group":
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "LabeledExpression":
        combinators.add("capture");
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "ActionExpression":
        this.collectUsedCombinators(
          expr.expression,
          combinators,
          currentRuleIndex,
        );
        break;
      case "Quantified": {
        const quantified = expr as Quantified;
        // Add the appropriate combinator based on quantification. The
        // {n,} branch mirrors generateQuantifiedCode's decision exactly
        // (same `tryGenerateCharClassRunCode` calls) for min 0/1 -- see
        // the Star/Plus cases' comment above.
        let usesRun = false;
        if (quantified.max === undefined) {
          if (quantified.min === 0) {
            usesRun =
              this.options.enableCharClassRun &&
              tryGenerateCharClassRunCode(quantified.expression, 0) !== null;
            combinators.add(usesRun ? "charClassRun" : "zeroOrMore");
          } else if (quantified.min === 1) {
            usesRun =
              this.options.enableCharClassRun &&
              tryGenerateCharClassRunCode(quantified.expression, 1) !== null;
            combinators.add(usesRun ? "charClassRun" : "oneOrMore");
          } else {
            combinators.add("quantified");
          }
        } else if (quantified.min === quantified.max) {
          if (quantified.min !== 1) combinators.add("quantified");
        } else {
          if (quantified.min === 0 && quantified.max === 1) {
            combinators.add("optional");
          } else {
            combinators.add("quantified");
          }
        }
        if (!usesRun) {
          this.collectUsedCombinators(
            quantified.expression,
            combinators,
            currentRuleIndex,
          );
        }
        break;
      }
    }
  }
}

/**
 * Convenience function to generate TypeScript parser code from a grammar
 */
export function generateTypeScriptParser(
  grammar: GrammarDefinition,
  options?: Partial<CodeGenOptions>,
): GeneratedCode {
  const generator = new TPEGCodeGenerator({
    language: "typescript",
    ...options,
  });
  return generator.generateGrammar(grammar);
}
