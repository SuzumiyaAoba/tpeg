/**
 * Character Class Parser Tests
 */

import { describe, expect, it } from "bun:test";
import { characterClass } from "./character-class";

describe("characterClass", () => {
  const parser = characterClass();
  const pos = { offset: 0, line: 1, column: 1 };

  describe("any character dot", () => {
    it("should parse dot as any character", () => {
      const result = parser(".", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("AnyChar");
      }
    });
  });

  describe("character classes", () => {
    it("should parse simple character classes", () => {
      const result = parser("[abc]", pos);
      expect(result.success).toBe(true);
      if (result.success && result.val.type === "CharacterClass") {
        expect(result.val.type).toBe("CharacterClass");
        expect(result.val.negated).toBe(false);
        expect(result.val.ranges).toHaveLength(3);
        expect(result.val.ranges[0]).toEqual({ start: "a" });
        expect(result.val.ranges[1]).toEqual({ start: "b" });
        expect(result.val.ranges[2]).toEqual({ start: "c" });
      }
    });

    it("should parse character ranges", () => {
      const result = parser("[a-z]", pos);
      expect(result.success).toBe(true);
      if (result.success && result.val.type === "CharacterClass") {
        expect(result.val.negated).toBe(false);
        expect(result.val.ranges).toHaveLength(1);
        expect(result.val.ranges[0]).toEqual({ start: "a", end: "z" });
      }
    });

    it("should parse multiple ranges and characters", () => {
      const result = parser("[a-zA-Z0-9_]", pos);
      expect(result.success).toBe(true);
      if (result.success && result.val.type === "CharacterClass") {
        expect(result.val.negated).toBe(false);
        expect(result.val.ranges).toHaveLength(4);
        expect(result.val.ranges[0]).toEqual({ start: "a", end: "z" });
        expect(result.val.ranges[1]).toEqual({ start: "A", end: "Z" });
        expect(result.val.ranges[2]).toEqual({ start: "0", end: "9" });
        expect(result.val.ranges[3]).toEqual({ start: "_" });
      }
    });

    it("should parse negated character classes", () => {
      const result = parser("[^0-9]", pos);
      expect(result.success).toBe(true);
      if (result.success && result.val.type === "CharacterClass") {
        expect(result.val.negated).toBe(true);
        expect(result.val.ranges).toHaveLength(1);
        expect(result.val.ranges[0]).toEqual({ start: "0", end: "9" });
      }
    });

    it("should parse character classes with escaped characters", () => {
      const result = parser("[\\]\\\\\\^]", pos);
      expect(result.success).toBe(true);
      if (result.success && result.val.type === "CharacterClass") {
        expect(result.val.negated).toBe(false);
        expect(result.val.ranges).toHaveLength(3);
        expect(result.val.ranges[0]).toEqual({ start: "]" });
        expect(result.val.ranges[1]).toEqual({ start: "\\" });
        expect(result.val.ranges[2]).toEqual({ start: "^" });
      }
    });
  });

  describe("error cases", () => {
    it("should fail on unclosed character class", () => {
      const result = parser("[abc", pos);
      expect(result.success).toBe(false);
    });

    it("should fail on empty input", () => {
      const result = parser("", pos);
      expect(result.success).toBe(false);
    });

    it("should fail on invalid characters", () => {
      const result = parser("abc", pos);
      expect(result.success).toBe(false);
    });
  });
});
