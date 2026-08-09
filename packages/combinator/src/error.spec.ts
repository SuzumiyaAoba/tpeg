import { describe, expect, it } from "bun:test";
import { choice, commit, literal, parse, seq } from "@suzumiyaaoba/tpeg-core";
import { labeled, labeledWithContext, withDetailedError } from "./error";

describe("error combinators", () => {
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
