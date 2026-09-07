import { describe, expect, it } from "vite-plus/test";
import { choice, commit, literal, parse, seq } from "@suzumiyaaoba/tpeg-core";
import { labeled, labeledWithContext, named, withDetailedError } from "./error";

describe("error combinators", () => {
  describe("named", () => {
    // Every other combinator module's own `parserName` argument delegates
    // here (`token`, `between`, `sepBy`, `memoize`, `recursive`,
    // `withPosition`, ...) -- exercised indirectly through all of them,
    // but never directly until now.
    it("wraps with withDetailedError when parserName is given", () => {
      const parser = named(literal("abc"), "MyParser");
      const result = parse(parser)("def");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.parserName).toBe("MyParser");
      }
    });

    it("returns the parser UNCHANGED (no wrapping) when parserName is omitted", () => {
      const inner = literal("abc");
      expect(named(inner)).toBe(inner);
    });
  });

  describe("withDetailedError", () => {
    it("should enhance error with context and found char", () => {
      const parser = withDetailedError(literal("expected"), "MyParser");
      const result = parse(parser)("wrong input");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.parserName).toBe("MyParser");
        expect(result.error.found).toBe("w");
        expect(result.error.context).toBe("wrong"); // default context length
      }
    });

    it("should handle EOF context", () => {
      const parser = withDetailedError(literal("expected"), "MyParser");
      const result = parse(parser)("");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.found).toBe("EOF");
      }
    });

    it("reports a whole astral character as `found`, not a lone surrogate (regression: `input[failurePos]` indexed by raw UTF-16 code unit, so a failure positioned on an emoji reported one unpaired surrogate half instead of the actual character)", () => {
      const parser = withDetailedError(literal("wrong"), "MyParser");
      const result = parse(parser)("\u{1F600}wrong");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.found).toBe("\u{1F600}");
      }
    });

    it("preserves a fatal (cut/commit) failure -- spreads the original error, unlike labeled's pre-fix behavior", () => {
      // The baseline `labeled`'s regression test below contrasts against:
      // `enhancedError` is built via `{ ...failure.error }`, so `fatal`
      // (if present) is carried over automatically, never dropped the way
      // `labeled` used to drop it before its own fix.
      const committedAbc = commit(literal("abc"));
      const parser = withDetailedError(committedAbc, "MyParser");
      const direct = parser("def", 0);
      expect(direct.success).toBe(false);
      if (!direct.success) {
        expect(direct.error.fatal).toBe(true);
      }

      const withFallback = choice(parser, literal("def"));
      expect(parse(withFallback)("def").success).toBe(false);
    });

    it("does not duplicate the expected label or drop parserName when the wrapped parser is one alternative of a choice (regression: renaming an already-recorded failure looked, to `choice`, like a second independent expectation)", () => {
      // `seq(literal("ab"), literal("cd"))` failing on "cd" already
      // records `{label: '"cd"', parserName: "literal"}` in the shared
      // farthest-failure watermark via `literal`'s own `fail()` call.
      // `withDetailedError` then RENAMES that failure's `parserName` to
      // "MyParser" for its own returned value -- but before
      // `renameWatermarkExpectation` existed, that rename only touched a
      // local copy: the watermark itself still held the old entry, and
      // because this parser is `choice`'s FIRST alternative,
      // `tryOrderedCandidates` (`packages/core/src/combinators.ts`) saw
      // the renamed failure as a "concrete" (no longer the `FAIL`
      // singleton) result and re-forwarded it into the watermark as a
      // SECOND entry -- same label, different `parserName`. Two
      // watermark entries "the same label but different `parserName`"
      // is deliberately NOT deduplicated elsewhere (see
      // `failure.spec.ts`'s "treats equal label with different
      // parserName as distinct expectations" -- that's correct for two
      // genuinely independent parsers coincidentally sharing label text)
      // -- the actual bug was `withDetailedError` creating that second,
      // spurious entry for what both entries are really the SAME
      // underlying failure. The visible symptom: "Expected \"cd\" or
      // \"cd\"" instead of "Expected \"cd\"", and `parserName` silently
      // dropped (`materializeParseError` only reports one when every
      // tied expectation agrees).
      const inner = seq(literal("ab"), literal("cd"));
      const parser = withDetailedError(inner, "MyParser");
      const result = parse(choice(parser, literal("zz")))("abXX");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.expected).toBe('"cd"');
        expect(result.error.message).not.toContain(" or ");
        expect(result.error.parserName).toBe("MyParser");
      }
    });
  });

  describe("labeled", () => {
    it("should use custom error message", () => {
      const parser = labeled(literal("abc"), "Custom Message");
      const result = parse(parser)("def");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Custom Message");
      }
    });

    it("preserves a fatal (cut/commit) failure instead of building a fresh, non-fatal error object", () => {
      // Regression test: `labeled` used to build `errorObj` entirely from
      // scratch (never spreading `result.error`), silently dropping
      // `fatal` -- unlike `withDetailedError` above, which spreads the
      // original error. That let an enclosing `choice` fall back to a
      // sibling alternative it should have been barred from trying.
      const committedAbc = commit(literal("abc"));
      const parser = choice(
        labeled(committedAbc, "Custom Message"),
        literal("def"),
      );
      const result = parse(parser)("def");
      expect(result.success).toBe(false);
      const direct = labeled(committedAbc, "Custom Message")("def", 0);
      expect(direct.success).toBe(false);
      if (!direct.success) {
        expect(direct.error.fatal).toBe(true);
      }
    });
  });

  describe("labeledWithContext", () => {
    it("should include hierarchical context in message", () => {
      const parser = labeledWithContext(
        literal("abc"),
        "Fail",
        ["Top", "Sub"],
        "MyParser",
      );
      const result = parse(parser)("def");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Top > Sub");
        expect(result.error.context).toEqual(["Top", "Sub"]);
      }
    });

    it("preserves a fatal (cut/commit) failure instead of building a fresh, non-fatal error object", () => {
      const committedAbc = commit(literal("abc"));
      const parser = choice(
        labeledWithContext(committedAbc, "Fail", "Top"),
        literal("def"),
      );
      const result = parse(parser)("def");
      expect(result.success).toBe(false);
      const direct = labeledWithContext(committedAbc, "Fail", "Top")("def", 0);
      expect(direct.success).toBe(false);
      if (!direct.success) {
        expect(direct.error.fatal).toBe(true);
      }
    });
  });

  it("should preserve committed failures through error labels", () => {
    const committed = seq(literal("i"), commit(literal("f")));
    const wrappedParsers = [
      labeled(committed, "Expected if"),
      labeledWithContext(committed, "Expected if", "statement"),
    ];

    for (const wrapped of wrappedParsers) {
      const result = choice(wrapped, literal("i"))("ix", 0);
      expect(result.success).toBe(false);
    }
  });
});
