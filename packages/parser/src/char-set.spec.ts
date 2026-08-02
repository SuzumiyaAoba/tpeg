import { describe, expect, it } from "bun:test";
import {
  ALL_CHARS,
  type CharSet,
  EMPTY_SET,
  MAX_CODE_POINT,
  complement,
  contains,
  difference,
  fromChar,
  fromCodePointRange,
  intersect,
  isDisjoint,
  isEmpty,
  union,
} from "./char-set";

/** Asserts `a` is normalized: sorted, non-overlapping, non-adjacent. */
const assertNormalized = (a: CharSet): void => {
  for (let i = 1; i < a.length; i++) {
    const prev = a[i - 1] as { lo: number; hi: number };
    const cur = a[i] as { lo: number; hi: number };
    expect(prev.lo).toBeLessThanOrEqual(prev.hi);
    // Strictly more than one code point of gap between entries -- i.e.
    // not overlapping and not touching (which normalize would merge).
    expect(cur.lo).toBeGreaterThan(prev.hi + 1);
  }
  if (a.length > 0) {
    const last = a[a.length - 1] as { lo: number; hi: number };
    expect(last.lo).toBeLessThanOrEqual(last.hi);
  }
};

const digits = fromCodePointRange("0", "9");
const lower = fromCodePointRange("a", "z");
const upper = fromCodePointRange("A", "Z");
const astral = fromCodePointRange("\u{1F600}", "\u{1F64F}"); // emoji range

describe("char-set algebra", () => {
  it("union is normalized and commutative", () => {
    assertNormalized(union(digits, lower));
    expect(union(digits, lower)).toEqual(union(lower, digits));
  });

  it("union of adjacent ranges merges into one interval", () => {
    const a = fromCodePointRange("a", "m");
    const b = fromCodePointRange("n", "z");
    const merged = union(a, b);
    expect(merged).toEqual([
      { lo: "a".codePointAt(0) as number, hi: "z".codePointAt(0) as number },
    ]);
  });

  it("complement of complement is the identity (¬¬a = a)", () => {
    expect(complement(complement(digits))).toEqual(digits);
    expect(complement(complement(EMPTY_SET))).toEqual(EMPTY_SET);
    expect(complement(complement(astral))).toEqual(astral);
  });

  it("a union with its own complement is the universal set (a ∪ ¬a = ⊤)", () => {
    assertNormalized(union(digits, complement(digits)));
    expect(union(digits, complement(digits))).toEqual(ALL_CHARS);
  });

  it("a intersected with its own complement is empty (a ∩ ¬a = ∅)", () => {
    expect(intersect(digits, complement(digits))).toEqual(EMPTY_SET);
  });

  it("complement of the universal set is empty, and vice versa", () => {
    expect(complement(ALL_CHARS)).toEqual(EMPTY_SET);
    expect(complement(EMPTY_SET)).toEqual(ALL_CHARS);
  });

  it("isDisjoint(a,b) iff isEmpty(a ∩ b)", () => {
    const cases: readonly [CharSet, CharSet][] = [
      [digits, lower],
      [digits, digits],
      [lower, upper],
      [union(digits, lower), union(lower, upper)],
      [EMPTY_SET, digits],
      [ALL_CHARS, digits],
      [astral, digits],
    ];
    for (const [a, b] of cases) {
      expect(isDisjoint(a, b)).toBe(isEmpty(intersect(a, b)));
    }
  });

  it("difference: a \\ a is empty, a \\ ∅ is a", () => {
    expect(difference(digits, digits)).toEqual(EMPTY_SET);
    expect(difference(digits, EMPTY_SET)).toEqual(digits);
  });

  it("difference matches complement-then-intersect by construction", () => {
    const withoutVowels = difference(
      lower,
      union(fromChar("a"), fromChar("e")),
    );
    expect(contains(withoutVowels, "a".codePointAt(0) as number)).toBe(false);
    expect(contains(withoutVowels, "b".codePointAt(0) as number)).toBe(true);
  });

  it("contains agrees with set membership across union/intersect/complement", () => {
    const s = union(digits, astral);
    expect(contains(s, "5".codePointAt(0) as number)).toBe(true);
    expect(contains(s, "a".codePointAt(0) as number)).toBe(false);
    expect(contains(s, 0x1f600)).toBe(true);
    expect(contains(complement(s), "a".codePointAt(0) as number)).toBe(true);
    expect(contains(complement(s), "5".codePointAt(0) as number)).toBe(false);
  });

  it("fromChar and fromCodePointRange handle astral (surrogate-pair) characters correctly", () => {
    const face = fromChar("\u{1F600}");
    expect(contains(face, 0x1f600)).toBe(true);
    expect(isDisjoint(face, digits)).toBe(true);
    assertNormalized(astral);
    expect(contains(astral, 0x1f600)).toBe(true);
    expect(contains(astral, 0x1f64f)).toBe(true);
    expect(contains(astral, 0x1f650)).toBe(false);
  });

  it("union/intersect/complement/difference all preserve normalization on nontrivial inputs", () => {
    const a = union(union(digits, lower), astral);
    const b = union(upper, fromCodePointRange("5", "9"));
    assertNormalized(union(a, b));
    assertNormalized(intersect(a, b));
    assertNormalized(complement(a));
    assertNormalized(difference(a, b));
  });

  it("MAX_CODE_POINT is the upper bound of the universal set", () => {
    expect(ALL_CHARS).toEqual([{ lo: 0, hi: MAX_CODE_POINT }]);
  });
});
