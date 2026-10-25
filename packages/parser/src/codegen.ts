/**
 * TPEG Code Generation System
 *
 * Generates TypeScript parsers from TPEG grammar AST nodes.
 * This is a basic implementation supporting core TPEG features.
 */

import { analyzeFirstSets, assertNoNullableRepetition } from "./first-sets";
import {
  resolveStartRule,
  validateGeneratedIdentifiers,
  validateGrammar,
} from "./grammar-validation";
import { applySkipDesugar } from "./skip-desugar";
import type {
  ActionExpression,
  AnyChar,
  CharacterClass,
  Choice,
  Expression,
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

import {
  collectTransformFunctions,
  findMemoizeAnnotation,
  wrapWithMemoize,
  wrapWithTransform,
  grammarHasGlobalCut,
  forEachSequenceElement,
  sequenceHasCutFollowedByElement,
  collectUsedCombinators,
  isRuleReferencedAnywhere,
  collectTopLevelLabels,
  filterReferencedLabels,
  wrapWithAction,
  generateStringLiteralCode,
  generateCharacterClassCode,
  tryGenerateCharClassRunCode,
  generateIdentifierCode,
  generateQualifiedIdentifierCode,
  buildQualifiedIdentifierWarnings,
  buildExternalIdentifierWarnings,
  generateQuantifiedCode,
  generateLabeledExpressionCode,
} from "./codegen-helpers";
export * from "./codegen-helpers";

/**
 * Shared `Choice` emission skeleton used by the optimized and Eta
 * generators (this class's own `generateChoice` deliberately always
 * emits `choice(...)`, even for one alternative, so it does not use
 * this helper):
 *
 * - zero alternatives emits `choice()`;
 * - one alternative emits the alternative's code bare -- wrapping a
 *   single branch in `choice(...)` would be a no-op call;
 * - two or more emit `choice(alt1, alt2, ...)` unless `multiOverride`
 *   supplies different code (the optimized generator's
 *   predictive-dispatch attempt, which must run only after the
 *   zero/one-alternative shortcuts -- same order it used inline).
 */
export const generateChoiceCode = (
  expr: Choice,
  generateAlternative: (alternative: Expression) => string,
  multiOverride?: (expr: Choice) => string | undefined,
): string => {
  if (expr.alternatives.length === 0) {
    return "choice()";
  }
  if (expr.alternatives.length === 1) {
    const alternative = expr.alternatives[0];
    if (alternative) {
      return generateAlternative(alternative);
    }
  }
  const override = multiOverride?.(expr);
  if (override !== undefined) {
    return override;
  }
  return `choice(${expr.alternatives.map(generateAlternative).join(", ")})`;
};

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
  /** Non-fatal generation warnings (e.g. an unresolved `QualifiedIdentifier`
   * reference -- see `buildQualifiedIdentifierWarnings`). Empty when there
   * is nothing to report. */
  warnings: string[];
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
    // Reset per-instance state so a reused generator does not leak rule
    // names or declaration-order information from a previous grammar.
    this.ruleNames.clear();
    this.ruleIndex.clear();
    this.currentRuleIndex = -1;

    // Reject a duplicate rule name or a left-recursive rule outright,
    // before anything else -- see `grammar-validation.ts`'s doc comment
    // for why this MUST run before `analyzeFirstSets` (a duplicate name
    // can make that fixpoint oscillate forever instead of converging).
    validateGrammar(grammar);

    // `@skip`-desugar BEFORE first-set analysis and every downstream
    // walk: the grammar the emitted code implements is the desugared
    // one, so nullable-repetition checks, reference scanning, and the
    // combinator-import collection must all see the `Skip`-inserted
    // shape too. Rule names, order, annotations, and transforms are
    // unchanged by the rewrite -- see `skip-desugar.ts`.
    const desugared = applySkipDesugar(grammar);

    // Reject an unbounded repetition over a nullable body outright,
    // before generating any code -- see `assertNoNullableRepetition`'s
    // doc comment (`first-sets.ts`) for why this has no well-defined PEG
    // semantics and would otherwise generate code whose behavior depends
    // on incidental wrapping (e.g. whether the repetition happens to sit
    // inside an `optional`).
    assertNoNullableRepetition(desugared, analyzeFirstSets(desugared));

    const imports: string[] = [];
    const exports: string[] = [];
    const parts: string[] = [];

    // Collect used combinators
    const usedCombinators = new Set<string>();

    // `commitAtTopLevel` for a Cut in the start rule's own top-level
    // Sequence is only sound when the start rule is EXCLUSIVELY the
    // grammar's external entry point -- see `isRuleReferencedAnywhere`'s
    // doc comment for the concrete counterexample (a `Choice`
    // alternative elsewhere in the grammar referencing the start rule
    // by name) this guards against. Which rule IS the start rule comes
    // from `resolveStartRule` (`grammar-validation.ts`): the rule named
    // by `@start` when the annotation is present, `rules[0]` otherwise
    // -- `index === startRuleIndex` below replaces the historical
    // `index === 0` so the resolved rule, not just the first-declared
    // one, gets the top-level treatment.
    const startRule = resolveStartRule(desugared);
    const startRuleIndex = startRule?.index ?? -1;
    const startRuleName = startRule?.rule.name;
    const startRuleIsSafeForCommitAtTopLevel =
      startRuleName !== undefined &&
      !isRuleReferencedAnywhere(desugared, startRuleName);

    // Collect all rule names and their declaration order first, since a
    // reference to a rule needs to know both (whether it's a rule at all,
    // and whether generating it as a plain identifier would read a `const`
    // that hasn't been initialized yet - see generateIdentifier).
    desugared.rules.forEach((rule, index) => {
      this.ruleNames.add(rule.name);
      this.ruleIndex.set(rule.name, index);
    });
    desugared.rules.forEach((rule, index) => {
      this.collectUsedCombinators(
        rule.pattern,
        usedCombinators,
        index,
        index === startRuleIndex && startRuleIsSafeForCommitAtTopLevel,
      );
    });
    // Every rule's emitted parser is wrapped in `untagCapture(...)` (see
    // `generateRule`) regardless of its pattern, so the import is needed
    // unconditionally whenever the grammar declares any rule at all.
    if (desugared.rules.length > 0) {
      usedCombinators.add("untagCapture");
    }

    // Emit the import statements for whatever `collectUsedCombinators`
    // found (plus the `Parser` type), then reject a rule name, capture
    // label, or transform parameter name that would generate to a
    // reserved word, an internal codegen name, or one of the imported
    // bindings -- see `validateGeneratedIdentifiers`'s doc comment
    // (`grammar-validation.ts`) for the concrete failure modes.
    const { lines: importLines, importedBindings } = this.buildImports(
      desugared,
      usedCombinators,
      startRuleIsSafeForCommitAtTopLevel,
    );
    imports.push(...importLines);
    validateGeneratedIdentifiers(desugared, {
      namePrefix: this.options.namePrefix,
      importedBindings,
    });

    // Generate parser for each rule, applying a matching TypeScript
    // transform function (if the grammar declares one) to the rule's result
    const transformsByRuleName = collectTransformFunctions(desugared);
    desugared.rules.forEach((rule, index) => {
      this.currentRuleIndex = index;
      const ruleCode = this.generateRule(
        rule,
        transformsByRuleName.get(rule.name),
        index === startRuleIndex && startRuleIsSafeForCommitAtTopLevel,
      );
      parts.push(ruleCode);
      // The emitted declaration is `export const <namePrefix><rule.name>`,
      // so the exports list records the prefixed name -- the name a
      // consumer would actually import (matching eta-generator.ts, which
      // has always pushed the prefixed name).
      exports.push(this.options.namePrefix + rule.name);
    });

    // An explicit `@start: <name>` also emits `export { <name> as start }`
    // so a consumer can reach the grammar's entry point under one stable
    // name regardless of which rule it is or what `namePrefix` was used.
    // Skipped when the resolved rule's own emitted name is already
    // `start` (the alias would be a duplicate export) -- and when a
    // DIFFERENT rule emits `start` this throws instead: the two exports
    // would collide, and silently dropping the alias would hand the
    // caller the wrong rule under the entry-point name.
    if (startRule?.explicit) {
      const startEmittedName = this.options.namePrefix + startRule.rule.name;
      if (startEmittedName !== "start") {
        if (
          desugared.rules.some(
            (rule) => `${this.options.namePrefix}${rule.name}` === "start",
          )
        ) {
          throw new Error(
            `Rule name "start" collides with the \`start\` export alias @start emits for entry rule "${startRule.rule.name}" -- rename the rule, or set a namePrefix so the rule no longer emits that name.`,
          );
        }
        parts.push(`export { ${startEmittedName} as start };`);
        exports.push("start");
      }
    }

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
      warnings: [
        ...buildExternalIdentifierWarnings(desugared),
        ...buildQualifiedIdentifierWarnings(desugared),
      ],
    };
  }

  /**
   * The import statements this grammar's emitted code needs, plus the
   * exact set of binding names the emitted code can reference (for
   * `validateGeneratedIdentifiers` to check rule/label/parameter names
   * against). `lines` is empty when `includeImports` is false -- matching
   * the emitted code, which then declares no imports -- but
   * `importedBindings` is populated regardless: the emitted code still
   * CALLS these combinators in that mode (the caller is expected to
   * supply the bindings), so a rule named e.g. `sequence` or
   * `untagCapture` would otherwise pass validation and emit
   * `export const sequence = sequence(...)`, a TDZ `ReferenceError` at
   * module evaluation.
   */
  private buildImports(
    grammar: GrammarDefinition,
    usedCombinators: ReadonlySet<string>,
    startRuleIsSafeForCommitAtTopLevel: boolean,
  ): { lines: string[]; importedBindings: string[] } {
    // `Parser` is referenced only by the `: Parser<any>` rule annotations
    // and the `import type` line emitted alongside them (`includeTypes`)
    // -- a rule named `Parser` collides with the generated code only then.
    const importedBindings: string[] = [
      ...(this.options.includeTypes ? ["Parser"] : []),
      ...usedCombinators,
    ];
    // memoize and commitAtTopLevel both live in tpeg-combinator, not
    // tpeg-core, so they share one import line there rather than being
    // folded into `combinators` below. memoize is only ever emitted for
    // a rule carrying an explicit `@memoize` annotation (see
    // generateRule) -- this generator has no automatic memoization
    // heuristic of its own (unlike codegen-optimized.ts).
    // commitAtTopLevel is emitted (in place of the ordinary `commit`,
    // see generateSequence) only for a `Cut` that is a direct element
    // of the grammar's start rule's own top-level Sequence, AND ONLY
    // when nothing else in the grammar references that start rule by
    // name -- see `isRuleReferencedAnywhere`'s doc comment, and
    // `packages/combinator/src/logic.ts`'s `commitAtTopLevel` doc
    // comment for why the narrower shape is the one that's actually
    // safe.
    const combinatorPackageImports: string[] = [];
    if (grammar.rules.some((rule) => findMemoizeAnnotation(rule))) {
      combinatorPackageImports.push("memoize");
    }
    // The `@start`-resolved entry rule, not blindly `rules[0]` -- see
    // `resolveStartRule` (`grammar-validation.ts`).
    const startRule = resolveStartRule(grammar)?.rule;
    if (
      (startRuleIsSafeForCommitAtTopLevel &&
        startRule?.pattern.type === "Sequence" &&
        sequenceHasCutFollowedByElement(startRule.pattern.elements)) ||
      grammarHasGlobalCut(grammar)
    ) {
      combinatorPackageImports.push("commitAtTopLevel");
    }
    importedBindings.push(...combinatorPackageImports);
    if (!this.options.includeImports) {
      return { lines: [], importedBindings };
    }
    // `Parser` is only referenced by the `: Parser<any>` annotations, so
    // `includeTypes: false` (the CLI's `--no-types`) must not import it
    // either -- an unused `import type` fails `noUnusedLocals` and is a
    // SyntaxError if the output is used as plain JavaScript.
    const lines: string[] = this.options.includeTypes
      ? ['import type { Parser } from "@suzumiyaaoba/tpeg-core";']
      : [];
    const combinators = Array.from(usedCombinators).sort();
    if (combinators.length > 0) {
      lines.push(
        `import { ${combinators.join(", ")} } from "@suzumiyaaoba/tpeg-core";`,
      );
    }
    if (combinatorPackageImports.length > 0) {
      lines.push(
        `import { ${combinatorPackageImports.join(", ")} } from "@suzumiyaaoba/tpeg-combinator";`,
      );
    }
    return { lines, importedBindings };
  }

  /**
   * Generate code for a single rule definition
   */
  private generateRule(
    rule: RuleDefinition,
    transformFn?: TransformFunction,
    isStartRule = false,
  ): string {
    // `untagCapture` strips a surviving CAPTURE_TAG at the rule boundary --
    // a rule whose own pattern still yields a tagged object (a bare
    // `x:"a"`, a grouped/labeled choice alternative, an optional labeled
    // element, an action returning `$$`, ...) would otherwise leak its
    // internal labels into an enclosing `captureSequence` merge wherever
    // it's referenced unlabeled. Applied inside `memoize(...)` below so the
    // memo table stores the already-clean value.
    let parserCode = `untagCapture(${this.generateExpression(rule.pattern, isStartRule)})`;
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
        return this.generateStringLiteral(expr);
      case "CharacterClass":
        return this.generateCharacterClass(expr);
      case "Identifier":
        return this.generateIdentifier(expr);
      case "QualifiedIdentifier":
        return this.generateQualifiedIdentifier(expr);
      case "AnyChar":
        return this.generateAnyChar(expr);
      case "Sequence":
        return this.generateSequence(expr, isStartRuleTopLevelSequence);
      case "Choice":
        return this.generateChoice(expr);
      case "Group":
        return this.generateGroup(expr);
      case "Star":
        return this.generateStar(expr);
      case "Plus":
        return this.generatePlus(expr);
      case "Optional":
        return this.generateOptional(expr);
      case "Quantified":
        return this.generateQuantified(expr);
      case "PositiveLookahead":
        return this.generatePositiveLookahead(expr);
      case "NegativeLookahead":
        return this.generateNegativeLookahead(expr);
      case "Skip":
        // `applySkipDesugar`-inserted boundary skip: invoke the `@skip`
        // rule optionally and discard whatever it returns -- `ignore`
        // maps the success value to the `IGNORED` sentinel, which
        // `sequence`/`captureSequence` then exclude from the result
        // tuple / label merge, so a rule's own value shape is identical
        // with and without `@skip`.
        return `ignore(optional(${this.generateExpression(expr.expression)}))`;
      case "Span":
        // `@expr` source-text extraction: the child matches exactly as
        // written; `span` replaces the produced value with the consumed
        // source text (`packages/core/src/transform.ts`).
        return `span(${this.generateExpression(expr.expression)})`;
      case "WordBoundary":
        // `\b` / `\B` word-boundary assertion -- a bare parser constant
        // (`packages/core/src/boundary.ts`), no call.
        return expr.negated ? "nonWordBoundary" : "wordBoundary";
      case "LabeledExpression":
        return this.generateLabeledExpression(expr);
      case "ActionExpression":
        return this.generateActionExpression(expr);
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
    // `generateExpression`) AND `rules[0]` is never referenced by name
    // from anywhere else in the grammar (see
    // `isRuleReferencedAnywhere`'s doc comment for why that second
    // condition is load-bearing, not just belt-and-suspenders) -- a cut
    // here is provably at backtrack depth 0 (see `commitAtTopLevel`'s doc
    // comment in `packages/combinator/src/logic.ts` for why that's the
    // condition that matters), so `commitAtTopLevel(...)` is emitted
    // instead of the
    // ordinary `commit(...)`, letting `memoize` discard now-unreachable
    // cache entries as the parse commits past them. A `Cut` marked
    // `global: true` by `promoteGlobalCuts` (`ast-optimize.ts`)
    // gets the same treatment regardless of `isStartRuleTopLevel` -- that
    // function only sets the flag where the broader promotion argument
    // holds (see its module doc comment).
    //
    // Per the Capture Structure Reference Table (docs/peg-grammar.md),
    // dropping `~` must leave the sequence's capture exactly as if `~`
    // weren't there at all. If exactly one non-Cut element remains, "as if
    // `~` weren't there" means a single bare pattern -- which captures as
    // that element's own value, not a 1-tuple. So a single remaining part
    // (with no label on this sequence) is returned bare rather than passed
    // through `sequence(...)`, mirroring `codegen-optimized.ts`'s
    // `generateOptimizedSequence`, which already does this. The `!hasLabel`
    // guard matters: a labeled sole survivor (e.g. `~x:"v"`) must still go
    // through `captureSequence` below, or its still-CAPTURE_TAG-tagged
    // value would leak out bare instead of merged.
    const hasLabel = collectTopLevelLabels(expr).length > 0;
    // Elements that contribute a VALUE to this sequence's result:
    // everything but `~` cuts and `applySkipDesugar`-inserted `Skip`
    // markers (whose `ignore(optional(...))` emission the
    // `IGNORED`-sentinel filter drops before the tuple is built).
    const valueElementCount = expr.elements.filter(
      (el) => el.type !== "Cut" && el.type !== "Skip",
    ).length;
    const parts: string[] = [];
    forEachSequenceElement(expr.elements, (el, committed, cutIsGlobal) => {
      const code = this.generateExpression(el);
      parts.push(
        !committed
          ? code
          : isStartRuleTopLevel || cutIsGlobal
            ? `commitAtTopLevel(${code})`
            : `commit(${code})`,
      );
    });
    if (parts.length === 0) {
      return "sequence()";
    }
    if (valueElementCount === 1 && !hasLabel) {
      // Exactly one value-contributing element: this sequence's own
      // value must be that element's value, not a 1-tuple. With no
      // `Skip` siblings that's the bare emission (the `parts.length`
      // fast path); WITH them, the surrounding `sequence(...)` must
      // still run -- its `ignore(optional(...))` boundary skips consume
      // input -- but the `IGNORED` filter leaves a 1-tuple behind, so
      // `map` unwraps it back to the element's own value.
      if (parts.length === 1) {
        const [only] = parts;
        if (only) return only;
      }
      return `map(sequence(${parts.join(", ")}), ([v]) => v)`;
    }
    const elements = parts.join(", ");
    // A sequence with labeled elements needs its per-element captured
    // objects merged into one - `sequence()` returns a positional tuple
    // instead, which would leave labels unreachable by name.
    return hasLabel ? `captureSequence(${elements})` : `sequence(${elements})`;
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
   * Collect all combinators used in an expression. Delegates to the
   * shared {@link collectUsedCombinators} with this generator's own
   * decisions: `generateChoice` always emits `choice(...)` (even for a
   * single alternative), and `generateSequence` emits `commit` only for
   * elements after a non-top-level, non-`global` `Cut` (see
   * `sequenceNeedsOrdinaryCommit`).
   */
  private collectUsedCombinators(
    expr: Expression,
    combinators: Set<string>,
    currentRuleIndex: number,
    isStartRuleTopLevel = false,
  ): void {
    collectUsedCombinators(
      expr,
      combinators,
      {
        ruleIndex: this.ruleIndex,
        currentRuleIndex,
        enableCharClassRun: this.options.enableCharClassRun,
        commitAfterAnyCut: false,
        choiceCombinatorFor: () => "choice",
      },
      isStartRuleTopLevel,
    );
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
