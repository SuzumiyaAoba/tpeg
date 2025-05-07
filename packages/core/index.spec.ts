import { describe, expect, it } from "bun:test";
import {
  and,
  andPredicate,
  any,
  anyChar,
  charClass,
  choice,
  formatParseError,
  formatParseResult,
  isEmptyArray,
  isNonEmptyArray,
  lit,
  literal,
  map,
  mapResult,
  not,
  notPredicate,
  oneOrMore,
  opt,
  optional,
  parse,
  plus,
  reportParseError,
  seq,
  sequence,
  star,
  zeroOrMore,
} from "./index";
import type { ParseError, ParseResult, ParseSuccess, Pos } from "./index";

describe("isEmptyArray", () => {
  it("should return true for an empty array", () => {
    expect(isEmptyArray([])).toBe(true);
  });

  it("should return false for a non-empty array", () => {
    expect(isEmptyArray([1, 2, 3])).toBe(false);
  });
});

describe("isNonEmptyArray", () => {
  it("should return false for an empty array", () => {
    expect(isNonEmptyArray([])).toBe(false);
  });

  it("should return true for a non-empty array", () => {
    expect(isNonEmptyArray([1, 2, 3])).toBe(true);
  });
});

describe("any", () => {
  it("should parse any single character", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should parse newline character", () => {
    const input = "\n";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("\n");
      expect(result.next).toEqual({ offset: 1, column: 0, line: 2 });
    }
  });

  it("should return error for empty input", () => {
    const input = "";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Unexpected EOI");
      expect(result.error.pos).toEqual(pos);
    }
  });

  it("should return error for out of bound", () => {
    const input = "a";
    const pos: Pos = { offset: 1, column: 1, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Unexpected EOI");
      expect(result.error.pos).toEqual(pos);
    }
  });
});

describe("string", () => {
  it("should parse a string", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("abc")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("abc");
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  it("should return error if string does not match", () => {
    const input = "abd";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("abc")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected character");
      expect(result.error.pos).toEqual({ offset: 2, column: 2, line: 1 });
    }
  });

  it("should handle newline in string", () => {
    const input = "a\nb";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("a\nb")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a\nb");
      expect(result.next).toEqual({ offset: 3, column: 1, line: 2 });
    }
  });

  it("should handle surrogate pairs correctly", () => {
    // 𝄞 (musical G clef) is a surrogate pair (U+1D11E) represented as \uD834\uDD1E
    const input = "𝄞abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("𝄞abc")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("𝄞abc");
      // 𝄞 is a surrogate pair (2 code units) + 3 characters
      expect(result.next).toEqual({ offset: 5, column: 4, line: 1 });
    }
  });

  it("should correctly parse emoji characters", () => {
    // 🙂 is a surrogate pair (U+1F642)
    const input = "🙂🙂";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("🙂🙂")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("🙂🙂");
      // Each emoji is 2 code units, so 4 in total
      expect(result.next).toEqual({ offset: 4, column: 2, line: 1 });
    }
  });

  it("should handle mixed normal and surrogate pair characters", () => {
    const input = "a🙂b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("a🙂b")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a🙂b");
      // 1 (a) + 2 (🙂) + 1 (b) = 4 code units
      expect(result.next).toEqual({ offset: 4, column: 3, line: 1 });
    }
  });

  it("should fail correctly on partial emoji mismatch", () => {
    const input = "a🙃b"; // Different emoji (upside-down smile)
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("a🙂b")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected character");
      expect(result.error.pos).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });
});

describe("charClass", () => {
  it("should parse a single character", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("a")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should parse a character within a range", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass(["a", "c"])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("b");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should return error if character does not match", () => {
    const input = "d";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass(["a", "c"])(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Expected [a-c]");
      expect(result.error.pos).toEqual(pos);
    }
  });

  it("should handle newline", () => {
    const input = "\n";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("\n")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("\n");
      expect(result.next).toEqual({ offset: 1, column: 0, line: 2 });
    }
  });

  it("should return error for EOF", () => {
    const input = "";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("a")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Unexpected EOI");
      expect(result.error.pos).toEqual(pos);
    }
  });
});

describe("seq", () => {
  it("should parse a sequence of parsers", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = seq(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "b", "c"]);
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  it("should return error if a parser fails", () => {
    const input = "abd";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = seq(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Sequence failed at item 3");
      expect(result.error.pos).toEqual({ offset: 2, column: 2, line: 1 });
    }
  });
});

describe("choice", () => {
  it("should parse the first successful parser", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = choice(lit("a"), lit("b"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should return error if all parsers fail", () => {
    const input = "c";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = choice(lit("a"), lit("b"))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain(
        "None of the 2 alternatives matched",
      );
      expect(result.error.pos).toEqual(pos);
    }
  });
});

describe("opt", () => {
  it("should parse the parser if it succeeds", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = opt(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a"]);
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should return empty array if parser fails", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = opt(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toEqual(pos);
    }
  });
});

describe("star", () => {
  it("should parse zero or more occurrences", () => {
    const input = "aaa";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = star(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a", "a"]);
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  it("should return empty array if parser fails", () => {
    const input = "bbb";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = star(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toEqual(pos);
    }
  });
});

describe("plus", () => {
  it("should parse one or more occurrences", () => {
    const input = "aaa";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = plus(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "a", "a"]);
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });

  it("should return error if parser fails", () => {
    const input = "bbb";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = plus(lit("a"))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Expected at least one match");
      expect(result.error.pos).toEqual(pos);
    }
  });
});

describe("positive", () => {
  it("should succeed if parser succeeds", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = and(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeUndefined();
      expect(result.next).toEqual(pos);
    }
  });

  it("should return error if parser fails", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = and(lit("a"))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("And-predicate did not match");
      expect(result.error.pos).toEqual(pos);
    }
  });
});

describe("negative", () => {
  it("should succeed if parser fails", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = not(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeUndefined();
      expect(result.next).toEqual(pos);
    }
  });

  it("should return error if parser succeeds", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = not(lit("a"))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Not-predicate matched");
      expect(result.error.pos).toEqual(pos);
    }
  });
});

describe("map", () => {
  it("should map the value", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = map(lit("a"), ($) => $.toUpperCase())(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("A");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should return error if parser fails", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = map(lit("a"), ($) => $.toUpperCase())(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Unexpected character");
      expect(result.error.pos).toEqual({ offset: 0, column: 0, line: 1 });
    }
  });
});

describe("Unicode support", () => {
  it("should parse a single Unicode emoji with any", () => {
    const input = "😊";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("😊");
      expect(result.next).toEqual({ offset: 2, column: 1, line: 1 });
    }
  });

  it("should parse a single Unicode emoji with charClass", () => {
    const input = "😊";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("😊")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("😊");
      expect(result.next).toEqual({ offset: 2, column: 1, line: 1 });
    }
  });

  it("should parse a Unicode character in a range with charClass", () => {
    const input = "𝄞"; // U+1D11E MUSICAL SYMBOL G CLEF
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass(["𝄀", "𝄿"])(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("𝄞");
      expect(result.next).toEqual({ offset: 2, column: 1, line: 1 });
    }
  });

  it("should parse a Unicode string with lit", () => {
    const input = "a😊b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lit("a😊b")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a😊b");
      expect(result.next).toEqual({ offset: 4, column: 3, line: 1 });
    }
  });

  it("should return error for non-matching Unicode with charClass", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = charClass("😊")(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Expected");
      expect(result.error.pos).toEqual(pos);
    }
  });
});

describe("tpeg-combinator", () => {
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

describe("Enhanced Error Handling", () => {
  const pos: Pos = { offset: 0, column: 0, line: 1 };

  describe("anyChar", () => {
    it("should provide enhanced error information", () => {
      const input = "";
      const result = anyChar()(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Unexpected EOI");
        expect(result.error.expected).toBe("any character");
        expect(result.error.found).toBe("end of input");
        expect(result.error.parserName).toBe("anyChar");
      }
    });

    it("should allow custom parser name", () => {
      const input = "";
      const result = anyChar("customAnyChar")(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.parserName).toBe("customAnyChar");
      }
    });
  });

  describe("literal", () => {
    it("should provide enhanced error information for EOI", () => {
      const input = "";
      const result = literal("abc")(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Unexpected EOI");
        expect(result.error.expected).toBe('"abc"');
        expect(result.error.found).toBe("end of input");
        expect(result.error.parserName).toBe("literal");
      }
    });

    it("should provide enhanced error with mismatch information", () => {
      const input = "abd";
      const result = literal("abc")(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Unexpected character");
        expect(result.error.expected).toBe('"abc"');
        expect(result.error.found).toBe("abd");
        expect(result.error.parserName).toBe("literal");
      }
    });

    it("should allow custom parser name", () => {
      const input = "abd";
      const result = literal("abc", "myLiteral")(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.parserName).toBe("myLiteral");
      }
    });
  });

  describe("charClass", () => {
    it("should provide enhanced error information", () => {
      const input = "x";
      const result = charClass("a", ["0", "9"])(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Expected [a0-9]");
        expect(result.error.expected).toBe("[a0-9]");
        expect(result.error.found).toBe("x");
        expect(result.error.parserName).toBe("charClass");
      }
    });

    it("should provide enhanced error for EOI", () => {
      const input = "";
      const result = charClass("a", ["0", "9"])(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Unexpected EOI");
        expect(result.error.expected).toBe("[a0-9]");
        expect(result.error.found).toBe("end of input");
      }
    });
  });

  describe("sequence", () => {
    it("should provide enhanced error information with context", () => {
      const input = "a";
      const parser = sequence(lit("a"), lit("b"), lit("c"));
      const result = parser(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Sequence failed at item 2");
        expect(result.error.context).toContain("sequence item 2 of 3");
        expect(result.error.parserName).toBeDefined();
      }
    });
  });

  describe("choice", () => {
    it("should provide enhanced error information with all alternatives", () => {
      const input = "x";
      const parser = choice(lit("a"), lit("b"), lit("c"));
      const result = parser(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain(
          "None of the 3 alternatives matched",
        );
        expect(result.error.expected).toBeDefined();
        expect(result.error.parserName).toBe("choice");
        expect(result.error.context).toContain("choice with 3 alternatives");
      }
    });
  });

  describe("oneOrMore", () => {
    it("should provide enhanced error information", () => {
      const input = "x";
      const parser = oneOrMore(lit("a"));
      const result = parser(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Expected at least one match");
        expect(result.error.parserName).toBe("oneOrMore");
        expect(result.error.context).toContain("first item in oneOrMore");
      }
    });
  });

  describe("andPredicate", () => {
    it("should provide enhanced error information", () => {
      const input = "x";
      const parser = andPredicate(lit("a"));
      const result = parser(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("And-predicate did not match");
        expect(result.error.parserName).toBe("andPredicate");
        expect(result.error.context).toContain("in positive lookahead");
      }
    });
  });

  describe("notPredicate", () => {
    it("should provide enhanced error information", () => {
      const input = "a";
      const parser = notPredicate(lit("a"));
      const result = parser(input, pos);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain(
          "Not-predicate matched when it should not have",
        );
        expect(result.error.parserName).toBe("notPredicate");
        expect(result.error.context).toContain("in negative lookahead");
        expect(result.error.expected).toBe("pattern not to match");
      }
    });
  });
});

describe("Error Formatting", () => {
  const pos: Pos = { offset: 10, column: 5, line: 3 };
  const error: ParseError = {
    message: "Unexpected character",
    pos,
    expected: '"abc"',
    found: "x",
    parserName: "literal",
    context: ["in expression", "parsing rule"],
  };

  describe("formatParseError", () => {
    it("should format error information with all details", () => {
      const input = "line 1\nline 2\nabcdex\nline 4";
      const formatted = formatParseError(error, input, { colorize: false });

      expect(formatted).toContain("Parse error at line 3, column 5");
      expect(formatted).toContain("Context: in expression > parsing rule");
      expect(formatted).toContain("Parser: literal");
      expect(formatted).toContain('Expected: "abc"');
      expect(formatted).toContain("Found: x");
      expect(formatted).toContain("Source context:");
      expect(formatted).toContain("line 2");
      expect(formatted).toContain("> 3 | abcdex");
      expect(formatted).toContain("line 4");
      expect(formatted).toContain("Position: Line 3, Column 5, Offset 10");
    });

    it("should handle empty input", () => {
      const formatted = formatParseError(error, "", { colorize: false });
      expect(formatted).toContain("Parse error at line 3, column 5");
      expect(formatted).not.toContain("Source context:"); // No source context for empty input
    });

    it("should respect formatting options", () => {
      const minimalFormatted = formatParseError(
        error,
        "line 1\nline 2\nabcdex\nline 4",
        {
          colorize: false,
          contextLines: 0,
          showPosition: false,
          highlightErrors: false,
        },
      );

      expect(minimalFormatted).toContain("Parse error at line 3, column 5");
      expect(minimalFormatted).not.toContain("Position:"); // Should not show position
      // エラーメッセージの各行数を直接確認せずに、必要な情報が含まれているかを確認
      expect(minimalFormatted).toContain("Parser: literal");
    });
  });

  describe("formatParseResult", () => {
    it("should return null for successful parse results", () => {
      const successResult: ParseResult<string> = {
        success: true,
        val: "test",
        current: pos,
        next: pos,
      };

      const formatted = formatParseResult(successResult, "input", {
        colorize: false,
      });
      expect(formatted).toBeNull();
    });

    it("should format error for failed parse results", () => {
      const failureResult: ParseResult<string> = {
        success: false,
        error,
      };

      const formatted = formatParseResult(failureResult, "input", {
        colorize: false,
      });
      expect(formatted).toContain("Parse error at line 3, column 5");
    });
  });

  describe("reportParseError", () => {
    it("should report errors for failed parse results", () => {
      // Save original console.error
      const originalConsoleError = console.error;

      try {
        // Replace console.error with a mock function
        let called = false;
        console.error = () => {
          called = true;
        };

        const failureResult: ParseResult<string> = {
          success: false,
          error,
        };

        reportParseError(failureResult, "input");
        expect(called).toBe(true);
      } finally {
        // Restore original console.error
        console.error = originalConsoleError;
      }
    });

    it("should not report anything for successful parse results", () => {
      // Save original console.error
      const originalConsoleError = console.error;

      try {
        // Replace console.error with a mock function
        let called = false;
        console.error = () => {
          called = true;
        };

        const successResult: ParseResult<string> = {
          success: true,
          val: "test",
          current: pos,
          next: pos,
        };

        reportParseError(successResult, "input");
        expect(called).toBe(false);
      } finally {
        // Restore original console.error
        console.error = originalConsoleError;
      }
    });
  });
});
