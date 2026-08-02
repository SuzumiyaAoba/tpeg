import { describe, expect, it } from "bun:test";
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
  withDefault,
} from "./combinators";
import type { FirstCharFilter } from "./combinators";
import type { Parser } from "./types";
import { createFailure } from "./utils";

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
    const input = "d";
    const pos = 0;
    const result = choice(lit("a"), lit("b"))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.expected).toEqual(["a", "b"]);
    }
  });

  it("should handle nested expected arrays in failures", () => {
    const input = "d";
    const pos = 0;
    const parserWithNestedExpected = (_: string, pos: number) =>
      createFailure("fail", pos, { expected: ["x", "y"] });
    const result = choice(lit("a"), parserWithNestedExpected)(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.expected).toEqual(["a", "x", "y"]);
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
      expect(result.error.expected).toEqual(["y"]);
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
      expect(result.error.expected).toEqual(["y", "w"]);
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
      expect(result.error.expected).toEqual(["y"]);
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

  // Pillar 2 of the perf plan factored `choice`'s fatal-handling and
  // farthest-error aggregation out into a helper (`tryOrderedCandidates`)
  // shared with `predictiveChoice`'s ASCII-table dispatch path. Before
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
            expect(result.error.expected).toEqual(["5"]);
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
