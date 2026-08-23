/**
 * Shared random-grammar/random-input generation for differential fuzzing,
 * extracted from `codegen-differential.spec.ts` so a second differential
 * harness -- `@suzumiyaaoba/tpeg-generator`'s `eta-differential.spec.ts` --
 * can drive the exact same (grammar, input) space against a different
 * generator without either module drifting out of sync with the other's
 * copy. `tpeg-parser` cannot import from `tpeg-generator` (that would be
 * the dependency cycle the other direction, `tpeg-generator -> tpeg-parser`,
 * already relies on not existing), so this lives on the `tpeg-parser` side
 * and `tpeg-generator`'s test imports it as a `devDependency`-only,
 * test-only consumer.
 *
 * See `codegen-differential.spec.ts`'s own module doc comment for why this
 * kind of fuzzing exists at all (a large, deterministic sample of random
 * grammars compared against a base/oracle implementation) -- this module
 * only extracts the generator/harness PLUMBING, not that file's own
 * codegen-variant list or test assertions.
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { isFatalFailure } from "@suzumiyaaoba/tpeg-core";

// --- Deterministic PRNG (linear congruential generator) -----------------

export const makeRng = (seed: number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
};

export const pick = <T>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)] as T;

// --- Random grammar generation --------------------------------------------

export const LEAVES = [
  '"a"',
  '"b"',
  '"ab"',
  '"ba"',
  '"aa"',
  // 3+-character literals with a shared prefix -- exercises the
  // dispatch trie's beyond-FIRST_1 discrimination
  // (`packages/core/src/dispatch-trie.ts`), never reached by a purely
  // 1-2-character LEAVES set.
  '"abc"',
  '"abd"',
  "[a-b]",
  "[ab]",
  "[^a]",
  // Multi-range and negated multi-range classes -- distinct from the
  // single-range/single-negated-char forms above, exercising
  // `ast-optimize-char-class.ts`'s character-class-merging pass over more
  // than one range/member, plus the negated-multi-range codegen path,
  // neither reached by `[a-b]`/`[ab]`/`[^a]` alone.
  "[^a-b]",
  "[^ab]",
  "[a-bd-e]",
  "[^a-bd-e]",
  "[abc]",
  ".",
  // Non-ASCII / astral leaves -- exercises `codePointAt`-based decoding
  // (`anyChar`/`charClass`/`charClassRun` in `packages/core/src/
  // basic.ts`/`char-class.ts`) and the predictive-dispatch non-ASCII
  // fallback (`packages/core/src/combinators.ts`'s `predictiveChoice`).
  '"é"',
  '"ø"',
  '"😀"',
  // Non-ASCII character-class RANGES (`[à-ÿ]`-shaped, not just a single
  // non-ASCII string literal above) -- until `character-class.ts`'s
  // `charClassChar` grew a non-ASCII alternative, the .tpeg grammar TEXT
  // parser could only accept ASCII printable characters as a class
  // member, so this shape was structurally unreachable from any
  // grammar-TEXT fuzzer no matter the sample size; the equivalent astral
  // range was previously only exercised at the combinator layer
  // (`core/combinator-oracle.spec.ts`), never through the actual .tpeg
  // parse -> AST -> codegen pipeline this file drives.
  "[あ-ん]",
  "[^あ-ん]",
  "[a-zあ]",
  "[😀-🙏]",
  // Control-character leaves -- a `StringLiteral`/`CharacterClass` whose
  // VALUE contains an actual newline/tab byte (not the two source
  // characters "\" "n"), decoded from the grammar-text escape sequence by
  // `string-literal.ts`/`character-class.ts`. Added after finding that
  // `@suzumiyaaoba/tpeg-generator`'s Eta-based generator escaped only
  // backslash/double-quote when emitting a `literal("...")`/`charClass(...)`
  // call, so a control character in the VALUE came out as a raw byte
  // inside the generated source's `"..."` literal -- invalid TypeScript.
  // Neither this fuzzer nor `codegen.ts`/`codegen-optimized.ts` (which
  // already escape control characters via `constants.ts`'s
  // `escapeStringLiteral`) had ever exercised this shape before.
  '"\\n"',
  '"\\t"',
  "[\\n]",
  "[\\t]",
] as const;

/** Generates one random Expression's SOURCE TEXT (not an AST -- fed back
 * through the real grammar parser, exactly like a human-authored .tpeg
 * file, so this exercises the full parse -> AST -> codegen pipeline, not
 * just codegen in isolation). `allowRuleRef` gates whether a reference to
 * `refs` may appear as a leaf, so a non-recursive rule's own body never
 * references itself. */
export const genExpr = (
  rng: () => number,
  depth: number,
  allowRuleRef: boolean,
  refs: readonly string[],
): string => {
  const atom = () => pick(rng, allowRuleRef ? [...LEAVES, ...refs] : LEAVES);
  if (depth <= 0) return atom();
  const next = () => genExpr(rng, depth - 1, allowRuleRef, refs);
  switch (Math.floor(rng() * 33)) {
    case 0:
      return atom();
    case 1:
      return `(${next()} ${next()})`;
    case 2:
      return `(${next()} / ${next()})`;
    case 3:
      return `${atom()}*`;
    case 4:
      return `${atom()}+`;
    case 5:
      return `(${next()})?`;
    case 6:
      return `!${atom()} ${next()}`;
    case 7:
      return `&${atom()} ${next()}`;
    case 8:
      return `(${next()} / ${next()} / ${next()})`;
    case 9:
      return `${atom()}{1,3}`;
    case 10:
      return `${atom()}{2}`;
    case 11:
      // Three-element Sequence with a Cut, exercising cut-scoping past
      // the immediately-following element (`commit`'s doc comment,
      // `packages/core/src/combinators.ts`).
      return `(${next()} ~ ${next()} ${next()})`;
    case 12:
      // A labeled element -- exercises `capture` (`packages/core/src/
      // capture.ts`) alongside every rewrite pass; value shape is
      // unaffected by which VARIANT compiles it (only by whether the
      // grammar text has a label at all), so this composes safely with
      // the existing shapePreserving comparison.
      return `x:${atom()}`;
    case 13:
      // A trailing cut leaving exactly ONE non-Cut element behind --
      // every other cut-bearing case below has at least two remaining
      // elements, so this is the shape that slipped past every prior
      // audit round: dropping the `~` must leave the sequence's capture
      // "exactly as if `~` weren't there" (docs/peg-grammar.md's Capture
      // Structure Reference Table), which for a single survivor means a
      // BARE value, not a 1-tuple -- `codegen.ts`'s `generateSequence`
      // used to always wrap in `sequence(...)` regardless, disagreeing
      // with `codegen-optimized.ts` on every grammar shaped like this
      // (fixed alongside this comment).
      return `(${next()} ~)`;
    case 14:
      // Star over a CUT-bearing group, not just a bare atom (unlike case
      // 3) -- exercises `zeroOrMore` re-raising a fatal failure from a
      // committed sub-sequence rather than treating it as "stop
      // repeating" (`repetition.ts`'s doc comment, `packages/core/src/`).
      // The leading `atom()` guarantees the group is non-nullable
      // regardless of what `next()` draws, so this never trips
      // `assertNoNullableRepetition`.
      return `(${atom()} ~ ${next()})*`;
    case 15:
      // Same, but `oneOrMore` -- a fatal failure on the SECOND+ attempt
      // (not just the first) must also propagate.
      return `(${atom()} ~ ${next()})+`;
    case 16:
      // A Cut inside a NegativeLookahead's own probe: must commit only
      // WITHIN that probe's attempt, absorbed at the lookahead's own
      // boundary rather than escaping to whatever encloses `!(...)`
      // (`notPredicate`'s doc comment, `packages/core/src/lookahead.ts`).
      return `!(${next()} ~ ${next()}) ${next()}`;
    case 17:
      // Same for PositiveLookahead (`andPredicate`'s doc comment).
      return `&(${next()} ~ ${next()}) ${next()}`;
    case 18:
      // A bounded Quantified over a COMPOSITE (possibly-nullable)
      // expression -- unlike cases 9/10 (`atom(){1,3}`/`atom(){2}`,
      // always non-nullable), this exercises `quantified`'s explicit
      // carve-out: a bounded range has well-defined PEG semantics
      // regardless of whether the repeated expression is nullable, since
      // the `for` loop bounding it can never loop unboundedly either way
      // (`first-sets.ts`'s `assertNoNullableRepetition` doc comment).
      return `(${next()} / ${next()}){0,2}`;
    case 19:
      // An OPEN-ENDED Quantified (`{2,}`, no upper bound) over a
      // composite two-element sequence -- the leading `atom()` keeps it
      // non-nullable, so this is safe, but it's a shape cases 9/10/18
      // don't reach (no fixed upper bound, non-atomic body).
      return `(${atom()} ${next()}){2,}`;
    case 20:
      // Star over a plain (non-cut) group, not just an atom -- may
      // legitimately draw a nullable `next()` (e.g. one that itself
      // recursed into case 3's `atom()*` or case 5's `(...)?`), in which
      // case the harness's existing construction-time-rejection handling
      // (`assertNoNullableRepetition` firing, caught and counted as
      // skipped -- see the main test loop below) applies exactly like it
      // already does for a hand-written `("a"?)*`.
      return `(${next()} ${next()})*`;
    case 21:
      // A Cut as the FIRST element of a Sequence (zero preceding
      // elements) -- every existing cut-bearing case above (11/14/15/16/
      // 17) always has at least an `atom()` or lookahead ahead of the
      // `~`, so this is the only shape exercising that a cut still marks
      // every SUBSEQUENT element's failure fatal even with nothing before
      // it to have already matched.
      return `(~ ${next()} ${next()})`;
    case 22:
      // `optional` wrapping a group that ends in a committed
      // sub-sequence -- distinct from case 5's `(next())?` (never
      // contains a cut) and cases 14/15's `star`/`plus` (not `optional`):
      // exercises `optional`'s own fatal re-raise (`repetition.ts`'s doc
      // comment) rather than swallowing the cut's failure as "no match".
      return `(${next()} ~ ${next()})?`;
    case 23:
      // A labeled element wrapping a Cut-bearing group -- `capture`
      // alongside fatal-failure propagation through a `LabeledExpression`,
      // which `reference-interpreter.ts`'s own doc comment says is
      // "transparent" for recognition; this pins that codegen agrees.
      return `x:(${next()} ~ ${next()})`;
    case 24:
      // `{0,1}` -- the degenerate Quantified bound equivalent to `?`,
      // distinct from case 9's `{1,3}`/case 10's `{2}` (both force at
      // least one match) and case 18's `{0,2}` (wraps a composite, not a
      // bare atom).
      return `${atom()}{0,1}`;
    case 25:
      // A Cut-bearing group as one alternative of a Choice, directly at
      // the grammar-text level -- complements case 16/17's lookahead-
      // scoped absorption tests with `choice`'s own fatal-absorption
      // boundary (`commit`'s doc comment, `packages/core/src/
      // combinators.ts`): the committed alternative failing past its cut
      // must not fall through to the sibling.
      return `((${next()} ~ ${next()}) / ${next()})`;
    case 26:
      // Negative lookahead over a GROUP, not just a bare `atom()` (unlike
      // case 6) -- exercises `ast-optimize-negative-lookahead.ts`'s
      // degeneration pass over a composite probe.
      return `!(${next()}) ${next()}`;
    case 27:
      // A leading cut leaving exactly ONE non-Cut element behind --
      // case 21 already covers a leading cut with TWO elements after it;
      // this is the single-survivor counterpart to case 13 above, for
      // the same "as if `~` weren't there" reason.
      return `(~ ${next()})`;
    case 28:
      // A TRAILING negative lookahead -- every prior lookahead case (6/
      // 16/17/26) only ever puts `!`/`&` at the FRONT of what follows it.
      // A trailing `!atom` at the end of a sequence is an extremely
      // common real-world idiom ("x not immediately followed by y") and
      // was structurally unreachable from this generator before this
      // case existed -- confirmed unreachable by a manual audit alongside
      // the fix that added this case (see the commit introducing it).
      return `(${next()} !${atom()})`;
    case 29:
      // Same, but trailing PositiveLookahead.
      return `(${next()} &${atom()})`;
    case 30:
      // Nested/doubled lookahead -- `!(!a)` (negate a negation) and
      // `!(&a)`/`&(!a)` (negate an affirmation / affirm a negation), none
      // of which any prior case produces (6/16/17/26 always wrap a single
      // `!`/`&` around a bare atom or group, never around ANOTHER
      // lookahead). Unlike an earlier version of this case, the outer
      // operator's operand is wrapped in an explicit `(...)` group: `prefix
      // = (AND/NOT)? Suffix` (`composition.ts`'s `withLookahead`) consumes
      // exactly ONE leading `!`/`&`, so a bare `!!a`/`!&a`/`&!a` -- lacking
      // the group -- fails to parse `grammarDefinition` at all. That made
      // this branch's every draw land in the fuzzing loop's `skippedCount`
      // rather than actually exercising nested lookahead, for as long as
      // this file existed; confirmed by testing all three shapes directly
      // against `parse(grammarDefinition)`.
      return pick(rng, [
        `!(!${atom()}) ${next()}`,
        `!(&${atom()}) ${next()}`,
        `&(!${atom()}) ${next()}`,
      ]);
    case 31:
      // A greedy `*` immediately followed by a trailing negative
      // lookahead in the same group -- unlike case 28 (a single `atom()`
      // before the `!`), this exercises the lookahead firing right after
      // a REPETITION's own backtracking exhausts itself, not just after
      // one match.
      return `(${atom()}* !${atom()})`;
    default:
      return `(${next()} ~ ${next()})`;
  }
};

/** One mutually-recursive rule's body: always `<prefix> (<ref>) <suffix> /
 * <base>` -- the prefix/suffix pair guarantees at least one character is
 * consumed before ever recursing, so this can never be left-recursive
 * (which neither the real runtime nor `reference-interpreter.ts` -- nor
 * indeed any of this project's codegen -- supports), regardless of which
 * rule `ref` names or how deep the mutual cycle goes. */
export const genRecursiveRuleBody = (
  rng: () => number,
  refs: readonly string[],
): string => {
  const brackets = [
    ['"("', '")"'],
    ['"["', '"]"'],
    ['"<"', '">"'],
  ] as const;
  const [prefix, suffix] = pick(rng, brackets);
  const ref = pick(rng, refs);
  const base = pick(rng, LEAVES);
  return `${prefix} (${ref}) ${suffix} / ${base}`;
};

/** Renders `sub`'s optional `@memoize`/`@memoize: N` rule annotation --
 * exercises the automatic-memoization-adjacent EXPLICIT annotation path
 * (`codegen-optimized.ts`'s `findMemoizeAnnotation`/`wrapWithMemoize`),
 * distinct from `enableMemoization`'s reentrancy-driven automatic
 * decision. */
export const genMemoizeAnnotation = (rng: () => number): string => {
  switch (Math.floor(rng() * 3)) {
    case 0:
      return "";
    case 1:
      return "@memoize\n  ";
    default:
      return "@memoize: 4\n  ";
  }
};

/** Generates one complete random `.tpeg` grammar source: a `start` rule
 * (which may reference the non-recursive `sub` rule and the mutually
 * recursive `rec1`), the non-recursive `sub` rule, and a `rec1`/`rec2`
 * mutually-recursive pair (see `genRecursiveRuleBody`'s doc comment for why
 * that pair can never be left-recursive). */
export const genGrammarSource = (rng: () => number): string => {
  const memoAnnotation = genMemoizeAnnotation(rng);
  return `grammar G {\n  start = ${genExpr(rng, 3, true, ["sub", "rec1"])}\n  sub = ${genExpr(rng, 2, false, [])}\n  ${memoAnnotation}rec1 = ${genRecursiveRuleBody(rng, ["rec1", "rec2"])}\n  rec2 = ${genRecursiveRuleBody(rng, ["rec1", "rec2"])}\n}`;
};

export const FIXED_TEST_INPUTS = [
  "",
  "a",
  "b",
  "ab",
  "aa",
  "ba",
  "abb",
  "aab",
  "abab",
  "bbb",
  "c",
  "ac",
  "abc",
  "abd",
  "aba",
  "bab",
  "abba",
  "aabb",
  "aaa",
  "baa",
  "é",
  "aé",
  "😀",
  "a😀b",
  "à",
  "(a)",
  "[a]",
  "<a>",
  "((a))",
  "([a])",
  "(<a>)",
  "(",
  "((((a",
  // Control-character inputs -- pairs with the `LEAVES` control-character
  // literals above, so a grammar containing e.g. `"\n"` actually gets
  // matched against input containing a real newline byte, not just parsed.
  "\n",
  "\t",
  "\n\t\n",
] as const;

/** Random strings appended to the fixed `FIXED_TEST_INPUTS` list above,
 * drawn from a small alphabet covering every leaf/bracket character
 * `LEAVES`/`genRecursiveRuleBody` can produce, plus astral/non-ASCII
 * characters -- a fixed hand-picked list alone repeatedly exercises the
 * same handful of (grammar, input) combinations across many random
 * grammars; this widens the input side too, at effectively zero extra
 * runtime cost (still one compiled-parser call per input). Generated ONCE
 * at module load with its own fixed LCG seed (independent of any caller's
 * own grammar-generation seed, so changing that seed doesn't also reshuffle
 * inputs), so this list is itself deterministic and reproducible across
 * runs. */
export const RANDOM_TEST_INPUTS: readonly string[] = (() => {
  let state = 424242 >>> 0;
  const rng = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const alphabet = [
    "a",
    "b",
    "c",
    "d",
    "e",
    "(",
    ")",
    "[",
    "]",
    "<",
    ">",
    "é",
    "😀",
  ] as const;
  const inputs: string[] = [];
  for (let i = 0; i < 20; i++) {
    const len = Math.floor(rng() * 7);
    let s = "";
    for (let j = 0; j < len; j++) {
      s += alphabet[Math.floor(rng() * alphabet.length)];
    }
    inputs.push(s);
  }
  return inputs;
})();

export const ALL_TEST_INPUTS: readonly string[] = [
  ...FIXED_TEST_INPUTS,
  ...RANDOM_TEST_INPUTS,
];

// --- Harness ---------------------------------------------------------------

/** Compiles generated TypeScript source (no imports -- every variant this
 * is used for is generated with `includeImports: false`) into a callable
 * `start` parser, given the already-loaded `tpeg-core`/`tpeg-combinator`
 * namespaces as the function's scope. Mirrors the `new Function(...)`
 * pattern `cut-memoize.spec.ts` uses for the same reason: these are
 * genuinely generated modules, not hand-written parsers, so there's no
 * static import target to bind them to.
 *
 * `combinator` is spread FIRST, `core` SECOND (core wins on any shared
 * name) -- this mirrors exactly how generated code actually imports the
 * two packages: leaf/composition parsers (`literal`, `choice`,
 * `sequence`, `charClassRun`, `predictiveChoice`, ...) always come from
 * `@suzumiyaaoba/tpeg-core`, while only `memoize`/`commitAtTopLevel` come
 * from `@suzumiyaaoba/tpeg-combinator` (see `codegen.ts`'s import
 * generation). The previous `{ ...core, ...combinator }` ordering let
 * `tpeg-combinator`'s re-exported copies of core names silently shadow
 * the real ones -- harmless while both packages shared one `tpeg-core`
 * instance, but exactly the wrong composition to have caught the
 * duplicate-bundling bug fixed alongside this module (see
 * `packages/combinator/src/dist-instance.spec.ts`), since that shadowing
 * masked which package's copy of `FAIL`/the watermark a generated
 * parser's calls actually reached. */
export const compileStart = (
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

export type ResultKey = string;

// "FATAL" is a failure that's still fatal once it reaches the caller --
// i.e. nothing between here and the top (`choice`/`predictiveChoice`/
// `andPredicate`/`notPredicate`) absorbed the cut first. Collapsing this
// into the same "F" as an ordinary failure would let a cut-propagation bug
// that gets recognition right but fatality wrong (e.g. a fatal failure
// escaping a boundary that should have absorbed it, or one that got
// absorbed too early) produce zero diffs.
export const keySuccessOnly = (r: ReturnType<Parser<unknown>>): ResultKey =>
  r.success ? `S:${r.next}` : isFatalFailure(r) ? "FATAL" : "F";
export const keyWithValue = (r: ReturnType<Parser<unknown>>): ResultKey =>
  r.success
    ? `S:${r.next}:${JSON.stringify(r.val)}`
    : isFatalFailure(r)
      ? "FATAL"
      : "F";
