import { describe, expect, it, spyOn } from "bun:test";
import { lit } from "./basic";
import { formatParseError, formatParseResult, reportParseError } from "./error";
import type { ParseError, ParseResult } from "./types";
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

  it("should include parser name when provided", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: { offset: 5, line: 2, column: 1 },
      parserName: "numberParser",
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input);
    expect(result).toContain("Parser: numberParser");
  });

  it("should format error with single context string", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: { offset: 5, line: 2, column: 1 },
      context: "in expression",
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input);
    expect(result).toContain("Context: in expression");
  });

  it("should handle formatting without colorization", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: { offset: 5, line: 2, column: 1 },
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input, { colorize: false });
    expect(result).not.toContain("\x1b[31m"); // No ANSI color codes
    expect(result).toContain("Parse error");
  });

  it("should format with custom context lines", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: { offset: 10, line: 3, column: 2 },
    };
    const input = "line1\nline2\nline3\nline4\nline5";

    // With more context lines
    const result1 = formatParseError(error, input, { contextLines: 3 });
    expect(result1).toContain("line1");
    expect(result1).toContain("line5");

    // With fewer context lines
    const result2 = formatParseError(error, input, { contextLines: 1 });
    expect(result2).not.toContain("line1");
    expect(result2).not.toContain("line5");
  });

  it("should format without highlighting errors", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: { offset: 5, line: 2, column: 1 },
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input, { highlightErrors: false });
    expect(result).not.toContain("^"); // No pointer to error position
  });

  it("should format without showing position", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: { offset: 5, line: 2, column: 1 },
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input, { showPosition: false });
    expect(result).not.toContain("Source:");
    expect(result).not.toContain("| xyz");
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

  it("should pass options to formatParseError", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: { offset: 5, line: 2, column: 1 },
    };

    const result: ParseResult<string> = {
      success: false,
      error,
    };
    const input = "abc\nxyz";

    const formatted = formatParseResult(result, input, {
      colorize: false,
      showPosition: false,
    });
    expect(formatted).not.toContain("Source:");
    expect(formatted).not.toContain("\x1b[31m"); // No ANSI color codes
  });
});

describe("reportParseError", () => {
  it("should call console.error when parsing fails", () => {
    const input = "xyz";
    const result = parse(lit("abc"))(input);

    // Use spyOn to spy on console.error before calling the function
    const spy = spyOn(console, "error").mockImplementation(() => {});

    reportParseError(result, input);

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]?.[0]).toContain("Parse error");

    spy.mockRestore();
  });

  it("should not call console.error when parsing succeeds", () => {
    const input = "abc";
    const result = parse(lit("abc"))(input);

    // Use spyOn to spy on console.error
    const spy = spyOn(console, "error").mockImplementation(() => {});

    reportParseError(result, input);

    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });


  it("should pass options to formatParseError", () => {
    const input = "xyz";
    const result = parse(lit("abc"))(input);

    // Use spyOn to spy on console.error
    const spy = spyOn(console, "error").mockImplementation(() => {});

    reportParseError(result, input, { colorize: false });

    expect(spy).toHaveBeenCalled();
    const errorMessage = spy.mock.calls[0]?.[0];
    expect(errorMessage).not.toContain("\x1b[31m"); // No ANSI color codes

    spy.mockRestore();
  });
});

describe("Complex Error Formatting Scenarios", () => {
  it("should handle multi-byte characters in source context correctly", () => {
    const input = "あいうえお\nかきくけこ";
    const error: ParseError = {
      message: "Unexpected character",
      pos: { offset: 8, line: 2, column: 2 }, // 'く' (index 2 in line 2)
    };

    const result = formatParseError(error, input, {
      contextLines: 1,
      highlightErrors: true,
      colorize: false,
    });

    // Should contain the line with the error
    expect(result).toContain("かきくけこ");
    // Should point to the correct character 'く'
    // 'か' (2 width) + 'き' (2 width) = 4 spaces offset
    // The pointer line should have spaces followed by ^
    const lines = result.split("\n");
    const pointerLine = lines[lines.length - 1];
    expect(pointerLine).toContain("    ^");
  });

  it("should truncate long lines correctly with multi-byte characters", () => {
    const longLine = "あ".repeat(100);
    const input = longLine;
    const error: ParseError = {
      message: "Error",
      pos: { offset: 0, line: 1, column: 0 },
    };

    const result = formatParseError(error, input, {
      maxLineLength: 10,
      colorize: false,
    });

    // Should be truncated
    expect(result).toContain("...");
    // Should not contain the full line
    expect(result).not.toContain(longLine);
    // Should contain the start of the line
    expect(result).toContain("あああ");
  });

  it("should handle mixed width characters in pointer alignment", () => {
    // 'a' (1) + 'あ' (2) + 'b' (1) = error at 'b' should be offset by 3
    const input = "aあb";
    const error: ParseError = {
      message: "Error",
      pos: { offset: 2, line: 1, column: 2 },
    };

    const result = formatParseError(error, input, {
      colorize: false,
      highlightErrors: true,
    });

    const lines = result.split("\n");
    const pointerLine = lines[lines.length - 1];
    // "a" (1) + "あ" (2) = 3 spaces
    // plus line number prefix "1 | " (4 chars) -> total 7 spaces
    // But wait, line number width depends on total lines. Here 1 line -> width 1.
    // "1 | " -> 4 chars.
    // So 4 + 3 = 7 spaces.
    expect(pointerLine).toContain("       ^");
  });
});
