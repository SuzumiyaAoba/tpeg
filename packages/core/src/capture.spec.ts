import { describe, expect, it } from "bun:test";
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
import { choice, sequence } from "./combinators";

describe("capture", () => {
  const pos = { offset: 0, column: 0, line: 1 };

  describe("basic capture functionality", () => {
    it("should capture a simple value with a label", () => {
      const parser = capture("name", literal("hello"));
      const result = parser("hello", pos);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({ name: "hello" });
        expect(result.next.offset).toBe(5);
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
    it("should merge multiple captured objects", () => {
      const captures = [{ name: "hello" }, { value: 42 }, { active: true }];

      const merged = mergeCaptures(captures);
      expect(merged).toEqual({
        name: "hello",
        value: 42,
        active: true,
      });
    });

    it("should handle non-object values gracefully", () => {
      const captures = [
        { name: "hello" },
        "string value",
        42,
        null,
        undefined,
        [],
        { value: "world" },
      ];

      const merged = mergeCaptures(captures);
      expect(merged).toEqual({
        name: "hello",
        value: "world",
      });
    });

    it("should handle overlapping keys by taking the last value", () => {
      const captures = [
        { name: "first" },
        { name: "second" },
        { name: "third" },
      ];

      const merged = mergeCaptures(captures);
      expect(merged).toEqual({ name: "third" });
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
