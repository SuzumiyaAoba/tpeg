import type { CharRange } from "./types";

/**
 * `CharSet`: a set of Unicode code points, represented as a sorted,
 * non-overlapping, non-adjacent list of inclusive intervals over
 * `[0, MAX_CODE_POINT]`.
 *
 * This is the closed Boolean algebra `first-sets.ts` was missing: the
 * previous `{ chars: Set<string>, ranges: CharRangeLiteral[] }`
 * representation is closed under union but has no `complement` or
 * `difference`, which is exactly why a negated character class (`[^"]`)
 * or a negative lookahead's subtraction (`!a b`) had nowhere to go but
 * `unknown`. Working over code points (not UTF-16 code units) also means
 * a surrogate-pair (astral) character is just another interval endpoint
 * here -- no special-casing, no bail-out. Lowering to UTF-16 code units
 * only happens at the one place that actually needs code units: the
 * runtime `FirstCharFilter` boundary (see
 * `packages/core/src/combinators.ts`), because `predictiveChoice`
 * compares against `input[pos.offset]`, a single UTF-16 code unit.
 *
 * Every exported set-algebra function takes and returns already-normalized
 * `CharSet`s (sorted, merged) and preserves that invariant -- never
 * construct a `CharSet` by hand outside `fromChar`/`fromCodePointRange`.
 */

/** An inclusive code-point interval. `lo <= hi` always holds for a
 * normalized entry. */
export interface CodePointInterval {
  readonly lo: number;
  readonly hi: number;
}

/** A normalized `CharSet`: sorted ascending by `lo`, no two entries
 * overlap or touch (adjacent entries are always merged), no entry has
 * `lo > hi`. All functions in this module both require and preserve this
 * invariant. */
export type CharSet = readonly CodePointInterval[];

/** The highest valid Unicode code point (U+10FFFF). */
export const MAX_CODE_POINT = 0x10ffff;

/** The empty set: matches no code point. */
export const EMPTY_SET: CharSet = [];

/** The universal set: every code point in `[0, MAX_CODE_POINT]`. */
export const ALL_CHARS: CharSet = [{ lo: 0, hi: MAX_CODE_POINT }];

/**
 * Sorts and coalesces an arbitrary (possibly unsorted, possibly
 * overlapping) list of intervals into normalized form. Internal --
 * exported functions below only ever hand this already-normalized input
 * from `fromChar`/`fromCodePointRange`/other normalized `CharSet`s, so
 * callers of this module never need to call it directly.
 */
const normalize = (intervals: readonly CodePointInterval[]): CharSet => {
  if (intervals.length === 0) return EMPTY_SET;
  const sorted = [...intervals].sort((a, b) => a.lo - b.lo);
  const result: CodePointInterval[] = [];
  let current = sorted[0] as CodePointInterval;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i] as CodePointInterval;
    // `<= current.hi + 1`, not just `<= current.hi`, so touching
    // intervals (e.g. [0,9] and [10,19]) merge into one -- not just
    // overlapping ones -- keeping the normalized form as compact as the
    // input allows.
    if (next.lo <= current.hi + 1) {
      current = { lo: current.lo, hi: Math.max(current.hi, next.hi) };
    } else {
      result.push(current);
      current = next;
    }
  }
  result.push(current);
  return result;
};

/** A single-code-point `CharSet` from one grammar-source character (a JS
 * string of 1 UTF-16 code unit for BMP characters, 2 for astral ones --
 * `codePointAt` handles both correctly). */
export const fromChar = (c: string): CharSet => {
  const cp = c.codePointAt(0);
  return cp === undefined ? EMPTY_SET : [{ lo: cp, hi: cp }];
};

/** A single-interval `CharSet` from a grammar-source `[start-end]` range,
 * given as the two boundary characters (same encoding as `fromChar`). */
export const fromCodePointRange = (start: string, end: string): CharSet => {
  const lo = start.codePointAt(0);
  const hi = end.codePointAt(0);
  if (lo === undefined || hi === undefined || lo > hi) return EMPTY_SET;
  return [{ lo, hi }];
};

/** `true` iff the set matches no code point. */
export const isEmpty = (a: CharSet): boolean => a.length === 0;

/** `true` iff `cp` is a member of `a`. Binary search over the sorted,
 * non-overlapping intervals. */
export const contains = (a: CharSet, cp: number): boolean => {
  let lo = 0;
  let hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const interval = a[mid] as CodePointInterval;
    if (cp < interval.lo) hi = mid - 1;
    else if (cp > interval.hi) lo = mid + 1;
    else return true;
  }
  return false;
};

/** Set union: every code point in `a` or `b` (or both). */
export const union = (a: CharSet, b: CharSet): CharSet => {
  if (isEmpty(a)) return b;
  if (isEmpty(b)) return a;
  return normalize([...a, ...b]);
};

/** Set intersection: only code points in both `a` and `b`. Two-pointer
 * sweep over both sorted interval lists, O(|a| + |b|). */
export const intersect = (a: CharSet, b: CharSet): CharSet => {
  const result: CodePointInterval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as CodePointInterval;
    const y = b[j] as CodePointInterval;
    const lo = Math.max(x.lo, y.lo);
    const hi = Math.min(x.hi, y.hi);
    if (lo <= hi) result.push({ lo, hi });
    // Advance whichever interval ends first -- it can't overlap anything
    // further along in the other list.
    if (x.hi < y.hi) i++;
    else j++;
  }
  // Already sorted and non-overlapping by construction (each `hi` bound is
  // the min of two strictly-increasing-per-list bounds), so no `normalize`
  // needed here.
  return result;
};

/** Set complement relative to `[0, MAX_CODE_POINT]`: every code point NOT
 * in `a`. This is the operation the old `{chars, ranges}` representation
 * couldn't express, which is why a negated character class (`[^...]`) had
 * to bail to `unknown` -- see `first-sets.ts`. */
export const complement = (a: CharSet): CharSet => {
  if (isEmpty(a)) return ALL_CHARS;
  const result: CodePointInterval[] = [];
  let cursor = 0;
  for (const { lo, hi } of a) {
    if (lo > cursor) result.push({ lo: cursor, hi: lo - 1 });
    cursor = hi + 1;
  }
  if (cursor <= MAX_CODE_POINT) {
    result.push({ lo: cursor, hi: MAX_CODE_POINT });
  }
  return result;
};

/** Set difference: code points in `a` but not in `b` (`a \ b`). */
export const difference = (a: CharSet, b: CharSet): CharSet =>
  intersect(a, complement(b));

/**
 * `true` iff `a` and `b` share no code point. Implemented as a direct
 * two-pointer sweep (not `isEmpty(intersect(a, b))`) so a disjointness
 * check never has to materialize the intersection.
 */
export const isDisjoint = (a: CharSet, b: CharSet): boolean => {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as CodePointInterval;
    const y = b[j] as CodePointInterval;
    if (x.lo <= y.hi && y.lo <= x.hi) return false;
    if (x.hi < y.hi) i++;
    else j++;
  }
  return true;
};

/**
 * Renders `set` back into the AST's `CharRange[]` shape (`{start, end?}`,
 * single-character strings) -- the inverse of `fromChar`/
 * `fromCodePointRange`, used to synthesize a `CharacterClass` node from a
 * computed set (see `ast-optimize-negative-lookahead.ts`'s generalized
 * `!a b` rewrite). A single-code-point interval (`lo === hi`) omits
 * `end`, matching how a plain grammar-source character is written
 * (`{start: c}`, no `end`) -- not required for correctness (an `end`
 * equal to `start` would mean the same thing), just keeps synthesized
 * output indistinguishable from what a human would have written.
 */
export const toCharRanges = (set: CharSet): CharRange[] =>
  set.map(({ lo, hi }) =>
    lo === hi
      ? { start: String.fromCodePoint(lo) }
      : { start: String.fromCodePoint(lo), end: String.fromCodePoint(hi) },
  );
