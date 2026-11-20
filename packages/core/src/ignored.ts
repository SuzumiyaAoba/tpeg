/**
 * TPEG "ignored value" machinery
 *
 * The `IGNORED` sentinel + `ignore(...)` wrapper let a sequence element
 * consume input WITHOUT contributing a value to the enclosing
 * sequence's result tuple or label merge. Kept in its own leaf module
 * (no imports beyond `./types`) because both `./combinators.ts`
 * (`sequence`) and `./capture.ts` (`captureSequence`) must test for the
 * sentinel, and those two modules already depend on each other --
 * parking the sentinel in either would create an init-order-sensitive
 * import cycle.
 */

import type { Parser } from "./types";

/**
 * Sentinel `ignore(...)` produces as a successful result's `val`: "this
 * parser consumed input but its value must not appear in the enclosing
 * sequence's result." `sequence` and `captureSequence` drop `IGNORED`
 * entries before building the result tuple or merged label object, so
 * an ignored element contributes NOTHING to the caller's value -- the
 * mechanism `@skip`-inserted whitespace parsers ride on: generated code
 * emits `ignore(optional(<skipRule>))` at sequence boundaries, keeping
 * a rule's own value shape identical with and without `@skip`.
 *
 * A `unique symbol` so no user value can ever compare equal to it; the
 * identity check in `sequence`/`captureSequence` is the ONLY place it
 * is tested, and any other combinator (`Star`, `optional`, `choice`,
 * ...) treats it as an ordinary opaque value -- which is correct,
 * because value-dropping is a property of the *sequence boundary*, not
 * of the value itself.
 */
export const IGNORED: unique symbol = Symbol("tpeg.ignored");

/** Values returned by a sequence before applying its ignore policy. */
export type ParserValues<P extends Parser<unknown>[]> = {
  [K in keyof P]: P[K] extends Parser<infer T> ? T : never;
};

/** Slots a single child can contribute. An opaque value may also be IGNORED. */
type VisibleSlot<Value> = unknown extends Value
  ? [] | [Value]
  : [Value] extends [typeof IGNORED]
    ? []
    : typeof IGNORED extends Value
      ? [] | [Exclude<Value, typeof IGNORED>]
      : [Value];

type DropIgnored<
  Values extends unknown[],
  Prefix extends unknown[] = [],
  Ambiguous extends unknown[] = [],
> = Values extends [infer Head, ...infer Tail]
  ? 0 | 1 extends VisibleSlot<Head>["length"]
    ? // Each ambiguous child doubles the possible shapes. Keep a typed
      // array suffix once an exact union would exceed 64 variants.
      Ambiguous["length"] extends 6
      ? [...Prefix, ...Exclude<Values[number], typeof IGNORED>[]]
      : DropIgnored<Tail, [...Prefix, ...VisibleSlot<Head>], [...Ambiguous, 0]>
    : DropIgnored<Tail, [...Prefix, ...VisibleSlot<Head>], Ambiguous>
  : Values extends []
    ? Prefix
    : [...Prefix, ...Exclude<Values[number], typeof IGNORED>[]];

type VisibleValues<Values extends unknown[]> =
  typeof IGNORED extends Values[number]
    ? // Long generated rules can exceed TypeScript's recursion limit for
      // tuple filtering. Still describe every possible visible element.
      "512" extends keyof Values
      ? Exclude<Values[number], typeof IGNORED>[]
      : DropIgnored<Values>
    : Values;

/** Visible result slots of a sequence. Fixed tuples without ignored values pass through directly. */
export type SequenceValues<P extends Parser<unknown>[]> = VisibleValues<
  ParserValues<P>
>;

/**
 * Wraps a parser so its successful match is recorded as "consumed, but
 * valueless": the result's `val` becomes the `IGNORED` sentinel, which
 * `sequence`/`captureSequence` then exclude from the result tuple /
 * label merge. Failures pass through unchanged.
 *
 * @example
 * ```typescript
 * // Matches optional whitespace but contributes no tuple slot:
 * sequence(ignore(optional(ws)), tokenA, ignore(optional(ws)), tokenB)
 * // -> val === [aVal, bVal]  (whitespace consumed, not captured)
 * ```
 */
export const ignore = <T>(parser: Parser<T>): Parser<typeof IGNORED> => {
  return (input: string, pos: number) => {
    const result = parser(input, pos);
    if (!result.success) {
      return result;
    }
    return {
      success: true as const,
      val: IGNORED,
      current: result.current,
      next: result.next,
    };
  };
};
