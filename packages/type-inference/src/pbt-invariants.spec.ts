/**
 * Property-based (`fast-check`) invariants for `TypeInferenceEngine` -- this
 * package had NO fuzzing/property-based coverage before this file (unlike
 * `tpeg-core`/`tpeg-combinator`/`tpeg-parser`, which each got a
 * `pbt-*.spec.ts` -- see `packages/core/src/pbt-invariants.spec.ts`'s module
 * doc comment for the shared rationale). `type-inference.spec.ts` exercises
 * every `Expression` variant, but only via hand-picked fixed trees; this file
 * generalizes over randomly generated `Expression` trees (built from
 * `tpeg-core`'s own `create*` AST factories, the same ones
 * `type-inference.spec.ts` uses) to check structural invariants that must
 * hold for ANY tree, not just the fixtures that happened to get written.
 *
 * Every property here is read directly off `type-inference.ts`'s own doc
 * comments/switch cases (`inferStarType`, `inferOptionalType`,
 * `inferChoiceType`, `inferSequenceType`'s single-survivor branch,
 * `inferLookaheadType`, the `Cut` case in `inferExpressionType`) -- not
 * independently re-derived -- since there is no second, independent TPEG
 * type-inference implementation to differentially fuzz against.
 */

import { describe, expect, it } from "vite-plus/test";
import type { Expression } from "@suzumiyaaoba/tpeg-core";
import {
  createAnyChar,
  createCharRange,
  createCharacterClass,
  createChoice,
  createCut,
  createGrammarDefinition,
  createIdentifier,
  createNegativeLookahead,
  createOptional,
  createPlus,
  createPositiveLookahead,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import fc from "fast-check";
import { TypeInferenceEngine } from "./type-inference";

const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const FC_PARAMS = { seed: 20260908, numRuns: 200 * FUZZ_SCALE };

// A small alphabet of always-terminal, non-recursive leaf expressions --
// mirrors `LEAVES` in `packages/core/src/pbt-invariants.spec.ts` and
// `packages/combinator/src/pbt-invariants.spec.ts`, adapted to the grammar
// AST node shapes this package's engine consumes (rather than runnable
// `Parser<T>`s).
const LEAVES: readonly Expression[] = [
  createStringLiteral("a", '"'),
  createStringLiteral("hello", '"'),
  createCharacterClass([createCharRange("a", "z")]),
  createCharacterClass([createCharRange("0", "9")], true),
  createAnyChar(),
];
const leafArb = fc.constantFrom(...LEAVES);

// A richer, recursively generated tree -- every non-leaf variant that takes
// a single inner `Expression` or a list of them, EXCLUDING `Identifier`
// (rule references need a resolvable grammar context; covered separately by
// `circularGrammarArb` below) and `LabeledExpression`/`ActionExpression`
// (covered by `type-inference.spec.ts`'s fixed cases -- their result types
// are either a fixed wrapper or intentionally `unknown`, nothing structural
// left to generalize).
const { tree } = fc.letrec<{ tree: Expression; leaf: Expression }>((tie) => ({
  leaf: leafArb,
  tree: fc.oneof(
    { maxDepth: 3, depthIdentifier: "tpeg-type-inference-pbt-tree" },
    tie("leaf"),
    fc
      .array(tie("tree"), { minLength: 1, maxLength: 3 })
      .map((elements) => createSequence(elements)),
    fc
      .array(tie("tree"), { minLength: 2, maxLength: 3 })
      .map((alternatives) => createChoice(alternatives)),
    tie("tree").map((t) => createStar(t)),
    tie("tree").map((t) => createPlus(t)),
    tie("tree").map((t) => createOptional(t)),
    tie("tree").map((t) => createPositiveLookahead(t)),
    tie("tree").map((t) => createNegativeLookahead(t)),
  ),
}));

describe("TypeInferenceEngine invariants (fast-check), generalized from type-inference.spec.ts's fixed cases", () => {
  it("inferExpressionType is deterministic: two fresh engines infer the identical typeString/baseType/isArray/nullable for the same tree", () => {
    fc.assert(
      fc.property(tree, (expr) => {
        const a = new TypeInferenceEngine().inferExpressionType(expr);
        const b = new TypeInferenceEngine().inferExpressionType(expr);
        expect(a.typeString).toBe(b.typeString);
        expect(a.baseType).toBe(b.baseType);
        expect(a.isArray).toBe(b.isArray);
        expect(a.nullable).toBe(b.nullable);
      }),
      FC_PARAMS,
    );
  });

  it("the typeCache is transparent: enableCaching true vs. false infer the identical typeString/baseType/isArray for the same tree", () => {
    fc.assert(
      fc.property(tree, (expr) => {
        const cached = new TypeInferenceEngine({
          enableCaching: true,
        }).inferExpressionType(expr);
        const uncached = new TypeInferenceEngine({
          enableCaching: false,
        }).inferExpressionType(expr);
        expect(cached.typeString).toBe(uncached.typeString);
        expect(cached.baseType).toBe(uncached.baseType);
        expect(cached.isArray).toBe(uncached.isArray);
      }),
      FC_PARAMS,
    );
  });

  it("Star/Plus always infer as an array type whose typeString is the inner type's array form (inferArrayTypes: true, the default)", () => {
    fc.assert(
      fc.property(tree, (inner) => {
        const engine = new TypeInferenceEngine();
        const innerType = engine.inferExpressionType(inner);
        const needsParens = innerType.typeString.includes(" | ");
        const elementType = needsParens
          ? `(${innerType.typeString})`
          : innerType.typeString;

        const star = engine.inferExpressionType(createStar(inner));
        const plus = engine.inferExpressionType(createPlus(inner));

        for (const result of [star, plus]) {
          expect(result.isArray).toBe(true);
          expect(result.typeString).toBe(`${elementType}[]`);
          expect(result.baseType).toBe(innerType.baseType);
        }
      }),
      FC_PARAMS,
    );
  });

  it("Optional always infers as `[<inner>] | []` (never a bare T or `T | undefined`), matching optional()'s runtime [T] | [] shape", () => {
    fc.assert(
      fc.property(tree, (inner) => {
        const engine = new TypeInferenceEngine();
        const innerType = engine.inferExpressionType(inner);
        const result = engine.inferExpressionType(createOptional(inner));

        expect(result.typeString).toBe(`[${innerType.typeString}] | []`);
        expect(result.isArray).toBe(true);
        expect(result.baseType).toBe("tuple");
        expect(result.nullable).toBe(false);
      }),
      FC_PARAMS,
    );
  });

  it("PositiveLookahead/NegativeLookahead/Cut always infer as void and contribute no imports, regardless of the wrapped expression", () => {
    fc.assert(
      fc.property(tree, (inner) => {
        const engine = new TypeInferenceEngine();
        const results = [
          engine.inferExpressionType(createPositiveLookahead(inner)),
          engine.inferExpressionType(createNegativeLookahead(inner)),
          engine.inferExpressionType(createCut()),
        ];
        for (const result of results) {
          expect(result.typeString).toBe("void");
          expect(result.baseType).toBe("void");
          expect(result.isArray).toBe(false);
          expect(result.imports).toEqual([]);
        }
      }),
      FC_PARAMS,
    );
  });

  it("a Sequence of exactly one element (optionally padded with any number of Cuts) infers identically to that element alone", () => {
    fc.assert(
      fc.property(
        tree,
        fc.nat({ max: 3 }),
        fc.nat({ max: 3 }),
        (only, leadingCuts, trailingCuts) => {
          const engine = new TypeInferenceEngine();
          const alone = engine.inferExpressionType(only);

          const padded = createSequence([
            ...Array.from({ length: leadingCuts }, () => createCut()),
            only,
            ...Array.from({ length: trailingCuts }, () => createCut()),
          ]);
          const result = engine.inferExpressionType(padded);

          expect(result.typeString).toBe(alone.typeString);
          expect(result.baseType).toBe(alone.baseType);
          expect(result.isArray).toBe(alone.isArray);
        },
      ),
      FC_PARAMS,
    );
  });

  it("a Choice's unionMembers has exactly one entry per alternative, in order, each matching that alternative's own inferred type", () => {
    fc.assert(
      fc.property(
        fc.array(tree, { minLength: 2, maxLength: 4 }),
        (alternatives) => {
          const engine = new TypeInferenceEngine();
          const result = engine.inferExpressionType(createChoice(alternatives));

          expect(result.baseType).toBe("union");
          expect(result.unionMembers).toBeDefined();
          const members = result.unionMembers ?? [];
          expect(members.length).toBe(alternatives.length);
          members.forEach((member, i) => {
            const alt = alternatives[i];
            if (!alt) throw new Error("unreachable");
            const expected = new TypeInferenceEngine().inferExpressionType(alt);
            expect(member.typeString).toBe(expected.typeString);
            expect(member.baseType).toBe(expected.baseType);
          });
        },
      ),
      FC_PARAMS,
    );
  });

  it("inferGrammarTypes never throws for a self- or mutually-recursive rule reference chain, and always records it as a circular dependency", () => {
    // Rule names, each an Identifier referencing the NEXT name in the
    // cycle (wrapping around) -- length 1 is direct self-recursion
    // (`a = a`), length >= 2 is mutual recursion (`a = b`, `b = a`, ...).
    const cycleArb = fc.uniqueArray(fc.constantFrom("a", "b", "c", "d"), {
      minLength: 1,
      maxLength: 4,
    });

    fc.assert(
      fc.property(cycleArb, (names) => {
        const rules = names.map((name, i) =>
          createRuleDefinition(
            name,
            createIdentifier(names[(i + 1) % names.length] as string),
          ),
        );
        const grammar = createGrammarDefinition("G", [], rules);

        const engine = new TypeInferenceEngine();
        const result = engine.inferGrammarTypes(grammar);

        expect(result.circularDependencies.length).toBeGreaterThan(0);
        for (const name of names) {
          expect(result.ruleTypes.get(name)?.typeString).toBe("unknown");
        }
      }),
      FC_PARAMS,
    );
  });
});
