import { describe, expect, it } from "bun:test";
import {
  and,
  any,
  charClass,
  choice,
  isEmptyArray,
  isNonEmptyArray,
  lit,
  map,
  not,
  opt,
  plus,
  seq,
  star,
} from "./index";
import type { Pos } from "./index";

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
      expect(result.error.message).toBe("Unexpected end of input");
      expect(result.error.pos).toEqual(pos);
    }
  });

  it("should return error for out of bound", () => {
    const input = "a";
    const pos: Pos = { offset: 1, column: 1, line: 1 };
    const result = any()(input, pos);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Unexpected end of input");
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
      expect(result.error.message).toBe("Unexpected character");
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
      expect(result.error.message).toBe("Unexpected EOF");
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
      expect(result.error.message).toBe("Unexpected character");
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
      expect(result.error.message).toBe("Expected one of: choice 1, choice 2");
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
      expect(result.error.message).toBe("Expected at least one");
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
      expect(result.error.message).toBe("And-predicate did not match");
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
      expect(result.error.message).toBe("Not-predicate matched");
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
      expect(result.error.message).toBe("Unexpected character");
      expect(result.error.pos).toEqual({ offset: 0, column: 0, line: 1 });
    }
  });
});
