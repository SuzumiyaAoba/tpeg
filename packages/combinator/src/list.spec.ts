import { describe, expect, it } from "bun:test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { literal } from "@suzumiyaaoba/tpeg-core";
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
        expect(result.next.offset).toBe(0);
      }
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
      // Then choice(nonEmpty, empty) will try 'empty'.
      // 'empty' also fails because it starts with 'notPredicate(valueParser)',
      // but valueParser matches the first 'a'.
      // So the whole parser fails.
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
