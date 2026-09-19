import { describe, expect, it } from "vite-plus/test";
import { lit } from "./basic";
import { choice, seq } from "./combinators";
import { optional } from "./repetition";
import { filter, map, mapError, mapResult, span, tap } from "./transform";
import type { ParseSuccess } from "./types";
import { parse } from "./utils";

describe("map", () => {
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
