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
