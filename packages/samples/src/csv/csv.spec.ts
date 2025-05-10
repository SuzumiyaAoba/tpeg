import { describe, expect, it } from "bun:test";
import { parseCSV, parseCSVWithHeaders } from "./csv";

describe("CSV Parser", () => {
  describe("parseCSV", () => {
    it("should parse basic CSV string", () => {
      const csvString = `name,age,city
John,30,New York
Jane,25,Boston
Bob,40,San Francisco`;

      const result = parseCSV(csvString);

      expect(result).toEqual([
        ["name", "age", "city"],
        ["John", "30", "New York"],
        ["Jane", "25", "Boston"],
        ["Bob", "40", "San Francisco"],
      ]);
    });

    it("should handle quoted fields", () => {
      const csvString = `name,description,location
"John Smith","Software Engineer, Senior",New York
Jane,"Boston, MA","Home Office"
"Bob Jones","Manager, ""Technical Lead""","San Francisco, CA"`;

      const result = parseCSV(csvString);

      expect(result).toEqual([
        ["name", "description", "location"],
        ['"John Smith"', '"Software Engineer', ' Senior"', "New York"],
        ["Jane", '"Boston', ' MA"', '"Home Office"'],
        [
          '"Bob Jones"',
          '"Manager',
          ' ""Technical Lead"""',
          '"San Francisco',
          ' CA"',
        ],
      ]);
    });

    it("should handle empty fields", () => {
      const csvString = `name,age,city
John,,New York
,25,
Bob,40,`;

      const result = parseCSV(csvString);

      expect(result).toEqual([
        ["name", "age", "city"],
        ["John", "", "New York"],
        ["", "25", ""],
        ["Bob", "40", ""],
      ]);
    });

    it("should return array with empty string for empty CSV", () => {
      const result = parseCSV("");
      expect(result).toEqual([[""]]);
    });
  });

  describe("parseCSVWithHeaders", () => {
    it("should parse CSV with headers into array of objects", () => {
      const csvString = `name,age,city
John,30,New York
Jane,25,Boston
Bob,40,San Francisco`;

      const result = parseCSVWithHeaders(csvString);

      expect(result).toEqual([
        { name: "John", age: "30", city: "New York" },
        { name: "Jane", age: "25", city: "Boston" },
        { name: "Bob", age: "40", city: "San Francisco" },
      ]);
    });

    it("should return empty array for CSV with only headers", () => {
      const csvString = "name,age,city";
      const result = parseCSVWithHeaders(csvString);
      expect(result).toEqual([]);
    });

    it("should return empty array for empty CSV", () => {
      const result = parseCSVWithHeaders("");
      expect(result).toEqual([]);
    });

    it("should handle mismatched header/row length", () => {
      const csvString = `name,age,city,country
John,30,New York
Jane,25,Boston,USA
Bob,40`;

      const result = parseCSVWithHeaders(csvString);

      expect(result).toEqual([
        { name: "John", age: "30", city: "New York" },
        { name: "Jane", age: "25", city: "Boston", country: "USA" },
        { name: "Bob", age: "40" },
      ]);
    });
  });
});
