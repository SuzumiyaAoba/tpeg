import { describe, expect, it, vi } from "vite-plus/test";
import { lit } from "./basic";
import { charClass } from "./char-class";
import {
  type FormatErrorOptions,
  formatParseError,
  formatParseResult,
  reportParseError,
} from "./error";
import type { ParseError, ParseResult } from "./types";
import { parse } from "./utils";

describe("formatParseError", () => {
  it("reports invalid non-numeric positions through the normal validation error", () => {
    for (const pos of [Symbol("pos"), 0n, Object.create(null)]) {
      expect(() =>
        formatParseError(
          { message: "Error", pos } as unknown as ParseError,
          "abc",
        ),
      ).toThrow("Invalid error object provided");
    }
  });

  it.each(["own", "inherited"])(
    "reads an %s position getter once for validation and display",
    (kind) => {
      let calls = 0;
      const fields = { message: "original diagnostic" };
      const readPosition = () => (calls++ === 0 ? 1 : 0);
      const position = {
        get pos() {
          return readPosition();
        },
      };
      const error =
        kind === "own"
          ? Object.defineProperty(fields, "pos", {
              get: readPosition,
              enumerable: true,
            })
          : Object.assign(Object.create(position) as ParseError, fields);
      const formatted = formatParseError(error as ParseError, "abc", {
        colorize: false,
      });
      expect(formatted).toContain("line 1, column 2:");
      const lines = formatted.split("\n");
      expect(lines[lines.length - 1]).toBe("     ^");
      expect(calls).toBe(1);
    },
  );

  it("snapshots diagnostics before reading options that can change the error", () => {
    const error = {
      message: "original diagnostic",
      pos: 1,
      context: ["original context"],
      expected: ["original expectation"],
    };
    const formatted = formatParseError(error, "abc", {
      colorize: false,
      get locale(): "en" {
        error.pos = 2;
        error.message = "changed diagnostic";
        error.context.push("changed context");
        error.expected.push("changed expectation");
        return "en";
      },
    });
    expect(formatted).toContain("line 1, column 2:");
    expect(formatted).toContain("Error: original diagnostic");
    expect(formatted).toContain("Context: original context");
    expect(formatted).toContain("Expected: original expectation");
    expect(formatted).not.toContain("changed diagnostic");
    expect(formatted).not.toContain("changed context");
    expect(formatted).not.toContain("changed expectation");
  });

  it("reads a colorize getter once and uses that value throughout formatting", () => {
    let calls = 0;
    const formatted = formatParseError({ message: "Error", pos: 0 }, "x", {
      get colorize() {
        return calls++ > 0;
      },
    });
    expect(formatted).not.toContain("\x1b[");
    expect(calls).toBe(1);
  });

  it.each(["constructor", "toString", "__proto__"])(
    "retains the unknown {%s} template placeholder literally",
    (name) => {
      const formatted = formatParseError({ message: "original", pos: 0 }, "x", {
        colorize: false,
        messages: { error: `{${name}}: {message}` },
      });
      expect(formatted).toContain(`{${name}}: original`);
    },
  );

  it("reads inherited message templates once and applies their overrides", () => {
    let headerCalls = 0;
    let errorCalls = 0;
    class Messages {
      get parseError() {
        headerCalls++;
        return "At {line}:{column}";
      }
      get error() {
        errorCalls++;
        return "Details: {message}";
      }
    }
    const formatted = formatParseError({ message: "original", pos: 1 }, "abc", {
      colorize: false,
      messages: new Messages(),
    });
    expect(formatted).toContain("At 1:2");
    expect(formatted).toContain("Details: original");
    expect(headerCalls).toBe(1);
    expect(errorCalls).toBe(1);
  });

  it("uses locale defaults for undefined partial templates", () => {
    const options = {
      colorize: false,
      locale: "ja",
      messages: { error: undefined, source: undefined },
    } as unknown as FormatErrorOptions;
    const formatted = formatParseError(
      { message: "original", pos: 0 },
      "x",
      options,
    );
    expect(formatted).toContain("エラー: original");
    expect(formatted).toContain("ソース:");
  });

  it.each([
    ["symbol", Symbol("template")],
    ["object without a prototype", Object.create(null) as object],
  ])(
    "uses the default for an invalid %s template without coercing it",
    (_kind, error) => {
      const formatted = formatParseError({ message: "original", pos: 0 }, "x", {
        colorize: false,
        messages: { error },
      } as unknown as FormatErrorOptions);
      expect(formatted).toContain("Error: original");
    },
  );

  it.each([
    ["symbol", Symbol("locale")],
    ["object without a prototype", Object.create(null) as object],
    [
      "throwing primitive conversion",
      {
        [Symbol.toPrimitive]() {
          throw new Error("must not coerce locale");
        },
      },
    ],
  ])(
    "falls back to English without coercing an invalid %s locale",
    (_name, locale) => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      try {
        const result = formatParseError(
          { message: "original diagnostic", pos: 0 },
          "x",
          { colorize: false, locale } as unknown as FormatErrorOptions,
        );
        expect(result).toContain("Parse error at line 1, column 1:");
        expect(result).toContain("original diagnostic");
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
          "Invalid locale, falling back to 'en'",
        );
      } finally {
        warn.mockRestore();
      }
    },
  );
  it("should format a parse error with line and column information", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: 5,
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input);
    expect(result).toContain("line 2");
    expect(result).toContain("column 2"); // 1-based: "y" is the 2nd character
    expect(result).toContain("Unexpected character");
  });

  it("should include context when provided", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: 5,
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
      pos: 5,
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
      pos: 5,
      parserName: "numberParser",
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input);
    expect(result).toContain("Parser: numberParser");
  });

  it("should format error with single context string", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: 5,
      context: "in expression",
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input);
    expect(result).toContain("Context: in expression");
  });

  it("should handle formatting without colorization", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: 5,
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input, { colorize: false });
    expect(result).not.toContain("\x1b[31m"); // No ANSI color codes
    expect(result).toContain("Parse error");
  });

  it("should format with custom context lines", () => {
    const error: ParseError = {
      message: "Unexpected character",
      // offset 14 is the "n" in "line3" (line 3, column 2) -- the original
      // version of this test specified line/column directly
      // as `{ offset: 10, line: 3, column: 2 }`, an offset/line pair that
      // was never actually consistent for this input (offset 10 is really
      // on line 2). That was invisible before because formatting trusted
      // the caller-supplied line/column directly; now line/column are
      // always derived from `pos` via `offsetToPos`, so the offset has to
      // genuinely correspond to line 3 to preserve this test's intent
      // (context lines centered on line 3).
      pos: 14,
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
      pos: 5,
    };
    const input = "abc\nxyz";

    const result = formatParseError(error, input, { highlightErrors: false });
    expect(result).not.toContain("^"); // No pointer to error position
  });

  it("should format without showing position", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: 5,
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
      current: 0,
      next: 3,
    };

    const formatted = formatParseResult(result, input);
    // According to the implementation, it returns null for success
    expect(formatted).toBeNull();
  });

  it("should format a failed parse result", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: 5,
    };

    const result: ParseResult<string> = {
      success: false,
      error,
    };
    const input = "abc\nxyz";

    const formatted = formatParseResult(result, input);
    expect(formatted).toContain("Parse error");
    expect(formatted).toContain("line 2");
    expect(formatted).toContain("column 2");
  });

  it("should pass options to formatParseError", () => {
    const error: ParseError = {
      message: "Unexpected character",
      pos: 5,
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
  it("keeps the first error object in the fallback without reading the result getter again", () => {
    let calls = 0;
    const original = { message: "original", pos: Number.NaN };
    const result: ParseResult<never> = {
      success: false,
      get error() {
        calls++;
        return calls === 1 ? original : { message: "changed", pos: 0 };
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      reportParseError(result, "x");
      expect(spy).toHaveBeenCalledWith("Original error:", original);
      expect(calls).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("reports a throwing error getter once without throwing from the fallback", () => {
    let calls = 0;
    const thrown = new Error("error getter failed");
    const result: ParseResult<never> = {
      success: false,
      get error(): ParseError {
        calls++;
        throw thrown;
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => reportParseError(result, "x")).not.toThrow();
      expect(spy).toHaveBeenCalledWith("Failed to read parse error:", thrown);
      expect(calls).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("should call console.error when parsing fails", () => {
    const input = "xyz";
    const result = parse(lit("abc"))(input);

    // Use spyOn to spy on console.error before calling the function
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportParseError(result, input);

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]?.[0]).toContain("Parse error");

    spy.mockRestore();
  });

  it("should not call console.error when parsing succeeds", () => {
    const input = "abc";
    const result = parse(lit("abc"))(input);

    // Use spyOn to spy on console.error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportParseError(result, input);

    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it("should pass options to formatParseError", () => {
    const input = "xyz";
    const result = parse(lit("abc"))(input);

    // Use spyOn to spy on console.error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportParseError(result, input, { colorize: false });

    expect(spy).toHaveBeenCalled();
    const errorMessage = spy.mock.calls[0]?.[0];
    expect(errorMessage).not.toContain("\x1b[31m"); // No ANSI color codes

    spy.mockRestore();
  });
});

describe("Complex Error Formatting Scenarios", () => {
  describe("source excerpts", () => {
    const sourceLines = (
      error: ParseError,
      input: string,
      options: FormatErrorOptions = {},
    ) => {
      const formatted = formatParseError(error, input, {
        colorize: false,
        showLineNumbers: false,
        ...options,
      });
      return formatted.split("Source:\n")[1]?.split("\n") ?? [];
    };

    it.each([
      ["ASCII", "a".repeat(100) + "X" + "b".repeat(100), 100],
      ["CJK", "あ".repeat(40) + "X" + "い".repeat(40), 40],
      ["astral", "😀".repeat(40) + "X" + "🌍".repeat(40), 80],
    ] as const)(
      "keeps the failing character visible and the pointer aligned in a long %s line",
      (_kind, input, pos) => {
        const [source, pointer] = sourceLines(
          { message: "Error", pos },
          input,
          { maxLineLength: 40 },
        );
        expect(source).toContain("X");
        if (!source || !pointer) throw new Error("missing source excerpt");
        const width = (text: string) =>
          Array.from(text).reduce(
            (total, char) => total + ((char.codePointAt(0) ?? 0) > 127 ? 2 : 1),
            0,
          );
        expect(width(source)).toBeLessThanOrEqual(40);
        expect(pointer.indexOf("^")).toBe(
          width(source.slice(0, source.indexOf("X"))),
        );
      },
    );

    it("shows the actual end of a long line for an EOF error", () => {
      const [source, pointer] = sourceLines(
        { message: "Error", pos: 120 },
        "a".repeat(120),
        { maxLineLength: 40 },
      );
      expect(source).toMatch(/^\.\.\.a+$/);
      expect(pointer?.indexOf("^")).toBe(source?.length);
    });

    it("retains the error line with no surrounding lines when contextLines is zero", () => {
      const source = sourceLines(
        { message: "Error", pos: 9 },
        "before\nerror\nafter",
        { contextLines: 0 },
      );
      expect(source).toEqual(["error", "  ^"]);
    });

    it("shows the empty source line and pointer for an empty input", () => {
      const source = sourceLines({ message: "Error", pos: 0 }, "");
      expect(source).toEqual(["", "^"]);
    });

    it.each([
      ["tab", "\tX", 1, "\\tX", 2],
      ["null", "\0X", 1, "\\x00X", 4],
      ["C1 control", "\x9bX", 1, "\\x9bX", 4],
      ["escape sequence", "\x1b[31mX", 5, "\\x1b[31mX", 8],
    ] as const)(
      "makes a source %s visible and aligns the pointer with its displayed width",
      (_kind, input, pos, shown, column) => {
        expect(sourceLines({ message: "Error", pos }, input)).toEqual([
          shown,
          " ".repeat(column) + "^",
        ]);
      },
    );

    it("retains line numbers when centering an excerpt on a late error", () => {
      const [source, pointer] = sourceLines(
        { message: "Error", pos: 120 },
        "a".repeat(120) + "X",
        { maxLineLength: 40, showLineNumbers: true },
      );
      expect(source).toMatch(/^1 \| \.\.\.a+X$/);
      expect(pointer?.indexOf("^")).toBe(source?.indexOf("X"));
    });
  });

  it("should handle multi-byte characters in source context correctly", () => {
    const input = "あいうえお\nかきくけこ";
    const error: ParseError = {
      message: "Unexpected character",
      pos: 8, // 'く' (index 2 in line 2)
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
      pos: 0,
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
      pos: 2,
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

  it("keeps the pointer aligned after an astral character", () => {
    // `offsetToPos` reports columns in code points, while the source string
    // is indexed in UTF-16 code units. The emoji before `x` must still count
    // as two terminal cells when the pointer is rendered.
    const input = "😀x";
    const result = formatParseError({ message: "Error", pos: 2 }, input, {
      colorize: false,
    });

    const lines = result.split("\n");
    const pointerLine = lines[lines.length - 1];
    expect(pointerLine).toContain("      ^");
  });

  it("formats bare-CR input using the same line boundaries as offsetToPos", () => {
    const result = formatParseError({ message: "Error", pos: 2 }, "a\rb", {
      colorize: false,
    });

    expect(result).toContain("line 2");
    expect(result).toContain("2 | b");
  });

  it('rejects error objects whose pos is outside the offset contract (regression: `typeof pos === "number" && pos >= 0` accepted fractional and infinite positions -- a fractional pos reported a misaligned line/column and Infinity silently dropped the source context instead of surfacing the malformed error)', () => {
    const input = "abc\nxyz";
    for (const pos of [1.5, Number.NaN, Infinity, -Infinity, -1, 2 ** 32]) {
      expect(() => formatParseError({ message: "Error", pos }, input)).toThrow(
        "Invalid error object",
      );
    }
  });

  it("still accepts a pos past input.length (offsetToPos deliberately tolerates errors recorded against a different, shorter input)", () => {
    const result = formatParseError({ message: "Error", pos: 100 }, "abc", {
      colorize: false,
    });
    expect(result).toContain("Error");
  });

  it("normalizes a NaN maxLineLength to the minimum instead of appending '...' to every line", () => {
    // `clampValue`'s Math.min/Math.max chain propagates NaN, so a NaN
    // `maxLineLength` used to stay NaN -- and `truncateLine`'s
    // `width > NaN` comparison is always false, making it append "..."
    // to every line regardless of length. NaN now normalizes to the
    // minimum (40), so a short line must come through untruncated.
    const result = formatParseError(
      { message: "Error", pos: 0 },
      "short line",
      { colorize: false, maxLineLength: Number.NaN },
    );

    expect(result).toContain("short line");
    expect(result).not.toContain("short line...");
  });
});

describe("control and whitespace characters in diagnostics", () => {
  it("makes C1 controls visible in expected labels and found diagnostics", () => {
    const result = parse(lit("\x9b"))("\x9d");
    if (result.success) throw new Error("expected failure");
    expect(result.error.message).toBe('Expected "\\x9b", found "\\x9d"');
    const formatted = formatParseError(result.error, "\x9d", {
      colorize: false,
    });
    expect(formatted).toContain('Expected: "\\x9b"');
    expect(formatted).toContain("Found: \\x9d");
    expect(formatted).not.toMatch(/[\x80-\x9f]/);
  });

  it("escapes a control character in a literal's expected label and in the found text", () => {
    const result = parse(lit("\n"))("\r");
    if (result.success) throw new Error("expected failure");
    expect(result.error.message).toBe('Expected "\\n", found "\\r"');
  });

  it("escapes control characters in a character-class label", () => {
    const result = parse(charClass(["\x00", "\x1f"]))("a");
    if (result.success) throw new Error("expected failure");
    expect(result.error.message).toBe('Expected \\x00-\\x1f, found "a"');
  });

  it("keeps the Found line for a whitespace or control character", () => {
    for (const [input, shown] of [
      ["\t", 'Found: "\\t"'],
      [" ", 'Found: " "'],
      ["\r", 'Found: "\\r"'],
    ] as const) {
      const result = parse(lit("x"))(input);
      if (result.success) throw new Error("expected failure");
      const formatted = formatParseError(result.error, input, {
        colorize: false,
      });
      expect(formatted).toContain(shown);
    }
  });
});

describe("formatParseError: 1-based display column", () => {
  it("reports the first character of a line as column 1", () => {
    const formatted = formatParseError(
      { message: "Unexpected character", pos: 4 },
      "abc\nxyz",
      { colorize: false },
    );
    expect(formatted).toContain("Parse error at line 2, column 1:");
  });
});
