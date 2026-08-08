import { beforeEach, describe, expect, it } from "bun:test";
import { literal } from "./basic";
import {
  type CapturedValue,
  capture,
  captureChoice,
  captureSequence,
  getCaptureLabels,
  getCapturedValue,
  isCapturedValue,
  mergeCaptures,
} from "./capture";
import { choice, commit, sequence } from "./combinators";
import { resetFailureWatermark } from "./failure";
import type { Parser } from "./types";

// See `combinators.spec.ts`'s identical `beforeEach` -- the farthest-failure
// watermark (`./failure.ts`) is module-global, keyed by input string VALUE.
beforeEach(() => {
  resetFailureWatermark();
});

describe("capture", () => {
  const pos = 0;

  describe("basic capture functionality", () => {
    it("should capture a simple value with a label", () => {
      const parser = capture("name", literal("hello"));
      const result = parser("hello", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({ name: "hello" });
        expect(result.next).toBe(5);
      }
    });

    it("should propagate failures from the inner parser", () => {
      const parser = capture("name", literal("hello"));
      const result = parser("world", pos);

      expect(result.success).toBe(false);
    });

    it("should handle different value types", () => {
      const numberParser = capture("count", literal("42"));
      const result = numberParser("42", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({ count: "42" });
      }
    });
  });

  describe("mergeCaptures", () => {
    // `mergeCaptures` only merges entries `capture(...)` itself tagged (see
    // `capture.ts`'s `CAPTURE_TAG` doc comment) -- a bare object literal
    // is exactly the untagged shape it must now IGNORE (see "should not
    // merge an untagged object-shaped value" below), so every fixture here
    // is built through an actual `capture(...)` call rather than a plain
    // object literal.
    const tagged = <T>(label: string, value: T): CapturedValue => {
      const result = capture(label, literal(String(value)))(String(value), 0);
      if (!result.success) {
        throw new Error("unreachable: literal(x) always matches x");
      }
      return result.val;
    };

    it("should merge multiple captured objects", () => {
      const captures = [
        tagged("name", "hello"),
        tagged("value", "42"),
        tagged("active", "true"),
      ];

      const merged = mergeCaptures(captures);
      expect(merged).toEqual({
        name: "hello",
        value: "42",
        active: "true",
      });
    });

    it("should handle non-object and untagged-object values gracefully", () => {
      const captures = [
        tagged("name", "hello"),
        "string value",
        42,
        null,
        undefined,
        [],
        { value: "world" }, // untagged -- looks like a capture but isn't one
        tagged("greeting", "hi"),
      ];

      const merged = mergeCaptures(captures);
      expect(merged).toEqual({
        name: "hello",
        greeting: "hi",
      });
    });

    it("should handle overlapping keys by taking the last value", () => {
      const captures = [
        tagged("name", "first"),
        tagged("name", "second"),
        tagged("name", "third"),
      ];

      const merged = mergeCaptures(captures);
      expect(merged).toEqual({ name: "third" });
    });

    it("should not merge an untagged object-shaped value (e.g. an unlabeled reference to a rule that captures internally)", () => {
      // A plain object literal is exactly what an unlabeled Sequence
      // element resolves to when it happens to reference another
      // captureSequence-producing rule -- it must never be treated as a
      // capture of ITS OWN, or its fields would silently leak into
      // whichever rule references it without a label.
      const untaggedLikeANestedCapture = { key: "a", value: "b" };
      const merged = mergeCaptures([
        tagged("name", "foo"),
        untaggedLikeANestedCapture,
      ]);
      expect(merged).toEqual({ name: "foo" });
    });
  });

  describe("captureSequence", () => {
    it("should merge multiple captures into a single object", () => {
      const parser = captureSequence(
        capture("greeting", literal("hello")),
        capture("target", literal("world")),
      );

      const result = parser("helloworld", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          greeting: "hello",
          target: "world",
        });
      }
    });

    it("should return tuple for mixed captured and non-captured values", () => {
      const parser = captureSequence(
        capture("greeting", literal("hello")),
        literal(" "),
        capture("target", literal("world")),
      );

      const result = parser("hello world", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          greeting: "hello",
          target: "world",
        });
      }
    });

    it("should handle empty sequence", () => {
      const parser = captureSequence();
      const result = parser("", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({});
      }
    });

    it("should propagate failures from any element", () => {
      const parser = captureSequence(
        capture("greeting", literal("hello")),
        capture("target", literal("universe")),
      );

      const result = parser("helloworld", pos);
      expect(result.success).toBe(false);
    });

    it("should handle sequences with only non-captured values", () => {
      const parser = captureSequence(
        literal("hello"),
        literal(" "),
        literal("world"),
      );

      const result = parser("hello world", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["hello", " ", "world"]);
      }
    });

    it("should NOT leak an unlabeled element's own internal capture fields into the merged result", () => {
      // A rule reference that is itself a `captureSequence` (e.g. compiled
      // from `pair = key:Ident "=" value:Ident`) returns an object-shaped
      // value even when referenced WITHOUT a label at the use site (e.g.
      // `rule = name:Ident " " pair`, `pair` unlabeled). Only `name` was
      // actually labeled at this level, so only `name` should appear in
      // the merged result -- `pair`'s own `key`/`value` fields must not
      // silently flatten into it (a real regression: see this module's
      // `CAPTURE_TAG`).
      const pair = captureSequence(
        capture("key", literal("a")),
        literal("="),
        capture("value", literal("b")),
      );
      const rule = captureSequence(
        capture("name", literal("foo")),
        literal(" "),
        pair,
      );

      const result = rule("foo a=b", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({ name: "foo" });
      }
    });

    it("keeps tuple shape when no element is actually capture()-tagged, even if one is incidentally object-shaped", () => {
      // Same shape of hazard as above, but with nothing labeled at ANY
      // level -- `captureSequence` must not spuriously switch into
      // merge-object mode (and thereby silently drop `objectShaped`'s
      // fields) just because one element's runtime value happens to look
      // like an object.
      const objectShaped: Parser<{ x: number }> = (input, p) => ({
        success: true,
        val: { x: 1 },
        current: p,
        next: p,
      });
      const parser = captureSequence(literal("a"), objectShaped);

      const result = parser("a", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", { x: 1 }]);
      }
    });
  });

  describe("captureChoice", () => {
    it("should return the first successful capture", () => {
      const parser = captureChoice(
        capture("greeting", literal("hello")),
        capture("farewell", literal("goodbye")),
      );

      const result1 = parser("hello", pos);
      expect(result1.success).toBe(true);
      if (result1.success) {
        expect(result1.val).toEqual({ greeting: "hello" });
      }

      const result2 = parser("goodbye", pos);
      expect(result2.success).toBe(true);
      if (result2.success) {
        expect(result2.val).toEqual({ farewell: "goodbye" });
      }
    });

    it("should fail if all alternatives fail", () => {
      const parser = captureChoice(
        capture("greeting", literal("hello")),
        capture("farewell", literal("goodbye")),
      );

      const result = parser("bonjour", pos);
      expect(result.success).toBe(false);
    });

    it("does not try the next alternative once a committed sub-parser fails", () => {
      // Without the fatal short-circuit, this would fall through to the
      // second alternative (which matches on "h" alone) and succeed.
      const parser = captureChoice(
        sequence(literal("h"), commit(capture("greeting", literal("i")))),
        capture("farewell", literal("h")),
      );

      const result = parser("hx", pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        // `fatal` is absorbed at `captureChoice`'s own boundary, not
        // forwarded -- see the identical note in `combinators.spec.ts`'s
        // `choice` test and `captureChoice`'s own doc comment. The
        // short-circuit itself (not falling through to "farewell") is
        // what `result.success === false` already proves, since the
        // second alternative would otherwise have matched "h" and
        // succeeded.
        expect(result.error.fatal).toBeFalsy();
      }
    });

    it("a cut inside a nested captureChoice does not stop an ENCLOSING captureChoice from trying its own remaining alternatives", () => {
      // Symmetric regression test to `combinators.spec.ts`'s identically-
      // named `choice` test -- see that test's comment for the full
      // rationale and the bug this pins.
      const innerChoice = captureChoice(
        sequence(literal("y"), commit(literal("b")), commit(literal("c"))),
        literal("x"),
      );
      const outerFallback = sequence(literal("y"), literal("b"), literal("z"));
      const result = captureChoice(innerChoice, outerFallback)("ybz", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["y", "b", "z"]);
      }
    });

    it("should handle mixed captured and non-captured alternatives", () => {
      const parser = captureChoice(
        capture("greeting", literal("hello")),
        literal("hi"),
      );

      const result1 = parser("hello", pos);
      expect(result1.success).toBe(true);
      if (result1.success) {
        expect(result1.val).toEqual({ greeting: "hello" });
      }

      const result2 = parser("hi", pos);
      expect(result2.success).toBe(true);
      if (result2.success) {
        expect(result2.val).toBe("hi");
      }
    });
  });

  describe("utility functions", () => {
    it("isCapturedValue should correctly identify captured values", () => {
      expect(isCapturedValue({ name: "hello" })).toBe(true);
      expect(isCapturedValue({ a: 1, b: 2 })).toBe(true);
      expect(isCapturedValue({})).toBe(true);

      expect(isCapturedValue("string")).toBe(false);
      expect(isCapturedValue(42)).toBe(false);
      expect(isCapturedValue(null)).toBe(false);
      expect(isCapturedValue(undefined)).toBe(false);
      expect(isCapturedValue([])).toBe(false);
      expect(isCapturedValue([1, 2, 3])).toBe(false);
    });

    it("getCaptureLabels should return all labels from a captured value", () => {
      const captured: CapturedValue = {
        name: "hello",
        count: 42,
        active: true,
      };

      const labels = getCaptureLabels(captured);
      expect(labels.sort()).toEqual(["active", "count", "name"]);
    });

    it("getCapturedValue should retrieve values by label", () => {
      const captured: CapturedValue = {
        name: "hello",
        count: 42,
        active: true,
      };

      expect(getCapturedValue<string>(captured, "name")).toBe("hello");
      expect(getCapturedValue<number>(captured, "count")).toBe(42);
      expect(getCapturedValue<boolean>(captured, "active")).toBe(true);
      expect(getCapturedValue<string>(captured, "missing")).toBeUndefined();
    });
  });

  describe("integration with regular combinators", () => {
    it("should work with regular sequence combinator", () => {
      const parser = sequence(
        capture("first", literal("a")),
        capture("second", literal("b")),
      );

      const result = parser("ab", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual([{ first: "a" }, { second: "b" }]);
      }
    });

    it("should work with regular choice combinator", () => {
      const parser = choice(
        capture("greeting", literal("hello")),
        capture("farewell", literal("goodbye")),
      );

      const result = parser("hello", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({ greeting: "hello" });
      }
    });
  });

  describe("complex capture scenarios", () => {
    it("should handle nested captures", () => {
      const innerParser = capture("inner", literal("value"));
      const outerParser = capture("outer", innerParser);

      const result = outerParser("value", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          outer: { inner: "value" },
        });
      }
    });

    it("should handle captures in complex expressions", () => {
      const parser = captureSequence(
        capture("method", choice(literal("GET"), literal("POST"))),
        literal(" "),
        capture("path", literal("/api/users")),
        literal(" "),
        capture("protocol", literal("HTTP/1.1")),
      );

      const result = parser("GET /api/users HTTP/1.1", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          method: "GET",
          path: "/api/users",
          protocol: "HTTP/1.1",
        });
      }
    });

    it("should preserve capture structure through multiple levels", () => {
      const protocol = captureChoice(
        capture("https", literal("https")), // Put longer match first
        capture("http", literal("http")),
      );

      const url = captureSequence(
        protocol,
        literal("://"),
        capture("domain", literal("example.com")),
      );

      const result = url("https://example.com", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          https: "https",
          domain: "example.com",
        });
      }
    });
  });
});
