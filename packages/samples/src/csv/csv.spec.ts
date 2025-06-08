import { describe, expect, it } from "bun:test";
import { arrayToCSV, parseCSV, parseCSVWithHeaders } from "./csv";

describe("CSV Parser", () => {
  describe("Basic CSV Parsing", () => {
    it("parses simple CSV data", () => {
      const csvData = "name,age,city\nJohn,30,New York\nJane,25,Boston";
      const result = parseCSV(csvData);

      expect(result).toEqual([
        ["name", "age", "city"],
        ["John", "30", "New York"],
        ["Jane", "25", "Boston"],
      ]);
    });

    it("handles empty fields", () => {
      const csvData = "name,middle,last\nJohn,,Doe\nJane,Mary,Smith";
      const result = parseCSV(csvData);

      expect(result).toEqual([
        ["name", "middle", "last"],
        ["John", "", "Doe"],
        ["Jane", "Mary", "Smith"],
      ]);
    });

    it("handles single column", () => {
      const csvData = "name\nJohn\nJane\nBob";
      const result = parseCSV(csvData);

      expect(result).toEqual([["name"], ["John"], ["Jane"], ["Bob"]]);
    });

    it("handles empty CSV", () => {
      const result = parseCSV("");
      expect(result).toEqual([]);
    });

    it("filters out completely empty rows", () => {
      const csvData = "name,age\nJohn,30\n\n\nJane,25\n";
      const result = parseCSV(csvData);

      expect(result).toEqual([
        ["name", "age"],
        ["John", "30"],
        ["Jane", "25"],
      ]);
    });
  });

  describe("Quoted Fields", () => {
    it("handles quoted fields", () => {
      const csvData = '"name","age","city"\n"John Doe","30","New York"';
      const result = parseCSV(csvData);

      expect(result).toEqual([
        ["name", "age", "city"],
        ["John Doe", "30", "New York"],
      ]);
    });

    it("handles escaped quotes", () => {
      const csvData = 'name,description\n"John","A ""great"" person"';
      const result = parseCSV(csvData);

      expect(result).toEqual([
        ["name", "description"],
        ["John", 'A "great" person'],
      ]);
    });

    it("handles fields with commas in quotes", () => {
      const csvData = 'name,address\n"John","123 Main St, Apt 4"';
      const result = parseCSV(csvData);

      expect(result).toEqual([
        ["name", "address"],
        ["John", "123 Main St, Apt 4"],
      ]);
    });

    it("handles fields with newlines in quotes", () => {
      const csvData = 'name,description\n"John","Line 1\nLine 2"';
      const result = parseCSV(csvData);

      expect(result).toEqual([
        ["name", "description"],
        ["John", "Line 1\nLine 2"],
      ]);
    });

    it("handles mixed quoted and unquoted fields", () => {
      const csvData = 'name,age,"city"\nJohn,30,"New York"\n"Jane",25,Boston';
      const result = parseCSV(csvData);

      expect(result).toEqual([
        ["name", "age", "city"],
        ["John", "30", "New York"],
        ["Jane", "25", "Boston"],
      ]);
    });
  });

  describe("Header-based Parsing", () => {
    it("parses CSV with headers into objects", () => {
      const csvData = "name,age,city\nJohn,30,New York\nJane,25,Boston";
      const result = parseCSVWithHeaders(csvData);

      expect(result).toEqual([
        { name: "John", age: "30", city: "New York" },
        { name: "Jane", age: "25", city: "Boston" },
      ]);
    });

    it("handles missing values in data rows", () => {
      const csvData = "name,age,city\nJohn,30\nJane,25,Boston";
      const result = parseCSVWithHeaders(csvData);

      expect(result).toEqual([
        { name: "John", age: "30", city: "" },
        { name: "Jane", age: "25", city: "Boston" },
      ]);
    });

    it("handles extra values in data rows", () => {
      const csvData = "name,age\nJohn,30,Extra\nJane,25";
      const result = parseCSVWithHeaders(csvData);

      expect(result).toEqual([
        { name: "John", age: "30" },
        { name: "Jane", age: "25" },
      ]);
    });

    it("returns empty array for CSV with no data rows", () => {
      const csvData = "name,age,city";
      const result = parseCSVWithHeaders(csvData);

      expect(result).toEqual([]);
    });

    it("returns empty array for empty CSV", () => {
      const result = parseCSVWithHeaders("");
      expect(result).toEqual([]);
    });
  });

  describe("CSV Generation", () => {
    it("converts objects to CSV", () => {
      const data = [
        { name: "John", age: 30, city: "New York" },
        { name: "Jane", age: 25, city: "Boston" },
      ];

      const result = arrayToCSV(data);
      const expected = "name,age,city\nJohn,30,New York\nJane,25,Boston";

      expect(result).toBe(expected);
    });

    it("handles empty array", () => {
      const result = arrayToCSV([]);
      expect(result).toBe("");
    });

    it("escapes fields with commas", () => {
      const data = [{ name: "John Doe", address: "123 Main St, Apt 4" }];

      const result = arrayToCSV(data);
      const expected = 'name,address\nJohn Doe,"123 Main St, Apt 4"';

      expect(result).toBe(expected);
    });

    it("escapes fields with quotes", () => {
      const data = [{ name: "John", description: 'A "great" person' }];

      const result = arrayToCSV(data);
      const expected = 'name,description\nJohn,"A ""great"" person"';

      expect(result).toBe(expected);
    });

    it("escapes fields with newlines", () => {
      const data = [{ name: "John", description: "Line 1\nLine 2" }];

      const result = arrayToCSV(data);
      const expected = 'name,description\nJohn,"Line 1\nLine 2"';

      expect(result).toBe(expected);
    });

    it("handles different data types", () => {
      const data = [
        { name: "John", age: 30, active: true },
        { name: "Jane", age: 25, active: false },
      ];

      const result = arrayToCSV(data);
      const expected = "name,age,active\nJohn,30,true\nJane,25,false";

      expect(result).toBe(expected);
    });
  });

  describe("Error Handling", () => {
    it("handles invalid CSV gracefully", () => {
      // The parser should return empty array for malformed input
      expect(parseCSV('"unclosed quote')).toEqual([]);
    });
  });

  describe("Whitespace Handling", () => {
    it("trims whitespace from unquoted fields", () => {
      const csvData = "name,age\n  John  ,  30  \n  Jane  ,  25  ";
      const result = parseCSV(csvData);

      expect(result).toEqual([
        ["name", "age"],
        ["John", "30"],
        ["Jane", "25"],
      ]);
    });

    it("preserves whitespace in quoted fields", () => {
      const csvData = 'name,age\n"  John  ","  30  "';
      const result = parseCSV(csvData);

      expect(result).toEqual([
        ["name", "age"],
        ["  John  ", "  30  "],
      ]);
    });
  });
});
