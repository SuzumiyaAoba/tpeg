import { describe, expect, it } from "bun:test";
import { any, literal } from "./basic";
import { charClass } from "./char-class";
import { choice as alt, seq } from "./combinators";
import { formatParseError, reportParseError } from "./error";
import { not } from "./lookahead";
import { zeroOrMore as many, oneOrMore as many1, optional } from "./repetition";
import { map } from "./transform";
import { parse } from "./utils";

// Character class definitions
const digit = () => charClass(["0", "9"]);
const letter = () => charClass(["a", "z"], ["A", "Z"]);
const whitespace = () => charClass(" ", "\t", "\n", "\r");

// Integration tests
describe("Integration tests", () => {
  // CSV parser tests
  describe("CSV parser", () => {
    // Newline parser (supporting CR, LF, and CRLF)
    const newline = alt(literal("\r\n"), literal("\n"), literal("\r"));

    // Function to parse a string until a comma, newline, or end of input
    const cell = map(many(seq(not(alt(literal(","), newline)), any)), (chars) =>
      chars.map(([_, c]) => c).join(""),
    );

    // Function to parse a row
    const row = map(
      seq(cell, many(seq(literal(","), cell))),
      ([first, rest]) => [first, ...rest.map(([, cell]) => cell)],
    );

    // Function to parse a CSV
    const csvParser = map(
      seq(row, many(seq(newline, row))),
      ([first, rest]) => [first, ...rest.map(([, row]) => row)],
    );

    it("should parse a simple CSV", () => {
      const input = "a,b,c\nd,e,f";
      const result = parse(csvParser)(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual([
          ["a", "b", "c"],
          ["d", "e", "f"],
        ]);
      }
    });

    it("should parse empty cells", () => {
      const input = "a,,c\n,e,";
      const result = parse(csvParser)(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual([
          ["a", "", "c"],
          ["", "e", ""],
        ]);
      }
    });

    it("should handle CRLF line endings", () => {
      const input = "a,b\r\nc,d";
      const result = parse(csvParser)(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual([
          ["a", "b"],
          ["c", "d"],
        ]);
      }
    });
  });

  // Calculator parser tests
  describe("Calculator parser", () => {
    // Number parser
    const numParser = map(many1(digit()), (digits) =>
      Number.parseInt(digits.join(""), 10),
    );

    // Arithmetic operation parsers (simplified version)
    const addOp = alt(literal("+"), literal("-"));
    const mulOp = alt(literal("*"), literal("/"));

    // Function to parse a term
    const term = map(
      seq(numParser, many(seq(mulOp, numParser))),
      ([first, rest]) => {
        return rest.reduce((acc, [op, val]) => {
          if (op === "*") return acc * val;
          if (op === "/") return Math.floor(acc / val);
          return acc;
        }, first);
      },
    );

    // Function to parse an expression
    const expr = map(seq(term, many(seq(addOp, term))), ([first, rest]) => {
      return rest.reduce((acc, [op, val]) => {
        if (op === "+") return acc + val;
        if (op === "-") return acc - val;
        return acc;
      }, first);
    });

    it("should parse simple arithmetic expressions", () => {
      const input = "1+2*3";
      const result = parse(expr)(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(7); // 1 + (2 * 3)
      }
    });

    it("should handle operator precedence", () => {
      const input = "2*3+4";
      const result = parse(expr)(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(10); // (2 * 3) + 4
      }
    });
  });

  // Error handling and error message tests
  describe("Error Handling", () => {
    const intParser = map(many1(digit()), (digits) =>
      Number.parseInt(digits.join(""), 10),
    );

    const labeledExpr = map(
      seq(
        intParser,
        alt(literal("+"), literal("-"), literal("*"), literal("/")),
        intParser,
      ),
      ([left, op, right]) => {
        switch (op) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            return left / right;
          default:
            return 0;
        }
      },
    );

    it("should provide detailed error messages", () => {
      const input = "123+abc";
      const result = parse(labeledExpr)(input);
      expect(result.success).toBe(false);

      if (!result.success) {
        const errorMessage = formatParseError(result.error, input);
        expect(errorMessage).toContain("Parse error");
        expect(errorMessage).toContain("Expected");
        expect(errorMessage).toContain("Found: a");
      }
    });

    it("should detect invalid operators", () => {
      const input = "123#456";
      const result = parse(labeledExpr)(input);
      expect(result.success).toBe(false);

      if (!result.success) {
        const errorMessage = formatParseError(result.error, input);
        expect(errorMessage).toContain("Parse error");
        expect(errorMessage).toContain("Expected");
        expect(errorMessage).toContain("Found: #");
      }
    });

    it("should handle errors at the end of input", () => {
      const input = "123+";
      const result = parse(labeledExpr)(input);
      expect(result.success).toBe(false);

      if (!result.success) {
        const errorMessage = formatParseError(result.error, input);
        expect(errorMessage).toContain("Parse error");
        expect(errorMessage).toContain("Expected");
        expect(errorMessage).toContain("end of input");
      }
    });
  });

  // Unicode support tests
  describe("Unicode Support", () => {
    // Emoji parser
    const emoji = alt(
      literal("😀"),
      literal("😁"),
      literal("😂"),
      literal("🤣"),
      literal("😊"),
    );

    // Function to parse emoji sequences
    const emojiSequence = many1(emoji);

    it("should parse emoji characters correctly", () => {
      const input = "😀😁😂🤣😊";
      const result = parse(emojiSequence)(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["😀", "😁", "😂", "🤣", "😊"]);
      }
    });

    it("should handle mixed ASCII and emoji", () => {
      // Parser for alternating characters and emoji
      const mixedParser = many1(alt(letter(), emoji));
      const input = "a😀b😁c😂";
      const result = parse(mixedParser)(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "😀", "b", "😁", "c", "😂"]);
      }
    });

    // Surrogate pair tests
    it("should correctly handle surrogate pairs", () => {
      // 𝄞 (musical G clef) is a surrogate pair U+1D11E
      const musicalSymbol = literal("𝄞");
      const input = "𝄞𝄞𝄞";
      const result = parse(many1(musicalSymbol))(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["𝄞", "𝄞", "𝄞"]);
      }
    });
  });
});
