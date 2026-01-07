import { describe, expect, it } from "bun:test";
import type { Parser, Pos } from "@suzumiyaaoba/tpeg-core";
import {
  charClass,
  choice,
  literal,
  map,
  oneOrMore,
  seq,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import {
  between,
  recursive,
  token,
} from "./index";

describe("combinator integration tests", () => {
  it("should detect and prevent infinite loops in repetition parsers", () => {
    // Parser that always succeeds without consuming input
    const problematicParser: Parser<string> = (_input: string, pos: Pos) => ({
      success: true,
      val: "problematic",
      current: pos,
      next: pos, // Returns the same position
    });

    const repeatedProblematic = zeroOrMore(problematicParser);

    // Should detect the infinite loop and return a failure
    const result = repeatedProblematic("test", {
      offset: 0,
      line: 1,
      column: 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Infinite loop detected");
    }
  });

  it("should handle nested structures", () => {
    const openParser = literal("{");
    const closeParser = literal("}");
    const parser = between(openParser, closeParser);

    const result = parser('{a:"b",c:123}', { offset: 0, line: 1, column: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe('a:"b",c:123');
    }
  });

  it("should handle recursive math expressions", () => {
    const [expr, setExpr] = recursive<number>();

    const num = map(oneOrMore(charClass(["0", "9"])), (digits) =>
      Number.parseInt(digits.join(""), 10),
    );

    const parenExpr = map(
      seq(token(literal("(")), expr, token(literal(")"))),
      ([_, val, __]) => val,
    );

    const term = token(choice(num, parenExpr));

    setExpr(
      map(
        seq(term, zeroOrMore(seq(choice(literal("+"), literal("-")), term))),
        ([first, rest]) => {
          return rest.reduce((acc, [op, val]) => {
            return op === "+" ? (acc as number) + (val as number) : (acc as number) - (val as number);
          }, first as number);
        },
      ),
    );

    const result = expr("2 + (3 - 1)", { offset: 0, line: 1, column: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe(4);
    }
  });
});
