/**
 * Reference PEG interpreter for a TPEG `GrammarDefinition`: a direct,
 * unoptimized evaluator of Ford's PEG semantics (POPL 2004), used purely
 * as a differential-testing ORACLE (`codegen-differential.spec.ts`) --
 * never shipped in a generated parser, never optimized.
 *
 * ## Why this exists alongside the base-vs-optimized-variants comparison
 *
 * `codegen-differential.spec.ts` already compares
 * `generateTypeScriptParser` (the base generator) against every
 * optimization variant, but that comparison is blind to a bug shared by
 * ALL of them -- if the base generator's own encoding of some PEG
 * construct were wrong, every variant would agree with it and the
 * differential test would report zero diffs. This module is a SEPARATE
 * implementation, written directly against the grammar's AST with no
 * shared code path with `codegen.ts`/`codegen-optimized.ts`/
 * `packages/core/src/combinators.ts`, so an agreement between it and the
 * generated code is actual evidence the semantics are right, not just
 * that every code path made the same mistake.
 *
 * ## What this deliberately does NOT model
 *
 * Only recognition (did it match, and where did it stop) is computed --
 * `{ ok: true, next } | { ok: false, fatal }`. No parsed VALUE is
 * constructed. Value shape is already covered by the existing base vs.
 * optimized-variant comparison (`shapePreserving` variants there compare
 * on value too); duplicating codegen's value-construction logic here
 * would be a second copy of that logic to keep in sync, for no additional
 * coverage. Similarly, `LabeledExpression` and `ActionExpression` are
 * treated as transparent (their recognition is exactly their wrapped
 * expression's) -- labels/actions affect only the produced value.
 *
 * ## Cut/commit semantics
 *
 * A `Cut` inside a `Sequence` has no effect on its own (evaluating it
 * always succeeds, consuming nothing) -- what it does is mark every
 * element AFTER it in the same `Sequence` such that, if one of them
 * fails, that failure is `fatal` rather than ordinary. A `fatal` failure
 * propagates up through nested `Sequence`s unchanged, but is ABSORBED
 * (turned back into an ordinary failure) at the boundary of whichever
 * `Choice` or `PositiveLookahead`/`NegativeLookahead` it reaches first --
 * exactly the scoping `commit`'s doc comment
 * (`packages/core/src/combinators.ts`) and `andPredicate`'s doc comment
 * (`packages/core/src/lookahead.ts`) describe for the real runtime. A
 * repetition (`Star`/`Plus`/`Optional`/`Quantified`) re-raises a fatal
 * failure from its wrapped expression rather than treating it as "stop
 * repeating" -- matching `repetition.ts`.
 *
 * ## Termination
 *
 * A zero-width match inside `Star`/`Plus`/an unbounded `Quantified`
 * throws (mirroring `createInfiniteLoopError` in
 * `packages/core/src/repetition.ts`) rather than looping forever --
 * callers should treat this as "skip this grammar/input pair", exactly
 * like `assertNoNullableRepetition` rejects such a grammar at
 * construction time for the real codegen path. A recursion-depth guard
 * similarly throws rather than overflowing the stack on a left-recursive
 * grammar (this interpreter, like the real runtime, has no left-recursion
 * support).
 */

import type {
  Expression,
  GrammarDefinition,
  RuleDefinition,
} from "@suzumiyaaoba/tpeg-core";

/** Thrown (not returned) for a condition that means "this grammar/input
 * pair is out of scope for this interpreter" -- infinite loop (zero-width
 * repetition) or unbounded recursion (most likely left recursion, which
 * neither this interpreter nor the real runtime supports). A caller
 * should catch this and skip, exactly like a construction-time rejection
 * from `assertNoNullableRepetition` is skipped elsewhere in the
 * differential harness. */
export class ReferenceInterpreterLimitError extends Error {}

interface Ok {
  readonly ok: true;
  readonly next: number;
}
interface Ng {
  readonly ok: false;
  /** Whether this failure must abort the enclosing choice/lookahead
   * entirely rather than allow backtracking to a sibling alternative --
   * see this module's doc comment on cut/commit semantics. */
  readonly fatal: boolean;
}
type Result = Ok | Ng;

const OK = (next: number): Ok => ({ ok: true, next });
const NG = (fatal: boolean): Ng => ({ ok: false, fatal });

/** Default recursion-depth ceiling: comfortably above any legitimate
 * grammar/input pair this harness's random generator produces, but low
 * enough that a left-recursive grammar (infinite descent with zero
 * consumption) fails fast rather than blowing the real call stack. */
const DEFAULT_MAX_DEPTH = 5000;

/**
 * Compiles `grammar` into a callable recognizer for its `start` rule.
 * Every call to the returned function re-runs the interpreter fresh (no
 * memoization, deliberately -- this is a correctness oracle, not a
 * performance-sensitive path), so the same instance is safe to call
 * repeatedly across different inputs.
 *
 * @throws {Error} if the grammar has no `start` rule or references an
 *   undefined rule -- a malformed-grammar bug the caller should let
 *   surface rather than silently skip.
 * @throws {ReferenceInterpreterLimitError} (from the returned function,
 *   not from this call) on a zero-width repetition or on exceeding
 *   `maxDepth` -- see the class doc comment.
 */
export const makeReferenceInterpreter = (
  grammar: GrammarDefinition,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): ((input: string) => Result) => {
  const rules = new Map<string, RuleDefinition>();
  for (const rule of grammar.rules) rules.set(rule.name, rule);
  const start = rules.get("start");
  if (!start) {
    throw new Error("makeReferenceInterpreter: grammar has no 'start' rule");
  }

  let depth = 0;

  /** Decodes the code point at `pos`, if any, plus its UTF-16 length --
   * mirrors `anyChar`/`charClass`'s own `codePointAt`-based decoding
   * (`packages/core/src/basic.ts`, `char-class.ts`) so an astral
   * character is recognized as exactly one character here too. */
  const codePointAt = (
    s: string,
    pos: number,
  ): { cp: number; len: number } | null => {
    const cp = s.codePointAt(pos);
    if (cp === undefined) return null;
    return { cp, len: cp > 0xffff ? 2 : 1 };
  };

  const evalExpr = (expr: Expression, input: string, pos: number): Result => {
    if (++depth > maxDepth) {
      depth--;
      throw new ReferenceInterpreterLimitError(
        `recursion depth exceeded ${maxDepth} (likely left recursion)`,
      );
    }
    try {
      switch (expr.type) {
        case "StringLiteral":
          return input.startsWith(expr.value, pos)
            ? OK(pos + expr.value.length)
            : NG(false);

        case "AnyChar": {
          const c = codePointAt(input, pos);
          return c ? OK(pos + c.len) : NG(false);
        }

        case "CharacterClass": {
          const c = codePointAt(input, pos);
          if (!c) return NG(false);
          let hit = false;
          for (const range of expr.ranges) {
            const lo = range.start.codePointAt(0) as number;
            const hi =
              range.end === undefined
                ? lo
                : (range.end.codePointAt(0) as number);
            if (c.cp >= lo && c.cp <= hi) {
              hit = true;
              break;
            }
          }
          return hit !== expr.negated ? OK(pos + c.len) : NG(false);
        }

        case "Identifier": {
          const rule = rules.get(expr.name);
          if (!rule) {
            throw new Error(
              `makeReferenceInterpreter: undefined rule '${expr.name}'`,
            );
          }
          return evalExpr(rule.pattern, input, pos);
        }

        case "QualifiedIdentifier":
          // Cross-module references never appear in the single-grammar
          // sources this harness generates.
          throw new Error(
            "makeReferenceInterpreter: QualifiedIdentifier not supported",
          );

        case "Group":
        case "LabeledExpression":
        case "ActionExpression":
          // Transparent for recognition purposes -- see module doc
          // comment.
          return evalExpr(expr.expression, input, pos);

        case "Cut":
          // A bare Cut, reached directly (not as a Sequence element --
          // see the "Sequence" case below for the actual cut-scoping
          // logic): succeeds trivially, consuming nothing.
          return OK(pos);

        case "Sequence": {
          let p = pos;
          let cutActive = false;
          for (const el of expr.elements) {
            if (el.type === "Cut") {
              cutActive = true;
              continue;
            }
            const r = evalExpr(el, input, p);
            if (!r.ok) {
              // Once a Cut has fired earlier in this same Sequence, EVERY
              // subsequent element's failure is fatal, not just the one
              // immediately after the Cut -- matches `sequence(before...,
              // commit(sequence(after...)))`'s compiled shape, where
              // `commit` wraps the whole remaining sub-sequence.
              return NG(r.fatal || cutActive);
            }
            p = r.next;
          }
          return OK(p);
        }

        case "Choice": {
          for (const alt of expr.alternatives) {
            const r = evalExpr(alt, input, pos);
            if (r.ok) return r;
            if (r.fatal) {
              // Absorbed at this Choice's own boundary -- stop trying
              // further alternatives, but report an ordinary (non-fatal)
              // failure to whatever encloses THIS choice.
              return NG(false);
            }
          }
          return NG(false);
        }

        case "Star": {
          let p = pos;
          for (;;) {
            const r = evalExpr(expr.expression, input, p);
            if (!r.ok) {
              if (r.fatal) return r;
              break;
            }
            if (r.next === p) {
              throw new ReferenceInterpreterLimitError(
                "zero-width match inside Star",
              );
            }
            p = r.next;
          }
          return OK(p);
        }

        case "Plus": {
          const first = evalExpr(expr.expression, input, pos);
          if (!first.ok) return first;
          if (first.next === pos) {
            throw new ReferenceInterpreterLimitError(
              "zero-width match inside Plus",
            );
          }
          let p = first.next;
          for (;;) {
            const r = evalExpr(expr.expression, input, p);
            if (!r.ok) {
              if (r.fatal) return r;
              break;
            }
            if (r.next === p) {
              throw new ReferenceInterpreterLimitError(
                "zero-width match inside Plus",
              );
            }
            p = r.next;
          }
          return OK(p);
        }

        case "Optional": {
          const r = evalExpr(expr.expression, input, pos);
          if (r.ok) return r;
          if (r.fatal) return r;
          return OK(pos);
        }

        case "Quantified": {
          let p = pos;
          for (let i = 0; i < expr.min; i++) {
            const r = evalExpr(expr.expression, input, p);
            if (!r.ok) return r;
            p = r.next;
          }
          const limit =
            expr.max === undefined ? Number.POSITIVE_INFINITY : expr.max;
          for (let i = expr.min; i < limit; i++) {
            const r = evalExpr(expr.expression, input, p);
            if (!r.ok) {
              if (r.fatal) return r;
              break;
            }
            // A zero-width match only loops forever when unbounded --
            // an explicit `max` already bounds the loop above, mirroring
            // `quantified`'s own guard in `packages/core/src/repetition.ts`.
            if (expr.max === undefined && r.next === p) {
              throw new ReferenceInterpreterLimitError(
                "zero-width match inside unbounded Quantified",
              );
            }
            p = r.next;
          }
          return OK(p);
        }

        case "PositiveLookahead": {
          const r = evalExpr(expr.expression, input, pos);
          // Fatal or not, a lookahead's own outcome only ever depends on
          // success/failure of the probe -- absorbed at this predicate's
          // boundary exactly like `andPredicate` (`packages/core/src/
          // lookahead.ts`) absorbs a cut reached inside `&e`.
          return r.ok ? OK(pos) : NG(false);
        }

        case "NegativeLookahead": {
          const r = evalExpr(expr.expression, input, pos);
          return r.ok ? NG(false) : OK(pos);
        }

        default:
          throw new Error(
            `makeReferenceInterpreter: unsupported node type ${(expr as Expression).type}`,
          );
      }
    } finally {
      depth--;
    }
  };

  return (input: string): Result => {
    depth = 0;
    return evalExpr(start.pattern, input, 0);
  };
};

/**
 * Convenience wrapper around {@link makeReferenceInterpreter} that
 * collapses a `Result` into the same `"S:<next>" | "F" | "FATAL"` key
 * shape `codegen-differential.spec.ts`'s `keySuccessOnly` uses for the
 * generated-code side of a comparison -- so an oracle diff reads the
 * same way as every other diff in that harness. `"FATAL"` is distinct
 * from plain `"F"`: this interpreter models `fatal`/cut absorption
 * exactly like the real runtime (see this module's doc comment), so a
 * failure that's still fatal once it reaches the very top -- i.e. no
 * enclosing `Choice`/`PositiveLookahead`/`NegativeLookahead` absorbed it
 * first -- is exactly what the generated code's own top-level
 * `commit`/`commitAtTopLevel` failure looks like, and a mismatch here (a
 * "did it fail" agreement that's still a "why it failed" disagreement)
 * is a real cut-propagation bug this key was previously blind to.
 */
export const referenceRecognize = (
  grammar: GrammarDefinition,
  maxDepth?: number,
): ((input: string) => string) => {
  const interp = makeReferenceInterpreter(grammar, maxDepth);
  return (input: string): string => {
    const r = interp(input);
    if (r.ok) return `S:${r.next}`;
    return r.fatal ? "FATAL" : "F";
  };
};
