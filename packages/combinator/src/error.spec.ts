import { describe, expect, it } from "vite-plus/test";
import {
  choice,
  commit,
  literal,
  parse,
  seq,
  type ParseError,
  type Parser,
  createFailure,
  notPredicate,
} from "@suzumiyaaoba/tpeg-core";
import { labeled, labeledWithContext, named, withDetailedError } from "./error";
import { memoize } from "./logic";

describe("error combinators", () => {
  describe("diagnostic ownership through wrappers", () => {
    const label = (kind: string, parser: Parser<string>, name: string) =>
      kind === "context"
        ? labeledWithContext(parser, "custom label", ["Root"], name)
        : labeled(parser, "custom label", name);

    it.each(["plain", "context"])(
      "keeps the %s label's name in a single choice alternative",
      (kind) => {
        const result = parse(choice(label(kind, literal("a"), "Label")))("x");
        expect(result).toMatchObject({
          success: false,
          error: { parserName: "Label", pos: 0 },
        });
      },
    );

    it.each(["plain", "context"])(
      "keeps distinct %s label owners when their expectations tie",
      (kind) => {
        const shared = literal("a");
        const result = parse(
          choice(label(kind, shared, "A"), label(kind, shared, "B")),
        )("x");
        expect(result).toMatchObject({
          success: false,
          error: { expected: ['"a"', '"a"'] },
        });
        if (!result.success) expect(result.error.parserName).toBeUndefined();
      },
    );

    it.each(["plain", "context"])(
      "does not let a nearer %s label rename another alternative's farther diagnostic",
      (kind) => {
        const farther: Parser<string> = () =>
          createFailure("farther", 2, { expected: "far", parserName: "Far" });
        const result = parse(
          choice(farther, label(kind, literal("q"), "Near")),
        )("abc");
        expect(result).toMatchObject({
          success: false,
          error: { pos: 2, expected: "far", parserName: "Far" },
        });
      },
    );

    it("retains added found/context fields when a named custom failure crosses another choice", () => {
      const failure: Parser<string> = () => ({
        success: false,
        error: {
          message: "custom failure",
          pos: 1,
          found: "decoded",
          context: ["original"],
          detail: 7,
        },
      });
      const result = parse(choice(named(choice(failure), "Wrapped")))("abc");
      expect(result).toMatchObject({
        success: false,
        error: {
          message: "custom failure",
          pos: 1,
          found: "b",
          context: "abc",
          parserName: "Wrapped",
          detail: 7,
        },
      });
    });

    it("retains details added through nested named wrappers", () => {
      const failure: Parser<string> = () =>
        createFailure("custom failure", 1, {
          context: ["original"],
          found: "decoded",
        });
      const result = parse(
        choice(named(named(choice(failure), "Inner"), "Outer")),
      )("abc");
      expect(result).toMatchObject({
        success: false,
        error: {
          found: "b",
          context: "abc",
          parserName: "Outer",
          pos: 1,
        },
      });
    });

    it("does not modify cached raw diagnostics when adding named details during a probe", () => {
      let calls = 0;
      const cached = memoize(
        choice(() => {
          calls++;
          return createFailure("custom failure", 1, {
            found: "decoded",
            context: ["original"],
          });
        }),
      );
      const wrapped = named(cached, "Wrapped");
      const result = parse(seq(notPredicate(wrapped), cached))("abc");
      expect(result).toMatchObject({
        success: false,
        error: { found: "decoded", context: ["original"], pos: 1 },
      });
      expect(calls).toBe(1);
    });
  });

  it("keeps a custom label when the labeled parser is a choice alternative", () => {
    const result = parse(
      choice(labeled(literal("a"), "A custom label", "A"), literal("b")),
    )("x");
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.message).toContain("A custom label");
  });

  it("replays a cached custom diagnostic after a probe discarded it", () => {
    let calls = 0;
    const cached = memoize(
      choice(() => {
        calls++;
        return createFailure("cached custom failure", 0, {
          context: ["cached"],
        });
      }),
    );
    const parser: Parser<unknown> = (input, pos) => {
      notPredicate(cached)(input, pos);
      return cached(input, pos);
    };
    expect(parse(parser)("x")).toMatchObject({
      success: false,
      error: { pos: 0, message: "cached custom failure", context: ["cached"] },
    });
    expect(calls).toBe(1);
  });

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
    it("preserves a non-enumerable Error message and inherited diagnostic fields", () => {
      const prototype = Object.assign(new Error("original diagnostic"), {
        pos: 1,
        expected: ["a", "b"],
        fatal: true,
      });
      const error: ParseError = Object.create(prototype, {
        detail: { value: "retained", enumerable: true },
      });
      const failure: Parser<string> = () => ({ success: false, error });
      const decorated = withDetailedError(failure, "Named");
      expect(decorated("xz", 0)).toMatchObject({
        success: false,
        error: {
          message: "original diagnostic",
          pos: 1,
          expected: ["a", "b"],
          found: "z",
          fatal: true,
          parserName: "Named",
          detail: "retained",
        },
      });
      expect(parse(choice(decorated, literal("xz")))("xz").success).toBe(false);
    });

    it("keeps inherited abort flags from allowing a choice fallback", () => {
      const error: ParseError = Object.create({
        message: "limit reached",
        pos: 0,
        fatal: true,
        abort: true,
      });
      const decorated = withDetailedError(
        () => ({ success: false, error }),
        "Named",
      );
      const result = parse(choice(decorated, literal("x")))("x");
      expect(result).toMatchObject({
        success: false,
        error: { message: "limit reached", fatal: true, abort: true },
      });
    });

    it("uses one position getter value for both the returned position and found text", () => {
      let reads = 0;
      const error: ParseError = {
        message: "diagnostic",
        get pos() {
          return reads++;
        },
      };
      const result = withDetailedError(
        () => ({ success: false, error }),
        "Named",
      )("xy", 0);
      expect(result).toMatchObject({
        success: false,
        error: { pos: 0, found: "x" },
      });
      expect(reads).toBe(1);
    });

    it.each([
      [["a", "b"], "a or b"],
      [[], "valid input"],
    ])(
      "formats an expectation list %j in a missing message",
      (expected, text) => {
        const parser = withDetailedError(
          () => ({ success: false, error: { message: "", pos: 0, expected } }),
          "Named",
        );
        expect(parser("x", 0)).toMatchObject({
          success: false,
          error: { message: `Named: Expected ${text} but found 'x'` },
        });
      },
    );

    it("uses one error snapshot for the diagnostic position and found character", () => {
      let reads = 0;
      const parser = withDetailedError(
        () => ({
          success: false,
          get error() {
            return { message: "", pos: reads++, expected: "a" };
          },
        }),
        "Named",
      );
      expect(parser("xy", 0)).toMatchObject({
        success: false,
        error: {
          pos: 0,
          found: "x",
          message: "Named: Expected a but found 'x'",
        },
      });
    });
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

    it("preserves a fatal (cut/commit) failure while adding diagnostics", () => {
      // Diagnostic decoration must retain the cut so an enclosing choice
      // cannot accept its fallback after the committed parser fails.
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

    it("keeps each named alternative's attribution when two share the same label (regression: renaming matched by label text and retitled the earlier alternative's entry too)", () => {
      // Alt1's `literal("x")` records `{'"x"',literal}`; its rename turns
      // it into `{'"x"',ParserA}`. Alt2's `literal("x")` then appends a
      // NEW `{'"x"',literal}` (distinct by parserName -- see
      // `failure.spec.ts`'s pinned "equal label, different parserName"
      // case). Renaming by label text retitled BOTH entries to
      // "ParserB", so the final error claimed parserName "ParserB" --
      // though alt1 was ParserA's. The snapshot-based rename only
      // retitles entries the wrapped call itself contributed.
      const result = parse(
        choice(named(literal("x"), "ParserA"), named(literal("x"), "ParserB")),
      )("y");

      expect(result.success).toBe(false);
      if (!result.success) {
        // Both attributions survive -- same label kept distinct per the
        // pinned semantics -- so no single parserName is reportable.
        expect(result.error.expected).toEqual(['"x"', '"x"']);
        expect(result.error.parserName).toBeUndefined();
      }
    });

    it("does not retitle a farther-position expectation the wrapped parser never contributed", () => {
      // On "ax": alt1's seq records `{'"b"',literal}` at pos 1 (the
      // farthest failure). Alt2's `literal("q")` fails at pos 0 -- its
      // `fail()` record is ignored as nearer, so ParserB contributed
      // NOTHING to the watermark. The old label-based rename still
      // retitled the '"b"' entry to "ParserB" (the materialized error
      // withDetailedError read reported '"b"' as its own expectation),
      // yielding `ParserB: Expected "b"` though ParserB only ever
      // expected "q". With contribution-scoped renaming the '"b"'
      // entry keeps its 'literal' attribution; ParserB's forwarded
      // claim lands as its own separate entry, so parserName is
      // ambiguous and omitted.
      const result = parse(
        choice(seq(literal("a"), literal("b")), named(literal("q"), "ParserB")),
      )("ax");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.pos).toBe(1);
        expect(result.error.parserName).not.toBe("ParserB");
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
    it("keeps a diagnostic context independent of later caller changes", () => {
      const context = ["Root"];
      const parser = labeledWithContext(literal("a"), "Failure", context);
      const result = parser("b", 0);
      context.push("Changed");
      expect(result).toMatchObject({
        success: false,
        error: {
          message: "Failure (in context: Root)",
          context: ["Root"],
        },
      });
    });

    it("does not let a previous diagnostic alter the context of another call", () => {
      const context = ["Root"];
      const parser = labeledWithContext(literal("a"), "Failure", context);
      const first = parser("b", 0);
      if (!first.success && Array.isArray(first.error.context))
        first.error.context.push("Changed");
      expect(parser("b", 0)).toMatchObject({
        success: false,
        error: { context: ["Root"] },
      });
      expect(context).toEqual(["Root"]);
    });

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
