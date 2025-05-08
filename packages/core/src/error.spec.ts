import { describe, expect, it } from "bun:test";
import { lit } from "./basic";
import { formatParseError, formatParseResult, reportParseError } from "./error";
import type { ParseError, ParseResult, Pos } from "./types";
import { parse } from "./utils";

describe("formatParseError", () => {
  it("should format a parse error with line and column information", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: { offset: 5, line: 2, column: 1 },
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input);
    expect(result).toContain("line 2");
    expect(result).toContain("column 1");
    expect(result).toContain("Unexpected character");
  });

  it("should include context when provided", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: { offset: 5, line: 2, column: 1 },
      context: ["in expression", "while parsing number"],
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input);
    expect(result).toContain("in expression");
    expect(result).toContain("while parsing number");
  });

  it("should include expected and found information", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: { offset: 5, line: 2, column: 1 },
      expected: "digit",
      found: "x",
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input);
    expect(result).toContain("Expected: digit");
    expect(result).toContain("Found: x");
  });
});

describe("formatParseResult", () => {
  it("should format a successful parse result", () => {
    const input = "abc";
    const result: ParseResult<string> = {
      success: true,
      val: "abc",
      current: { offset: 0, line: 1, column: 0 },
      next: { offset: 3, line: 1, column: 3 },
    };

    const formatted = formatParseResult(result, input);
    // According to the implementation, it returns null for success
    expect(formatted).toBeNull();
  });

  it("should format a failed parse result", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: { offset: 5, line: 2, column: 1 },
    };

    const result: ParseResult<string> = {
      success: false,
      error,
    };
    const input = "abc\nxyz";

    const formatted = formatParseResult(result, input);
    expect(formatted).toContain("Parse error");
    expect(formatted).toContain("line 2");
    expect(formatted).toContain("column 1");
  });
});

describe("reportParseError", () => {
  it("should throw an error when parsing fails", () => {
    const input = "xyz";
    const result = parse(lit("abc"))(input);
    // Redirect and capture console.error
    const originalConsoleError = console.error;
    let capturedError = "";
    console.error = (msg) => {
      capturedError = msg;
    };

    reportParseError(result, input);
    console.error = originalConsoleError;

    expect(capturedError).toContain("Parse error");
  });

  it("should do nothing when parsing succeeds", () => {
    const input = "abc";
    const result = parse(lit("abc"))(input);
    // Redirect and capture console.error
    const originalConsoleError = console.error;
    let capturedError = "";
    console.error = (msg) => {
      capturedError = msg;
    };

    reportParseError(result, input);
    console.error = originalConsoleError;

    expect(capturedError).toBe("");
  });
});
