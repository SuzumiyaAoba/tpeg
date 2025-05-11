import { describe, expect, it } from "bun:test";
import { parse } from "tpeg-core";
import { expression, runDemo, term } from "./error-demo";

describe("Error Demo", () => {
  it("term parser should parse digits with spaces", () => {
    const result = parse(term)("123");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([[], ["1", "2", "3"], []]);
    }
  });

  it("expression parser should parse simple expressions", () => {
    const result = parse(expression)("123 + 456");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([
        [[], ["1", "2", "3"], [" "]],
        "+",
        [[" "], ["4", "5", "6"], []],
      ]);
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
