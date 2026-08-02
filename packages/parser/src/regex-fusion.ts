/**
 * Pillar 4b of the PEG-theory performance plan: compiling a whole rule's
 * pattern into a single `regexFused` call (`packages/core/src/
 * regex-fused.ts`) when that pattern denotes a regular language -- i.e.
 * contains no non-terminal references -- so a `Sequence` of N leaf
 * combinators (each allocating a `Pos`/`ParseSuccess` per character) is
 * replaced by one `RegExp.exec`.
 *
 * The gate measurement backing this (see the plan file's Pillar 4a
 * section) found ~82-87% of leaf-parser invocations in the JSON and
 * unfactored-arithmetic bench grammars belong to wholly-clean rules, with
 * a ~6.7x collapse factor (leaf invocations per rule entry) -- both
 * numbers high enough to justify this module.
 *
 * ## Two independent conditions, both required
 *
 * 1. **Structural**: the rule's pattern contains no `Identifier` /
 *    `QualifiedIdentifier` / `ActionExpression` / `LabeledExpression` /
 *    lookahead / `Cut` (see `isStructurallyFusable`). This is what makes
 *    "compile to a regex" meaningful at all -- a subtree with a
 *    non-terminal reference isn't a regular language, and an action's
 *    code is opaque to this module by construction.
 *
 *    A further, narrower structural restriction applies to `Star`/`Plus`/
 *    `Quantified`: their wrapped expression must be a *simple* leaf
 *    (`CharacterClass`, `AnyChar`, or a single-code-point `StringLiteral`)
 *    -- see "Shape reconstruction" below for why.
 *
 * 2. **Determinism**: for every repetition (`Star`/`Plus`/`Quantified`)
 *    and every `Choice` inside the fusable subtree, the translation to a
 *    JS regex's greedy/backtracking behavior must coincide with PEG's
 *    possessive one (see `checkFusionSafe`). Pillar 1's exact `CharSet`
 *    intersection (via `firstSetsDisjoint`) is what makes this checkable
 *    at all -- the pre-Pillar-1 approximate FIRST-set representation
 *    couldn't prove disjointness for negated classes or lookahead-derived
 *    subtraction.
 *
 *    The classic counterexample (fixed in this module's test suite):
 *    `[a-z]* "x"` against `"abcx"`. PEG's `*` is possessive -- it
 *    consumes "abcx" in full and then fails to find an "x", so the whole
 *    match fails. A naive `/[a-z]*x/` backtracks `[a-z]*` down by one and
 *    succeeds. `FIRST([a-z]) ∩ FIRST("x") = {x} ≠ ∅` catches this.
 *
 *    Two refinements over the plan's original two-clause wording
 *    (`FIRST(e) ∩ FIRST(next) = ∅ AND next non-nullable`), both found
 *    during the Pillar 4a gate write-up and confirmed by hand-tracing
 *    before being coded here:
 *
 *    - The correct "what follows" isn't just the single adjacent sibling
 *      -- it's the *properly composed* FIRST set of everything remaining
 *      in the fused region from that point on, folding nullable elements
 *      through exactly the way `sequenceFirstSetFrom` (in `first-sets.ts`)
 *      already does internally for cut placement. `checkFusionSafe`
 *      reimplements that fold locally (via the exported `unionFirstSets`)
 *      because it needs to inject an externally-supplied `tail` at the
 *      base case, which the un-exported `sequenceFirstSetFrom` doesn't
 *      accept. With this, a trailing repetition -- nothing left in the
 *      fused region after it -- is automatically safe (its computed
 *      "follow" first-set is empty, and an empty first-set is disjoint
 *      from everything), matching the more fundamental reason it's safe:
 *      a JS regex engine never backtracks a quantifier to satisfy
 *      something that isn't even in the pattern.
 *    - `Choice` needs the analogous check, not just repetitions: `(?:a|b)`
 *      can also backtrack from `a` into `b` on a downstream failure,
 *      diverging from PEG's non-backtracking alternative commitment. Pairwise
 *      FIRST-disjointness among alternatives is necessary but not
 *      sufficient -- if `tail` (what follows the whole `Choice` in the
 *      fused region) is non-empty, no alternative may ALSO be nullable
 *      (a nullable alternative can always match empty regardless of
 *      disjointness, so the regex engine can reach it and continue into
 *      `tail` from the original position, something PEG's ordered choice
 *      would never do once an earlier alternative already matched a
 *      non-empty prefix and then failed downstream).
 *
 *    "Nothing outside the fused region can be part of the same regex" is
 *    the other half of why this is checkable at all: since `regexFused`
 *    is one atomic `exec()` from its caller's perspective (like any other
 *    leaf `Parser`), nothing outside a rule's own fused pattern can ever
 *    cause the *regex engine itself* to backtrack into a decision made
 *    inside it -- ordinary PEG-level backtracking (a caller's enclosing
 *    `Choice` retrying with a different alternative, or the whole rule
 *    being re-invoked from scratch) is unaffected either way. This is why
 *    the top-level call always starts with `tail = EMPTY_FIRST_SET`.
 *
 * ## Shape reconstruction (no cross-rule analysis needed)
 *
 * A rule's return VALUE shape must not change just because it happens to
 * be implemented with a regex internally -- any other rule that
 * references it (possibly via an `ActionExpression` that destructures a
 * `Sequence`'s positional tuple) must see byte-identical values whether
 * or not fusion happened. Rather than proving no caller depends on the
 * old shape (a whole-grammar analysis this module doesn't do), fusion
 * reconstructs the *exact* original shape from the regex's own capture
 * groups, computed once at codegen time from the same AST subtree that
 * generated the regex source:
 *
 * - `StringLiteral` needs no group -- codegen already knows its value.
 * - `CharacterClass`/`AnyChar`, standing alone, get their own capturing
 *   group (their value is exactly what that group captured).
 * - `Sequence` needs no group of its own; its value is an array of its
 *   elements' reconstructed values, in order (matches `sequence()`'s
 *   tuple shape).
 * - `Choice` wraps each alternative in a marker group (even a bare
 *   `StringLiteral` alternative, which otherwise has nothing to check);
 *   reconstruction picks the first alternative whose marker matched
 *   (exactly one will, given condition 2's disjointness) and yields its
 *   value.
 * - `Optional` gets a marker group around its wrapped expression;
 *   reconstruction yields `[value]` or `[]` (matches `optional()`'s
 *   `[T] | []` shape, NOT `T | null`).
 * - `Star`/`Plus`/`Quantified` capture their *entire* run in one group
 *   and reconstruct via `Array.from(capturedRun)` -- splitting the run
 *   back into one array entry per code point. This is exactly correct
 *   when the repeated element is a single code point per iteration
 *   (`CharacterClass`, `AnyChar`, a 1-code-point `StringLiteral`), and
 *   is why the structural condition above restricts repetitions to
 *   those three leaf kinds: JS regex has no way to recover *per-iteration*
 *   captures from a repeated *group* (a pattern like `(?:(a)(b))*`
 *   applied repeatedly only keeps the LAST iteration's submatch), so a
 *   repetition over anything
 *   compound (a `Sequence`, a multi-character `StringLiteral`, a nested
 *   repetition) can't be shape-reconstructed this way and is left
 *   unfused instead.
 *
 * Because reconstruction reproduces the pre-fusion shape exactly, no
 * caller-side analysis is needed -- unlike `leftFactorChoices`'s
 * `isShapeSensitiveRule` gate (which exists because THAT rewrite
 * genuinely changes value shape and has no reconstruction step).
 */

import {
  EMPTY_FIRST_SET,
  type FirstSet,
  type GrammarFirstSetAnalysis,
  firstSetOfExpression,
  firstSetsDisjoint,
  isNullable,
  unionFirstSets,
} from "./first-sets";
import type { CharacterClass, Expression, RuleDefinition } from "./types";

const STRUCTURALLY_DISQUALIFYING = new Set<Expression["type"]>([
  "Identifier",
  "QualifiedIdentifier",
  "ActionExpression",
  "LabeledExpression",
  "PositiveLookahead",
  "NegativeLookahead",
  "Cut",
]);

/** A leaf that `Star`/`Plus`/`Quantified` may wrap and still be fusable
 * -- see the module doc comment's "Shape reconstruction" section for why
 * this excludes compound expressions and multi-code-point literals. */
const isSimpleRepeatable = (expr: Expression): boolean => {
  if (expr.type === "CharacterClass" || expr.type === "AnyChar") return true;
  if (expr.type === "StringLiteral") {
    return [...expr.value].length === 1;
  }
  return false;
};

/** Structural half of fusability -- see the module doc comment's
 * condition 1. Independent of input/grammar state, so it's checked once
 * per rule regardless of how many times `isRuleFusable` might otherwise
 * re-derive it. */
const isStructurallyFusable = (expr: Expression): boolean => {
  if (STRUCTURALLY_DISQUALIFYING.has(expr.type)) return false;
  switch (expr.type) {
    case "Sequence":
      return expr.elements.every(isStructurallyFusable);
    case "Choice":
      return expr.alternatives.every(isStructurallyFusable);
    case "Group":
    case "Optional":
      return isStructurallyFusable(expr.expression);
    case "Star":
    case "Plus":
    case "Quantified":
      return (
        isSimpleRepeatable(expr.expression) &&
        isStructurallyFusable(expr.expression)
      );
    case "StringLiteral":
    case "CharacterClass":
    case "AnyChar":
      return true;
    default:
      return false;
  }
};

const isEmptyFirst = (fs: FirstSet): boolean =>
  !fs.unknown && fs.set.length === 0;

/**
 * Determinism half of fusability -- see the module doc comment's
 * condition 2. `tail` is the already-composed `FirstSet` of whatever
 * follows `expr` within the fused region (NOT outside it -- see the
 * module doc comment for why the top-level call always passes
 * `EMPTY_FIRST_SET`).
 */
const checkFusionSafe = (
  expr: Expression,
  tail: FirstSet,
  analysis: GrammarFirstSetAnalysis,
): boolean => {
  switch (expr.type) {
    case "StringLiteral":
    case "CharacterClass":
    case "AnyChar":
      return true;
    case "Group":
    case "Optional":
      return checkFusionSafe(expr.expression, tail, analysis);
    case "Sequence": {
      let follow = tail;
      for (let i = expr.elements.length - 1; i >= 0; i--) {
        const element = expr.elements[i] as Expression;
        if (!checkFusionSafe(element, follow, analysis)) return false;
        const elementFirst = firstSetOfExpression(
          element,
          analysis.firstSets,
          analysis.nullableRules,
        );
        follow = isNullable(element, analysis.nullableRules)
          ? unionFirstSets(elementFirst, follow)
          : elementFirst;
      }
      return true;
    }
    case "Choice": {
      const { alternatives } = expr;
      // Both checks below only matter when something follows the whole
      // Choice within the fused region: once ANY alternative succeeds
      // and nothing remains to satisfy, the match is immediately
      // complete for both a JS regex engine and PEG's ordered choice --
      // neither has a reason to reconsider, so neither pairwise overlap
      // nor a nullable alternative can cause a divergence. (Symmetric to
      // why a trailing repetition needs no disjointness check either.)
      // The discriminating case that DOES need these when `tail` is
      // non-empty: `Choice["ab", "a"]` followed by `"b"`, on input
      // "ab" -- PEG commits to "ab" (the first alternative that
      // matches), then fails to find "b" afterward, and never
      // reconsiders "a" (PEG's ordered choice doesn't backtrack once
      // matched). A naive `/(?:ab|a)b/` DOES backtrack the alternation
      // into "a", then succeeds on "b" -- a real divergence pairwise
      // FIRST-disjointness (which "ab" and "a" fail) correctly catches.
      if (!isEmptyFirst(tail)) {
        const firsts = alternatives.map((alt) =>
          firstSetOfExpression(alt, analysis.firstSets, analysis.nullableRules),
        );
        for (let i = 0; i < alternatives.length; i++) {
          for (let j = i + 1; j < alternatives.length; j++) {
            if (
              !firstSetsDisjoint(firsts[i] as FirstSet, firsts[j] as FirstSet)
            ) {
              return false;
            }
          }
        }
        for (const alt of alternatives) {
          if (isNullable(alt, analysis.nullableRules)) return false;
        }
      }
      return alternatives.every((alt) => checkFusionSafe(alt, tail, analysis));
    }
    case "Star":
    case "Plus":
    case "Quantified": {
      // No recursive `checkFusionSafe(inner, ...)` call here: `inner`
      // can only be a CharacterClass/AnyChar/1-code-point StringLiteral
      // (isStructurallyFusable's `isSimpleRepeatable` restriction, the
      // OTHER, independent gate `isRuleFusable` also runs) -- none of
      // which have any internal Choice/repetition of their own to check.
      // If that structural restriction is ever loosened to allow a
      // compound repeated element, this case must start recursing too.
      const inner = expr.expression;
      const isBounded =
        expr.type === "Quantified" &&
        expr.max !== undefined &&
        expr.max <= expr.min;
      if (!isBounded) {
        const innerFirst = firstSetOfExpression(
          inner,
          analysis.firstSets,
          analysis.nullableRules,
        );
        if (!firstSetsDisjoint(innerFirst, tail)) return false;
      }
      return true;
    }
    default:
      return false;
  }
};

/** Whether `rule`'s entire pattern can be compiled to a single fused
 * regex -- both conditions from the module doc comment. */
export const isRuleFusable = (
  rule: RuleDefinition,
  analysis: GrammarFirstSetAnalysis,
): boolean =>
  isStructurallyFusable(rule.pattern) &&
  checkFusionSafe(rule.pattern, EMPTY_FIRST_SET, analysis);

// ============================================================================
// Regex source + reconstruction-expression emission
// ============================================================================

/** Escapes `s` for literal inclusion in a `u`-flag regex pattern. Plain
 * (non-astral, non-metacharacter) text and astral characters both pass
 * through unescaped -- only the fixed set of regex metacharacters needs
 * a backslash. */
const escapeRegexLiteral = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `\u{...}` escape for one code point -- valid inside a `u`-flag
 * pattern (including inside a bracket expression's range endpoints),
 * and side-steps needing to individually escape whichever of
 * `] ^ - \` a raw range endpoint might happen to be. */
const codePointEscape = (cp: number): string => `\\u{${cp.toString(16)}}`;

/** Renders a `CharacterClass`'s ranges as a `[...]`/`[^...]` bracket
 * expression body (no enclosing capturing group). */
const charClassBracketExpr = (expr: CharacterClass): string => {
  const body = expr.ranges
    .map((r) => {
      const startCp = r.start.codePointAt(0) as number;
      if (r.end === undefined) return codePointEscape(startCp);
      const endCp = r.end.codePointAt(0) as number;
      return `${codePointEscape(startCp)}-${codePointEscape(endCp)}`;
    })
    .join("");
  return `[${expr.negated ? "^" : ""}${body}]`;
};

/** Regex source for a *simple repeatable* leaf (see `isSimpleRepeatable`)
 * with NO capturing group of its own -- used only as the immediate
 * inner pattern of `Star`/`Plus`/`Quantified`, whose own group captures
 * the whole run instead (see the module doc comment's "Shape
 * reconstruction" section). */
const simpleLeafSource = (expr: Expression): string => {
  switch (expr.type) {
    case "CharacterClass":
      return charClassBracketExpr(expr);
    case "AnyChar":
      return "[\\s\\S]";
    case "StringLiteral":
      return escapeRegexLiteral(expr.value);
    default:
      throw new Error(
        `simpleLeafSource: unexpected node type ${expr.type} (isSimpleRepeatable should have rejected this earlier)`,
      );
  }
};

/** A mutable, shared group-index allocator: capturing-group numbers are
 * assigned in the same left-to-right order their opening parens appear
 * in the emitted regex source, so a single counter incremented at each
 * allocation site (always BEFORE recursing into that group's own
 * contents) reproduces the regex engine's own numbering exactly. */
interface GroupCounter {
  next: number;
}

interface Emitted {
  /** Regex source for this node (no enclosing delimiters/flags). */
  readonly pattern: string;
  /** A JS expression (source text) that evaluates to this node's
   * reconstructed value, given a variable named `g` in scope holding
   * `FusedMatch.groups`. */
  readonly valueExpr: string;
}

const emit = (expr: Expression, counter: GroupCounter): Emitted => {
  switch (expr.type) {
    case "StringLiteral":
      return {
        pattern: escapeRegexLiteral(expr.value),
        valueExpr: JSON.stringify(expr.value),
      };
    case "CharacterClass": {
      const groupIndex = counter.next++;
      return {
        pattern: `(${charClassBracketExpr(expr)})`,
        valueExpr: `g[${groupIndex}]`,
      };
    }
    case "AnyChar": {
      const groupIndex = counter.next++;
      return { pattern: "([\\s\\S])", valueExpr: `g[${groupIndex}]` };
    }
    case "Group":
      return emit(expr.expression, counter);
    case "Sequence": {
      const parts = expr.elements.map((el) => emit(el, counter));
      return {
        pattern: parts.map((p) => p.pattern).join(""),
        valueExpr: `[${parts.map((p) => p.valueExpr).join(", ")}]`,
      };
    }
    case "Choice": {
      const markerIndices: number[] = [];
      const altPatterns: string[] = [];
      const altValueExprs: string[] = [];
      for (const alt of expr.alternatives) {
        const markerIndex = counter.next++;
        markerIndices.push(markerIndex);
        const { pattern, valueExpr } = emit(alt, counter);
        altPatterns.push(`(${pattern})`);
        altValueExprs.push(valueExpr);
      }
      // `reduceRight` without an initial value seeds the accumulator with
      // the LAST element untouched (never passed through the callback)
      // and folds right-to-left from there -- exactly the "no check
      // needed on the final fallback" shape this ternary chain wants,
      // since condition 2 already guarantees exactly one marker is
      // defined at runtime.
      const valueExpr = altValueExprs.reduceRight(
        (elseBranch, altExpr, i) =>
          `g[${markerIndices[i]}] !== undefined ? ${altExpr} : ${elseBranch}`,
      );
      return { pattern: `(?:${altPatterns.join("|")})`, valueExpr };
    }
    case "Optional": {
      const markerIndex = counter.next++;
      const inner = emit(expr.expression, counter);
      return {
        pattern: `(?:(${inner.pattern}))?`,
        valueExpr: `g[${markerIndex}] !== undefined ? [${inner.valueExpr}] : []`,
      };
    }
    case "Star":
    case "Plus":
    case "Quantified": {
      const groupIndex = counter.next++;
      const leafSource = simpleLeafSource(expr.expression);
      const quantifier =
        expr.type === "Star"
          ? "*"
          : expr.type === "Plus"
            ? "+"
            : expr.max === undefined
              ? `{${expr.min},}`
              : `{${expr.min},${expr.max}}`;
      return {
        pattern: `((?:${leafSource})${quantifier})`,
        valueExpr: `g[${groupIndex}] === undefined ? [] : Array.from(g[${groupIndex}])`,
      };
    }
    default:
      throw new Error(
        `emit: unexpected node type ${expr.type} (isStructurallyFusable should have rejected this earlier)`,
      );
  }
};

export interface FusedRule {
  /** Regex source for the whole rule (no enclosing delimiters/flags),
   * suitable for `regexFused(source, description)`. */
  readonly source: string;
  /** A JS expression (source text) reconstructing the rule's original
   * value shape from a `FusedMatch.groups` array named `g`. */
  readonly valueExpr: string;
}

/** Compiles `rule.pattern` (already confirmed fusable via `isRuleFusable`)
 * to a regex source string and a value-reconstruction expression. */
export const emitFusedRule = (rule: RuleDefinition): FusedRule => {
  const counter: GroupCounter = { next: 0 };
  const { pattern, valueExpr } = emit(rule.pattern, counter);
  return { source: pattern, valueExpr };
};
