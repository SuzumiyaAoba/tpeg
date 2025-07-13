/**
 * TPEG Module System Parser Tests
 *
 * Tests for parsing module system constructs in TPEG grammar.
 * Based on docs/peg-grammar.md specification.
 */

import { describe, expect, it } from "bun:test";
import {
  importStatement,
  exportDeclaration,
  qualifiedIdentifier,
  extendsClause,
} from "./module";

describe("Module System Parsers", () => {
  describe("importStatement", () => {
    it("should parse simple import statement", () => {
      const input = 'import "base.tpeg" as base';
      const result = importStatement(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("ImportStatement");
        expect(result.val.modulePath).toBe("base.tpeg");
        expect(result.val.alias).toBe("base");
        expect(result.val.selective).toBeUndefined();
        expect(result.val.version).toBeUndefined();
      }
    });

    it("should parse import without alias", () => {
      const input = 'import "utils.tpeg"';
      const result = importStatement(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.modulePath).toBe("utils.tpeg");
        expect(result.val.alias).toBeUndefined();
      }
    });

    it("should parse selective import", () => {
      const input = 'import "base.tpeg" { identifier, whitespace }';
      const result = importStatement(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.modulePath).toBe("base.tpeg");
        expect(result.val.selective).toEqual(["identifier", "whitespace"]);
        expect(result.val.alias).toBeUndefined();
      }
    });

    it("should parse selective import with empty list", () => {
      const input = 'import "base.tpeg" { }';
      const result = importStatement(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.selective).toEqual([]);
      }
    });

    it("should parse versioned import", () => {
      const input = 'import "base.tpeg" version "^1.0" as base';
      const result = importStatement(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.modulePath).toBe("base.tpeg");
        expect(result.val.version).toBe("^1.0");
        expect(result.val.alias).toBe("base");
      }
    });

    it("should parse versioned import without alias", () => {
      const input = 'import "base.tpeg" version ">=2.0, <3.0"';
      const result = importStatement(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.modulePath).toBe("base.tpeg");
        expect(result.val.version).toBe(">=2.0, <3.0");
        expect(result.val.alias).toBeUndefined();
      }
    });
  });

  describe("exportDeclaration", () => {
    it("should parse export declaration", () => {
      const input = "@export: [identifier, whitespace, number]";
      const result = exportDeclaration(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("ExportDeclaration");
        expect(result.val.rules).toEqual(["identifier", "whitespace", "number"]);
      }
    });

    it("should parse empty export declaration", () => {
      const input = "@export: []";
      const result = exportDeclaration(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.rules).toEqual([]);
      }
    });

    it("should parse single rule export", () => {
      const input = "@export: [identifier]";
      const result = exportDeclaration(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.rules).toEqual(["identifier"]);
      }
    });
  });

  describe("qualifiedIdentifier", () => {
    it("should parse qualified identifier", () => {
      const input = "base.identifier";
      const result = qualifiedIdentifier(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("QualifiedIdentifier");
        expect(result.val.module).toBe("base");
        expect(result.val.name).toBe("identifier");
      }
    });

    it("should parse complex qualified identifier", () => {
      const input = "Math_Core.expression_parser";
      const result = qualifiedIdentifier(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.module).toBe("Math_Core");
        expect(result.val.name).toBe("expression_parser");
      }
    });

    it("should fail on simple identifier", () => {
      const input = "identifier";
      const result = qualifiedIdentifier(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(false);
    });
  });

  describe("extendsClause", () => {
    it("should parse extends with simple identifier", () => {
      const input = "extends BaseGrammar";
      const result = extendsClause(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("BaseGrammar");
      }
    });

    it("should parse extends with qualified identifier", () => {
      const input = "extends base.Grammar";
      const result = extendsClause(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("base.Grammar");
      }
    });

    it("should parse extends with namespace", () => {
      const input = "extends Math.Core";
      const result = extendsClause(input, { offset: 0, line: 1, column: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("Math.Core");
      }
    });
  });
}); 