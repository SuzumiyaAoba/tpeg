import { describe, expect, it } from "bun:test";
import { lit } from "./basic";
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
    // wrapping it with its own message/context/parserName -- see Pillar 6
    // of the perf plan: the child's own `fail()` call already recorded
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
    // Superseded by Pillar 6 of the perf plan: `andPredicate` no longer
    // wraps a child failure with its own "in positive lookahead" context
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
    // (`./failure.ts`, Pillar 6 of the perf plan): `found` is the actual
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
