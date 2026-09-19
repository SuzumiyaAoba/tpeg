/**
 * Tests for the `IGNORED` sentinel + `ignore(...)` wrapper
 * (`./ignored.ts`) -- the mechanism `@skip`-inserted boundary parsers
 * ride on: an ignored element consumes input but contributes NOTHING to
 * the enclosing `sequence`/`captureSequence` result.
 */

import { beforeEach, describe, expect, it } from "vite-plus/test";
import { literal } from "./basic";
import { capture, captureSequence } from "./capture";
import { choice, sequence } from "./combinators";
import { resetFailureWatermark } from "./failure";
import { IGNORED, ignore } from "./ignored";
import { optional } from "./repetition";

// See `combinators.spec.ts`'s identical `beforeEach` -- the
// farthest-failure watermark (`./failure.ts`) is module-global, keyed by
// input string VALUE.
beforeEach(() => {
  resetFailureWatermark();
});

describe("ignore", () => {
  it("maps a successful result's val to the IGNORED sentinel, keeping consumption", () => {
    const parser = ignore(literal("hello"));
    const result = parser("hello world", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe(IGNORED);
      expect(result.next).toBe(5);
    }
  });

  it("passes failures through unchanged", () => {
    const parser = ignore(literal("hello"));
    const result = parser("bye", 0);
    expect(result.success).toBe(false);
  });

  it("IGNORED is a unique symbol no ordinary value can equal", () => {
    expect(typeof IGNORED).toBe("symbol");
    for (const value of [
      undefined,
      null,
      0,
      "",
      [],
      {},
      Symbol("tpeg.ignored"),
    ]) {
      expect(value).not.toBe(IGNORED);
    }
  });
});

describe("IGNORED filtering in sequence/captureSequence", () => {
  it("sequence drops ignored values from the result tuple but keeps their consumption", () => {
    const parser = sequence(
      ignore(optional(literal(" "))),
      literal("a"),
      ignore(optional(literal(" "))),
      literal("b"),
      ignore(optional(literal(" "))),
    );
    const result = parser(" a b ", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "b"]);
      expect(result.next).toBe(5);
    }
  });

  it("an all-ignored sequence yields the empty tuple", () => {
    const parser = sequence(ignore(literal(" ")), ignore(literal(" ")));
    const result = parser("  x", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toBe(2);
    }
  });

  it("captureSequence drops ignored values without touching the merged labels", () => {
    const parser = captureSequence(
      ignore(optional(literal(" "))),
      capture("x", literal("a")),
      ignore(optional(literal(" "))),
      capture("y", literal("b")),
      ignore(optional(literal(" "))),
    );
    const result = parser(" a b ", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual({ x: "a", y: "b" });
      expect(result.next).toBe(5);
    }
  });

  it("an ignored value does not count as a capture (no accidental object merge)", () => {
    // With every element ignored, `hasCaptures` stays false and the
    // result is the plain (empty) tuple, not `{}`.
    const parser = captureSequence(ignore(literal(" ")));
    const result = parser(" ", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
    }
  });

  it("IGNORED is only special inside sequence boundaries -- choice forwards it like any value", () => {
    // Value-dropping is a property of the sequence boundary, not of the
    // sentinel itself: an ignored alternative's result passes through a
    // choice untouched.
    const parser = sequence(
      choice(ignore(literal("q")), literal("a")),
      literal("b"),
    );
    const result = parser("qb", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      // The choice forwarded IGNORED as `q`'s value, and the enclosing
      // sequence dropped it -- only "b" remains.
      expect(result.val).toEqual(["b"]);
    }
  });
});
