import { describe, it, expect } from "bun:test";
import { expression, term, runDemo } from "./error-demo";
import { parse } from "tpeg-core";

describe("Error Demo", () => {
  it("term parser should parse digits with spaces", () => {
    const result = parse(term())("123");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("123");
    }
  });

  it("expression parser should parse simple expressions", () => {
    const result = parse(expression())("123 + 456");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("123 + 456");
    }
  });

  it("should demonstrate error handling", () => {
    const consoleLog = console.log;
    // Suppress console.log for the test
    console.log = () => {};

    try {
      runDemo();
      // If we reached here, the demo ran without crashing
      expect(true).toBe(true);
    } finally {
      // Restore console.log
      console.log = consoleLog;
    }
  });
});
