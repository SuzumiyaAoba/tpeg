/**
 * TPEG Parser Integration Tests
 */

import { describe, expect, it } from "bun:test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { basicSyntax, tpegFile } from "./index";

describe("basicSyntax", () => {
  const parser = basicSyntax;
  const pos = { offset: 0, line: 1, column: 1 };

  describe("string literals", () => {
    it("should parse double-quoted strings", () => {
      const result = parser('"hello world"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("StringLiteral");
        if (result.val.type === "StringLiteral") {
          expect(result.val.value).toBe("hello world");
          expect(result.val.quote).toBe('"');
        }
      }
    });

    it("should parse single-quoted strings", () => {
      const result = parser("'test'", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("StringLiteral");
        if (result.val.type === "StringLiteral") {
          expect(result.val.value).toBe("test");
          expect(result.val.quote).toBe("'");
        }
      }
    });
  });

  describe("character classes", () => {
    it("should parse any character dot", () => {
      const result = parser(".", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("AnyChar");
      }
    });

    it("should parse character ranges", () => {
      const result = parser("[a-z]", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("CharacterClass");
        if (result.val.type === "CharacterClass") {
          expect(result.val.negated).toBe(false);
          expect(result.val.ranges).toHaveLength(1);
          expect(result.val.ranges[0]).toEqual({ start: "a", end: "z" });
        }
      }
    });

    it("should parse negated character classes", () => {
      const result = parser("[^0-9]", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("CharacterClass");
        if (result.val.type === "CharacterClass") {
          expect(result.val.negated).toBe(true);
          expect(result.val.ranges).toHaveLength(1);
          expect(result.val.ranges[0]).toEqual({ start: "0", end: "9" });
        }
      }
    });
  });

  describe("identifiers", () => {
    it("should parse simple identifiers", () => {
      const result = parser("expression", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Identifier");
        if (result.val.type === "Identifier") {
          expect(result.val.name).toBe("expression");
        }
      }
    });

    it("should parse identifiers with underscores and numbers", () => {
      const result = parser("my_rule_123", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Identifier");
        if (result.val.type === "Identifier") {
          expect(result.val.name).toBe("my_rule_123");
        }
      }
    });
  });

  describe("parser precedence", () => {
    it("should prioritize string literals over identifiers", () => {
      const result = parser('"identifier"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("StringLiteral");
      }
    });

    it("should prioritize character classes over identifiers", () => {
      const result = parser("[abc]", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("CharacterClass");
      }
    });

    it("should prioritize any char over identifiers", () => {
      const result = parser(".", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("AnyChar");
      }
    });
  });

  describe("error cases", () => {
    it("should fail on invalid input", () => {
      const result = parser("@invalid", pos);
      expect(result.success).toBe(false);
    });

    it("should fail on empty input", () => {
      const result = parser("", pos);
      expect(result.success).toBe(false);
    });

    it("should fail on unclosed string literals", () => {
      const result = parser('"unclosed', pos);
      expect(result.success).toBe(false);
    });

    it("should fail on unclosed character classes", () => {
      const result = parser("[unclosed", pos);
      expect(result.success).toBe(false);
    });
  });
});

describe("tpegFile", () => {
  it("parses a grammar block alone", () => {
    const result = parse(tpegFile)(`
      grammar Simple {
        greeting = "hello"
      }
    `);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.name).toBe("Simple");
      expect(result.val.rules).toHaveLength(1);
      expect(result.val.transforms).toEqual([]);
    }
  });

  it("attaches trailing transforms blocks to the grammar's transforms array", () => {
    const result = parse(tpegFile)(`
      grammar Calculator {
        number = [0-9]+
      }

      transforms Evaluator@typescript {
        number(captures: string) -> Result<number> {
          return { success: true, value: parseInt(captures, 10) };
        }
      }
    `);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.name).toBe("Calculator");
      expect(result.val.transforms).toHaveLength(1);
      expect(result.val.transforms?.[0]?.transformSet.name).toBe("Evaluator");
      expect(result.val.transforms?.[0]?.transformSet.targetLanguage).toBe(
        "typescript",
      );
    }
  });

  it("collects multiple trailing transforms blocks", () => {
    const result = parse(tpegFile)(`
      grammar Calculator {
        number = [0-9]+
      }

      transforms Evaluator@typescript {
        number(captures: string) -> Result<number> {
          return { success: true, value: parseInt(captures, 10) };
        }
      }

      transforms Printer@typescript {
        number(captures: string) -> Result<string> {
          return { success: true, value: captures };
        }
      }
    `);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.transforms).toHaveLength(2);
      expect(result.val.transforms?.map((t) => t.transformSet.name)).toEqual([
        "Evaluator",
        "Printer",
      ]);
    }
  });
});
