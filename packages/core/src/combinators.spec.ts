import { beforeEach, describe, expect, it } from "bun:test";
import { lit } from "./basic";
import {
  choice,
  commit,
  lazy,
  maybe,
  predictiveChoice,
  reject,
  seq,
  sequence,
  tryOrderedCandidates,
  withDefault,
} from "./combinators";
import type { FirstCharFilter } from "./combinators";
import {
  materializeParseError,
  resetFailureWatermark,
  snapshotFailureWatermark,
} from "./failure";
import { optional } from "./repetition";
import type { Parser } from "./types";
import { createFailure } from "./utils";

// The farthest-failure watermark (`./failure.ts`) is module-global state
// keyed by the input string's VALUE, not by test identity -- two unrelated
// tests that `fail()` on an identical string content would otherwise
// silently share (and pollute) each other's watermark. See
// `failure.spec.ts`'s identical `beforeEach` for the full rationale.
beforeEach(() => {
  resetFailureWatermark();
});

describe("tryOrderedCandidates", () => {
  // The shared ordered-choice trial loop `choice`/`predictiveChoice`/
  // `captureChoice` all delegate to -- previously exercised only
  // INDIRECTLY through those callers (see the comments at
  // `combinators.spec.ts:205,445` before this block existed). Direct
  // tests here target the loop itself, independent of which caller wraps
  // it.
  it("returns the first candidate that succeeds, in declaration order", () => {
    const result = tryOrderedCandidates(
      [lit("a"), lit("b"), lit("c")],
      "b",
      0,
      "test",
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.val).toBe("b");
  });

  it("returns FAIL when every candidate fails ordinarily", () => {
    const result = tryOrderedCandidates([lit("a"), lit("b")], "c", 0, "test");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.fatal).toBeFalsy();
  });

  it("absorbs a fatal failure at its own boundary: stops trying later candidates and reports an ORDINARY (non-fatal) failure", () => {
    let ranThirdCandidate = false;
    const thirdCandidate: Parser<unknown> = (input, pos) => {
      ranThirdCandidate = true;
      return lit("c")(input, pos);
    };
    const candidates: Parser<unknown>[] = [
      seq(lit("a"), commit(lit("b"))),
      thirdCandidate,
    ];
    const result = tryOrderedCandidates(candidates, "ac", 0, "test");
    expect(result.success).toBe(false);
    if (!result.success) {
      // Absorbed here, not left fatal for whatever encloses this call.
      expect(result.error.fatal).toBeFalsy();
    }
    expect(ranThirdCandidate).toBe(false);
  });

  it("forwards a CONCRETE (non-singleton) failure's expectation into the shared farthest-failure watermark", () => {
    // A hand-written parser that builds its own `ParseError` via the
    // public `createFailure` (`./utils.ts`) instead of the internal
    // `fail`/`FAIL` singleton path -- see this function's own doc comment
    // on why its `.error` still needs forwarding for farthest-failure
    // diagnostics to see it.
    const concreteFailure: Parser<string> = (input, pos) =>
      createFailure("custom failure", pos, { expected: "custom-thing" });
    // A single candidate, so nothing else's own `fail()` call can also
    // contribute to the watermark at this position -- isolates exactly
    // this forwarding step.
    tryOrderedCandidates([concreteFailure], "y", 0, "test");
    const error = materializeParseError(false);
    expect(error.expected).toBe("custom-thing");
  });

  it("returns a concrete construction-error failure for a hole in the candidate array", () => {
    const parsers = [undefined, lit("c")] as unknown as Parser<string>[];
    const result = tryOrderedCandidates(parsers, "x", 0, "test");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("index 0");
    }
  });
});

describe("seq", () => {
  it("should parse a sequence of parsers", () => {
    const input = "abc";
    const pos = 0;
    const result = seq(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "b", "c"]);
      expect(result.next).toBe(3);
    }
  });

  it("should return error if any parser fails", () => {
    const input = "abd";
    const pos = 0;
    const result = seq(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(false);
  });

  it("should handle empty sequence", () => {
    const input = "abc";
    const pos = 0;
    const result = seq()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toEqual(pos);
    }
  });

  it("should fail if a parser is undefined", () => {
    const input = "a";
    const pos = 0;
    // @ts-ignore
    const result = seq(lit("a"), undefined)(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Parser at index 1 is undefined");
    }
  });
});

describe("choice", () => {
  it("should parse with the first matching parser", () => {
    const input = "a";
    const pos = 0;
    const result = choice(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toBe(1);
    }
  });

  it("should try the next parser if the previous one fails", () => {
    const input = "b";
    const pos = 0;
    const result = choice(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("b");
      expect(result.next).toBe(1);
    }
  });

  it("should return error if all parsers fail", () => {
    const input = "d";
    const pos = 0;
    const result = choice(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(false);
  });

  it("should handle empty choice", () => {
    const input = "a";
    const pos = 0;
    const result = choice()(input, pos);
    expect(result.success).toBe(false);
  });

  it("does not try the next alternative once a committed sub-parser fails", () => {
    const input = "ix";
    const pos = 0;
    const committedBranch = seq(lit("i"), commit(lit("f")));
    // `fallback` would itself SUCCEED on this input ("ix" starts with
    // "i") -- so the only way `result.success` can be `false` below is
    // if `choice` actually stopped at the committed branch's failure
    // instead of falling through to try `fallback` too.
    const fallback = lit("i");
    const result = choice(committedBranch, fallback)(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      // The specific inner failure (expected "f") surfaces, not a
      // generic "none of the parsers matched" aggregate.
      expect(result.error.message).toContain("f");
      // `fatal` is NOT forwarded on `choice`'s own returned failure: a
      // cut is scoped to protect only the choice it's directly inside,
      // not whatever encloses that choice (see `docs/peg-grammar.md` and
      // `choice`'s own doc comment). This `choice(...)` call isn't
      // nested inside anything here, but the field's value is still
      // observable and worth pinning so a future change can't silently
      // reintroduce fatal-leaking past this boundary.
      expect(result.error.fatal).toBeFalsy();
    }
  });

  it("still tries the next alternative when the failure isn't fatal", () => {
    const input = "ix";
    const pos = 0;
    const branch = seq(lit("i"), lit("f"));
    const fallback = lit("i");
    const result = choice(branch, fallback)(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("i");
    }
  });

  it("a cut inside a nested choice does not stop an ENCLOSING choice from trying its own remaining alternatives", () => {
    // Regression test for a real bug found while building
    // `ast-optimize.ts`'s `insertAutomaticCuts`: this is the minimal
    // hand-written-`~`-equivalent repro of
    // `docs/peg-grammar.md`'s stated cut scope ("a cut inside a nested
    // group does not protect the outer sequence's siblings"), using only
    // `choice`/`commit`/`seq` directly -- no codegen, no automatic cut
    // insertion involved.
    //
    // Structure: an OUTER choice's first alternative is itself an INNER
    // choice containing a cut. Before the fix, the inner choice's
    // absorbed-but-still-`fatal`-marked failure (pre-fix: NOT absorbed at
    // all, forwarded as-is) caused the OUTER choice to ALSO stop early
    // and refuse to try its own second alternative -- incorrectly
    // rejecting input the second alternative would have matched.
    const input = "ybz";
    const pos = 0;
    const innerChoice = choice(
      seq(lit("y"), commit(lit("b")), commit(lit("c"))), // commits after "y", then fails on "z" != "c"
      lit("x"), // irrelevant: FIRST-disjoint from "y", never reachable here regardless
    );
    const outerFallback = seq(lit("y"), lit("b"), lit("z")); // the alternative that SHOULD match "ybz"
    const result = choice(innerChoice, outerFallback)(input, pos);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["y", "b", "z"]);
      expect(result.next).toBe(3);
    }
  });

  it("should fail if a parser is undefined", () => {
    const input = "b";
    const pos = 0;
    // @ts-ignore
    const result = choice(lit("a"), undefined)(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Parser at index 1 is undefined");
    }
  });

  it("should aggregate expected values from failures", () => {
    // `expected` labels are now `literal`'s own quoted form (`"a"`, not
    // bare `a`) -- see `./failure.ts`'s `Expectation` doc comment and
    // `basic.ts`'s `literal`.
    const input = "d";
    const pos = 0;
    const result = choice(lit("a"), lit("b"))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.expected).toEqual(['"a"', '"b"']);
    }
  });

  it("should handle nested expected arrays in failures", () => {
    // A hand-written parser using the public `createFailure` (not `fail`)
    // still participates in the shared farthest-failure watermark: `choice`
    // forwards a concrete (non-singleton) failure's `expected` into it --
    // see `tryOrderedCandidates`'s doc comment in `./combinators.ts`.
    const input = "d";
    const pos = 0;
    const parserWithNestedExpected = (_: string, pos: number) =>
      createFailure("fail", pos, { expected: ["x", "y"] });
    const result = choice(lit("a"), parserWithNestedExpected)(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.expected).toEqual(['"a"', "x", "y"]);
    }
  });

  it("should report only the farthest failure's expected values, not earlier (closer) ones", () => {
    // alt1 fails immediately at offset 0; alt2 consumes one char before
    // failing at offset 1. Only alt2's expectation should survive --
    // alt1's "a" is from a strictly closer (less useful) failure and
    // must not be merged in alongside it.
    const input = "xz";
    const pos = 0;
    const result = choice(lit("a"), sequence(lit("x"), lit("y")))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.expected).toBe('"y"');
      expect(result.error.pos).toBe(1);
    }
  });

  it("should merge expected values only across failures tied at the farthest offset", () => {
    // alt1 and alt3 both fail at offset 1 (after consuming "x"); alt2
    // fails immediately at offset 0 and must be excluded from the merge.
    const input = "xz";
    const pos = 0;
    const result = choice(
      sequence(lit("x"), lit("y")),
      lit("a"),
      sequence(lit("x"), lit("w")),
    )(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.expected).toEqual(['"y"', '"w"']);
      expect(result.error.pos).toBe(1);
    }
  });
});

describe("commit", () => {
  it("passes through a successful parse unchanged", () => {
    const input = "a";
    const pos = 0;
    const result = commit(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
    }
  });

  it("marks a failure as fatal", () => {
    const input = "b";
    const pos = 0;
    const result = commit(lit("a"))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fatal).toBe(true);
    }
  });
});

describe("predictiveChoice", () => {
  const charFilter = (...chars: string[]): FirstCharFilter => ({
    ranges: chars.map((c) => {
      const cp = c.codePointAt(0) as number;
      return { lo: cp, hi: cp };
    }),
  });

  it("skips an alternative whose filter excludes the next character, still succeeding via a later one", () => {
    const input = "b";
    const pos = 0;
    const result = predictiveChoice([
      [lit("a"), charFilter("a")],
      [lit("b"), charFilter("b")],
    ])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("b");
    }
  });

  it("preserves ordered-choice semantics among alternatives whose filters both match", () => {
    // Both filters admit "a"; the *first* one in declaration order must
    // still win, exactly like plain `choice`.
    const input = "ax";
    const pos = 0;
    const result = predictiveChoice<[string, string]>([
      [lit("a"), charFilter("a")],
      [seq(lit("a"), lit("y")) as unknown as Parser<string>, charFilter("a")],
    ])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
    }
  });

  it("always attempts an alternative with a null filter, regardless of the next character", () => {
    const input = "z";
    const pos = 0;
    const result = predictiveChoice([
      [lit("a"), charFilter("a")],
      [lit("z"), null],
    ])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("z");
    }
  });

  it("always attempts every alternative at end-of-input, since there's no character to filter by", () => {
    const input = "";
    const pos = 0;
    const succeedsOnEmpty: Parser<string> = (_input, p) => ({
      success: true,
      val: "empty",
      current: p,
      next: p,
    });
    const result = predictiveChoice([
      [lit("a"), charFilter("a")],
      [succeedsOnEmpty, charFilter("q")],
    ])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("empty");
    }
  });

  it("fails fast, without running any alternative, when the next character matches no filter", () => {
    const input = "z";
    const pos = 0;
    let ran = false;
    const trackedA: Parser<string> = (i, p) => {
      ran = true;
      return lit("a")(i, p);
    };
    const result = predictiveChoice([
      [trackedA, charFilter("a")],
      [lit("b"), charFilter("b")],
    ])(input, pos);
    expect(result.success).toBe(false);
    expect(ran).toBe(false);
    if (!result.success) {
      expect(result.error.pos).toEqual(pos);
      expect(result.error.found).toBe("z");
    }
  });

  it("reports the union of all alternatives' filter chars as `expected` on a fast failure", () => {
    const input = "z";
    const pos = 0;
    const result = predictiveChoice([
      [lit("a"), charFilter("a")],
      [lit("b"), charFilter("b")],
    ])(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.expected).toEqual(['"a"', '"b"']);
    }
  });

  it("handles empty choice", () => {
    const input = "a";
    const pos = 0;
    const result = predictiveChoice([])(input, pos);
    expect(result.success).toBe(false);
  });

  it("matches an astral (surrogate-pair) character exactly via its code point, not its UTF-16 code units", () => {
    // U+1F600 is 2 UTF-16 code units; a filter naming the code point
    // directly must match the whole character, and a filter for an
    // adjacent BMP character must not.
    const face = "\u{1F600}";
    const cp = face.codePointAt(0) as number;
    const astralFilter: FirstCharFilter = { ranges: [{ lo: cp, hi: cp }] };
    const succeedsOnFace: Parser<string> = (i, p) => lit(face)(i, p);
    const pos = 0;

    const matched = predictiveChoice([[succeedsOnFace, astralFilter]])(
      face,
      pos,
    );
    expect(matched.success).toBe(true);

    const excluded = predictiveChoice([[succeedsOnFace, charFilter("a")]])(
      face,
      pos,
    );
    expect(excluded.success).toBe(false);
  });

  it("aggregates farthest-error expected values from the choice among surviving candidates when at least one survives", () => {
    const input = "xz";
    const pos = 0;
    const result = predictiveChoice([
      [
        sequence(lit("x"), lit("y")) as unknown as Parser<string>,
        charFilter("x"),
      ],
      [lit("a"), charFilter("a")],
    ])(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.expected).toBe('"y"');
      expect(result.error.pos).toBe(1);
    }
  });

  it("produces the exact same result as an equivalent plain `choice` for every input, across a battery of cases", () => {
    // The core soundness claim: filtering must never change which inputs
    // succeed, what value/position a success produces, or (for the cases
    // where more than one candidate survives filtering) which failure
    // wins.
    const plain = choice(lit("a"), lit("b"), sequence(lit("c"), lit("d")));
    const predictive = predictiveChoice<[string, [string, string]]>([
      [lit("a"), charFilter("a")],
      [lit("b"), charFilter("b")],
      [sequence(lit("c"), lit("d")), charFilter("c")],
    ]);

    for (const input of ["a", "b", "cd", "c", "cx", "z", ""]) {
      const pos = 0;
      const plainResult = plain(input, pos);
      const predictiveResult = predictive(input, pos);
      expect(predictiveResult.success).toBe(plainResult.success);
      if (plainResult.success && predictiveResult.success) {
        expect(predictiveResult.val).toEqual(plainResult.val);
        expect(predictiveResult.next).toEqual(plainResult.next);
      }
    }
  });

  // `choice`'s fatal-handling and farthest-error aggregation was factored
  // out into a helper (`tryOrderedCandidates`) shared with
  // `predictiveChoice`'s ASCII-table dispatch path. Before
  // that, `predictiveChoice` got cut/commit semantics "for free" by
  // delegating its filtered candidate list straight to `choice(...)`; the
  // tests below exercise the same scenarios as `describe("choice")`'s
  // fatal-handling tests above, but through `predictiveChoice`, to pin
  // that the shared helper still gives it identical behavior now that it
  // no longer calls `choice` at all.
  describe("cut/commit semantics, exercised through predictiveChoice's dispatch table", () => {
    it("does not try the next alternative once a committed sub-parser fails (ASCII dispatch-table path)", () => {
      const input = "ix";
      const pos = 0;
      const committedBranch = seq(lit("i"), commit(lit("f")));
      // `fallback` would itself SUCCEED on this input ("ix" starts with
      // "i") -- so the only way `result.success` can be `false` below is
      // if the dispatch table's trial loop actually stopped at the
      // committed branch's failure instead of falling through to try
      // `fallback` too.
      const fallback = lit("i");
      const result = predictiveChoice<[unknown, string]>([
        [committedBranch, charFilter("i")],
        [fallback, charFilter("i")],
      ])(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("f");
        // `fatal` is absorbed at THIS predictiveChoice's own boundary,
        // not forwarded -- same scoping rule as `choice`.
        expect(result.error.fatal).toBeFalsy();
      }
    });

    it("still tries the next alternative when the failure isn't fatal (ASCII dispatch-table path)", () => {
      const input = "ix";
      const pos = 0;
      const branch = seq(lit("i"), lit("f"));
      const fallback = lit("i");
      const result = predictiveChoice<[unknown, string]>([
        [branch, charFilter("i")],
        [fallback, charFilter("i")],
      ])(input, pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("i");
      }
    });

    it("a cut inside a nested predictiveChoice does not stop an ENCLOSING choice from trying its own remaining alternatives", () => {
      // Same structure and regression rationale as `choice`'s "a cut
      // inside a nested choice does not stop an ENCLOSING choice..."
      // test above, with the inner choice replaced by a
      // `predictiveChoice` -- the fatal-absorption boundary must hold
      // regardless of which of the two combinators is nested inside the
      // other.
      const input = "ybz";
      const pos = 0;
      const innerPredictiveChoice = predictiveChoice<[string, string]>([
        [
          seq(
            lit("y"),
            commit(lit("b")),
            commit(lit("c")),
          ) as unknown as Parser<string>,
          charFilter("y"),
        ],
        [lit("x"), charFilter("x")],
      ]);
      const outerFallback = seq(lit("y"), lit("b"), lit("z"));
      const result = choice(
        innerPredictiveChoice as unknown as Parser<unknown>,
        outerFallback as unknown as Parser<unknown>,
      )(input, pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["y", "b", "z"]);
        expect(result.next).toBe(3);
      }
    });

    it("does not try the next alternative once a committed sub-parser fails (non-ASCII fallback path)", () => {
      // Same scenario as the ASCII-table test above, but with filters
      // that exclude some ASCII code points, forcing the non-ASCII
      // fallback branch to be exercised via an astral input character.
      //
      // Crucially, this needs an ASCII-only-filtered alternative in the
      // mix too: `nonAsciiFallbackNeeded` (the flag that decides between
      // reusing `allCandidates` directly vs. actually running the
      // per-call `.filter()`) is only `true` when at least one
      // alternative's filter tops out below the ASCII boundary. With
      // every alternative astral-only (as an earlier version of this test
      // had it), `nonAsciiFallbackNeeded` stays `false` and the assertions
      // below would pass via the `allCandidates` early-return branch
      // instead of the `.filter()` branch this test is meant to cover.
      const astral = "\u{1F600}";
      const input = `${astral}x`;
      const pos = 0;
      const astralFilter: FirstCharFilter = {
        ranges: [
          {
            lo: astral.codePointAt(0) as number,
            hi: astral.codePointAt(0) as number,
          },
        ],
      };
      let asciiOnlyBranchRan = false;
      const asciiOnlyBranch: Parser<string> = (i, p) => {
        asciiOnlyBranchRan = true;
        return lit("a")(i, p);
      };
      const committedBranch = seq(lit(astral), commit(lit("f")));
      const fallback = lit(astral);
      const result = predictiveChoice<[unknown, string, string]>([
        [committedBranch, astralFilter],
        [fallback, astralFilter],
        [asciiOnlyBranch, charFilter("a")],
      ])(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("f");
        expect(result.error.fatal).toBeFalsy();
      }
      // Proves the ASCII-only alternative really was excluded by the
      // exact per-call check (its filter can't match an astral code
      // point), not merely absent from some unrelated table entry.
      expect(asciiOnlyBranchRan).toBe(false);
    });
  });

  // See `predictiveChoice`'s own doc comment, "Caller contract: a non-`null`
  // filter asserts 'skippable when excluded'", and `first-sets.ts`'s
  // `canCommitWithoutConsuming`: an alternative that can reach a `commit`
  // without having consumed input yet must be paired with a `null` filter,
  // never a real one, however narrow its computed FIRST set looks --
  // otherwise `predictiveChoice` can skip the very call that would have
  // produced the `fatal` failure the whole choice depends on. These tests
  // pin the CORRECT (contract-honoring) behavior at the runtime level; the
  // codegen-level regression for the bug this contract exists to prevent
  // lives in `packages/parser/src/cut-memoize.spec.ts`.
  describe("caller contract: an alternative reaching a commit without consuming input must get a null filter", () => {
    it("with the contract honored (filter: null), the whole choice fails once the cut fires -- it does not fall through to the next alternative", () => {
      // Mirrors `"a"? ~ "a" / "b"` on input "b": the first alternative's
      // FIRST set (if naively computed from the literal after the cut)
      // would be {a}, but `optional("a")` can take its empty-match branch
      // on ANY input, reach the commit, and then fail fatally when the
      // trailing "a" doesn't match. A correct caller passes `null` here.
      const nullablePrefixWithCommit = seq(
        optional(lit("a")),
        commit(lit("a")),
      ) as unknown as Parser<unknown>;
      const fallback = lit("b");
      const result = predictiveChoice<[unknown, string]>([
        [nullablePrefixWithCommit, null],
        [fallback, charFilter("b")],
      ])("b", 0);

      expect(result.success).toBe(false);
      if (!result.success) {
        // Absorbed at this predictiveChoice's own boundary, same scoping
        // rule as `choice`/`commit` -- not left `fatal` for a caller
        // further out to see.
        expect(result.error.fatal).toBeFalsy();
      }
    });

    it("for comparison: a filter that DOES exclude the current character (no commit reachable) is safely skippable", () => {
      // Sanity check that the fix isn't "predictiveChoice never skips
      // anything" -- an ordinary non-nullable, commit-free alternative is
      // still filtered exactly as before.
      let ranNonMatching = false;
      const nonMatching: Parser<string> = (i, p) => {
        ranNonMatching = true;
        return lit("a")(i, p);
      };
      const fallback = lit("b");
      const result = predictiveChoice<[string, string]>([
        [nonMatching, charFilter("a")],
        [fallback, charFilter("b")],
      ])("b", 0);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("b");
      }
      expect(ranNonMatching).toBe(false);
    });

    it("a null-filter alternative survives the dispatch trie even when it also carries a literalPrefix (regression)", () => {
      // A `null` filter is the "unconditionally triable, never excludable"
      // marker this suite already covers at the ASCII-bucket level above.
      // The optional third (`literalPrefix`) tuple element
      // (`packages/core/src/dispatch-trie.ts`'s `DispatchTrieNode`) has
      // its OWN, deeper excludability: `buildDispatchTrie` partitions
      // entries into per-next-character child groups by `literalPrefix`,
      // and an entry only propagates into groups matching ITS OWN prefix
      // -- unless its `remaining` is forced to `""`. Before the fix this
      // test pins, a `null`-filter alternative that ALSO carried a
      // `literalPrefix` (today's codegen never produces this combination
      // -- `codegen-optimized.ts`'s `tryGeneratePredictiveChoice` nulls
      // both together via the same `unsafeToSkip` check -- but nothing in
      // `predictiveChoice`'s own contract prevented a caller from doing
      // so) got excluded from every trie group except the one matching
      // its own prefix's second character, silently breaking
      // ordered-choice semantics: a LATER alternative sharing that
      // group's character could win over an EARLIER, unconditionally-
      // triable one it should never have been able to beat.
      //
      // `alt0` here always succeeds on "a" (standing in for an
      // alternative that can reach a commit without consuming -- see the
      // tests above -- collapsed to a plain success for a simpler,
      // sharper repro), given a literal prefix "ac" it does NOT actually
      // require. `alt1`/`alt2` share "ac"/"ad" prefixes so the trie
      // actually has >=2 prefixed entries to discriminate on. On input
      // "ad" (matching alt2's second character, NOT alt0's), ordered
      // choice must still let alt0 -- declared first -- win.
      const alwaysSucceedsOnA = lit("a");
      const result = predictiveChoice<[string, string, string]>([
        [alwaysSucceedsOnA, null, "ac"],
        [lit("ac"), charFilter("a"), "ac"],
        [lit("ad"), charFilter("a"), "ad"],
      ])("ad", 0);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("a");
      }
    });
  });

  describe("ASCII dispatch table construction", () => {
    it("every ASCII code point admitted by a range filter independently reaches the same candidate (table dedup doesn't drop entries)", () => {
      // A digit class filter admits every one of '0'-'9' identically --
      // the table-construction dedup shares one candidate array instance
      // across all ten entries (see the doc comment on the construction
      // loop), but that must never mean only SOME of those ten code
      // points actually get routed to it. Exercise all ten explicitly.
      const digitFilter: FirstCharFilter = { ranges: [{ lo: 48, hi: 57 }] };
      const parser = predictiveChoice([[lit("5"), digitFilter]]);
      const pos = 0;
      for (const digit of "0123456789") {
        const result = parser(digit, pos);
        if (digit === "5") {
          expect(result.success).toBe(true);
        } else {
          // Reached (and failed inside) `lit("5")`, not the "no
          // candidates matched" fast-failure -- proves this code point's
          // table entry does contain the candidate, not an empty array.
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.expected).toBe('"5"');
          }
        }
      }
    });

    it("a filter range spanning the ASCII/non-ASCII boundary matches correctly on both sides", () => {
      // `[a-é]` (lo=0x61 'a', hi=0xE9 'é') straddles the 128-entry
      // table boundary: ASCII code points in range (e.g. 'z' = 0x7A) must
      // still hit the table, and non-ASCII code points in range (e.g.
      // 0xE9 itself) must be caught by the non-ASCII fallback -- neither
      // side should treat this filter as excluding the other side's
      // in-range characters.
      const spanningFilter: FirstCharFilter = {
        ranges: [{ lo: 0x61, hi: 0xe9 }],
      };
      const parser = predictiveChoice([
        [
          (input: string, p: number) => ({
            success: true as const,
            val: input[p] as string,
            current: p,
            next: p + 1,
          }),
          spanningFilter,
        ],
      ]);
      const pos = 0;
      expect(parser("z", pos).success).toBe(true);
      expect(parser(String.fromCodePoint(0xe9), pos).success).toBe(true);
      expect(parser("A", pos).success).toBe(false);
    });
  });

  describe("literal-prefix trie (third tuple slot)", () => {
    const iFilter = charFilter("i");

    it('does not lose the shorter alternative to a deepest-node-wins bug: "==" / "=" on "=x" still matches "="', () => {
      // The trace: input "=x" descends the trie one level
      // (matching "="'s shared first character), finds no child for "x",
      // and must fall back to trying BOTH "==" and "=" at this node, in
      // declaration order -- not just whichever alternative's literal is
      // longest.
      const parser = predictiveChoice([
        [lit("=="), charFilter("="), "=="],
        [lit("="), charFilter("=")],
      ]);
      const pos = 0;
      const result = parser("=x", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("=");
        expect(result.next).toBe(1);
      }
      const eqeq = parser("==", pos);
      expect(eqeq.success).toBe(true);
      if (eqeq.success) expect(eqeq.val).toBe("==");
    });

    it("narrows a keyword-dense bucket by a shared literal prefix without running every candidate", () => {
      const ran: string[] = [];
      const tracked = (label: string, literalStr: string): Parser<string> => {
        const inner = lit(literalStr);
        return (input, p) => {
          ran.push(label);
          return inner(input, p);
        };
      };
      const parser = predictiveChoice([
        [tracked("if", "if"), iFilter, "if"],
        [tracked("import", "import"), iFilter, "import"],
        [tracked("interface", "interface"), iFilter, "interface"],
        [tracked("instanceof", "instanceof"), iFilter, "instanceof"],
        [tracked("ident", "i"), iFilter], // no-prefix fallback (matches bare "i")
      ]);
      const pos = 0;

      ran.length = 0;
      const result = parser("instanceof", pos);
      expect(result.success).toBe(true);
      if (result.success) expect(result.val).toBe("instanceof");
      // The trie should have narrowed to {instanceof, ident} by depth 2
      // ("in" is shared only by interface/instanceof/ident) and then to
      // {instanceof, ident} again at depth 3+ -- "if"/"import" must never
      // even be attempted once "instanceof"'s later characters diverge
      // from them.
      expect(ran).not.toContain("if");
      expect(ran).not.toContain("import");
    });

    it("never excludes a no-literal-prefix alternative at any depth, even deep inside a shared-prefix bucket", () => {
      const parser = predictiveChoice([
        [lit("interface"), iFilter, "interface"],
        [lit("instanceof"), iFilter, "instanceof"],
        [lit("in"), iFilter], // no prefix -- must survive every depth
      ]);
      const pos = 0;
      // "instant" shares "insta" with neither "interface" (diverges at
      // depth 2: 'n'-'t') -- wait, both start "in": diverge at depth 2
      // ('t' vs 'e'/'s'). Regardless of how deep the shared-prefix
      // alternatives get excluded, "in" (no prefix) must still be
      // attempted and succeed here since it matches the first two chars.
      const result = parser("instant", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("in");
        expect(result.next).toBe(2);
      }
    });

    it("stops descending at end of input and falls back to the current node's candidates", () => {
      const parser = predictiveChoice([
        [lit("if"), iFilter, "if"],
        [lit("import"), iFilter, "import"],
      ]);
      const pos = 0;
      // "i" alone: depth-1 lookup reads past the end of input
      // (`charCodeAt` -> NaN), which must not match any child and must
      // not throw -- falls back to the root bucket's candidates (both).
      const result = parser("i", pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.expected).toEqual(['"if"', '"import"']);
      }
    });

    it("caller contract: literalPrefix must be a prefix EVERY match shares, and filter must match exactly literalPrefix's first character", () => {
      // See predictiveChoice's own doc comment, "Caller contract:
      // `literalPrefix` must be a prefix EVERY match shares, and `filter`
      // must match exactly that first character" -- this pins both the
      // honored case (matches plain `choice`) and the violated case (does
      // NOT match plain `choice`, silently returning a different
      // alternative's result rather than crashing) as a concrete,
      // standalone regression, distinct from the `null`-filter contract
      // tests above.
      //
      // `alt0` can match starting with EITHER 'a' or 'z' -- its true FIRST
      // set is {a, z} -- but is given `literalPrefix: "zbc"`, a prefix
      // that only describes its 'z' branch. `alt1`/`alt2` share the "ab"
      // prefix so the 'a' bucket's trie actually has >=2 prefixed entries
      // to discriminate on, which is what triggers the deeper,
      // prefix-partitioned lookup this contract governs (a single
      // prefixed entry per bucket never builds a trie at all -- see
      // `buildDispatchTrie`'s doc comment, `./dispatch-trie.ts`).
      const alt0 = choice(lit("abdEF"), lit("zbc"));
      const alt1 = lit("abc");
      const alt2 = lit("abd");

      // Honored: filter restricted to exactly `literalPrefix`'s first
      // character ('a', matching alt0's "abdEF" branch this time, not its
      // "zbc" one) -- matches plain `choice` on every input that reaches
      // the 'a' bucket.
      const honored = predictiveChoice<[string, string, string]>([
        [alt0, charFilter("a"), "abd"],
        [alt1, charFilter("a"), "abc"],
        [alt2, charFilter("a"), "abd"],
      ]);
      const plain = choice(alt0, alt1, alt2);
      for (const input of ["abdEF", "abc", "abd"]) {
        const honoredResult = honored(input, 0);
        const plainResult = plain(input, 0);
        expect(honoredResult.success).toBe(plainResult.success);
        if (honoredResult.success && plainResult.success) {
          expect(honoredResult.val).toBe(plainResult.val);
          expect(honoredResult.next).toBe(plainResult.next);
        }
      }

      // Violated: filter broadened to {a, z} (a sound over-approximation
      // of alt0's TRUE first-character set on its own) but literalPrefix
      // still "zbc" -- describing only alt0's 'z' branch. On "abdEF",
      // plain `choice` tries alt0 first and matches its "abdEF" branch;
      // predictiveChoice instead partitions the 'a' bucket's trie by
      // "zbc"'s second character ('b'), which alt0's entry propagates
      // into via `literalPrefix.slice(1)` regardless of which branch will
      // actually match -- so at depth 2 it competes on 'b' against
      // alt1/alt2's own "ab" prefixes and loses to declaration order
      // there, rather than being tried (and winning) at the top level.
      const violated = predictiveChoice<[string, string, string]>([
        [
          alt0,
          {
            ranges: [
              { lo: 97, hi: 97 },
              { lo: 122, hi: 122 },
            ],
          },
          "zbc",
        ],
        [alt1, charFilter("a"), "abc"],
        [alt2, charFilter("a"), "abd"],
      ]);
      const plainOnAbdEF = plain("abdEF", 0);
      const violatedOnAbdEF = violated("abdEF", 0);
      expect(plainOnAbdEF).toEqual({
        success: true,
        val: "abdEF",
        current: 0,
        next: 5,
      });
      // Demonstrably NOT what plain `choice` returns -- alt0 was silently
      // dropped from the 'a' bucket's trie, and alt2 ("abd") won instead.
      expect(violatedOnAbdEF).not.toEqual(plainOnAbdEF);
      expect(violatedOnAbdEF).toEqual({
        success: true,
        val: "abd",
        current: 0,
        next: 3,
      });
    });
  });
});

describe("sequence", () => {
  it("should be an alias for seq", () => {
    const input = "abc";
    const pos = 0;
    const result = sequence(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "b", "c"]);
      expect(result.next).toBe(3);
    }
  });
});

describe("maybe", () => {
  it("should return the result if parser succeeds", () => {
    const input = "a";
    const pos = 0;
    const result = maybe(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toBe(1);
    }
  });

  it("should return null if parser fails", () => {
    const input = "b";
    const pos = 0;
    const result = maybe(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeNull();
      expect(result.next).toEqual(pos);
    }
  });

  it("re-raises a fatal (cut/commit) failure instead of swallowing it into null -- mirrors optional's identical guard in repetition.ts", () => {
    const committedBranch = seq(lit("if"), commit(lit("then")));
    const result = maybe(committedBranch)("ifelse", 0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fatal).toBe(true);
    }
  });
});

describe("withDefault", () => {
  it("should return the parsed value if parser succeeds", () => {
    const input = "a";
    const pos = 0;
    const result = withDefault(lit("a"), "default")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toBe(1);
    }
  });

  it("should return the default value if parser fails", () => {
    const input = "b";
    const pos = 0;
    const result = withDefault(lit("a"), "default")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("default");
      expect(result.next).toEqual(pos); // Position should not advance
    }
  });

  it("re-raises a fatal (cut/commit) failure instead of swallowing it into the default", () => {
    // Without this, `withDefault(seq(lit("if"), commit(cond)), fallback)`
    // would silently discard the cut's intent the moment `cond` fails --
    // exactly the bug `optional` (repetition.ts) already guards against.
    // Widened to `Parser<unknown>` so `withDefault`'s default-value
    // parameter isn't forced into the branch's own literal tuple type --
    // irrelevant here since the fatal path never actually returns it.
    const committedBranch: Parser<unknown> = seq(
      lit("if"),
      commit(lit("then")),
    );
    const result = withDefault(committedBranch, "default")("ifelse", 0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fatal).toBe(true);
    }
  });
});

describe("reject", () => {
  it("should succeed if the given parser fails", () => {
    const input = "b";
    const pos = 0;
    const result = reject(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeNull();
      expect(result.next).toEqual(pos); // Position should not advance
    }
  });

  it("should fail if the given parser succeeds", () => {
    const input = "a";
    const pos = 0;
    const result = reject(lit("a"))(input, pos);
    expect(result.success).toBe(false);
  });

  // Mirrors `notPredicate`'s watermark snapshot/restore
  // (`./lookahead.spec.ts`, `./lookahead.ts`'s doc comment): a failure
  // inside the probed parser is the EXPECTED, desired outcome that makes
  // `reject` succeed -- not a genuine failure of the surrounding parse --
  // so it must not leave the shared farthest-failure watermark (see
  // `./failure.ts`) pointing at a position/expectation unrelated to
  // whatever the parse actually goes on to fail at.
  it("restores the farthest-failure watermark to its pre-probe state on success, discarding the probe's own excursion", () => {
    const input = "ax";
    // The probe matches "a" (one character) before failing partway
    // through the 5-character literal "bbbbb" -- deep enough that, left
    // unrestored, its watermark position (>= 1) would outrank a
    // subsequent unrelated failure at position 0.
    const probe = seq(lit("a"), lit("bbbbb"));
    const snapshotBefore = snapshotFailureWatermark();
    const rejectResult = reject(probe)(input, 0);
    expect(rejectResult.success).toBe(true);

    // The watermark is back to whatever it was before the probe ran --
    // the probe's own excursion left no trace.
    const snapshotAfterReject = snapshotFailureWatermark();
    expect(snapshotAfterReject).toEqual(snapshotBefore);

    // An unrelated, shallower failure right after: without the restore,
    // the watermark would still hold the probe's stale (deeper) position
    // and this failure's own `fail()` call (`pos: 0`) would lose to it
    // (`fail` only updates the watermark when the new position is >=
    // the existing one).
    const unrelated = lit("z")(input, 0);
    expect(unrelated.success).toBe(false);
    if (!unrelated.success) {
      expect(unrelated.error.pos).toBe(0);
      expect(unrelated.error.found).toBe("a");
    }
  });
});

describe("lazy", () => {
  it("delegates to the parser returned by the thunk", () => {
    const input = "a";
    const pos = 0;
    const result = lazy(() => lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
    }
  });

  it("defers reading a not-yet-initialized const, breaking the TDZ that a plain reference hits", () => {
    // Mirrors the shape generated code produces for mutually recursive
    // rules: `a` refers to `b`, which is declared below it. A direct
    // reference (`b` instead of `lazy(() => b)`) would throw
    // "Cannot access 'b' before initialization" as soon as `a`'s
    // initializer ran.
    const a: Parser<unknown> = sequence(
      lit("("),
      lazy(() => b),
      lit(")"),
    );
    const b: Parser<unknown> = choice(a, lit("x"));

    const pos = 0;
    const result = a("(((x)))", pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toBe(7);
    }
  });
});
