import { describe, expect, it } from "vite-plus/test";
import { anyChar, literal } from "./basic";
import {
  capture,
  captureChoice,
  captureSequence,
  untagCapture,
} from "./capture";
import { charClass, charClassRun, negatedCharClass } from "./char-class";
import {
  choice,
  commit,
  lazy,
  maybe,
  predictiveChoice,
  reject,
  sequence,
  withDefault,
} from "./combinators";
import { FAIL, fail, resetFailureWatermark } from "./failure";
import { andPredicate, notPredicate } from "./lookahead";
import type { Parser } from "./types";
import { regexFused, regexFusedMap } from "./regex-fused";
import { oneOrMore, optional, quantified, zeroOrMore } from "./repetition";
import { filter, map } from "./transform";
import { isValidOffset } from "./utils";

/**
 * The `Parser` position contract: `pos` is a UTF-16 code-unit offset into
 * `input`, so the only legal positions are the integers `0..input.length`
 * inclusive (the end itself, where only an empty match can succeed).
 * Everything else -- negative, fractional, `NaN`, `Infinity`, or `>= 2**32`
 * (beyond every possible string length) -- is outside the contract, and
 * every leaf parser must FAIL on it rather than let raw string operations
 * coerce it into a real index:
 *
 * - `input.startsWith(str, -1)` and `RegExp.lastIndex = -1` CLAMP the index
 *   to 0, so `literal`/`regexFused` used to "match" a character that was
 *   never at `pos` and report `{ current: -1, next: 0 }`.
 * - `input.charCodeAt(0.5)` TRUNCATES to index 0, and `(2**32) >>> 0`
 *   wraps to 0, so `anyChar`/`charClass` used to return bogus successes
 *   like `{ current: 0.5, next: 1.5 }` or `{ current: 2**32 }`.
 * - `NaN` slipped through every one of those coercions and, worst of all,
 *   produced `next = NaN` -- which made `zeroOrMore`'s
 *   `result.next === currentPos` loop guard (`NaN === NaN` is false)
 *   loop forever. The guard is now `!(result.next > currentPos)`, so a
 *   `NaN` or backwards `next` is flagged as the same zero-progress
 *   violation instead.
 */
describe("position contract: out-of-contract pos always fails", () => {
  const input = "aBcあ";
  /** Every position outside `0..input.length`: the two clamp/truncate
   * cases that used to produce wrong matches, plus the wraparound and
   * non-finite cases that produced bogus or hanging behavior. */
  const invalidPositions: [string, number][] = [
    ["-1", -1],
    ["-0.5", -0.5],
    ["0.5", 0.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["input.length + 1", input.length + 1],
    ["2**32 (>>>0 wraps to 0)", 2 ** 32],
    ["2**31 + 0.5", 2 ** 31 + 0.5],
  ];

  const leafParsers: [string, Parser<unknown>][] = [
    ["anyChar", anyChar()],
    ["literal (ascii path)", literal("a")],
    ["literal (unicode path)", literal("あ")],
    ["charClass", charClass(["a", "z"])],
    ["negatedCharClass", negatedCharClass(["a", "z"])],
    ["charClassRun min=0", charClassRun([["a", "z"]], 0)],
    ["charClassRun min=1", charClassRun([["a", "z"]], 1)],
    ["regexFused", regexFused("[a-z]", "lower")],
    ["regexFusedMap", regexFusedMap("[a-z]", "lower", (m) => m[0])],
  ];

  for (const [name, parser] of leafParsers) {
    for (const [label, pos] of invalidPositions) {
      it(`${name} fails at pos = ${label}`, () => {
        const result = parser(input, pos);
        expect(result.success).toBe(false);
      });
    }
  }

  it("accepts -0 as 0 (same index slot)", () => {
    const result = literal("a")(input, -0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toBe(1);
    }
  });

  it("still lets an empty-match-capable regexFused match at pos === input.length", () => {
    const result = regexFused("a*", "a-star")("bbb", 3);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.text).toBe("");
      expect(result.next).toBe(3);
    }
  });

  it("charClassRun min=0 still returns an empty run at pos === input.length", () => {
    const result = charClassRun([["a", "z"]], 0)("abc", 3);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toBe(3);
    }
  });
});

describe("position contract: isValidOffset", () => {
  const valid = [0, 1, -0, 42, 2 ** 31, 2 ** 32 - 1];
  const invalid = [
    -1,
    -0.5,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    2 ** 32,
    1e21,
  ];

  for (const pos of valid) {
    it(`accepts ${pos}`, () => {
      expect(isValidOffset(pos)).toBe(true);
    });
  }
  for (const pos of invalid) {
    it(`rejects ${pos}`, () => {
      expect(isValidOffset(pos)).toBe(false);
    });
  }
});

describe("position contract: repetition loops cannot hang on a bad next", () => {
  // A child whose `next` never advances used to slip past the
  // `result.next === currentPos` guard whenever `next` was `NaN`
  // (`NaN === NaN` is false) -- `zeroOrMore(literal("a"))(input, NaN)`
  // hung forever, because `literal` at `NaN` kept "succeeding" via
  // `startsWith`'s index coercion. Two independent fixes now make this
  // impossible: every leaf rejects an out-of-contract `pos`, and the
  // loop guard is `!(result.next > currentPos)` -- no assumption that
  // `next` is a real, comparable number at all.
  it("zeroOrMore at pos = NaN fails rather than echoing a bogus empty run", () => {
    const result = zeroOrMore(literal("a"))("aBc", Number.NaN);
    expect(result.success).toBe(false);
  });

  it("oneOrMore at pos = NaN fails rather than hanging", () => {
    const result = oneOrMore(literal("a"))("aBc", Number.NaN);
    expect(result.success).toBe(false);
  });

  it("quantified at pos = NaN fails rather than echoing a bogus empty run", () => {
    const result = quantified(literal("a"), 0)("aBc", Number.NaN);
    expect(result.success).toBe(false);
  });

  it("zeroOrMore flags a zero-width child as a fatal infinite-loop error", () => {
    const result = zeroOrMore(optional(literal("a")))("bbb", 0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fatal).toBe(true);
    }
  });

  it("zeroOrMore flags a child whose next goes BACKWARDS (not just zero-width)", () => {
    // `next < currentPos` violates the `next > current` success
    // invariant; `next === currentPos` alone would have let it loop.
    const backwards: Parser<string> = (_input, p) => ({
      success: true,
      val: "x",
      current: p,
      next: p - 1,
    });
    const result = zeroOrMore(backwards)("abc", 2);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fatal).toBe(true);
    }
  });

  it("zeroOrMore flags a child whose next is NaN", () => {
    const nanNext: Parser<string> = (_input, p) => ({
      success: true,
      val: "x",
      current: p,
      next: Number.NaN,
    });
    const result = zeroOrMore(nanNext)("abc", 0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fatal).toBe(true);
    }
  });

  it("oneOrMore flags a backwards next identically", () => {
    const backwards: Parser<string> = (_input, p) => ({
      success: true,
      val: "x",
      current: p,
      next: p - 1,
    });
    const result = oneOrMore(backwards)("abc", 2);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fatal).toBe(true);
    }
  });

  it("a sequence containing an invalid-pos call propagates the leaf failure", () => {
    const result = sequence(literal("a"), literal("B"))("aBc", 0.5);
    expect(result.success).toBe(false);
  });
});

describe("position contract: combinators reject out-of-contract pos", () => {
  const input = "aab";
  /** Same invalid-offset table as the leaf-parser block above. */
  const invalidPositions: [string, number][] = [
    ["-1", -1],
    ["-0.5", -0.5],
    ["0.5", 0.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["input.length + 1", input.length + 1],
    ["2**32 (>>>0 wraps to 0)", 2 ** 32],
  ];

  // Combinators that can produce a ZERO-WIDTH success without any child
  // ever having consumed input -- the "no match -> empty" branch of
  // `optional`/`zeroOrMore`/`quantified`/`withDefault`, a successful
  // `!e`/`reject` probe, an empty `sequence`/`captureSequence`. Each of
  // these used to echo an invalid `pos` straight back as
  // `{ current: pos, next: pos }`.
  const combinators: [string, Parser<unknown>][] = [
    ["optional", optional(literal("a"))],
    ["zeroOrMore", zeroOrMore(literal("a"))],
    ["oneOrMore", oneOrMore(literal("a"))],
    ["quantified (min 1)", quantified(literal("a"), 1, 3)],
    ["quantified (min 0)", quantified(literal("a"), 0, 3)],
    ["sequence (non-empty)", sequence(literal("a"), literal("b"))],
    ["sequence (empty)", sequence()],
    [
      "captureSequence (non-empty)",
      captureSequence(capture("k", literal("a"))),
    ],
    ["captureSequence (empty)", captureSequence()],
    ["choice", choice(literal("a"), literal("b"))],
    [
      "predictiveChoice",
      predictiveChoice([
        [literal("a"), null],
        [literal("b"), null],
      ]),
    ],
    ["andPredicate", andPredicate(literal("a"))],
    ["notPredicate", notPredicate(literal("a"))],
    ["reject", reject(literal("a"))],
    ["withDefault", withDefault(literal("a"), "x")],
    ["maybe", maybe(literal("a"))],
    ["commit", commit(literal("a"))],
    ["capture", capture("k", literal("a"))],
    ["captureChoice", captureChoice(literal("a"), literal("b"))],
    ["untagCapture", untagCapture(literal("a"))],
    ["lazy", lazy(() => literal("a"))],
    ["map", map(literal("a"), (v) => v)],
    ["filter", filter(literal("a"), () => true, "rejected")],
  ];

  for (const [name, parser] of combinators) {
    for (const [label, pos] of invalidPositions) {
      it(`${name} fails at pos = ${label}`, () => {
        const result = parser(input, pos);
        expect(result.success).toBe(false);
      });
    }
  }

  it("optional still returns [] on a legitimate non-match at pos === input.length", () => {
    const result = optional(literal("a"))(input, input.length);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toBe(input.length);
    }
  });

  it("zeroOrMore still returns [] on a legitimate empty run at pos === input.length", () => {
    const result = zeroOrMore(literal("a"))(input, input.length);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toBe(input.length);
    }
  });

  it("notPredicate still succeeds at pos === input.length (EOF probe)", () => {
    const result = notPredicate(literal("a"))(input, input.length);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toBe(input.length);
    }
  });

  it("withDefault still returns its default at pos === input.length", () => {
    const result = withDefault(literal("a"), "x")(input, input.length);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("x");
      expect(result.next).toBe(input.length);
    }
  });

  it("an empty sequence still succeeds at pos === input.length", () => {
    const result = sequence()(input, input.length);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toBe(input.length);
    }
  });
});

describe("position contract: farthest-failure watermark cannot be poisoned by an invalid pos", () => {
  // `fail()` records `pos` verbatim into the shared farthest-failure
  // watermark; before the guard inside `fail()` itself, a leaf invoked at
  // `pos = Infinity` (which satisfies `pos > watermarkPos` for any real
  // watermark) pinned every later error materialized on that input to
  // `Infinity` -- an offset no formatter can map back to a location.
  it("a fail() at pos = Infinity does not pin the watermark to Infinity", () => {
    resetFailureWatermark();
    fail("abc", Number.POSITIVE_INFINITY, { label: "x" });
    fail("abc", 1, { label: "real" });
    expect(FAIL.error.pos).toBe(1);
  });

  it("a fail() at pos = NaN does not land in the watermark on a fresh input", () => {
    resetFailureWatermark();
    fail("abc", Number.NaN, { label: "x" });
    fail("abc", 2, { label: "real" });
    expect(FAIL.error.pos).toBe(2);
  });

  it("a fail() past input.length is not recorded", () => {
    resetFailureWatermark();
    fail("abc", 100, { label: "x" });
    fail("abc", 0, { label: "real" });
    expect(FAIL.error.pos).toBe(0);
  });

  it("a fail() at pos === input.length is still recorded (end of input)", () => {
    resetFailureWatermark();
    fail("abc", 3, { label: "x" });
    expect(FAIL.error.pos).toBe(3);
    expect(FAIL.error.found).toBe("end of input");
  });
});
