/**
 * Property-based (`fast-check`) soundness check for `first-sets.ts`'s
 * FIRST-set analysis -- see `packages/core/src/pbt-invariants.spec.ts`'s
 * module doc comment for the shared rationale with this repo's other
 * `pbt-*.spec.ts` files.
 *
 * `first-sets.ts`'s `analyzeFirstSets` has no property-level check of its
 * own soundness anywhere in this codebase: `combinator-oracle.spec.ts`
 * (`packages/core`) re-derives FIRST sets from scratch rather than
 * depending on this module (a different package, over a different AST --
 * see that file's module doc comment), and `codegen-differential.spec.ts`
 * only ever exercises this module indirectly, through whatever
 * `predictiveChoice` dispatch table `codegen-optimized.ts` happens to build
 * from it. This file tests `analyzeFirstSets` itself, directly, against a
 * genuine oracle: the independent `reference-interpreter.ts`.
 *
 * The property: for a non-nullable expression `e`, if a character is
 * outside `FIRST(e)`, `e` can never match starting with that character.
 * This is the exact soundness condition `codegen-optimized.ts`'s
 * `tryGeneratePredictiveChoice` relies on to skip an alternative solely by
 * inspecting its first input character -- an unsound FIRST-set here would
 * make dispatch skip an alternative it should have tried, silently
 * changing which one wins. Deliberately ONE-DIRECTIONAL: a character
 * INSIDE `FIRST(e)` is not asserted to make `e` succeed (FIRST sets are a
 * sound over-approximation, not exact -- see `first-sets.ts`'s own module
 * doc comment), and nullable expressions are skipped entirely (a nullable
 * `e` can succeed on zero characters regardless of what starts the
 * remaining input -- FIRST-set pruning legitimately does not apply to it,
 * which is why every real caller of this module checks `isNullable`
 * separately before treating a FIRST set as a valid filter).
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { Expression, GrammarDefinition } from "@suzumiyaaoba/tpeg-core";
import { resetFailureWatermark } from "@suzumiyaaoba/tpeg-core";
import fc from "fast-check";
import { contains } from "./char-set";
import { analyzeFirstSets, isNullable } from "./first-sets";
import {
  ReferenceInterpreterLimitError,
  referenceRecognize,
} from "./reference-interpreter";

beforeEach(() => {
  resetFailureWatermark();
});

const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const FC_PARAMS = { seed: 20260818, numRuns: 200 * FUZZ_SCALE };

const EMOJI = String.fromCodePoint(0x1f600);

const strLit = (value: string): Expression => ({
  type: "StringLiteral",
  value,
  quote: '"',
});
const charCls = (
  ranges: readonly { start: string; end?: string }[],
  negated: boolean,
): Expression => ({ type: "CharacterClass", ranges: [...ranges], negated });

// Guaranteed non-nullable -- always consumes >= 1 code point on success.
// `Identifier`/`QualifiedIdentifier` (rule references) are deliberately
// excluded from every leaf/composite below: each property builds a
// single-rule grammar, so there is nothing for a reference to resolve to.
const LEAVES: readonly Expression[] = [
  strLit("a"),
  strLit("b"),
  strLit("ab"),
  strLit(EMOJI),
  charCls([{ start: "a", end: "c" }], false),
  charCls([{ start: "a" }], true),
  { type: "AnyChar" },
];
const leafArb = fc.constantFrom(...LEAVES);

/** Random `Expression` trees over every node kind `firstSetOfExpression`/
 * `isNullable` special-case, deep enough to nest `Sequence`/`Choice`/
 * lookaheads/a `Cut` together, shallow enough (`maxDepth: 3`) to stay fast.
 * `Star`/`Plus` only ever wrap a bare LEAF -- see
 * `packages/core/src/pbt-invariants.spec.ts`'s identical rationale:
 * wrapping a nullable expression would trip `reference-interpreter.ts`'s
 * own zero-width-repetition guard, which the property below skips rather
 * than treats as a finding, but avoiding it by construction keeps the
 * assertion dense instead of mostly skips. */
const { tree } = fc.letrec<{ tree: Expression; leaf: Expression }>((tie) => ({
  leaf: leafArb,
  tree: fc.oneof(
    { maxDepth: 3, depthIdentifier: "tpeg-parser-first-sets-pbt" },
    tie("leaf"),
    fc
      .tuple(tie("tree"), tie("tree"))
      .map(([a, b]): Expression => ({ type: "Sequence", elements: [a, b] })),
    fc.tuple(tie("tree"), tie("tree")).map(
      ([a, b]): Expression => ({
        type: "Choice",
        alternatives: [a, b],
      }),
    ),
    tie("leaf").map((e): Expression => ({ type: "Star", expression: e })),
    tie("leaf").map((e): Expression => ({ type: "Plus", expression: e })),
    tie("tree").map((e): Expression => ({ type: "Optional", expression: e })),
    tie("tree").map((e): Expression => ({ type: "Group", expression: e })),
    tie("tree").map(
      (e): Expression => ({ type: "PositiveLookahead", expression: e }),
    ),
    tie("tree").map(
      (e): Expression => ({ type: "NegativeLookahead", expression: e }),
    ),
    tie("tree").map(
      (e): Expression => ({
        type: "LabeledExpression",
        label: "x",
        expression: e,
      }),
    ),
    // A leading non-nullable leaf, then a `Cut`, then a further tree --
    // exercises fatal-failure propagation alongside the FIRST-set
    // analysis (a `Cut` itself is always nullable and contributes no
    // characters of its own, see `first-sets.ts`).
    fc
      .tuple(tie("leaf"), tie("tree"))
      .map(
        ([lead, rest]): Expression => ({
          type: "Sequence",
          elements: [lead, { type: "Cut" }, rest],
        }),
      ),
  ),
}));

const ALPHABET = ["a", "b", "c", "x", "y", "z", EMOJI];
const inputArb = fc.string({
  unit: fc.constantFrom(...ALPHABET),
  maxLength: 6,
});

const grammarFor = (pattern: Expression): GrammarDefinition => ({
  type: "GrammarDefinition",
  name: "pbt",
  annotations: [],
  rules: [{ type: "RuleDefinition", name: "start", pattern }],
});

describe("PEG invariants (fast-check): first-sets.ts's FIRST-set analysis is sound", () => {
  it("a character outside FIRST(e) can never start a match of e, for any non-nullable e", () => {
    fc.assert(
      fc.property(tree, inputArb, (pattern, input) => {
        const grammar = grammarFor(pattern);
        const analysis = analyzeFirstSets(grammar);

        if (isNullable(pattern, analysis.nullableRules)) return;
        const first = analysis.firstSets.get("start");
        if (!first || first.unknown) return;

        let result: string;
        try {
          result = referenceRecognize(grammar)(input);
        } catch (error) {
          if (error instanceof ReferenceInterpreterLimitError) return;
          throw error;
        }

        if (input.length === 0) {
          // A non-nullable expression can never match zero characters,
          // regardless of FIRST-set contents.
          expect(result.startsWith("S:")).toBe(false);
          return;
        }
        const cp = input.codePointAt(0) as number;
        if (!contains(first.set, cp)) {
          expect(result.startsWith("S:")).toBe(false);
        }
      }),
      FC_PARAMS,
    );
  });
});

// --- Multi-rule / mutually-recursive coverage -----------------------------
//
// The property above builds a single-rule grammar on purpose (see LEAVES's
// comment), which means it never exercises `computeFirstSets`'s actual
// reason for existing: the iterative dataflow FIXPOINT over `Identifier`
// references that can point at *other* rules, including cycles. That is
// exactly the territory of the `3fe6224` fixpoint-oscillation bug (two
// rules' FIRST sets flipping back and forth instead of converging because
// of the de-duplication/overwrite ordering `analyzeFirstSets` now guards
// against -- see its own doc comment). A single-rule grammar can never
// reach that code path: `uniqueRules` degenerates to one entry, and no
// `Identifier` node has anything else to resolve to. This section builds
// small (three-rule) grammars, some of them self- or mutually-recursive via
// `Identifier`, and re-checks the same soundness property against
// `analyzeFirstSets`' fixpoint output.
const RULE_NAMES = ["start", "aux1", "aux2"] as const;
const identifierArb: fc.Arbitrary<Expression> = fc
  .constantFrom(...RULE_NAMES)
  .map((name) => ({ type: "Identifier", name }) as Expression);

/** Same shape as `tree` above, plus `Identifier` references into
 * `RULE_NAMES` -- deliberately added at the `tree` level, not `leaf`, for
 * the same reason `tree` itself is never used under `Star`/`Plus` there: an
 * `Identifier` may resolve to a nullable (or directly/indirectly
 * left-recursive) rule, which `Star`/`Plus` wrapping only a non-nullable
 * `leaf` is written to avoid entirely. */
const { tree: multiTree } = fc.letrec<{ tree: Expression; leaf: Expression }>(
  (tie) => ({
    leaf: leafArb,
    tree: fc.oneof(
      { maxDepth: 3, depthIdentifier: "tpeg-parser-first-sets-pbt-multi" },
      tie("leaf"),
      identifierArb,
      fc
        .tuple(tie("tree"), tie("tree"))
        .map(([a, b]): Expression => ({ type: "Sequence", elements: [a, b] })),
      fc.tuple(tie("tree"), tie("tree")).map(
        ([a, b]): Expression => ({
          type: "Choice",
          alternatives: [a, b],
        }),
      ),
      tie("leaf").map((e): Expression => ({ type: "Star", expression: e })),
      tie("leaf").map((e): Expression => ({ type: "Plus", expression: e })),
      tie("tree").map((e): Expression => ({ type: "Optional", expression: e })),
      tie("tree").map((e): Expression => ({ type: "Group", expression: e })),
      tie("tree").map(
        (e): Expression => ({ type: "PositiveLookahead", expression: e }),
      ),
      tie("tree").map(
        (e): Expression => ({ type: "NegativeLookahead", expression: e }),
      ),
      tie("tree").map(
        (e): Expression => ({
          type: "LabeledExpression",
          label: "x",
          expression: e,
        }),
      ),
      fc.tuple(tie("leaf"), tie("tree")).map(
        ([lead, rest]): Expression => ({
          type: "Sequence",
          elements: [lead, { type: "Cut" }, rest],
        }),
      ),
    ),
  }),
);

const multiGrammarFor = ([start, aux1, aux2]: readonly [
  Expression,
  Expression,
  Expression,
]): GrammarDefinition => ({
  type: "GrammarDefinition",
  name: "pbt-multi",
  annotations: [],
  rules: [
    { type: "RuleDefinition", name: "start", pattern: start },
    { type: "RuleDefinition", name: "aux1", pattern: aux1 },
    { type: "RuleDefinition", name: "aux2", pattern: aux2 },
  ],
});

describe("PEG invariants (fast-check): first-sets.ts's fixpoint is sound across multi-rule / mutually-recursive grammars", () => {
  it("a character outside FIRST(start) can never start a match of start, even when start's FIRST set is derived through Identifier references to other rules (self- and mutually-recursive included)", () => {
    fc.assert(
      fc.property(
        fc.tuple(multiTree, multiTree, multiTree),
        inputArb,
        (patterns, input) => {
          const grammar = multiGrammarFor(patterns);
          const analysis = analyzeFirstSets(grammar);

          const startPattern = patterns[0];
          if (isNullable(startPattern, analysis.nullableRules)) return;
          const first = analysis.firstSets.get("start");
          if (!first || first.unknown) return;

          let result: string;
          try {
            result = referenceRecognize(grammar)(input);
          } catch (error) {
            // Depth-guard trip -- almost always a left-recursive cycle
            // through the `Identifier` references above (this interpreter,
            // like the real runtime, has no left-recursion support). Out
            // of scope for a FIRST-set soundness property.
            if (error instanceof ReferenceInterpreterLimitError) return;
            throw error;
          }

          if (input.length === 0) {
            expect(result.startsWith("S:")).toBe(false);
            return;
          }
          const cp = input.codePointAt(0) as number;
          if (!contains(first.set, cp)) {
            expect(result.startsWith("S:")).toBe(false);
          }
        },
      ),
      FC_PARAMS,
    );
  });
});
