import { describe, expect, it } from "bun:test";
import {
  number,
  quotedString,
  sepBy,
  token,
} from "@suzumiyaaoba/tpeg-combinator";
import { literal, parse } from "@suzumiyaaoba/tpeg-core";
import { DirectExpression, Expression } from "./arith/calculator";
import { arrayToCSV, parseCSV, parseCSVWithHeaders } from "./csv/csv";
import { parseJSON } from "./json/json";

describe("TPEG Samples Integration Tests", () => {
  describe("JSON Parser Integration", () => {
    it("parses valid JSON objects", () => {
      const jsonString = `
        {
          "name": "John Doe",
          "age": 30,
          "isActive": true,
          "children": null,
          "scores": [85, 90, 78]
        }
        `;

      const result = parseJSON(jsonString);

      expect(result).toEqual({
        name: "John Doe",
        age: 30,
        isActive: true,
        children: null,
        scores: [85, 90, 78],
      });
    });

    it("parses JSON arrays", () => {
      const jsonString = `[1, "hello", true, null, {"key": "value"}]`;

      const result = parseJSON(jsonString);

      expect(result).toEqual([1, "hello", true, null, { key: "value" }]);
    });

    it("handles nested structures", () => {
      const jsonString = `{
        "users": [
          {"id": 1, "name": "John"},
          {"id": 2, "name": "Jane"}
        ],
        "meta": {"total": 2}
      }`;

      const result = parseJSON(jsonString);

      expect(result).toEqual({
        users: [
          { id: 1, name: "John" },
          { id: 2, name: "Jane" },
        ],
        meta: { total: 2 },
      });
    });

    it("handles empty structures", () => {
      expect(parseJSON("{}")).toEqual({});
      expect(parseJSON("[]")).toEqual([]);
    });
  });

  describe("CSV Parser Integration", () => {
    it("parses basic CSV", () => {
      const csvString =
        "name,age,city\nJohn,30,New York\nJane,25,Boston\nBob,40,Chicago";

      const result = parseCSV(csvString);

      expect(result).toEqual([
        ["name", "age", "city"],
        ["John", "30", "New York"],
        ["Jane", "25", "Boston"],
        ["Bob", "40", "Chicago"],
      ]);
    });

    it("handles quoted fields with special characters", () => {
      const csvString = `name,description,price
"Product A","A ""great"" product with, commas",29.99
"Product B","Simple product",19.99`;

      const result = parseCSV(csvString);

      expect(result).toEqual([
        ["name", "description", "price"],
        ["Product A", 'A "great" product with, commas', "29.99"],
        ["Product B", "Simple product", "19.99"],
      ]);
    });

    it("parses CSV with headers into objects", () => {
      const csvString = "name,age,city\nJohn,30,New York\nJane,25,Boston";

      const result = parseCSVWithHeaders(csvString);

      expect(result).toEqual([
        { name: "John", age: "30", city: "New York" },
        { name: "Jane", age: "25", city: "Boston" },
      ]);
    });

    it("converts objects back to CSV", () => {
      const data = [
        { name: "John", age: 30, city: "New York" },
        { name: "Jane", age: 25, city: "Boston" },
      ];

      const result = arrayToCSV(data);

      expect(result).toBe("name,age,city\nJohn,30,New York\nJane,25,Boston");
    });
  });

  describe("Arithmetic Parser Integration", () => {
    it("evaluates basic arithmetic expressions", () => {
      const testCases = [
        { expr: "1 + 2", expected: 3 },
        { expr: "3 * 4", expected: 12 },
        { expr: "10 / 2", expected: 5 },
        { expr: "7 - 3", expected: 4 },
        { expr: "8 % 3", expected: 2 },
      ];

      for (const { expr, expected } of testCases) {
        const result = parse(DirectExpression)(expr);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe(expected);
        }
      }
    });

    it("handles operator precedence", () => {
      const testCases = [
        { expr: "1 + 2 * 3", expected: 7 },
        { expr: "2 * 3 + 1", expected: 7 },
        { expr: "(1 + 2) * 3", expected: 9 },
        { expr: "2 * (3 + 1)", expected: 8 },
      ];

      for (const { expr, expected } of testCases) {
        const result = parse(DirectExpression)(expr);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val).toBe(expected);
        }
      }
    });

    it("builds AST for expressions", () => {
      const result = parse(Expression)("1 + 2");
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.val).toHaveProperty("type");
        expect((result.val as { type: string }).type).toBe("binaryOp");
      }
    });
  });

  describe("Combinator Functions Integration", () => {
    it("uses sepBy for comma-separated values", () => {
      const numberList = sepBy(number, literal(","));

      const result = parse(numberList)("1,2,3,4,5");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual([1, 2, 3, 4, 5]);
      }
    });

    it("uses quotedString for string literals", () => {
      const result = parse(quotedString)(`"hello world"`);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello world");
      }
    });

    it("uses token for whitespace handling", () => {
      const tokenizedNumber = token(number);

      const result = parse(tokenizedNumber)("  123  ");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(123);
      }
    });
  });

  describe("Error Handling Integration", () => {
    it("handles invalid JSON gracefully", () => {
      // These should return null instead of throwing
      expect(parseJSON('{"invalid": json}')).toBe(null);
      expect(parseJSON("[1,2,3,]")).toBe(null);
    });

    it("handles malformed CSV gracefully", () => {
      // An unterminated quote is malformed CSV, so parseCSV throws rather
      // than silently returning a truncated/empty result -- see
      // csv/csv.spec.ts for the full rationale.
      expect(() => parseCSV('"unclosed quote')).toThrow();
    });
  });

  describe("Performance and Edge Cases", () => {
    it("handles large JSON structures", () => {
      const largeObject = {
        data: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          active: i % 2 === 0,
        })),
      };

      const jsonString = JSON.stringify(largeObject);
      const result = parseJSON(jsonString);

      expect(result).toEqual(largeObject);
    });

    it("handles large CSV files", () => {
      const headers = "id,name,value";
      const rows = Array.from(
        { length: 100 },
        (_, i) => `${i},Item${i},${i * 10}`,
      );
      const csvString = [headers, ...rows].join("\n");

      const result = parseCSV(csvString);
      expect(result).toHaveLength(101); // headers + 100 rows
      expect(result[0]).toEqual(["id", "name", "value"]);
      expect(result[1]).toEqual(["0", "Item0", "0"]);
      expect(result[100]).toEqual(["99", "Item99", "990"]);
    });

    it("handles deeply nested arithmetic expressions", () => {
      const deepExpression = "((((1 + 2) * 3) - 4) / 5)";
      const result = parse(DirectExpression)(deepExpression);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(1); // ((((3) * 3) - 4) / 5) = ((9 - 4) / 5) = (5 / 5) = 1
      }
    });
  });
});
