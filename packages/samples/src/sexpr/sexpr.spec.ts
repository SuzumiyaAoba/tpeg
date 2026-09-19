import { describe, expect, it } from "vite-plus/test";
import { num, parseSExpr, parseSExprs, printSExp, str, sym } from "./sexpr";

describe("S-expression Parser", () => {
  describe("Atoms", () => {
    it("parses symbols", () => {
      expect(parseSExpr("foo")).toEqual(sym("foo"));
      expect(parseSExpr("a-b_c+d")).toEqual(sym("a-b_c+d"));
      // `+` and `-` alone are symbols, not malformed numbers.
      expect(parseSExpr("+")).toEqual(sym("+"));
      expect(parseSExpr("-")).toEqual(sym("-"));
    });

    it("parses integers and floats", () => {
      expect(parseSExpr("42")).toEqual(num(42));
      expect(parseSExpr("-17")).toEqual(num(-17));
      expect(parseSExpr("+8")).toEqual(num(8));
      expect(parseSExpr("3.14")).toEqual(num(3.14));
      expect(parseSExpr("-0.5")).toEqual(num(-0.5));
    });

    it("treats a number-like token with no digit boundary as a symbol", () => {
      // `-5abc` has no delimiter after the digits -- the number parser's
      // trailing lookahead rejects it and the whole token is a symbol.
      expect(parseSExpr("-5abc")).toEqual(sym("-5abc"));
      expect(parseSExpr("1.")).toEqual(sym("1."));
    });

    it("parses quoted strings with escapes", () => {
      expect(parseSExpr('"hello"')).toEqual(str("hello"));
      expect(parseSExpr('"a\\nb"')).toEqual(str("a\nb"));
      expect(parseSExpr('"q\\"q"')).toEqual(str('q"q'));
    });
  });

  describe("Lists", () => {
    it("parses flat lists", () => {
      expect(parseSExpr("(a b c)")).toEqual([sym("a"), sym("b"), sym("c")]);
    });

    it("parses nested lists", () => {
      expect(parseSExpr("(a (b (c)) d)")).toEqual([
        sym("a"),
        [sym("b"), [sym("c")]],
        sym("d"),
      ]);
    });

    it("parses the empty list", () => {
      expect(parseSExpr("()")).toEqual([]);
      expect(parseSExpr("(  )")).toEqual([]);
    });

    it("parses deeply nested lists", () => {
      expect(parseSExpr("((((x))))")).toEqual([[[[sym("x")]]]]);
    });

    it("handles whitespace anywhere between elements", () => {
      expect(parseSExpr("(  a\t\nb\r\n  c  )")).toEqual([
        sym("a"),
        sym("b"),
        sym("c"),
      ]);
    });
  });

  describe("Quote sugar", () => {
    it("desugars 'x to (quote x)", () => {
      expect(parseSExpr("'x")).toEqual([sym("quote"), sym("x")]);
      expect(parseSExpr("'(a b)")).toEqual([
        sym("quote"),
        [sym("a"), sym("b")],
      ]);
    });

    it("nests inside lists", () => {
      expect(parseSExpr("(f 'x '())")).toEqual([
        sym("f"),
        [sym("quote"), sym("x")],
        [sym("quote"), []],
      ]);
    });
  });

  describe("Comments", () => {
    it("skips ; comments to end of line", () => {
      expect(parseSExpr("; note\n(a ; mid\nb) ; tail")).toEqual([
        sym("a"),
        sym("b"),
      ]);
    });

    it("splits a symbol at a comment", () => {
      expect(parseSExpr("(foo;rest\nbar)")).toEqual([sym("foo"), sym("bar")]);
    });
  });

  describe("Documents", () => {
    it("parses multiple top-level forms", () => {
      expect(parseSExprs('x (y) "z" ; done')).toEqual([
        sym("x"),
        [sym("y")],
        str("z"),
      ]);
    });

    it("parses an empty document", () => {
      expect(parseSExprs("")).toEqual([]);
      expect(parseSExprs("  ; only a comment\n")).toEqual([]);
    });

    it("rejects a document with exactly-one requirement violations", () => {
      expect(() => parseSExpr("a b")).toThrow(/found 2/);
      expect(() => parseSExpr("")).toThrow(/found 0/);
    });
  });

  describe("Error Handling", () => {
    it("rejects an unclosed list", () => {
      expect(() => parseSExpr("(a b")).toThrow(/parse error/);
    });

    it("rejects a stray close paren", () => {
      expect(() => parseSExpr("a)")).toThrow(/parse error/);
    });
  });

  describe("Printing", () => {
    it("round-trips through printSExp", () => {
      const source = '(a (b "c d" \'e) -12.5)';
      const printed = printSExp(parseSExpr(source));

      expect(printed).toBe('(a (b "c d" (quote e)) -12.5)');
      expect(parseSExpr(printed)).toEqual(parseSExpr(source));
    });

    it("escapes special characters in strings", () => {
      expect(printSExp(str('a"b\nc'))).toBe('"a\\"b\\nc"');
    });
  });
});
