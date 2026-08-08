/**
 * Direct unit tests for the farthest-failure watermark (`./failure.ts`).
 * Previously only exercised indirectly via
 * `combinators.spec.ts`'s `choice`/`predictiveChoice` tests -- this file
 * targets `fail`/`materializeParseError`/`resetFailureWatermark`/
 * `snapshotFailureWatermark`/`restoreFailureWatermark`/`isFatalFailure`
 * directly, including the reentrancy/lifecycle edge cases the module's own
 * doc comment calls out.
 *
 * Every test starts from `resetFailureWatermark()` (see `beforeEach`
 * below): the watermark is module-global state, and `fail`'s own
 * "new parse" detection compares the input STRING BY VALUE (`input !==
 * watermarkInput`), not by some per-parse identity -- two unrelated tests
 * that happen to `fail()` on an identical string content would otherwise
 * silently share a watermark. Resetting explicitly sidesteps that rather
 * than relying on distinct-looking input strings to save each test.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  FAIL,
  FAIL_FATAL,
  fail,
  isFatalFailure,
  materializeParseError,
  resetFailureWatermark,
  restoreFailureWatermark,
  snapshotFailureWatermark,
} from "./failure";

beforeEach(() => {
  resetFailureWatermark();
});

describe("fail", () => {
  it("returns the FAIL singleton", () => {
    expect(fail("abc", 0, { label: "x" })).toBe(FAIL);
  });

  it("records the first failure on a fresh watermark", () => {
    fail("abc", 1, { label: "digit" });
    const error = materializeParseError(false);
    expect(error.pos).toBe(1);
    expect(error.expected).toBe("digit");
  });

  it("keeps the farther of two failures, discarding the closer one", () => {
    fail("abcdef", 1, { label: "close" });
    fail("abcdef", 4, { label: "far" });
    const error = materializeParseError(false);
    expect(error.pos).toBe(4);
    expect(error.expected).toBe("far");
  });

  it("ignores a failure that is closer than the current watermark", () => {
    fail("abcdef", 4, { label: "far" });
    fail("abcdef", 1, { label: "close" });
    const error = materializeParseError(false);
    expect(error.pos).toBe(4);
    expect(error.expected).toBe("far");
  });

  it("merges distinct expectations tied at the same farthest position", () => {
    fail("abcdef", 2, { label: "a" });
    fail("abcdef", 2, { label: "b" });
    const error = materializeParseError(false);
    expect(error.expected).toEqual(["a", "b"]);
  });

  it("does not duplicate the exact same Expectation object recorded twice", () => {
    const exp = { label: "digit" };
    fail("abcdef", 2, exp);
    fail("abcdef", 2, exp);
    const error = materializeParseError(false);
    expect(error.expected).toBe("digit");
  });

  it("treats a call whose input differs by value as a new parse", () => {
    fail("input-one", 5, { label: "old" });
    fail("input-two", 0, { label: "new" });
    const error = materializeParseError(false);
    expect(error.pos).toBe(0);
    expect(error.expected).toBe("new");
  });

  it("treats two calls with equal-content input strings as the same in-progress parse", () => {
    // `fail`'s "new parse" check is `input !== watermarkInput`, a plain
    // string comparison -- JS strings compare by VALUE (there is no
    // separate notion of string identity for primitives), so a second,
    // independently-built string with identical content is indistinguishable
    // from the first here, even if the two calls actually belong to two
    // unrelated parses. This is the documented lifecycle behavior (see
    // `./failure.ts`'s module doc comment): it can only make a subsequent
    // error message less precise, never affect parse success/position.
    const first = `shared-${"content"}`;
    const second = "shared-content";
    expect(first === second).toBe(true); // equal by value, as any two equal strings are

    fail(first, 3, { label: "from-first-call" });
    fail(second, 3, { label: "from-second-call" });
    const error = materializeParseError(false);
    // Both expectations were merged into the same watermark entry, rather
    // than the second call starting a fresh one.
    expect(error.expected).toEqual(["from-first-call", "from-second-call"]);
  });
});

describe("materializeParseError", () => {
  it("reports a generic failure when nothing was ever recorded", () => {
    const error = materializeParseError(false);
    expect(error.pos).toBe(-1);
    expect(error.expected).toBeUndefined();
    expect(error.found).toBeUndefined();
    expect(error.message).toBe("Parse failed");
  });

  it("reports the matched character as `found`", () => {
    fail("abc", 1, { label: "x" });
    const error = materializeParseError(false);
    expect(error.found).toBe("b");
    expect(error.message).toBe('Expected x, found "b"');
  });

  it('reports "end of input" when the farthest position is at or past the input\'s end', () => {
    fail("abc", 3, { label: "x" });
    const error = materializeParseError(false);
    expect(error.found).toBe("end of input");
    expect(error.message).toBe('Expected x, found "end of input"');
  });

  it('joins multiple tied expectations with "or" in the message', () => {
    fail("abc", 0, { label: "a" });
    fail("abc", 0, { label: "b" });
    const error = materializeParseError(false);
    expect(error.message).toBe('Expected a or b, found "a"');
  });

  it("attributes parserName when every tied expectation agrees on it", () => {
    fail("abc", 0, { label: "digit", parserName: "number" });
    const error = materializeParseError(false);
    expect(error.parserName).toBe("number");
  });

  it("omits parserName when tied expectations disagree on it", () => {
    fail("abc", 0, { label: "digit", parserName: "number" });
    fail("abc", 0, { label: "letter", parserName: "identifier" });
    const error = materializeParseError(false);
    expect(error.parserName).toBeUndefined();
  });

  it("omits parserName when it was never supplied", () => {
    fail("abc", 0, { label: "digit" });
    const error = materializeParseError(false);
    expect(error.parserName).toBeUndefined();
  });

  it("includes fatal: true only when asked to materialize a fatal failure", () => {
    fail("abc", 0, { label: "x" });
    expect(materializeParseError(true).fatal).toBe(true);
    expect(materializeParseError(false).fatal).toBeUndefined();
  });
});

describe("resetFailureWatermark", () => {
  it("clears position, input, and expectations back to their initial state", () => {
    fail("abc", 2, { label: "x" });
    resetFailureWatermark();
    const error = materializeParseError(false);
    expect(error.pos).toBe(-1);
    expect(error.expected).toBeUndefined();
  });

  it("lets a subsequent closer failure be recorded, since there is no prior farther one", () => {
    fail("abc", 2, { label: "far" });
    resetFailureWatermark();
    fail("abc", 0, { label: "close" });
    const error = materializeParseError(false);
    expect(error.pos).toBe(0);
    expect(error.expected).toBe("close");
  });
});

describe("snapshotFailureWatermark / restoreFailureWatermark", () => {
  it("restores exactly the state captured at snapshot time", () => {
    fail("abcdef", 2, { label: "before" });
    const snapshot = snapshotFailureWatermark();

    fail("abcdef", 4, { label: "after" });
    expect(materializeParseError(false).pos).toBe(4);

    restoreFailureWatermark(snapshot);
    const restored = materializeParseError(false);
    expect(restored.pos).toBe(2);
    expect(restored.expected).toBe("before");
  });

  it("never mutates a previously captured snapshot's expected array", () => {
    fail("abcdef", 2, { label: "first" });
    const snapshot = snapshotFailureWatermark();
    expect(snapshot.expected).toEqual([{ label: "first" }]);

    // A second expectation tied at the same farthest position is appended
    // to the LIVE watermark -- `watermarkExpected = [...watermarkExpected,
    // exp]` always replaces the array wholesale rather than pushing in
    // place, so the earlier snapshot's array reference must be unaffected.
    fail("abcdef", 2, { label: "second" });
    expect(snapshot.expected).toEqual([{ label: "first" }]);
    expect(snapshot.expected.length).toBe(1);
  });

  it("round-trips a snapshot taken on a fresh (never-failed) watermark", () => {
    const snapshot = snapshotFailureWatermark();
    fail("abc", 0, { label: "x" });
    restoreFailureWatermark(snapshot);
    const error = materializeParseError(false);
    expect(error.pos).toBe(-1);
    expect(error.expected).toBeUndefined();
  });
});

describe("isFatalFailure", () => {
  it("is true for the FAIL_FATAL singleton", () => {
    expect(isFatalFailure(FAIL_FATAL)).toBe(true);
  });

  it("is false for the FAIL singleton", () => {
    expect(isFatalFailure(FAIL)).toBe(false);
  });

  it("reads .error.fatal directly for a concrete failure", () => {
    expect(
      isFatalFailure({
        success: false,
        error: { message: "m", pos: 0, fatal: true },
      }),
    ).toBe(true);
    expect(
      isFatalFailure({
        success: false,
        error: { message: "m", pos: 0, fatal: false },
      }),
    ).toBe(false);
    expect(
      isFatalFailure({ success: false, error: { message: "m", pos: 0 } }),
    ).toBe(false);
  });
});

describe("FAIL / FAIL_FATAL singletons", () => {
  it("are frozen, always-unsuccessful results", () => {
    expect(FAIL.success).toBe(false);
    expect(FAIL_FATAL.success).toBe(false);
    expect(Object.isFrozen(FAIL)).toBe(true);
    expect(Object.isFrozen(FAIL_FATAL)).toBe(true);
  });

  it("FAIL_FATAL's .error always carries fatal: true; FAIL's never does", () => {
    fail("abc", 0, { label: "x" });
    expect(FAIL_FATAL.error.fatal).toBe(true);
    expect(FAIL.error.fatal).toBeUndefined();
  });

  it("their .error getter reflects the CURRENT watermark, not a value fixed at creation", () => {
    fail("abc", 0, { label: "first" });
    expect(FAIL.error.pos).toBe(0);
    expect(FAIL.error.expected).toBe("first");

    fail("abcdef", 4, { label: "second" });
    expect(FAIL.error.pos).toBe(4);
    expect(FAIL.error.expected).toBe("second");
  });
});
