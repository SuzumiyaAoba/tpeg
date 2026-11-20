import { describe, expect, it } from "vite-plus/test";
import { lit } from "./basic";
import { choice, commit, seq } from "./combinators";
import { guardedParserCall } from "./limits";
import { optional } from "./repetition";
import { filter, map, mapError, mapResult, span, tap } from "./transform";
import type { ParseError, ParseSuccess, Parser } from "./types";
import { parse } from "./utils";

describe("map", () => {
  it("keeps the outer match's positions when the mapper reuses the child parser", () => {
    const shared: ParseSuccess<string> = {
      success: true,
      val: "",
      current: 0,
      next: 0,
    };
    const child: Parser<string> = (input, pos) => {
      Object.assign(shared, {
        val: input[pos],
        current: pos,
        next: pos + 1,
      });
      return shared;
    };
    const result = map(child, (value) => {
      child("b", 0);
      return value.toUpperCase();
    })("xa", 1);
    expect(result).toEqual({ success: true, val: "A", current: 1, next: 2 });
  });

  it("captures positions before reading the child's value getter", () => {
    const child: ParseSuccess<string> = {
      success: true,
      current: 1,
      next: 2,
      get val() {
        child.current = 0;
        child.next = 0;
        return "a";
      },
    };
    expect(
      map(
        () => child,
        (value) => value.toUpperCase(),
      )("xa", 1),
    ).toEqual({
      success: true,
      val: "A",
      current: 1,
      next: 2,
    });
  });

  it("should transform the result value", () => {
    const input = "abc";
    const pos = 0;
    const result = map(lit("abc"), (val) => val.length)(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe(3);
      expect(result.next).toBe(3);
    }
  });

  it("should propagate failure", () => {
    const input = "def";
    const pos = 0;
    const result = map(lit("abc"), (val) => val.length)(input, pos);
    expect(result.success).toBe(false);
  });
});

describe("mapResult(parser, f)", () => {
  it("preserves the consumed positions when the mapper modifies its success argument", () => {
    const result = mapResult(lit("a"), (success) => {
      success.current = 50;
      success.next = 99;
      return "mapped";
    })("xa", 1);
    expect(result).toEqual({
      success: true,
      val: "mapped",
      current: 1,
      next: 2,
    });
  });
  it("should transform the success result", () => {
    const input = "abc";
    const pos = 0;
    const result = mapResult(lit("abc"), (result: ParseSuccess<string>) =>
      result.val.toUpperCase(),
    )(input, pos);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("ABC");
      expect(result.next).toBe(3);
    }
  });

  it("should propagate failure", () => {
    const input = "def";
    const pos = 0;
    const result = mapResult(lit("abc"), (result: ParseSuccess<string>) =>
      result.val.toUpperCase(),
    )(input, pos);

    expect(result.success).toBe(false);
  });
});

describe("mapError", () => {
  it("keeps a committed failure from falling through to another choice alternative", () => {
    const mapped = mapError(commit(lit("a")), (error) => ({
      message: "Mapped",
      pos: error.pos,
    }));
    const result = parse(choice(mapped, lit("b")))("b");
    expect(result.success).toBe(false);
    expect(mapped("b", 0)).toMatchObject({
      success: false,
      error: { fatal: true, message: "Mapped" },
    });
  });

  it("preserves a recursion abort even when a mapper returns only diagnostic fields", () => {
    const limited: Parser<string> = (input, pos) =>
      guardedParserCall(
        () => guardedParserCall(() => lit("a")(input, pos), pos),
        pos,
      );
    const mapped = mapError(limited, (error) => ({
      message: "Mapped",
      pos: error.pos,
    }));
    const result = parse(choice(mapped, lit("a")), { maxRecursionDepth: 1 })(
      "a",
    );
    expect(result).toMatchObject({
      success: false,
      error: { abort: true, fatal: true, message: "Mapped" },
    });
  });

  it("preserves the original control flags when a mapper mutates its argument", () => {
    const failure = {
      success: false as const,
      error: { message: "Stopped", pos: 0, fatal: true, abort: true },
    };
    const mapped = mapError<string>(
      () => failure,
      (error) => {
        error.fatal = false;
        error.abort = false;
        return { ...error, message: "Mapped" };
      },
    );
    expect(mapped("a", 0)).toMatchObject({
      success: false,
      error: { fatal: true, abort: true, message: "Mapped" },
    });
  });

  it("retains the mapper's returned error identity when control flags need no repair", () => {
    const mappedError: ParseError = { message: "Mapped", pos: 0, fatal: true };
    const result = mapError(lit("a"), () => mappedError)("b", 0);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(mappedError);
  });

  it("retains a non-enumerable Error message when repairing a committed failure", () => {
    const diagnostic = Object.assign(new Error("Mapped error"), { pos: 0 });
    const result = mapError(commit(lit("a")), () => diagnostic)("b", 0);
    expect(result).toMatchObject({
      success: false,
      error: { message: "Mapped error", pos: 0, fatal: true },
    });
  });

  it("keeps an inherited mapped abort flag while restoring the original cut flag", () => {
    const diagnostic: ParseError = Object.create({
      message: "mapped abort",
      pos: 0,
      abort: true,
    });
    const mapped = mapError(commit(lit("a")), () => diagnostic);
    expect(mapped("b", 0)).toMatchObject({
      success: false,
      error: { fatal: true, abort: true },
    });
    expect(choice(mapped, lit("b"))("b", 0)).toMatchObject({
      success: false,
      error: { abort: true },
    });
  });

  it("retains inherited diagnostic fields when repairing control flags", () => {
    const diagnostic: ParseError = Object.create({
      message: "Mapped",
      pos: 0,
      expected: ["a", "b"],
      found: "c",
      parserName: "Custom",
      context: ["outer"],
    });
    const result = mapError(commit(lit("a")), () => diagnostic)("b", 0);
    expect(result).toMatchObject({
      success: false,
      error: {
        message: "Mapped",
        pos: 0,
        expected: ["a", "b"],
        found: "c",
        parserName: "Custom",
        context: ["outer"],
        fatal: true,
      },
    });
  });
  it("should transform error on failure", () => {
    const input = "def";
    const pos = 0;
    const result = mapError(lit("abc"), (error) => ({
      ...error,
      message: "Custom error message",
    }))(input, pos);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Custom error message");
      // Untouched fields are preserved by the spread
      expect(result.error.parserName).toBe("literal");
    }
  });

  it("should propagate success", () => {
    const input = "abc";
    const pos = 0;
    const result = mapError(lit("abc"), (error) => ({
      ...error,
      message: "This shouldn't be called",
    }))(input, pos);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
    }
  });
});

describe("filter", () => {
  it("reports the value and position tested before the predicate changes the child", () => {
    const child: ParseSuccess<string> = {
      success: true,
      val: "a",
      current: 1,
      next: 2,
    };
    const result = filter(
      () => child,
      (value) => {
        expect(value).toBe("a");
        child.val = "b";
        child.current = 0;
        return false;
      },
      "Rejected",
    )("xa", 1);
    expect(result).toMatchObject({
      success: false,
      error: { message: "Rejected", pos: 1, found: "a" },
    });
  });

  it("reads a rejected value once and preserves the position before its getter runs", () => {
    let valueReads = 0;
    const child: ParseSuccess<string> = {
      success: true,
      current: 1,
      next: 2,
      get val() {
        child.current = 0;
        return valueReads++ === 0 ? "a" : "b";
      },
    };
    const result = filter(
      () => child,
      () => false,
      "Rejected",
    )("xa", 1);
    expect(result).toMatchObject({
      success: false,
      error: { pos: 1, found: "a" },
    });
    expect(valueReads).toBe(1);
  });

  it.each([
    ["object without a prototype", () => Object.create(null)],
    [
      "throwing primitive conversion",
      () => ({
        [Symbol.toPrimitive]() {
          throw new Error("Cannot print");
        },
      }),
    ],
    [
      "conversion without a primitive result",
      () => ({
        toString() {
          return {};
        },
        valueOf() {
          return {};
        },
      }),
    ],
  ])("returns its rejection diagnostic for a %s", (_name, createValue) => {
    const rejected = filter(
      map(lit("a"), createValue),
      () => false,
      "Rejected",
    );
    expect(rejected("a", 0)).toMatchObject({
      success: false,
      error: { message: "Rejected", pos: 0, found: "<unprintable value>" },
    });
  });

  it("preserves a value's custom string representation in rejection diagnostics", () => {
    const rejected = filter(
      map(lit("a"), () => ({ toString: () => "custom value" })),
      () => false,
      "Rejected",
    );
    expect(rejected("a", 0)).toMatchObject({
      success: false,
      error: { found: "custom value" },
    });
  });
  it("should succeed when predicate returns true", () => {
    const input = "abc";
    const pos = 0;
    const result = filter(
      lit("abc"),
      (val) => val.length === 3,
      "Length must be 3",
    )(input, pos);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
    }
  });

  it("should fail when predicate returns false", () => {
    const input = "abc";
    const pos = 0;
    const result = filter(
      lit("abc"),
      (val) => val.length === 5,
      "Length must be 5",
    )(input, pos);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Length must be 5");
      expect(result.error.parserName).toBe("filter");
    }
  });

  it("should propagate parsing failure", () => {
    const input = "def";
    const pos = 0;
    const result = filter(
      lit("abc"),
      (val) => val.length === 3,
      "Length must be 3",
    )(input, pos);

    expect(result.success).toBe(false);
  });

  // Mirrors `reject`'s identical fix (`./combinators.ts`): a predicate
  // failure happens AFTER a successful child match, so no leaf `fail()`
  // ever ran -- nothing recorded "value satisfying predicate" into the
  // shared farthest-failure watermark. A combinator that swallows the
  // concrete failure (`optional`/`zeroOrMore` turn a child failure into
  // their own success without re-forwarding `expected`) then lost the
  // predicate's expectation entirely: a later genuine failure's
  // aggregated `expected` listed only the leaf's labels.
  it("records its expectation in the watermark so a swallowing combinator can't drop it", () => {
    // On "a": `filter(lit("a"), ...)` matches "a" then fails the
    // predicate; `optional` turns that into a `[]` success; `lit("b")`
    // then fails genuinely. The final error must include BOTH
    // "value satisfying predicate" and `"b"`.
    const result = parse(
      seq(optional(filter(lit("a"), () => false, "not a")), lit("b")),
    )("a");
    expect(result.success).toBe(false);
    if (!result.success) {
      const expected = Array.isArray(result.error.expected)
        ? result.error.expected
        : [result.error.expected];
      expect(expected).toContain("value satisfying predicate");
      expect(expected).toContain('"b"');
    }
  });

  // Same fix `notPredicate`/`reject` got on their probe-success paths:
  // the child SUCCEEDED, so its internal sub-failures are speculative
  // noise -- and when one sits deeper than the predicate's own failure
  // position, leaving it in place made `fail()` a no-op, losing the
  // predicate's expectation (and suppressing later genuine failures).
  it("restores the watermark before recording, so deeper child noise can't suppress the predicate's expectation", () => {
    // The child `seq(lit("a"), choice(lit("bx"), lit("b")))` succeeds on
    // "ab" but records `'"bx"'` at pos 2 internally. `optional` swallows
    // `filter`'s concrete failure; `lit("c")` then fails at pos 0 --
    // previously invisible because the child's pos-2 record owned the
    // watermark: the error said `Expected "bx", found "end of input"`,
    // naming neither the predicate nor `"c"`.
    const result = parse(
      seq(
        optional(
          filter(
            seq(lit("a"), choice(lit("bx"), lit("b"))),
            () => false,
            "rejected",
          ),
        ),
        lit("c"),
      ),
    )("ab");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.pos).toBe(0);
      const expected = Array.isArray(result.error.expected)
        ? result.error.expected
        : [result.error.expected];
      expect(expected).toContain("value satisfying predicate");
      expect(expected).toContain('"c"');
      expect(expected).not.toContain('"bx"');
    }
  });
});

describe("tap", () => {
  it("should execute side effect on success", () => {
    let sideEffectValue = "";
    const input = "abc";
    const pos = 0;

    const result = tap(lit("abc"), (val: string) => {
      sideEffectValue = val;
    })(input, pos);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
    }
    expect(sideEffectValue).toBe("abc");
  });

  it("should not execute side effect on failure", () => {
    let sideEffectCalled = false;
    const input = "def";
    const pos = 0;

    const result = tap(lit("abc"), () => {
      sideEffectCalled = true;
    })(input, pos);

    expect(result.success).toBe(false);
    expect(sideEffectCalled).toBe(false);
  });

  it("should return original result unchanged", () => {
    const input = "abc";
    const pos = 0;

    const originalResult = lit("abc")(input, pos);
    const tappedResult = tap(lit("abc"), () => {
      /* do nothing */
    })(input, pos);

    expect(tappedResult).toEqual(originalResult);
  });
});

describe("span", () => {
  it("uses the same position reads for the source text and the returned match", () => {
    let currentReads = 0;
    let nextReads = 0;
    const child: Parser<string> = () => ({
      success: true,
      get current() {
        return currentReads++ === 0 ? 1 : 0;
      },
      get next() {
        return nextReads++ === 0 ? 3 : 4;
      },
      get val(): string {
        throw new Error("span must not read the discarded value");
      },
    });
    expect(span(child)("xabc", 1)).toEqual({
      success: true,
      val: "ab",
      current: 1,
      next: 3,
    });
    expect([currentReads, nextReads]).toEqual([1, 1]);
  });

  it("replaces the match value with the consumed source text", () => {
    const input = "abc123";
    const p = seq(lit("abc"), lit("123"));
    const result = span(p)(input, 0);
    expect(result.success).toBe(true);
    if (result.success) {
      // The child's tuple ["abc", "123"] is discarded wholesale.
      expect(result.val).toBe("abc123");
      expect(result.current).toBe(0);
      expect(result.next).toBe(6);
    }
  });

  it("slices from current to next at a nonzero position", () => {
    const result = span(lit("bc"))("xabcy", 2);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("bc");
      expect(result.current).toBe(2);
      expect(result.next).toBe(4);
    }
  });

  it("yields the empty string for a zero-width child match", () => {
    const result = span(optional(lit("x")))("ab", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("");
      expect(result.next).toBe(0);
    }
  });

  it("propagates the child's failure unchanged", () => {
    const result = span(lit("abc"))("def", 0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.parserName).toBe("literal");
    }
  });

  it("preserves multiline and non-ASCII text exactly", () => {
    const result = span(lit("a\nb日本語"))("a\nb日本語z", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a\nb日本語");
      expect(result.next).toBe(6);
    }
  });

  it("nested spans return the same text as the inner one", () => {
    const inner = span(seq(lit("ab"), lit("c")));
    const outer = span(inner);
    const result = outer("abc", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
    }
  });
});
