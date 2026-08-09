import { describe, expect, it } from "bun:test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { choice, commit, literal } from "@suzumiyaaoba/tpeg-core";
import { commaSeparated, commaSeparated1, sepBy, sepBy1 } from "./list";

describe("list combinators", () => {
  describe("sepBy", () => {
    it("should parse multiple items", () => {
      const parser = sepBy(literal("a"), literal(","));
      const result = parse(parser)("a,a,a");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "a", "a"]);
      }
    });

    it("should parse zero items", () => {
      const parser = sepBy(literal("a"), literal(","));
      const result = parse(parser)("b");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual([]);
        expect(result.next).toBe(0);
      }
    });

    it("propagates a fatal (cut/commit) failure from `value` instead of swallowing it into the empty-list fallback", () => {
      // Regression test: `sepBy`'s internal "or empty" fallback used to be
      // a `choice(...)`, which absorbs `fatal` at its own boundary --
      // silently letting an ENCLOSING choice fall back to a sibling
      // alternative it should have been barred from trying. `sepBy` is
      // meant to be transparent sugar for `sepBy1(...)?`, so a cut inside
      // `value` should propagate past `sepBy` itself.
      const committedA = commit(literal("a"));
      const parser = choice(sepBy(committedA, literal(",")), literal("b"));
      const result = parse(parser)("b");
      expect(result.success).toBe(false);
    });
  });

  describe("sepBy1", () => {
    it("should parse one or more items", () => {
      const parser = sepBy1(literal("a"), literal(","));
      const result = parse(parser)("a,a");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "a"]);
      }
    });

    it("should fail on zero items", () => {
      const parser = sepBy1(literal("a"), literal(","));
      const result = parse(parser)("b");
      expect(result.success).toBe(false);
    });
  });

  describe("commaSeparated", () => {
    it("should parse comma separated values", () => {
      const parser = commaSeparated(literal("a"));
      const result = parse(parser)("a, a, a");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "a", "a"]);
      }
    });

    it("should handle trailing comma if allowed", () => {
      const parser = commaSeparated(literal("a"), true);
      const result = parse(parser)("a, a, ");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "a"]);
      }
    });

    it("should fail on trailing comma if not allowed", () => {
      const parser = commaSeparated(literal("a"), false);
      const result = parse(parser)("a, a, ");

      // If allowTrailing is false, nonEmpty fails because of notPredicate(comma) at the third item.
      // The fallback to 'empty' is then tried (nonEmpty's failure wasn't
      // fatal), but 'empty' also fails because it starts with
      // 'notPredicate(valueParser)', and valueParser matches the first 'a'.
      // So the whole parser fails.
      expect(result.success).toBe(false);
    });

    it("propagates a fatal (cut/commit) failure from valueParser instead of swallowing it into the empty-list fallback", () => {
      // Regression test: `commaSeparated` used to pick between its
      // "nonEmpty" and "empty" cases via `choice(...)`, which absorbs
      // `fatal` at its own boundary -- silently letting an ENCLOSING
      // choice fall back to a sibling alternative it should have been
      // barred from trying.
      const committedA = commit(literal("a"));
      const parser = choice(commaSeparated(committedA), literal("b"));
      const result = parse(parser)("b");
      expect(result.success).toBe(false);
    });
  });

  describe("commaSeparated1", () => {
    it("should require at least one item", () => {
      const parser = commaSeparated1(literal("a"));
      const result = parse(parser)("");
      expect(result.success).toBe(false);
    });

    it("should parse multiple items", () => {
      const parser = commaSeparated1(literal("a"));
      const result = parse(parser)("a, a");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "a"]);
      }
    });
  });
});
