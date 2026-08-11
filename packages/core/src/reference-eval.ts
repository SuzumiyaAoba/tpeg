/**
 * Reference PEG interpreter for the HAND-WRITTEN COMBINATOR layer: a
 * direct, unoptimized evaluator of a small internal tree ADT ({@link Spec})
 * describing a composition of this package's own combinator exports, used
 * purely as a differential-testing ORACLE (`combinator-oracle.spec.ts` in
 * this package and in `tpeg-combinator`) -- never a replacement for the
 * real combinators, never optimized.
 *
 * ## Why this exists alongside `combinator-laws.spec.ts`
 *
 * `combinator-laws.spec.ts` already fuzzes this package's combinators
 * against each other (e.g. `charClassRun(specs, 0) === zeroOrMore(charClass(...specs))`),
 * but an algebraic law can only ever catch a divergence BETWEEN two
 * combinators -- it is blind to a bug shared by every combinator that
 * implements a given PEG construct, since both sides of the law would
 * agree on the same wrong answer. This module is a SEPARATE
 * implementation, evaluated directly against {@link Spec} with no shared
 * code path with `combinators.ts`/`repetition.ts`/`lookahead.ts`/
 * `char-class.ts`, so agreement between it and the real combinators is
 * actual evidence the semantics are right, not just that every code path
 * made the same mistake. This is exactly the role
 * `packages/parser/src/reference-interpreter.ts` already plays for the
 * CODE GENERATION pipeline -- see that module's doc comment for the fuller
 * rationale -- extended one layer down, to the hand-written combinators
 * codegen itself is built on (and that `packages/samples` and any
 * hand-written caller use directly, without going through codegen at all).
 *
 * ## What this deliberately does NOT model
 *
 * Only recognition (did it match, and where did it stop) is computed --
 * `{ ok: true, next } | { ok: false, fatal }`. No parsed VALUE is
 * constructed, exactly like `reference-interpreter.ts`; value shape for
 * these same combinators is already covered by `combinator-laws.spec.ts`'s
 * equivalence checks (several of which compare value, not just
 * recognition).
 *
 * `predictiveChoice` (`./combinators.ts`) has no dedicated `Spec` node --
 * `"alt"` is evaluated with the ordered-choice rule realizing BOTH
 * `choice` and (a caller-contract-honoring) `predictiveChoice`, since
 * `predictiveChoice`'s entire claim is that it recognizes exactly the same
 * language as `choice`, just faster. A caller building a real
 * `predictiveChoice` from a `Spec` tree (see `combinator-oracle.spec.ts`)
 * therefore compares it against evaluating that SAME `"alt"` node here --
 * any divergence is a `predictiveChoice` bug (or a caller-contract
 * violation in the filters that test harness derives), not a modeling gap
 * in this file.
 *
 * ## Cut/commit semantics
 *
 * Unlike `reference-interpreter.ts`'s grammar AST (where a bare `Cut` is a
 * `Sequence` element that retroactively scopes every element AFTER it),
 * this combinator-level ADT has no such implicit form -- a cut is always
 * an explicit `{ kind: "cut", expression }` node wrapping exactly the
 * sub-expression it protects, mirroring `commit()` (`./combinators.ts`)
 * directly: evaluating it always succeeds if `expression` succeeds, and
 * marks `expression`'s failure `fatal` if it fails. Composing
 * `seq([before..., { kind: "cut", expression: seq(after...) }])` produces
 * the same scoping `reference-interpreter.ts` derives from a bare `Cut`
 * marker, without needing that module's own special-cased `Sequence`
 * handling -- there is nothing implicit left to get wrong here.
 *
 * `"alt"` stops trying further alternatives the moment one produces a
 * `fatal` failure, absorbing it into an ordinary failure at its own
 * boundary (see `commit`'s doc comment, `./combinators.ts`); `"and"`
 * absorbs it identically (see `andPredicate`'s doc comment, `./lookahead.ts`);
 * `"star"`/`"plus"`/`"opt"`/`"quant"`'s optional tail/`"default"` all
 * re-raise a fatal failure rather than treating it as "no match" (see
 * `repetition.ts`/`withDefault`'s doc comments); `"not"`/`"reject"` turn
 * ANY failure, fatal or not, into an ordinary success (see
 * `notPredicate`'s doc comment, `./lookahead.ts`, and `reject`'s,
 * `./combinators.ts`) -- a cut reached inside a negative lookahead or
 * `reject`'s probe can only ever mean "commit within that probe's own
 * attempt," never escape the probe itself.
 *
 * ## Termination
 *
 * A zero-width match inside `"star"`/`"plus"`/an unbounded `"quant"`
 * throws {@link ReferenceEvalLimitError} (mirroring
 * `createInfiniteLoopError` in `./repetition.ts`) rather than looping
 * forever -- callers should treat this as "skip this spec/input pair,"
 * exactly like `reference-interpreter.ts`'s identically-named error class.
 * Unlike that module, there is no recursion-depth guard here: `Spec` is a
 * finite tree with no rule-reference node (nothing analogous to
 * `Identifier`), so evaluation depth is bounded by the tree's own depth --
 * there is no way to construct a `Spec` that recurses without also
 * growing without bound, the way a left-recursive grammar rule can.
 */

/** One character-or-range item for `"cls"`/`"run"`, mirroring the shape
 * `charClass`/`negatedCharClass`/`charClassRun` (`./char-class.ts`) accept
 * -- a bare single-character string, or a `[start, end]` pair -- so a
 * `Spec` node's `specs` can be passed straight through to the real
 * combinator when building a parser to compare against this evaluator. */
export type CharSpecItem = string | readonly [string, string];

/** The combinator tree this module evaluates. Every node corresponds
 * 1:1 to a real export from this package (see the module doc comment for
 * exactly which one each node stands in for); building an actual `Parser`
 * from the same tree is the test harness's job
 * (`combinator-oracle.spec.ts`), not this module's. */
export type Spec =
  | { readonly kind: "lit"; readonly value: string }
  | { readonly kind: "any" }
  | {
      readonly kind: "cls";
      readonly specs: readonly CharSpecItem[];
      readonly negated: boolean;
    }
  | {
      readonly kind: "run";
      readonly specs: readonly CharSpecItem[];
      readonly min: 0 | 1;
      readonly negated: boolean;
    }
  | { readonly kind: "seq"; readonly elements: readonly Spec[] }
  | { readonly kind: "alt"; readonly alternatives: readonly Spec[] }
  | { readonly kind: "star"; readonly expression: Spec }
  | { readonly kind: "plus"; readonly expression: Spec }
  | { readonly kind: "opt"; readonly expression: Spec }
  | {
      readonly kind: "quant";
      readonly expression: Spec;
      readonly min: number;
      readonly max?: number;
    }
  | { readonly kind: "and"; readonly expression: Spec }
  | { readonly kind: "not"; readonly expression: Spec }
  | { readonly kind: "cut"; readonly expression: Spec }
  | { readonly kind: "default"; readonly expression: Spec }
  | { readonly kind: "reject"; readonly expression: Spec };

/** Thrown (not returned) for a condition that means "this spec/input pair
 * is out of scope for this evaluator" -- a zero-width match inside an
 * unbounded repetition. See the module doc comment's "Termination"
 * section. */
export class ReferenceEvalLimitError extends Error {}

interface Ok {
  readonly ok: true;
  readonly next: number;
}
interface Ng {
  readonly ok: false;
  readonly fatal: boolean;
}
type Result = Ok | Ng;

const OK = (next: number): Ok => ({ ok: true, next });
const NG = (fatal: boolean): Ng => ({ ok: false, fatal });

/** Decodes the code point at `pos`, if any, plus its UTF-16 length --
 * an independent re-implementation of the same `codePointAt`-based
 * decoding `anyChar`/`charClass` use (`./basic.ts`, `./char-class.ts`),
 * written fresh rather than imported, so an astral character is
 * recognized as exactly one character here too without sharing that
 * logic with the code under test. */
const codePointAt = (
  s: string,
  pos: number,
): { cp: number; len: number } | null => {
  const cp = s.codePointAt(pos);
  if (cp === undefined) return null;
  return { cp, len: cp > 0xffff ? 2 : 1 };
};

/** Independent range-membership check for `"cls"`/`"run"` -- a fresh
 * `for` loop over `{lo, hi}` pairs derived from each `CharSpecItem`, not a
 * call into `./char-class.ts`'s `compileSpecs`/`matchesSpecsSlow`. */
const matchesCharSpecs = (
  codePoint: number,
  specs: readonly CharSpecItem[],
): boolean => {
  for (const spec of specs) {
    const [startStr, endStr] = typeof spec === "string" ? [spec, spec] : spec;
    const lo = startStr.codePointAt(0) as number;
    const hi = endStr.codePointAt(0) as number;
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
};

export const evalSpec = (spec: Spec, input: string, pos: number): Result => {
  switch (spec.kind) {
    case "lit":
      return input.startsWith(spec.value, pos)
        ? OK(pos + spec.value.length)
        : NG(false);

    case "any": {
      const c = codePointAt(input, pos);
      return c ? OK(pos + c.len) : NG(false);
    }

    case "cls": {
      const c = codePointAt(input, pos);
      if (!c) return NG(false);
      const hit = matchesCharSpecs(c.cp, spec.specs);
      return hit !== spec.negated ? OK(pos + c.len) : NG(false);
    }

    case "run": {
      // `charClassRun`'s single-scan possessive run, re-derived here as a
      // plain loop rather than reusing that combinator's own scan -- see
      // the module doc comment on independence.
      let count = 0;
      let p = pos;
      while (true) {
        const c = codePointAt(input, p);
        if (!c) break;
        if (matchesCharSpecs(c.cp, spec.specs) === spec.negated) break;
        p += c.len;
        count++;
      }
      if (count === 0 && spec.min === 1) return NG(false);
      return OK(p);
    }

    case "seq": {
      let p = pos;
      for (const el of spec.elements) {
        const r = evalSpec(el, input, p);
        if (!r.ok) return r;
        p = r.next;
      }
      return OK(p);
    }

    case "alt": {
      for (const alt of spec.alternatives) {
        const r = evalSpec(alt, input, pos);
        if (r.ok) return r;
        if (r.fatal) {
          // Absorbed at this alternative's own boundary -- see the module
          // doc comment.
          return NG(false);
        }
      }
      return NG(false);
    }

    case "star": {
      let p = pos;
      while (true) {
        const r = evalSpec(spec.expression, input, p);
        if (!r.ok) {
          if (r.fatal) return r;
          break;
        }
        if (r.next === p) {
          throw new ReferenceEvalLimitError("zero-width match inside star");
        }
        p = r.next;
      }
      return OK(p);
    }

    case "plus": {
      const first = evalSpec(spec.expression, input, pos);
      if (!first.ok) return first;
      if (first.next === pos) {
        throw new ReferenceEvalLimitError("zero-width match inside plus");
      }
      let p = first.next;
      while (true) {
        const r = evalSpec(spec.expression, input, p);
        if (!r.ok) {
          if (r.fatal) return r;
          break;
        }
        if (r.next === p) {
          throw new ReferenceEvalLimitError("zero-width match inside plus");
        }
        p = r.next;
      }
      return OK(p);
    }

    case "opt": {
      const r = evalSpec(spec.expression, input, pos);
      if (r.ok) return r;
      if (r.fatal) return r;
      return OK(pos);
    }

    case "quant": {
      let p = pos;
      for (let i = 0; i < spec.min; i++) {
        const r = evalSpec(spec.expression, input, p);
        if (!r.ok) return r;
        p = r.next;
      }
      const limit =
        spec.max === undefined ? Number.POSITIVE_INFINITY : spec.max;
      for (let i = spec.min; i < limit; i++) {
        const r = evalSpec(spec.expression, input, p);
        if (!r.ok) {
          if (r.fatal) return r;
          break;
        }
        // Only meaningful when unbounded -- a concrete `max` already
        // bounds this loop via `limit`, matching `quantified`'s own
        // guard in `./repetition.ts`.
        if (spec.max === undefined && r.next === p) {
          throw new ReferenceEvalLimitError(
            "zero-width match inside unbounded quant",
          );
        }
        p = r.next;
      }
      return OK(p);
    }

    case "and": {
      const r = evalSpec(spec.expression, input, pos);
      // Fatal or not, absorbed at this predicate's own boundary -- see
      // the module doc comment.
      return r.ok ? OK(pos) : NG(false);
    }

    case "not": {
      const r = evalSpec(spec.expression, input, pos);
      return r.ok ? NG(false) : OK(pos);
    }

    case "cut": {
      const r = evalSpec(spec.expression, input, pos);
      return r.ok ? r : NG(true);
    }

    case "default": {
      const r = evalSpec(spec.expression, input, pos);
      if (r.ok) return r;
      if (r.fatal) return r;
      return OK(pos);
    }

    case "reject": {
      const r = evalSpec(spec.expression, input, pos);
      return r.ok ? NG(false) : OK(pos);
    }

    default: {
      const exhaustive: never = spec;
      throw new Error(
        `evalSpec: unsupported node kind ${(exhaustive as Spec).kind}`,
      );
    }
  }
};

/**
 * Convenience wrapper around {@link evalSpec} that collapses a `Result`
 * into the same `"S:<next>" | "F"` key shape
 * `codegen-differential.spec.ts`'s `keySuccessOnly` and
 * `reference-interpreter.ts`'s `referenceRecognize` use, so an oracle diff
 * here reads the same way as every other diff in this codebase's
 * differential-testing harnesses.
 */
export const specRecognize =
  (spec: Spec) =>
  (input: string): string => {
    const r = evalSpec(spec, input, 0);
    return r.ok ? `S:${r.next}` : "F";
  };
