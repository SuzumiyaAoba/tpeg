import { beforeEach, describe, expect, it } from "bun:test";
import { lit } from "./basic";
import { choice, commit, seq } from "./combinators";
import { resetFailureWatermark } from "./failure";
import {
  assert,
  and,
  andPredicate,
  negative,
  not,
  notPredicate,
  positive,
} from "./lookahead";
import { createTestPos } from "./test-utils";

// See `combinators.spec.ts`'s identical `beforeEach` -- the farthest-failure
// watermark (`./failure.ts`) is module-global, keyed by input string VALUE.
beforeEach(() => {
  resetFailureWatermark();
});

describe("andPredicate", () => {
  it("should succeed if the parser succeeds", () => {
    const input = "abc";
    const pos = createTestPos(0);
    const result = andPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeUndefined();
      expect(result.next).toEqual(pos); // position is not advanced
      expect(result.current).toEqual(pos);
    }
  });

  it("should fail if the parser fails", () => {
    // `andPredicate` now relays the child's failure UNCHANGED instead of
    // wrapping it with its own message/context/parserName -- see
    // `./failure.ts`'s lazy failure diagnostics: the child's own `fail()`
    // call already recorded
    // the right position/expectation, so the failure is `lit("a")`'s own,
    // not "andPredicate"'s.
    const input = "bcd";
    const pos = createTestPos(0);
    const result = andPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Expected "a", found "b"');
      expect(result.error.parserName).toBe("literal");
      expect(result.error.context).toBeUndefined();
    }
  });

  it("should work at different positions in the input", () => {
    const input = "xyzabc";
    const pos = createTestPos(3);
    const result = andPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toEqual(pos); // position should not advance
    }
  });

  it("should handle empty input gracefully", () => {
    const input = "";
    const pos = createTestPos(0);
    const result = andPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(false);
  });

  it("should handle end of input", () => {
    const input = "a";
    const pos = createTestPos(1); // at end of input
    const result = andPredicate(lit("b"))(input, pos);
    expect(result.success).toBe(false);
  });

  it("relays the child parser's own failure unchanged rather than adding lookahead-specific context", () => {
    // Superseded by `./failure.ts`'s lazy failure diagnostics: `andPredicate`
    // no longer wraps a child failure with its own "in positive lookahead" context
    // (see the "should fail if the parser fails" test above for the
    // rationale). Kept as a regression pin on the current behavior rather
    // than deleted outright.
    const input = "bcd";
    const pos = createTestPos(0);
    const result = andPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.context).toBeUndefined();
    }
  });
});

// A cut/commit (`commit`, `./combinators.ts`) written inside a lookahead
// predicate must stay scoped to that predicate's own probe: `&e`/`!e` are
// each a self-contained "does e match here" check, never themselves one
// alternative of some outer `choice` -- so a `Cut` inside one can only
// sensibly mean "commit within e's own attempt." Both `andPredicate` and
// `notPredicate` must absorb a `fatal` failure at their own boundary
// (swap it back to non-fatal before relaying/converting it) rather than
// letting it escape to whatever encloses the predicate. See
// `andPredicate`'s own doc comment for the worked counterexample this
// closes: `(&(a ~ b)) / c` used to let a cut inside the lookahead wrongly
// suppress `c`.
describe("cut/commit scoping inside a lookahead predicate", () => {
  it("andPredicate absorbs a fatal failure from inside its probe -- an enclosing choice still tries its next alternative", () => {
    const committedProbe = seq(lit("a"), commit(lit("b")));
    const parser = choice(
      seq(andPredicate(committedProbe), lit("a")),
      lit("ac"),
    );
    // "ac": the probe matches "a" then fails to match "b" against "c" --
    // fatally, inside the probe. Without absorption, that fatal failure
    // would escape andPredicate and stop the outer choice from ever
    // trying the second alternative, even though "ac" plainly matches it.
    const result = parser("ac", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("ac");
    }
  });

  it("andPredicate's own failure (the probe genuinely not matching) is unaffected -- still an ordinary, non-fatal failure", () => {
    const committedProbe = seq(lit("a"), commit(lit("b")));
    const result = andPredicate(committedProbe)("ac", 0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fatal).toBeFalsy();
    }
  });

  it("notPredicate already absorbed this (turns any child failure, fatal or not, into an ordinary success) -- pinned for comparison", () => {
    const committedProbe = seq(lit("a"), commit(lit("b")));
    const parser = choice(
      seq(notPredicate(committedProbe), lit("a")),
      lit("x"),
    );
    // "ac": the probe fails (fatally, deep inside), so notPredicate
    // succeeds; the outer seq then matches "a" against "ac" wholesale.
    const result = parser("ac", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([undefined, "a"]);
    }
  });
});

describe("notPredicate", () => {
  it("should succeed if the parser fails", () => {
    const input = "bcd";
    const pos = createTestPos(0);
    const result = notPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeUndefined();
      expect(result.next).toEqual(pos); // position is not advanced
      expect(result.current).toEqual(pos);
    }
  });

  it("should fail if the parser succeeds", () => {
    // Message now comes from the shared farthest-failure watermark
    // (`./failure.ts`'s lazy failure diagnostics): `found` is the actual
    // character at `pos` (derived), not the fixed phrase "matching
    // pattern"; there's no "in negative lookahead" context frame either.
    const input = "abc";
    const pos = createTestPos(0);
    const result = notPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe(
        'Expected pattern not to match, found "a"',
      );
      expect(result.error.parserName).toBe("notPredicate");
      expect(result.error.context).toBeUndefined();
      expect(result.error.expected).toBe("pattern not to match");
      expect(result.error.found).toBe("a");
      expect(result.error.pos).toEqual(pos);
    }
  });

  it("should work at different positions in the input", () => {
    const input = "xyzdef";
    const pos = createTestPos(3);
    const result = notPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toEqual(pos); // position should not advance
    }
  });

  it("should handle empty input gracefully", () => {
    const input = "";
    const pos = createTestPos(0);
    const result = notPredicate(lit("a"))(input, pos);
    expect(result.success).toBe(true); // fails to match "a", so notPredicate succeeds
  });

  it("treats a fatal (cut/commit) failure inside the probed parser as an ordinary failure -- the probe still succeeds, unlike optional/withDefault", () => {
    // Deliberate, documented asymmetry with `optional`/`withDefault`: a
    // lookahead probes without ever committing to anything, so a cut
    // reached while probing doesn't mean "stop backtracking here" the way
    // it does when a probe's result is the actual parse outcome. Pinned so
    // a future change doesn't "fix" this into matching `optional`'s
    // fatal-propagating behavior by mistake.
    const committedBranch = seq(lit("i"), commit(lit("f")));
    const input = "ix";
    const pos = createTestPos(0);
    const result = notPredicate(committedBranch)(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toEqual(pos);
    }
  });

  it("should handle end of input", () => {
    const input = "a";
    const pos = createTestPos(1); // at end of input
    const result = notPredicate(lit("b"))(input, pos);
    expect(result.success).toBe(true); // fails to match "b", so notPredicate succeeds
  });
});

describe("Aliases", () => {
  describe("and", () => {
    it("should be an alias for andPredicate", () => {
      const input = "abc";
      const pos = createTestPos(0);
      const result = and(lit("a"))(input, pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBeUndefined();
        expect(result.next).toEqual(pos);
      }
    });

    it("should behave identically to andPredicate", () => {
      const input = "xyz";
      const pos = createTestPos(0);
      const andResult = and(lit("a"))(input, pos);
      const andPredicateResult = andPredicate(lit("a"))(input, pos);
      expect(andResult).toEqual(andPredicateResult);
    });
  });

  describe("positive", () => {
    it("should be an alias for andPredicate", () => {
      const input = "abc";
      const pos = createTestPos(0);
      const result = positive(lit("a"))(input, pos);
      expect(result.success).toBe(true);
    });
  });

  describe("assert", () => {
    it("should be an alias for andPredicate", () => {
      const input = "abc";
      const pos = createTestPos(0);
      const result = assert(lit("a"))(input, pos);
      expect(result.success).toBe(true);
    });
  });

  describe("not", () => {
    it("should be an alias for notPredicate", () => {
      const input = "bcd";
      const pos = createTestPos(0);
      const result = not(lit("a"))(input, pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBeUndefined();
        expect(result.next).toEqual(pos);
      }
    });

    it("should behave identically to notPredicate", () => {
      const input = "abc";
      const pos = createTestPos(0);
      const notResult = not(lit("a"))(input, pos);
      const notPredicateResult = notPredicate(lit("a"))(input, pos);
      expect(notResult).toEqual(notPredicateResult);
    });
  });

  describe("negative", () => {
    it("should be an alias for notPredicate", () => {
      const input = "bcd";
      const pos = createTestPos(0);
      const result = negative(lit("a"))(input, pos);
      expect(result.success).toBe(true);
    });
  });
});

describe("Edge Cases", () => {
  it("should handle complex nested lookaheads", () => {
    const input = "abc";
    const pos = createTestPos(0);
    // Double positive lookahead
    const result = andPredicate(andPredicate(lit("a")))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toEqual(pos);
    }
  });

  it("should handle positive followed by negative lookahead", () => {
    const input = "abc";
    const pos = createTestPos(0);
    // Positive lookahead for "a" followed by negative lookahead for "b"
    const positiveResult = andPredicate(lit("a"))(input, pos);
    expect(positiveResult.success).toBe(true);

    const negativeResult = notPredicate(lit("b"))(input, pos);
    expect(negativeResult.success).toBe(true); // "b" is not at position 0
  });

  it("should handle Unicode characters", () => {
    const input = "🚀abc";
    const pos = createTestPos(0);
    const result = andPredicate(lit("🚀"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toEqual(pos);
    }
  });

  it("should preserve position accuracy with multi-byte characters", () => {
    const input = "🚀🔥";
    const pos = createTestPos(2); // after the rocket emoji
    const result = andPredicate(lit("🔥"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toEqual(pos);
    }
  });
});
