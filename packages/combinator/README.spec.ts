import { describe, expect, it } from "bun:test";

import {
  type ParseSuccess,
  andPredicate,
  anyChar,
  charClass,
  choice,
  literal,
  map,
  mapResult,
  notPredicate,
  oneOrMore,
  optional,
  parse,
  sequence,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";

describe("@SuzumiyaAoba/combinator", () => {
  describe("Core Combinators", () => {
    describe("anyChar()", () => {
      it("should parse any single character", () => {
        const parser = anyChar();
        const successResult = parse(parser)("a");
        expect(successResult.success).toBe(true);
        if (successResult.success) {
          expect(successResult.val).toBe("a");
          expect(successResult.next.offset).toBe(1);
        }

        const failureResult = parse(parser)("");
        expect(failureResult.success).toBe(false);
      });
    });

    describe("literal(str)", () => {
      it("should parse a specific literal string", () => {
        const parser = literal("hello");
        const successResult = parse(parser)("hello world");
        expect(successResult.success).toBe(true);
        if (successResult.success) {
          expect(successResult.val).toBe("hello");
          expect(successResult.next.offset).toBe(5);
        }

        const failureResult1 = parse(parser)("world hello");
        expect(failureResult1.success).toBe(false);

        const failureResult2 = parse(parser)("hell");
        expect(failureResult2.success).toBe(false);
      });
    });

    describe("charClass(...charsOrRanges)", () => {
      it("should parse a character within a specified set or range", () => {
        const lowerCaseParser = charClass(["a", "z"]);
        const successResult1 = parse(lowerCaseParser)("b");
        expect(successResult1.success).toBe(true);
        if (successResult1.success) {
          expect(successResult1.val).toBe("b");
          expect(successResult1.next.offset).toBe(1);
        }

        const failureResult1 = parse(lowerCaseParser)("B");
        expect(failureResult1.success).toBe(false);

        const digitParser = charClass(["0", "9"]);
        const successResult2 = parse(digitParser)("5");
        expect(successResult2.success).toBe(true);
        if (successResult2.success) {
          expect(successResult2.val).toBe("5");
          expect(successResult2.next.offset).toBe(1);
        }

        const abcParser = charClass("a", "b", "c");
        const successResult3 = parse(abcParser)("a");
        expect(successResult3.success).toBe(true);
        if (successResult3.success) {
          expect(successResult3.val).toBe("a");
          expect(successResult3.next.offset).toBe(1);
        }

        const failureResult3 = parse(abcParser)("d");
        expect(failureResult3.success).toBe(false);

        const alphanumericParser = charClass(
          ["a", "z"],
          ["A", "Z"],
          ["0", "9"],
        );
        const successResult4 = parse(alphanumericParser)("Z");
        expect(successResult4.success).toBe(true);
        if (successResult4.success) {
          expect(successResult4.val).toBe("Z");
          expect(successResult4.next.offset).toBe(1);
        }
      });
    });

    describe("sequence(...parsers)", () => {
      it("should parse a sequence of parsers", () => {
        const parser = sequence(literal("hello"), charClass(["0", "9"]));
        const successResult = parse(parser)("hello5");
        expect(successResult.success).toBe(true);
        if (successResult.success) {
          expect(successResult.val).toEqual(["hello", "5"]);
          expect(successResult.next.offset).toBe(6);
        }

        const failureResult1 = parse(parser)("hello");
        expect(failureResult1.success).toBe(false);

        const failureResult2 = parse(parser)("world5");
        expect(failureResult2.success).toBe(false);

        const abcParser = sequence(literal("a"), literal("b"), literal("c"));
        const successResult2 = parse(abcParser)("abc");
        expect(successResult2.success).toBe(true);
        if (successResult2.success) {
          expect(successResult2.val).toEqual(["a", "b", "c"]);
          expect(successResult2.next.offset).toBe(3);
        }
      });
    });

    describe("choice(...parsers)", () => {
      it("should parse one of several alternative parsers", () => {
        const parser = choice(literal("hello"), literal("world"));
        const successResult1 = parse(parser)("hello");
        expect(successResult1.success).toBe(true);
        if (successResult1.success) {
          expect(successResult1.val).toBe("hello");
          expect(successResult1.next.offset).toBe(5);
        }

        const successResult2 = parse(parser)("world");
        expect(successResult2.success).toBe(true);
        if (successResult2.success) {
          expect(successResult2.val).toBe("world");
          expect(successResult2.next.offset).toBe(5);
        }

        const failureResult = parse(parser)("other");
        expect(failureResult.success).toBe(false);
      });
    });

    describe("optional(parser)", () => {
      it("should parse an optional parser", () => {
        const parser = optional(literal("hello"));
        const successResult1 = parse(parser)("hello");
        expect(successResult1.success).toBe(true);
        if (successResult1.success) {
          expect(successResult1.val).toEqual(["hello"]);
          expect(successResult1.next.offset).toBe(5);
        }

        const successResult2 = parse(parser)("world");
        expect(successResult2.success).toBe(true);
        if (successResult2.success) {
          expect(successResult2.val).toEqual([]);
          expect(successResult2.next.offset).toBe(0);
        }
      });
    });

    describe("zeroOrMore(parser)", () => {
      it("should parse zero or more occurrences of a parser", () => {
        const parser = zeroOrMore(literal("a"));
        const successResult1 = parse(parser)("aaa");
        expect(successResult1.success).toBe(true);
        if (successResult1.success) {
          expect(successResult1.val).toEqual(["a", "a", "a"]);
          expect(successResult1.next.offset).toBe(3);
        }

        const successResult2 = parse(parser)("bbb");
        expect(successResult2.success).toBe(true);
        if (successResult2.success) {
          expect(successResult2.val).toEqual([]);
          expect(successResult2.next.offset).toBe(0);
        }
      });
    });

    describe("oneOrMore(parser)", () => {
      it("should parse one or more occurrences of a parser", () => {
        const parser = oneOrMore(literal("a"));
        const successResult1 = parse(parser)("aaa");
        expect(successResult1.success).toBe(true);
        if (successResult1.success) {
          expect(successResult1.val).toEqual(["a", "a", "a"]);
          expect(successResult1.next.offset).toBe(3);
        }

        const successResult2 = parse(parser)("a");
        expect(successResult2.success).toBe(true);
        if (successResult2.success) {
          expect(successResult2.val).toEqual(["a"]);
          expect(successResult2.next.offset).toBe(1);
        }

        const failureResult = parse(parser)("bbb");
        expect(failureResult.success).toBe(false);
      });
    });

    describe("andPredicate(parser)", () => {
      it("should check if a parser succeeds without consuming input", () => {
        const parser = andPredicate(literal("a"));
        const successResult1 = parse(parser)("abc");
        expect(successResult1.success).toBe(true);
        if (successResult1.success) {
          expect(successResult1.next.offset).toBe(0);
        }
        const successResult2 = parse(sequence(parser, anyChar()))("abc");
        expect(successResult2.success).toBe(true);
        if (successResult2.success) {
          expect(successResult2.val).toEqual([undefined as never, "a"]);
          expect(successResult2.next.offset).toBe(1);
        }

        const failureResult = parse(parser)("bbc");
        expect(failureResult.success).toBe(false);
      });
    });

    describe("notPredicate(parser)", () => {
      it("should check if a parser fails without consuming input", () => {
        const parser = notPredicate(literal("a"));
        const successResult1 = parse(parser)("bbc");
        expect(successResult1.success).toBe(true);
        if (successResult1.success) {
          expect(successResult1.next.offset).toBe(0);
        }
        const successResult2 = parse(sequence(parser, anyChar()))("bbc");
        expect(successResult2.success).toBe(true);
        if (successResult2.success) {
          expect(successResult2.val).toEqual([undefined as never, "b"]);
          expect(successResult2.next.offset).toBe(1);
        }

        const failureResult = parse(parser)("abc");
        expect(failureResult.success).toBe(false);
      });
    });

    describe("map(parser, f)", () => {
      it("should transform the result of a parser using a mapping function", () => {
        const parser = map(literal("hello"), (s) => s.toUpperCase());
        const successResult = parse(parser)("hello");
        expect(successResult.success).toBe(true);
        if (successResult.success) {
          expect(successResult.val).toBe("HELLO");
          expect(successResult.next.offset).toBe(5);
        }

        const failureResult = parse(parser)("world");
        expect(failureResult.success).toBe(false);
      });
    });

    describe("mapResult(parser, f)", () => {
      it("should transform the result of a parser using a mapping function that receives the whole ParseSuccess object", () => {
        const parser = mapResult(
          literal("hello"),
          (result: ParseSuccess<string>) => {
            return {
              val: result.val.toUpperCase(),
              offset: result.next.offset,
            };
          },
        );
        const successResult = parse(parser)("hello");
        expect(successResult.success).toBe(true);
        if (successResult.success) {
          expect(successResult.val).toEqual({ val: "HELLO", offset: 5 });
          expect(successResult.next.offset).toBe(5);
        }

        const failureResult = parse(parser)("world");
        expect(failureResult.success).toBe(false);
      });
    });
  });
});
