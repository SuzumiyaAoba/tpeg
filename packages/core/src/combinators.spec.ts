import { describe, expect, it } from "bun:test";
import { lit } from "./basic";
import {
  choice,
  lazy,
  maybe,
  reject,
  seq,
  sequence,
  withDefault,
} from "./combinators";
import type { Parser, Pos } from "./types";
import { createFailure } from "./utils";

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

  it("should return error if any parser fails", () => {
    const input = "abd";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = seq(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(false);
  });

  it("should handle empty sequence", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = seq()(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
      expect(result.next).toEqual(pos);
    }
  });

  it("should fail if a parser is undefined", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    // @ts-ignore
    const result = seq(lit("a"), undefined)(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Parser at index 1 is undefined");
    }
  });
});

describe("choice", () => {
  it("should parse with the first matching parser", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = choice(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should try the next parser if the previous one fails", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = choice(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("b");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should return error if all parsers fail", () => {
    const input = "d";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = choice(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(false);
  });

  it("should handle empty choice", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = choice()(input, pos);
    expect(result.success).toBe(false);
  });

  it("should fail if a parser is undefined", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    // @ts-ignore
    const result = choice(lit("a"), undefined)(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Parser at index 1 is undefined");
    }
  });

  it("should aggregate expected values from failures", () => {
    const input = "d";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = choice(lit("a"), lit("b"))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.expected).toEqual(["a", "b"]);
    }
  });

  it("should handle nested expected arrays in failures", () => {
    const input = "d";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const parserWithNestedExpected = (_: string, pos: Pos) =>
      createFailure("fail", pos, { expected: ["x", "y"] });
    const result = choice(lit("a"), parserWithNestedExpected)(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.expected).toEqual(["a", "x", "y"]);
    }
  });

  it("should report only the farthest failure's expected values, not earlier (closer) ones", () => {
    // alt1 fails immediately at offset 0; alt2 consumes one char before
    // failing at offset 1. Only alt2's expectation should survive --
    // alt1's "a" is from a strictly closer (less useful) failure and
    // must not be merged in alongside it.
    const input = "xz";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = choice(lit("a"), sequence(lit("x"), lit("y")))(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.expected).toEqual(["y"]);
      expect(result.error.pos).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should merge expected values only across failures tied at the farthest offset", () => {
    // alt1 and alt3 both fail at offset 1 (after consuming "x"); alt2
    // fails immediately at offset 0 and must be excluded from the merge.
    const input = "xz";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = choice(
      sequence(lit("x"), lit("y")),
      lit("a"),
      sequence(lit("x"), lit("w")),
    )(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.expected).toEqual(["y", "w"]);
      expect(result.error.pos).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });
});

describe("sequence", () => {
  it("should be an alias for seq", () => {
    const input = "abc";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = sequence(lit("a"), lit("b"), lit("c"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["a", "b", "c"]);
      expect(result.next).toEqual({ offset: 3, column: 3, line: 1 });
    }
  });
});

describe("maybe", () => {
  it("should return the result if parser succeeds", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = maybe(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should return null if parser fails", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = maybe(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeNull();
      expect(result.next).toEqual(pos);
    }
  });
});

describe("withDefault", () => {
  it("should return the parsed value if parser succeeds", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = withDefault(lit("a"), "default")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
      expect(result.next).toEqual({ offset: 1, column: 1, line: 1 });
    }
  });

  it("should return the default value if parser fails", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = withDefault(lit("a"), "default")(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("default");
      expect(result.next).toEqual(pos); // Position should not advance
    }
  });
});

describe("reject", () => {
  it("should succeed if the given parser fails", () => {
    const input = "b";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = reject(lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeNull();
      expect(result.next).toEqual(pos); // Position should not advance
    }
  });

  it("should fail if the given parser succeeds", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = reject(lit("a"))(input, pos);
    expect(result.success).toBe(false);
  });
});

describe("lazy", () => {
  it("delegates to the parser returned by the thunk", () => {
    const input = "a";
    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = lazy(() => lit("a"))(input, pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("a");
    }
  });

  it("defers reading a not-yet-initialized const, breaking the TDZ that a plain reference hits", () => {
    // Mirrors the shape generated code produces for mutually recursive
    // rules: `a` refers to `b`, which is declared below it. A direct
    // reference (`b` instead of `lazy(() => b)`) would throw
    // "Cannot access 'b' before initialization" as soon as `a`'s
    // initializer ran.
    const a: Parser<unknown> = sequence(
      lit("("),
      lazy(() => b),
      lit(")"),
    );
    const b: Parser<unknown> = choice(a, lit("x"));

    const pos: Pos = { offset: 0, column: 0, line: 1 };
    const result = a("(((x)))", pos);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next.offset).toBe(7);
    }
  });
});
