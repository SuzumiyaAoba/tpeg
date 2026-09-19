import { describe, expect, it } from "vite-plus/test";
import { parseQueryParams, parseUrl } from "./url";

describe("URL Parser", () => {
  describe("Full URLs", () => {
    it("parses a complete URL", () => {
      expect(parseUrl("https://user@example.com:8443/a/b?x=1&y=2#top")).toEqual(
        {
          scheme: "https",
          userinfo: "user",
          host: "example.com",
          port: 8443,
          path: "/a/b",
          query: "x=1&y=2",
          fragment: "top",
        },
      );
    });

    it("parses scheme variations", () => {
      expect(parseUrl("http://h/")).toMatchObject({ scheme: "http" });
      expect(parseUrl("ftp://h/")).toMatchObject({ scheme: "ftp" });
      // RFC 3986: scheme may contain digits, `+`, `-`, `.` after the first letter.
      expect(parseUrl("x+y.z-w://h/")).toMatchObject({ scheme: "x+y.z-w" });
    });
  });

  describe("Authority", () => {
    it("parses userinfo with a colon", () => {
      expect(parseUrl("https://u:p@h/")).toMatchObject({
        userinfo: "u:p",
        host: "h",
      });
    });

    it("parses a port", () => {
      expect(parseUrl("http://h:8080/")).toMatchObject({
        host: "h",
        port: 8080,
      });
    });

    it("omits absent authority parts", () => {
      const result = parseUrl("https://example.com/");

      expect(result).toEqual({
        scheme: "https",
        host: "example.com",
        path: "/",
      });
      expect("userinfo" in result).toBe(false);
      expect("port" in result).toBe(false);
    });
  });

  describe("Path, query, fragment", () => {
    it("parses an empty path", () => {
      expect(parseUrl("https://h")).toMatchObject({ path: "" });
    });

    it("parses nested paths", () => {
      expect(parseUrl("https://h/a/b/c")).toMatchObject({ path: "/a/b/c" });
    });

    it("omits query and fragment when absent", () => {
      const result = parseUrl("https://h/p");

      expect("query" in result).toBe(false);
      expect("fragment" in result).toBe(false);
    });

    it("keeps an empty query distinct from an absent one", () => {
      expect(parseUrl("https://h/p?")).toMatchObject({ query: "" });
      expect(parseUrl("https://h/p#")).toMatchObject({ fragment: "" });
    });

    it("lets a query contain `/` and `?`", () => {
      expect(parseUrl("https://h/p?a/b?c")).toMatchObject({ query: "a/b?c" });
    });
  });

  describe("Opaque (authority-less) URLs", () => {
    it("parses mailto-style URLs", () => {
      expect(parseUrl("mailto:user@example.com")).toEqual({
        scheme: "mailto",
        path: "user@example.com",
      });
    });

    it("parses a bare scheme with empty path", () => {
      expect(parseUrl("about:")).toEqual({ scheme: "about", path: "" });
    });
  });

  describe("Error Handling", () => {
    it("rejects input with no scheme", () => {
      expect(() => parseUrl("://missing")).toThrow(/URL parse error/);
      expect(() => parseUrl("//host/path")).toThrow(/URL parse error/);
    });

    it("rejects a malformed port instead of re-reading it as a path", () => {
      // Without `commit`, `x://host:abc` would fall through to the
      // opaque-path alternative as `{ path: "//host:abc" }`.
      expect(() => parseUrl("x://host:abc")).toThrow(/URL parse error/);
    });

    it("rejects an empty authority after //", () => {
      expect(() => parseUrl("x://")).toThrow(/URL parse error/);
      expect(() => parseUrl("x://?q")).toThrow(/URL parse error/);
    });

    it("rejects whitespace inside the authority", () => {
      expect(() => parseUrl("x://a b/p")).toThrow(/URL parse error/);
    });
  });

  describe("Query parameters", () => {
    it("parses key=value pairs", () => {
      expect(parseQueryParams("a=1&b=2")).toEqual({ a: "1", b: "2" });
    });

    it("treats a bare key as an empty value", () => {
      expect(parseQueryParams("a&b=2")).toEqual({ a: "", b: "2" });
    });

    it("decodes percent escapes and +", () => {
      expect(parseQueryParams("q=hello+world&x=a%2Cb")).toEqual({
        q: "hello world",
        x: "a,b",
      });
    });

    it("leaves a malformed escape as-is", () => {
      expect(parseQueryParams("x=%zz")).toEqual({ x: "%zz" });
    });

    it("keeps the last value of a repeated key", () => {
      expect(parseQueryParams("k=1&k=2")).toEqual({ k: "2" });
    });

    it("returns {} for an empty query", () => {
      expect(parseQueryParams("")).toEqual({});
    });

    it("stores a __proto__ key as data", () => {
      const params = parseQueryParams("__proto__=x");
      expect(Object.hasOwn(params, "__proto__")).toBe(true);
      expect(params["__proto__"]).toBe("x");
      expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
    });
  });
});
