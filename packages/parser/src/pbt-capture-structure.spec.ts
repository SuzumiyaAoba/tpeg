/**
 * Property-based (`fast-check`) structural invariants for capture SHAPE --
 * see `packages/core/src/pbt-invariants.spec.ts`'s module doc comment for
 * the shared rationale with this repo's other `pbt-*.spec.ts` files.
 *
 * ## Why this exists alongside `capture-structure-table.spec.ts`
 *
 * Both `reference-interpreter.ts` and `reference-eval.ts` are deliberately
 * recognition-only (`{ok,next} | {ok:false,fatal}`, no value at all -- see
 * their own module doc comments): value shape has no independent oracle
 * anywhere in this codebase, and duplicating `codegen.ts`'s own value
 * construction to build one was explicitly rejected as "a second copy of
 * that logic to keep in sync, for no additional coverage"
 * (`reference-interpreter.ts`'s doc comment). `capture-structure-table.spec.ts`
 * closes part of that gap by compiling and running 23 HAND-WRITTEN rows from
 * docs/peg-grammar.md's Capture Structure Reference Table -- real evidence,
 * but a fixed, small, human-picked sample. The two most recent real bugs in
 * this exact area (`ce7351c`'s sequence-collapse 1-tuple, `44e8878`'s
 * optional/sequence type-inference mismatch) were both found by hand, not by
 * any harness -- exactly the kind of thing a fixed hand-written sample can
 * miss by construction (nobody happened to write the row that exposed it).
 *
 * This file takes a different, complementary approach: rather than an
 * independent oracle for the exact VALUE (which would just be a second
 * codegen), it fuzzes a STRUCTURAL property that must hold regardless of
 * which specific value came out -- generating random compositions and
 * checking the shape rule directly, at scale, instead of the 23 fixed
 * examples table.spec.ts checks by hand.
 *
 * ## The property under test
 *
 * `capture.ts`'s `CAPTURE_TAG` mechanism (see that module's own doc
 * comment) exists so that `captureSequence`/`captureChoice` can tell a
 * genuine same-level `capture(...)` apart from an untagged value that
 * merely happens to be object-shaped -- e.g. an UNLABELED reference to
 * another rule that uses labels internally. Only a tagged entry is merged
 * in; everything else (a plain literal's string, an untagged object from an
 * unlabeled sub-rule reference, ...) contributes NOTHING to the merged
 * result -- not even nested. This gives an exact, checkable rule for what a
 * `captureSequence`/`captureChoice`-shaped rule's result object contains:
 *
 *   The key set of the result equals EXACTLY the set of label names
 *   attached (as a direct `LabeledExpression`) to the WINNING alternative's
 *   own TOP-LEVEL elements -- never a label from a losing `Choice`
 *   alternative (see the existing `a:"x" / b:"y"` row in
 *   `capture-structure-table.spec.ts`, generalized here across randomly
 *   generated alternative shapes and depths), and never a field name
 *   leaked in from an unlabeled reference to a rule that happens to use
 *   labels internally (the concrete failure mode `CAPTURE_TAG` was added to
 *   prevent, `capture.ts:24-41`, verified there only by hand-written
 *   examples until now).
 *
 * When NO top-level element carries a label, codegen emits plain
 * `sequence()` instead of `captureSequence()` (`collectTopLevelLabels`
 * returning empty, `codegen.ts`), which does not merge or drop anything --
 * every element's own value (whatever it is, including an unflattened
 * nested object from an unlabeled sub-rule reference) appears positionally
 * in the resulting array. This file checks both shapes.
 *
 * ## Design: witnesses computed alongside the AST, not random text matching
 *
 * Each fragment constructor below returns both the `.tpeg` SOURCE TEXT for
 * that fragment and an exact INPUT STRING guaranteed to make it match (its
 * "witness"), plus enough structure to compute the EXPECTED captured value
 * independently of `codegen.ts`. A `Choice`'s first alternative is always
 * the witness/winner (ordered choice always prefers an earlier alternative
 * that matches, and the witness is constructed to make it match), so which
 * alternative wins is never ambiguous -- no free-form random-text fuzzing
 * that would mostly generate non-matching inputs is needed.
 */

import { describe, expect, test } from "bun:test";
import type { Parser } from "@suzumiyaaoba/tpeg-core";
import fc from "fast-check";
import { generateTypeScriptParser } from "./codegen";
import { grammarDefinition } from "./grammar";

const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const FC_PARAMS = { seed: 20260819, numRuns: 200 * FUZZ_SCALE };

/** Mirrors `capture-structure-table.spec.ts`'s `compileStart`. */
const compileStart = (
  code: string,
  core: Record<string, unknown>,
  combinator: Record<string, unknown>,
): Parser<unknown> => {
  const body = code.replace(/^export const (\w+)/gm, "const $1");
  const scope = { ...combinator, ...core };
  const factory = new Function(
    ...Object.keys(scope),
    `${body}\nreturn { start };`,
  );
  return (factory(...Object.values(scope)) as { start: Parser<unknown> }).start;
};

/** `helper`'s own fixed shape: a `captureSequence`-driving rule with two
 * labels, always matched by the fixed witness "pq". Every generated
 * grammar below includes this exact rule and may reference it -- an
 * UNLABELED reference must never leak `hx`/`hy` into an enclosing
 * `captureSequence`'s merged result (the concrete `CAPTURE_TAG` scenario
 * this file targets); this file also checks the reference's own value is
 * `{ hx: "p", hy: "q" }` UNCHANGED (not flattened, not dropped) wherever it
 * legitimately appears (unlabeled inside a plain `sequence()`, or itself
 * given a label). */
const HELPER_RULE_TEXT = 'helper = hx:"p" hy:"q"';
const HELPER_WITNESS = "pq";
const HELPER_VALUE = { hx: "p", hy: "q" };

/** One element of a generated Sequence's top level: either a plain literal,
 * an unlabeled reference to `helper`, or either of those wrapped in a
 * label. `labelName === null` means this element contributes NOTHING to an
 * enclosing `captureSequence`'s merged result (see the module doc comment)
 * -- regardless of whether `ownValue` happens to be object-shaped. */
interface Elem {
  readonly text: string;
  readonly witness: string;
  readonly labelName: string | null;
  /** This element's own value in isolation (what it would be if it were
   * the ENTIRE rule body on its own) -- used to compute both the
   * plain-`sequence()` (positional) and `captureSequence()` (merged)
   * expected results. */
  readonly ownValue: unknown;
}

// Distinct from "p"/"q" (helper's own literals) purely for readability of
// a failing witness/counterexample -- not load-bearing for correctness,
// since PEG literal matching never cares about cross-rule character reuse.
const LIT_CHARS = ["m", "n", "o"] as const;

const plainLitArb: fc.Arbitrary<Elem> = fc
  .constantFrom(...LIT_CHARS)
  .map((c) => ({
    text: `"${c}"`,
    witness: c,
    labelName: null,
    ownValue: c,
  }));

const helperRefArb: fc.Arbitrary<Elem> = fc.constant({
  text: "helper",
  witness: HELPER_WITNESS,
  labelName: null,
  ownValue: HELPER_VALUE,
});

const LABEL_NAMES = ["a", "b", "c"] as const;

/** Wraps a base element (literal or helper-reference) in a label, drawing
 * the label name independently so the same base element can appear both
 * labeled and unlabeled across the generated corpus. */
const labeledArb = (base: fc.Arbitrary<Elem>): fc.Arbitrary<Elem> =>
  fc.tuple(fc.constantFrom(...LABEL_NAMES), base).map(([name, elem]) => ({
    text: `${name}:${elem.text}`,
    witness: elem.witness,
    labelName: name,
    ownValue: elem.ownValue,
  }));

const elemArb: fc.Arbitrary<Elem> = fc.oneof(
  plainLitArb,
  helperRefArb,
  labeledArb(plainLitArb),
  labeledArb(helperRefArb),
);

interface SeqFragment {
  readonly text: string;
  readonly witness: string;
  /** The label set this sequence would contribute if referenced
   * unlabeled from an outer `captureSequence` -- always empty, mirroring
   * `helper`'s own reference behavior (a sequence never inherits labels
   * from inside a referenced rule; only THIS module's synthetic
   * grammars reference `helper`, so this field only documents that a
   * `SeqFragment` used as a `Choice` alternative carries no label of its
   * own at the `Choice`'s level -- labels attach to `Elem`s, not to
   * whole alternatives, matching real `.tpeg` syntax where `a:(...)`
   * labels a GROUP, not a bare `Choice` alternative). */
  readonly labelNames: readonly string[];
  readonly expectedValue: unknown;
}

/** Builds one `Sequence`'s worth of top-level elements into its own
 * fragment: source text, witness input, and the value `codegen.ts` must
 * produce for it -- `captureSequence`'s merge-only-tagged-entries rule if
 * any element is labeled, otherwise `sequence()`'s plain positional tuple
 * (see the module doc comment for exactly why those are the two cases). */
const buildSeqFragment = (elems: readonly Elem[]): SeqFragment => {
  const text = elems.map((e) => e.text).join(" ");
  const witness = elems.map((e) => e.witness).join("");
  const labelNames = elems
    .map((e) => e.labelName)
    .filter((n): n is string => n !== null);

  const expectedValue =
    labelNames.length > 0
      ? Object.fromEntries(
          elems
            .filter((e) => e.labelName !== null)
            .map((e) => [e.labelName as string, e.ownValue]),
        )
      : elems.length === 1
        ? // codegen.ts's generateSequence returns a single unlabeled
          // survivor bare, not wrapped in a 1-tuple -- see
          // capture-structure-table.spec.ts's `"literal"`/`[a-z]` rows
          // for the same rule pinned by hand.
          (elems[0] as Elem).ownValue
        : elems.map((e) => e.ownValue);

  return { text, witness, labelNames, expectedValue };
};

// 1 to 3 elements per alternative -- deep enough to mix a labeled and an
// unlabeled `helper` reference in the same sequence (the scenario that
// actually exercises CAPTURE_TAG), shallow enough to keep witnesses short
// and failures easy to read.
//
// Filtered to reject a draw with two elements sharing the same label
// name: real `.tpeg` grammars CAN write `c:helper c:"m"`, but what that
// should even mean (last-label-wins? a validation error?) is an entirely
// separate question from the one this file tests -- CAPTURE_TAG leakage
// -- and duplicate-key `expect(...).toEqual(...)` assertions built from
// `labelNames` (which is not itself deduplicated) would misreport a
// generator artifact as a `capture.ts` bug. Rejection rate stays low with
// only 3 label names across at most 3 elements.
const hasDuplicateLabel = (elems: readonly Elem[]): boolean => {
  const seen = new Set<string>();
  for (const e of elems) {
    if (e.labelName === null) continue;
    if (seen.has(e.labelName)) return true;
    seen.add(e.labelName);
  }
  return false;
};

const seqFragmentArb: fc.Arbitrary<SeqFragment> = fc
  .array(elemArb, { minLength: 1, maxLength: 3 })
  .filter((elems) => !hasDuplicateLabel(elems))
  .map(buildSeqFragment);

describe("PEG invariants (fast-check): captureSequence/captureChoice result shape matches only the WINNING top-level labels, never a leaked or lost field", () => {
  test("captureSequence/sequence: a rule's result contains exactly its own top-level labels' values -- an unlabeled helper reference is never flattened, never dropped from a plain sequence, and never leaks into a captureSequence merge", async () => {
    // Imported once, outside the property (mirrors
    // `codegen-differential.spec.ts`'s single-`await import` pattern) --
    // `fc.property` below stays synchronous, matching every other
    // `pbt-*.spec.ts` file in this codebase (none uses
    // `fc.asyncProperty`).
    const core = (await import("@suzumiyaaoba/tpeg-core")) as unknown as Record<
      string,
      unknown
    >;
    const combinator = (await import(
      "@suzumiyaaoba/tpeg-combinator"
    )) as unknown as Record<string, unknown>;

    fc.assert(
      fc.property(seqFragmentArb, (frag) => {
        const source = `grammar G {\n  start = ${frag.text}\n  ${HELPER_RULE_TEXT}\n}`;
        const parsed = grammarDefinition(source, 0);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;

        const code = generateTypeScriptParser(parsed.val, {
          includeImports: false,
          includeTypes: false,
        }).code;
        const start = compileStart(code, core, combinator);
        const result = start(frag.witness, 0);

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.val).toEqual(frag.expectedValue);

        if (frag.labelNames.length > 0) {
          // Explicit, redundant-with-the-deep-equal-above assertion of
          // the property by name: the exact key SET, independent of
          // values -- this is what would catch a leak that happened to
          // overwrite rather than merely add a key (e.g. `helper`'s own
          // `hx` colliding with a real label named `hx`, which the plain
          // `toEqual` above could in principle miss if the values
          // happened to coincide).
          expect(Object.keys(result.val as object).sort()).toEqual(
            [...frag.labelNames].sort(),
          );
        }
      }),
      FC_PARAMS,
    );
  });

  test("captureChoice: only the WINNING alternative's own top-level labels appear -- a losing sibling's labels never leak in", async () => {
    const core = (await import("@suzumiyaaoba/tpeg-core")) as unknown as Record<
      string,
      unknown
    >;
    const combinator = (await import(
      "@suzumiyaaoba/tpeg-combinator"
    )) as unknown as Record<string, unknown>;

    fc.assert(
      fc.property(seqFragmentArb, seqFragmentArb, (winner, loser) => {
        // Ordered choice always prefers the first alternative that
        // matches; `winner` is placed first and fed its own witness, so
        // it always wins regardless of what `loser` looks like.
        const source = `grammar G {\n  start = (${winner.text}) / (${loser.text})\n  ${HELPER_RULE_TEXT}\n}`;
        const parsed = grammarDefinition(source, 0);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;

        const code = generateTypeScriptParser(parsed.val, {
          includeImports: false,
          includeTypes: false,
        }).code;
        const start = compileStart(code, core, combinator);
        const result = start(winner.witness, 0);

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.val).toEqual(winner.expectedValue);

        if (winner.labelNames.length > 0) {
          expect(Object.keys(result.val as object).sort()).toEqual(
            [...winner.labelNames].sort(),
          );
        }
        // The losing alternative's OWN label names must not appear
        // among the result's keys unless `winner` also happens to use
        // the same name (in which case it's `winner`'s own value that
        // must be present, already checked by `toEqual` above).
        for (const loserLabel of loser.labelNames) {
          if (!winner.labelNames.includes(loserLabel)) {
            expect(
              Object.prototype.hasOwnProperty.call(
                result.val as object,
                loserLabel,
              ),
            ).toBe(false);
          }
        }
      }),
      FC_PARAMS,
    );
  });
});
