import { describe, expect, it } from "bun:test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { choice, commit, literal } from "@suzumiyaaoba/tpeg-core";
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

    it("preserves a fatal (cut/commit) failure instead of building a fresh, non-fatal error object", () => {
      const committedAbc = commit(literal("abc"));
      const parser = choice(
        labeledWithContext(committedAbc, "Fail", "Top"),
        literal("def"),
      );
      const result = parse(parser)("def");
      expect(result.success).toBe(false);
    });
  });
});
