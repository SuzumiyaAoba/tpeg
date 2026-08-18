import { beforeEach, describe, expect, it } from "bun:test";
import { literal as lit } from "./basic";
import { charClass } from "./char-class";
import { choice, commit, seq, withDefault } from "./combinators";
import { resetFailureWatermark } from "./failure";
import {
  oneOrMore,
  opt,
  optional,
  plus,
  quantified,
  star,
  zeroOrMore,
} from "./repetition";
import type { Parser } from "./types";
import { isFailure, isSuccess } from "./utils";

// See `combinators.spec.ts`'s identical `beforeEach` -- the farthest-failure
// watermark (`./failure.ts`) is module-global, keyed by input string VALUE.
beforeEach(() => {
  resetFailureWatermark();
});

describe("opt", () => {
  it("should parse with the given parser", () => {
    const input = "a";
    const pos = 0;
    const result = opt(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a"]);
      expect(result.next).toBe(1);
    }
  });

  it("should return empty array and not consume input if parser fails", () => {
    const input = "b";
    const pos = 0;
    const result = opt(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toEqual(pos);
    }
  });
});

describe("star", () => {
  it("should parse zero or more occurrences", () => {
    const input = "aaa";
    const pos = 0;
    const result = star(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a", "a"]);
      expect(result.next).toBe(3);
    }
  });

  it("should return empty array if parser never matches", () => {
    const input = "b";
    const pos = 0;
    const result = star(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toEqual(pos);
    }
  });
});

describe("plus", () => {
  it("should parse one or more occurrences", () => {
    const input = "aaa";
    const pos = 0;
    const result = plus(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a", "a"]);
      expect(result.next).toBe(3);
    }
  });

  it("should return error if parser never matches", () => {
    const input = "b";
    const pos = 0;
    const result = plus(lit("a"))(input, pos);
    expect(result.success).toBe(false);
  });
});

describe("optional", () => {
  it("should be an alias for opt", () => {
    const input = "a";
    const pos = 0;
    const result = optional(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a"]);
      expect(result.next).toBe(1);
    }
  });
});

describe("zeroOrMore", () => {
  it("should be an alias for star", () => {
    const input = "aaa";
    const pos = 0;
    const result = zeroOrMore(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a", "a"]);
      expect(result.next).toBe(3);
    }
  });
});

describe("oneOrMore", () => {
  it("should be an alias for plus", () => {
    const input = "aaa";
    const pos = 0;
    const result = oneOrMore(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a", "a"]);
      expect(result.next).toBe(3);
    }
  });
});

describe("fatal (cut/commit) propagation", () => {
  it("optional re-raises a fatal failure instead of matching zero times", () => {
    // No Choice sits between the cut and this `optional` -- `commit`'s
    // `fatal` marker reaches `optional` unchanged, and this is exactly
    // the case `optional`/`zeroOrMore`/`oneOrMore`/`quantified`'s
    // re-raise logic (repetition.ts) exists for: once a cut has fired
    // inside the wrapped parser, a subsequent failure must be a real
    // error, not silently treated as "the optional part just isn't
    // here."
    const input = "ax";
    const pos = 0;
    const parser = seq(lit("a"), commit(lit("b")));
    const result = optional(parser)(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fatal).toBe(true);
    }
  });

  // The three tests below wrap the committed parser in a `choice(...)`
  // -- unlike the `optional` case above, there IS a Choice directly
  // between the cut and the repetition combinator. `choice` now absorbs
  // `fatal` at its own boundary instead of forwarding it (see
  // `combinators.ts`'s `choice` doc comment): a cut protects only the
  // choice it's directly inside, never anything that choice's own
  // result gets returned to next, whether that's an enclosing choice
  // (the bug this fixed -- see `combinators.spec.ts`'s "does not try the
  // next alternative..." test) or, as here, a repetition wrapping the
  // choice.
  //
  // Consequence, stated plainly: `(choice("b" ~ "c", "a"))*` no longer
  // hard-fails when an iteration commits via "b" and then fails on "c"
  // -- the repetition sees an ordinary (non-fatal) failed iteration and
  // stops gracefully, returning success with whatever it already
  // matched. This is usually caught downstream by whatever follows the
  // repetition (an EOF check, a required terminator) reporting "expected
  // end of input" instead of a more specific "malformed X" message; a
  // repetition with nothing after it to enforce full consumption would
  // silently accept a shorter match. That tradeoff is inherent to a
  // single `fatal` boolean with no notion of which choice a cut belongs
  // to -- making it caller-aware would need scope information threaded
  // through the whole combinator API, well beyond what this fix does.

  it("zeroOrMore stops gracefully (does not hard-fail) once fatal is absorbed by an inner choice", () => {
    const input = "aabx";
    const pos = 0;
    const parser = choice(seq(lit("b"), commit(lit("c"))), lit("a"));
    const result = zeroOrMore(parser)(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a"]);
      expect(result.next).toBe(2);
    }
  });

  it("oneOrMore stops gracefully (does not hard-fail) once fatal is absorbed by an inner choice", () => {
    const input = "aabx";
    const pos = 0;
    const parser = choice(seq(lit("b"), commit(lit("c"))), lit("a"));
    const result = oneOrMore(parser)(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a"]);
      expect(result.next).toBe(2);
    }
  });

  it("quantified stops gracefully (does not hard-fail) once fatal is absorbed by an inner choice", () => {
    const input = "aabx";
    const pos = 0;
    const parser = choice(seq(lit("b"), commit(lit("c"))), lit("a"));
    const result = quantified(parser, 0)(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a"]);
      expect(result.next).toBe(2);
    }
  });
});

// Additional tests - edge cases and misuse scenarios
describe("repetition edge cases", () => {
  // Test for infinite loop detection
  it("should detect infinite loops in zeroOrMore", () => {
    // Parser that always returns the same position
    const infiniteParser: Parser<string> = (_input, pos) => ({
      success: true,
      val: "",
      current: pos,
      next: pos, // Does not consume input
    });

    const parser = zeroOrMore(infiniteParser);
    const result = parser("test", 0);

    expect(isFailure(result)).toBe(true);
    if (!isSuccess(result)) {
      expect(result.error.message).toContain("Infinite loop detected");
    }
  });

  it("should detect infinite loops in oneOrMore", () => {
    // Parser that always returns the same position
    const infiniteParser: Parser<string> = (_input, pos) => ({
      success: true,
      val: "",
      current: pos,
      next: pos, // Does not consume input
    });

    const parser = oneOrMore(infiniteParser);
    const result = parser("test", 0);

    // First match succeeds, but second and subsequent would cause infinite loop
    expect(isFailure(result)).toBe(true);
    if (!isSuccess(result)) {
      expect(result.error.message).toContain("Infinite loop detected");
    }
  });

  // 新しいテストケース：空文字列の処理
  it("should handle empty input correctly", () => {
    const input = "";
    const pos = 0;

    // optional should return empty array
    const optResult = opt(lit("a"))(input, pos);
    expect(optResult.success).toBe(true);
    if (optResult.success) {
      expect(optResult.val).toEqual([]);
      expect(optResult.next).toEqual(pos);
    }

    // zeroOrMore should return empty array
    const starResult = star(lit("a"))(input, pos);
    expect(starResult.success).toBe(true);
    if (starResult.success) {
      expect(starResult.val).toEqual([]);
      expect(starResult.next).toEqual(pos);
    }

    // oneOrMore should fail
    const plusResult = plus(lit("a"))(input, pos);
    expect(plusResult.success).toBe(false);
    if (!plusResult.success) {
      expect(plusResult.error.message).toContain("end of input");
    }
  });

  // 新しいテストケース：エラーメッセージの品質確認
  // `./failure.ts` の大域ウォーターマーク導入以降、`oneOrMore` は最初の失敗を
  // 「in oneOrMore」で包み直さず、子パーサー自身の失敗をそのまま返す
  // （`fail()` が既に大域ウォーターマークへ記録済みのため）。
  it("should provide meaningful error messages for oneOrMore failures", () => {
    const input = "xyz";
    const pos = 0;
    const result = plus(lit("a"))(input, pos);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Expected "a", found "x"');
      expect(result.error.pos).toBe(0);
    }
  });

  // 新しいテストケース：位置情報の正確性確認
  it("should maintain correct position information", () => {
    const input = "abcdef";
    const pos = 2;

    // Position should be maintained correctly
    const result = zeroOrMore(lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["c"]);
      expect(result.current).toEqual(pos);
      expect(result.next).toBe(3);
    }
  });

  // 新しいテストケース：複雑なネストしたパターン
  it("should handle deeply nested repetitions", () => {
    // Pattern: zero or more groups of (one or more 'a' followed by optional 'b')
    const groupParser = seq(oneOrMore(lit("a")), optional(lit("b")));
    const parser = zeroOrMore(groupParser);

    const result = parser("aaabaaab", 0);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.val).toEqual([
        [["a", "a", "a"], ["b"]],
        [["a", "a", "a"], ["b"]],
      ]);
    }
  });

  // 新しいテストケース：NonEmptyArray型の型安全性確認
  it("should ensure type safety for NonEmptyArray", () => {
    const input = "aaa";
    const pos = 0;
    const result = oneOrMore(lit("a"))(input, pos);

    expect(result.success).toBe(true);
    if (result.success) {
      // TypeScriptの型システムによりNonEmptyArrayであることが保証される
      expect(result.val.length).toBeGreaterThan(0);
      expect(result.val[0]).toBe("a");
    }
  });

  // 新しいテストケース：パフォーマンス関連
  it("should handle large inputs efficiently", () => {
    const largeInput = "a".repeat(1000);
    const pos = 0;

    const startTime = performance.now();
    const result = zeroOrMore(lit("a"))(largeInput, pos);
    const endTime = performance.now();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.length).toBe(1000);
      // 1秒以内に完了することを確認（合理的なパフォーマンス期待）
      expect(endTime - startTime).toBeLessThan(1000);
    }
  });

  // 新しいテストケース：複数行の処理
  it("should handle multiline input correctly", () => {
    const input = "a\na\na";
    const pos = 0;

    // Should parse first 'a' only (literal doesn't cross lines)
    const result = zeroOrMore(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a"]);
      expect(result.next).toBe(1);
    }
  });

  it("should handle sequences of repetitions", () => {
    // Pattern with sequence of digits followed by sequence of letters
    const digitParser = charClass(["0", "9"]);
    const letterParser = charClass(["a", "z"]);

    const parser = seq(oneOrMore(digitParser), oneOrMore(letterParser));
    const result = parser("123abc", 0);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.val).toEqual([
        ["1", "2", "3"],
        ["a", "b", "c"],
      ]);
    }
  });

  it("should handle optional parser with nested structure", () => {
    // Optional nested structure
    const innerParser = seq(lit("("), lit(")"));
    const parser = optional(innerParser);

    // Matching case
    const result1 = parser("()", 0);
    expect(isSuccess(result1)).toBe(true);
    if (isSuccess(result1)) {
      expect(result1.val).toEqual([["(", ")"]]);
    }

    // Non-matching case
    const result2 = parser("x", 0);
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result2)) {
      expect(result2.val).toEqual([]);
    }
  });

  it("should handle complex zeroOrMore patterns", () => {
    // Complex zeroOrMore: zero or more repetitions of (digit+letter)
    const pattern = seq(charClass(["0", "9"]), charClass(["a", "z"]));

    const parser = zeroOrMore(pattern);

    // Multiple match case
    const result1 = parser("1a2b3c", 0);
    expect(isSuccess(result1)).toBe(true);
    if (isSuccess(result1)) {
      expect(result1.val).toEqual([
        ["1", "a"],
        ["2", "b"],
        ["3", "c"],
      ]);
    }

    // Non-matching case
    const result2 = parser("xyz", 0);
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result2)) {
      expect(result2.val).toEqual([]);
    }
  });

  it("should test the boundary between opt and zeroOrMore", () => {
    // Test the difference between optional (0 or 1) and zeroOrMore (0 or more)
    const charA = lit("a");
    const optParser = optional(charA);
    const zeroOrMoreParser = zeroOrMore(charA);

    // For a single character
    const resultOpt1 = optParser("a", 0);
    const resultZeroOrMore1 = zeroOrMoreParser("a", 0);

    expect(isSuccess(resultOpt1)).toBe(true);
    expect(isSuccess(resultZeroOrMore1)).toBe(true);
    if (isSuccess(resultOpt1) && isSuccess(resultZeroOrMore1)) {
      expect(resultOpt1.val).toEqual(["a"]);
      expect(resultZeroOrMore1.val).toEqual(["a"]);
    }

    // For multiple characters
    const resultOpt2 = optParser("aaa", 0);
    const resultZeroOrMore2 = zeroOrMoreParser("aaa", 0);

    expect(isSuccess(resultOpt2)).toBe(true);
    expect(isSuccess(resultZeroOrMore2)).toBe(true);
    if (isSuccess(resultOpt2) && isSuccess(resultZeroOrMore2)) {
      // optional matches at most once
      expect(resultOpt2.val).toEqual(["a"]);
      expect(resultOpt2.next).toBe(1);

      // zeroOrMore matches as much as possible
      expect(resultZeroOrMore2.val).toEqual(["a", "a", "a"]);
      expect(resultZeroOrMore2.next).toBe(3);
    }
  });
});

describe("quantified", () => {
  it("should parse exactly n times", () => {
    const parser = quantified(lit("a"), 3, 3);
    const result = parser("aaa", 0);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.val).toEqual(["a", "a", "a"]);
      expect(result.next).toBe(3);
    }
  });

  it("should parse range {n,m}", () => {
    const parser = quantified(lit("a"), 2, 4);

    // Test minimum case
    const result1 = parser("aa", 0);
    expect(isSuccess(result1)).toBe(true);
    if (isSuccess(result1)) {
      expect(result1.val).toEqual(["a", "a"]);
    }

    // Test middle case
    const result2 = parser("aaa", 0);
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result2)) {
      expect(result2.val).toEqual(["a", "a", "a"]);
    }

    // Test maximum case
    const result3 = parser("aaaa", 0);
    expect(isSuccess(result3)).toBe(true);
    if (isSuccess(result3)) {
      expect(result3.val).toEqual(["a", "a", "a", "a"]);
    }

    // Test beyond maximum (should stop at max)
    const result4 = parser("aaaaa", 0);
    expect(isSuccess(result4)).toBe(true);
    if (isSuccess(result4)) {
      expect(result4.val).toEqual(["a", "a", "a", "a"]);
      expect(result4.next).toBe(4); // Should not consume the 5th 'a'
    }
  });

  it("should parse minimum {n,} (unbounded)", () => {
    const parser = quantified(lit("a"), 2);

    // Test minimum case
    const result1 = parser("aa", 0);
    expect(isSuccess(result1)).toBe(true);
    if (isSuccess(result1)) {
      expect(result1.val).toEqual(["a", "a"]);
    }

    // Test many repetitions
    const result2 = parser("aaaaaa", 0);
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result2)) {
      expect(result2.val).toEqual(["a", "a", "a", "a", "a", "a"]);
    }
  });

  it("should handle zero minimum {0,n}", () => {
    const parser = quantified(lit("a"), 0, 3);

    // Test no matches
    const result1 = parser("b", 0);
    expect(isSuccess(result1)).toBe(true);
    if (isSuccess(result1)) {
      expect(result1.val).toEqual([]);
    }

    // Test some matches
    const result2 = parser("aa", 0);
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result2)) {
      expect(result2.val).toEqual(["a", "a"]);
    }
  });

  it("should fail if minimum not met", () => {
    const parser = quantified(lit("a"), 3, 5);

    // Test insufficient matches. `quantified`'s required-repetition loop
    // now relays the child's failure UNCHANGED (see `./failure.ts`'s
    // watermark) instead of wrapping it with its own message/parserName --
    // the failure is `lit("a")`'s own.
    const result1 = parser("aa", 0);
    expect(isFailure(result1)).toBe(true);
    if (isFailure(result1)) {
      // Should fail when trying to parse 3rd "a" but only 2 available
      expect(result1.error.message).toContain("end of input");
      expect(result1.error.parserName).toBe("literal");
    }

    // Test no matches
    const result2 = parser("b", 0);
    expect(isFailure(result2)).toBe(true);
    if (isFailure(result2)) {
      // Should fail when trying to parse 1st "a" but got "b"
      expect(result2.error.message).toBe('Expected "a", found "b"');
      expect(result2.error.parserName).toBe("literal");
    }
  });

  it("should report the child parser's failure position, not the repetition's start", () => {
    // Repetition 1 matches "abc" at offset 0-3. Repetition 2 (required)
    // starts at offset 3 but the mismatch inside it ("aXc" vs "abc") is at
    // offset 4, one character into that repetition -- the reported position
    // should point at the actual mismatch, not the repetition's start.
    const parser = quantified(lit("abc"), 2);
    const result = parser("abcaXc", 0);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.pos).toBe(4);
    }
  });

  it("should validate parameters at construction time", () => {
    // An invalid range is a grammar authoring error, not a parse failure,
    // so it is reported eagerly when the parser is built.
    expect(() => quantified(lit("a"), -1, 3)).toThrow(
      "minimum (-1) cannot be negative",
    );

    expect(() => quantified(lit("a"), 5, 3)).toThrow(
      "maximum (3) cannot be less than minimum (5)",
    );
  });

  it("should detect infinite loops when the tail is genuinely unbounded (`max` omitted)", () => {
    // Parser that always succeeds but consumes no input
    const infiniteParser: Parser<string> = (_input, pos) => ({
      success: true,
      val: "",
      current: pos,
      next: pos, // Does not advance position
    });

    // No `max` -- the optional tail loops until `Number.POSITIVE_INFINITY`,
    // exactly the shape `zeroOrMore`/`oneOrMore` guard against.
    const parser = quantified(infiniteParser, 1);
    const result = parser("test", 0);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.message).toContain("Infinite loop detected");
    }
  });

  it("should succeed (not report an infinite loop) for a BOUNDED repetition over a zero-width match", () => {
    // A concrete `max` makes this loop's iteration count fixed by
    // construction (bounded by the `for` loop's own counter), so a
    // zero-width match is a legitimate `e{n,m}` result over a nullable
    // `e`, per standard PEG semantics -- not an infinite-loop error. This
    // is also exactly what TPEG's own `{n,m}` grammar syntax compiles a
    // bounded repetition of a nullable expression (e.g. `("a"?){2,3}`)
    // down to (see `codegen.ts`'s `generateQuantified`).
    const zeroWidthParser: Parser<string> = (_input, pos) => ({
      success: true,
      val: "",
      current: pos,
      next: pos, // Does not advance position
    });

    const requiredOnly = quantified(zeroWidthParser, 2, 2);
    const result1 = requiredOnly("test", 0);
    expect(isSuccess(result1)).toBe(true);
    if (isSuccess(result1)) {
      expect(result1.val).toEqual(["", ""]);
      expect(result1.next).toBe(0);
    }

    const requiredPlusBoundedOptional = quantified(zeroWidthParser, 1, 3);
    const result2 = requiredPlusBoundedOptional("test", 0);
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result2)) {
      expect(result2.val).toEqual(["", "", ""]);
      expect(result2.next).toBe(0);
    }
  });

  it("should be equivalent to existing parsers for special cases", () => {
    // {0,} should be equivalent to zeroOrMore
    const quantifiedParser = quantified(lit("a"), 0);
    const zeroOrMoreParser = zeroOrMore(lit("a"));

    const input = "aaab";
    const pos = 0;

    const result1 = quantifiedParser(input, pos);
    const result2 = zeroOrMoreParser(input, pos);

    expect(isSuccess(result1)).toBe(true);
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result1) && isSuccess(result2)) {
      expect(result1.val).toEqual(result2.val);
      expect(result1.next).toBe(result2.next);
    }

    // {1,} should be equivalent to oneOrMore
    const quantifiedParser2 = quantified(lit("a"), 1);
    const oneOrMoreParser = oneOrMore(lit("a"));

    const result3 = quantifiedParser2(input, pos);
    const result4 = oneOrMoreParser(input, pos);

    expect(isSuccess(result3)).toBe(true);
    expect(isSuccess(result4)).toBe(true);
    if (isSuccess(result3) && isSuccess(result4)) {
      expect(result3.val).toEqual(result4.val);
      expect(result3.next).toBe(result4.next);
    }

    // {0,1} should be equivalent to optional
    const quantifiedParser3 = quantified(lit("a"), 0, 1);
    const optionalParser = optional(lit("a"));

    const result5 = quantifiedParser3(input, pos);
    const result6 = optionalParser(input, pos);

    expect(isSuccess(result5)).toBe(true);
    expect(isSuccess(result6)).toBe(true);
    if (isSuccess(result5) && isSuccess(result6)) {
      expect(result5.val).toEqual(result6.val);
      expect(result5.next).toBe(result6.next);
    }
  });
});

// An UNBOUNDED repetition (`zeroOrMore`/`oneOrMore`/`quantified` with
// `max === undefined`) over a NULLABLE body has no well-defined PEG
// semantics: the body can succeed while consuming zero characters, so the
// loop could run forever. Codegen refuses to generate this shape outright
// (`packages/parser/src/first-sets.ts`'s `assertNoNullableRepetition`,
// wired into `codegen.ts`/`codegen-optimized.ts`) -- these tests exist only
// to pin the behavior of the hand-written combinators themselves (for a
// caller building a parser directly on `tpeg-core`, bypassing codegen
// entirely).
//
// The infinite-loop guard's failure is `fatal: true` (see
// `createInfiniteLoopError`'s own doc comment, this package's
// repetition.ts) -- previously it was an ordinary failure, and the SAME
// underlying mistake (`("a"?)*` over "bbb") was a hard, visible failure in
// one context (called bare) and silently accepted as `[]`/a default value/
// a fallthrough to the next `choice` alternative in another, purely
// because of what happened to wrap the repetition. Marking it fatal closes
// that inconsistency: every context below now either surfaces the
// diagnostic or fails the whole enclosing construct, never silently
// produces a different, unrelated success.
describe("unbounded repetition over a nullable body (undefined PEG semantics -- pinned combinator-level behavior)", () => {
  it("zeroOrMore over a nullable body fails fatally with an infinite-loop diagnostic rather than looping forever", () => {
    const result = zeroOrMore(optional(lit("a")))("bbb", 0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Infinite loop detected");
      expect(result.error.fatal).toBe(true);
    }
  });

  it("oneOrMore over a nullable body likewise fails fatally with an infinite-loop diagnostic", () => {
    const result = oneOrMore(optional(lit("a")))("bbb", 0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Infinite loop detected");
      expect(result.error.fatal).toBe(true);
    }
  });

  it("quantified with max=undefined (min=0) over a nullable body fails the same way", () => {
    const result = quantified(optional(lit("a")), 0)("bbb", 0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Infinite loop detected");
      expect(result.error.fatal).toBe(true);
    }
  });

  it("quantified with a BOUNDED range (min=max=2) over the same nullable body succeeds instead -- a finite loop can never diverge", () => {
    // Not a contradiction with the cases above: a bounded `{n,m}` is
    // governed entirely by a plain `for` counter (see `quantified`'s own
    // doc comment in repetition.ts), so it can't loop unboundedly
    // regardless of the body's nullability -- this is why codegen's
    // `assertNoNullableRepetition` only flags the UNBOUNDED shape.
    const result = quantified(optional(lit("a")), 2, 2)("bbb", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([[], []]);
      expect(result.next).toBe(0);
    }
  });

  it("the infinite-loop failure is FATAL -- optional() re-raises it instead of swallowing it as a zero-match success", () => {
    // Same defect (`("a"?)*` over "bbb"), now wrapped in `optional`:
    // `zeroOrMore`'s infinite-loop guard is a fatal failure, so `optional`
    // (repetition.ts) re-raises it exactly like any other cut-driven
    // failure instead of reporting "zero matches".
    const result = optional(zeroOrMore(optional(lit("a"))))("bbb", 0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fatal).toBe(true);
    }
  });

  it("withDefault re-raises the same failure identically, instead of falling back to its default value", () => {
    // Cast to `Parser<unknown>` since `withDefault`'s default value must
    // otherwise share `zeroOrMore(optional(...))`'s own (irrelevant here)
    // value type -- this test is about the failure/fallback behavior, not
    // about type inference.
    const nullableStar = zeroOrMore(
      optional(lit("a")),
    ) as unknown as Parser<unknown>;
    const result = withDefault(nullableStar, "fallback")("bbb", 0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fatal).toBe(true);
    }
  });

  it("choice() stops at its own boundary and fails outright, rather than falling through to the next alternative", () => {
    // The infinite-loop failure being fatal means an enclosing `choice`
    // stops trying further alternatives the moment it's reached (`commit`'s
    // doc comment, combinators.ts) -- unlike the old non-fatal behavior,
    // it no longer silently falls through to a sibling alternative that
    // happens to also match. Cast for the same reason as the `withDefault`
    // test above.
    const nullableStar = zeroOrMore(optional(lit("a"))) as unknown as Parser<
      string[]
    >;
    const result = choice<[string[], string]>(nullableStar, lit("bbb"))(
      "bbb",
      0,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      // Absorbed at `choice`'s own boundary -- reported as an ordinary
      // failure to whatever encloses this `choice`, not fatal itself (see
      // `tryOrderedCandidates`'s doc comment, combinators.ts).
      expect(result.error.fatal).toBeFalsy();
    }
  });
});
