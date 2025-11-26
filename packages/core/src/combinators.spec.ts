import { describe, expect, it } from "bun:test";
import { lit } from "./basic";
import { choice, maybe, reject, seq, sequence, withDefault } from "./combinators";
import type { Pos } from "./types";
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
