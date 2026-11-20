import { describe, expect, it, vi } from "vite-plus/test";
import { parse, type ParseError } from "@suzumiyaaoba/tpeg-core";
import { displayParseResult, expression, runDemo, term } from "./error-demo";

function displayedFailure(error: ParseError, input: string): string {
  const logger = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    displayParseResult({ success: false, error }, input);
    return logger.mock.calls.map(([message]) => message).join("\n");
  } finally {
    logger.mockRestore();
  }
}

describe("Error Demo", () => {
  it("separates multiple expectations in the displayed diagnostic", () => {
    const output = displayedFailure(
      { message: "Rejected", pos: 0, expected: ["digit", "sign"] },
      "x",
    );
    expect(output).toContain("Expected: digit, sign");
  });

  it("shows the source line after a bare carriage return", () => {
    const output = displayedFailure(
      { message: "Rejected", pos: 6 },
      "first\rx",
    );
    expect(output).toContain("line 2, column 1");
    expect(output).toContain("2 | x");
  });

  it("escapes tabs and aligns the pointer with the displayed offending character", () => {
    const output = displayedFailure({ message: "Rejected", pos: 1 }, "\tx");
    expect(output).toContain("1 | \\tx\n      ^");
  });

  it("term parser should parse digits with spaces", () => {
    const result = parse(term)("123");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual(["", ["1", "2", "3"], ""]);
    }
  });

  it("expression parser should parse simple expressions", () => {
    const result = parse(expression)("123 + 456");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([
        ["", ["1", "2", "3"], " "],
        "+",
        [" ", ["4", "5", "6"], ""],
      ]);
    }
  });

  it("should demonstrate error handling", () => {
    const logger = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      runDemo();
      expect(logger).toHaveBeenCalledWith("Parsing successful!");
      expect(
        logger.mock.calls.filter(
          ([message]) => message === "Parsing failed...",
        ),
      ).toHaveLength(4);
      expect(
        logger.mock.calls.filter(
          ([message]) =>
            typeof message === "string" && message.startsWith("Parse error at"),
        ),
      ).toHaveLength(4);
    } finally {
      logger.mockRestore();
    }
  });
});
