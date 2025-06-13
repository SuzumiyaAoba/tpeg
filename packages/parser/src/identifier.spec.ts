/**
 * Identifier Parser Tests
 */

import { describe, expect, it } from "bun:test";
import { identifier } from "./identifier";

describe("identifier", () => {
  const parser = identifier;
  const pos = { offset: 0, line: 1, column: 1 };

  describe("valid identifiers", () => {
    it("should parse simple identifiers", () => {
      const result = parser("expression", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Identifier");
        expect(result.val.name).toBe("expression");
      }
    });

    it("should parse identifiers starting with underscore", () => {
      const result = parser("_private", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("_private");
      }
    });

    it("should parse identifiers with numbers", () => {
      const result = parser("rule123", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("rule123");
      }
    });

    it("should parse identifiers with mixed case", () => {
      const result = parser("MyRule", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("MyRule");
      }
    });

    it("should parse identifiers with underscores", () => {
      const result = parser("my_rule_name", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("my_rule_name");
      }
    });

    it("should parse single character identifiers", () => {
      const result = parser("a", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("a");
      }
    });

    it("should parse single underscore", () => {
      const result = parser("_", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("_");
      }
    });
  });

  describe("error cases", () => {
    it("should fail on identifiers starting with numbers", () => {
      const result = parser("123rule", pos);
      expect(result.success).toBe(false);
    });

    it("should fail on empty input", () => {
      const result = parser("", pos);
      expect(result.success).toBe(false);
    });

    it("should parse partial identifier with special characters", () => {
      const result = parser("rule-name", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("rule");
        expect(result.next.offset).toBe(4); // Should stop before '-'
      }
    });

    it("should parse partial identifier with spaces", () => {
      const result = parser("rule name", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("rule");
        expect(result.next.offset).toBe(4); // Should stop before space
      }
    });

    it("should fail on identifiers starting with symbols", () => {
      const result = parser("@rule", pos);
      expect(result.success).toBe(false);
    });
  });

  describe("partial parsing", () => {
    it("should parse identifier and stop at non-identifier characters", () => {
      const result = parser("rule123+", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("rule123");
        expect(result.next.offset).toBe(7); // Should stop before '+'
      }
    });

    it("should parse identifier and stop at whitespace", () => {
      const result = parser("identifier ", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("identifier");
        expect(result.next.offset).toBe(10); // Should stop before space
      }
    });
  });
});
