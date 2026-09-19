import { describe, expect, it } from "vite-plus/test";
import { formatINI, parseINI } from "./ini";

describe("INI Parser", () => {
  describe("Basic Parsing", () => {
    it("parses global keys", () => {
      const result = parseINI("host = example.com\nport = 8080\n");

      expect(result).toEqual({
        globals: { host: "example.com", port: "8080" },
        sections: {},
      });
    });

    it("parses sections", () => {
      const result = parseINI("[server]\nhost = x\nport = 1\n[db]\nname = y\n");

      expect(result.globals).toEqual({});
      expect(result.sections).toEqual({
        server: { host: "x", port: "1" },
        db: { name: "y" },
      });
    });

    it("separates globals from section keys", () => {
      const result = parseINI("g = 1\n[s]\nk = 2\n");

      expect(result.globals).toEqual({ g: "1" });
      expect(result.sections).toEqual({ s: { k: "2" } });
    });

    it("parses an empty document", () => {
      expect(parseINI("")).toEqual({ globals: {}, sections: {} });
      expect(parseINI("\n\n  \n")).toEqual({ globals: {}, sections: {} });
    });

    it("parses a file without a trailing newline", () => {
      const result = parseINI("[s]\nkey = value");

      expect(result.sections).toEqual({ s: { key: "value" } });
    });
  });

  describe("Comments", () => {
    it("skips whole-line comments with ; and #", () => {
      const result = parseINI("; comment\nkey = value\n# another\n");

      expect(result.globals).toEqual({ key: "value" });
    });

    it("skips indented comments", () => {
      const result = parseINI("   ; indented\n\t# also indented\nk = v\n");

      expect(result.globals).toEqual({ k: "v" });
    });

    it("strips an inline comment after whitespace", () => {
      const result = parseINI("key = value ; note\nother = x # note\n");

      expect(result.globals).toEqual({ key: "value", other: "x" });
    });

    it("keeps a comment character inside a value when not preceded by whitespace", () => {
      const result = parseINI("password = a#b\nsemi = c;d\n");

      expect(result.globals).toEqual({ password: "a#b", semi: "c;d" });
    });

    it("allows a comment after a section header", () => {
      const result = parseINI("[s] ; trailing\nk = v\n");

      expect(result.sections).toEqual({ s: { k: "v" } });
    });
  });

  describe("Whitespace", () => {
    it("trims keys and values", () => {
      const result = parseINI("   key   =   value   \n");

      expect(result.globals).toEqual({ key: "value" });
    });

    it("handles compact `key=value` with no spaces", () => {
      const result = parseINI("key=value\n");

      expect(result.globals).toEqual({ key: "value" });
    });

    it("handles section names with surrounding whitespace inside brackets", () => {
      const result = parseINI("[  spaced  ]\nk = v\n");

      expect(result.sections).toEqual({ spaced: { k: "v" } });
    });

    it("supports all three line endings", () => {
      for (const nl of ["\n", "\r\n", "\r"]) {
        const result = parseINI(`[s]${nl}a = 1${nl}b = 2${nl}`);
        expect(result.sections).toEqual({ s: { a: "1", b: "2" } });
      }
    });
  });

  describe("Edge Cases", () => {
    it("keeps empty values", () => {
      const result = parseINI("empty =\n");

      expect(result.globals).toEqual({ empty: "" });
    });

    it("lets the last duplicate key win", () => {
      const result = parseINI("key = first\nkey = last\n");

      expect(result.globals).toEqual({ key: "last" });
    });

    it("merges a repeated section", () => {
      const result = parseINI("[a]\nx = 1\n[b]\ny = 2\n[a]\nz = 3\n");

      expect(result.sections).toEqual({
        a: { x: "1", z: "3" },
        b: { y: "2" },
      });
    });

    it("treats `=` inside a value as data", () => {
      const result = parseINI("expr = a=b=c\n");

      expect(result.globals).toEqual({ expr: "a=b=c" });
    });

    it("stores a section named [__proto__] as data, not via the prototype", () => {
      const result = parseINI("[__proto__]\nk = v\n");

      const section = result.sections["__proto__"] as Record<string, string>;
      expect(Object.hasOwn(result.sections, "__proto__")).toBe(true);
      expect(section).toEqual({ k: "v" });
      expect(Object.getPrototypeOf(result.sections)).toBe(Object.prototype);
    });

    it("stores a key named __proto__ as data, not via the prototype", () => {
      const result = parseINI("[s]\n__proto__ = x\n");

      const section = result.sections["s"] as Record<string, string>;
      expect(Object.hasOwn(section, "__proto__")).toBe(true);
      expect(section["__proto__"]).toBe("x");
      expect(Object.getPrototypeOf(section)).toBe(Object.prototype);
    });
  });

  describe("Error Handling", () => {
    it("rejects an unclosed section header", () => {
      expect(() => parseINI("[unclosed\nk = v")).toThrow(/INI parse error/);
    });

    it("rejects a pair line with no `=`", () => {
      expect(() => parseINI("just some words\n")).toThrow(/INI parse error/);
    });

    it("rejects content before a key", () => {
      expect(() => parseINI("= value\n")).toThrow();
    });
  });

  describe("Serialization", () => {
    it("round-trips a document", () => {
      const source = "g = 1\n\n[s]\nk = v\n\n[t]\nx = y\n";

      const once = parseINI(source);
      const twice = parseINI(formatINI(once));

      expect(twice).toEqual(once);
    });

    it("formats empty data as an empty string", () => {
      expect(formatINI({ globals: {}, sections: {} })).toBe("");
    });
  });
});
