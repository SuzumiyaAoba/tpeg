import { describe, expect, it } from "vite-plus/test";
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

    it("quotes fields with significant leading/trailing whitespace so they survive a write/parse round trip", () => {
      // `unquotedField` trims on the read side, so writing ` John `
      // unquoted would read back as `John` -- silent data loss.
      const data = [{ name: "  John  ", note: "hi" }];

      const written = arrayToCSV(data);
      expect(written).toBe('name,note\n"  John  ",hi');
      expect(parseCSV(written)).toEqual([
        ["name", "note"],
        ["  John  ", "hi"],
      ]);
    });
  });

  describe("Error Handling", () => {
    it("throws on an unclosed quote instead of silently dropping it", () => {
      // A leading quote with no matching close is malformed CSV. The old
      // grammar had no end-of-input check, so sepBy's built-in "value
      // failed, succeed with []" fallback silently accepted this and
      // returned []; parseCSV's documented contract is to throw instead.
      expect(() => parseCSV('"unclosed quote')).toThrow(/CSV parse error/);
    });

    it("throws (with the real diagnostic message) on trailing garbage after a valid row", () => {
      // A stray, unterminated quote right after an otherwise well-formed
      // row used to be silently truncated away instead of rejected.
      expect(() => parseCSV('a,b,c"')).toThrow();
      try {
        parseCSV('a,b,c"');
        throw new Error("expected parseCSV to throw");
      } catch (error) {
        // Previously this stringified the ParseError object directly
        // (`${result.error}`), producing "CSV parse error: [object Object]"
        // instead of the actual diagnostic message.
        expect((error as Error).message).not.toContain("[object Object]");
        expect((error as Error).message).toContain("CSV parse error:");
      }
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

  describe("Rows of empty fields (issue #69)", () => {
    // The old filter dropped ANY row whose cells were all empty -- but a
    // multi-field all-empty row is a real record (N empty columns), not a
    // blank line. Only the phantom row a line break leaves behind -- one
    // that parses as a single empty field `[""]` -- should be dropped.
    it("keeps a ',,' row (three empty fields)", () => {
      expect(parseCSV("a,b,c\n,,")).toEqual([
        ["a", "b", "c"],
        ["", "", ""],
      ]);
    });

    it('keeps a "","" row (quoted empty fields)', () => {
      expect(parseCSV('a,b\n"",""')).toEqual([
        ["a", "b"],
        ["", ""],
      ]);
    });

    it("keeps a row whose only field is a quoted empty or whitespace string", () => {
      expect(parseCSV('x\n""\n"   "\ny')).toEqual([
        ["x"],
        [""],
        ["   "],
        ["y"],
      ]);
    });

    it("drops a whitespace-only unquoted line as blank", () => {
      expect(parseCSV("x\n   \ny")).toEqual([["x"], ["y"]]);
    });

    it("round-trips single-column data with empty and whitespace values", () => {
      const data = [{ a: "" }, { a: " " }, { a: "x" }];
      expect(parseCSVWithHeaders(arrayToCSV(data))).toEqual(data);
    });

    it("still drops a truly blank line", () => {
      expect(parseCSV("a,b\n1,2\n\n3,4")).toEqual([
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ]);
    });

    it("a header literally named __proto__ is stored as data, not via the prototype setter", () => {
      const result = parseCSVWithHeaders("__proto__,a\nx,1");
      expect(result).toHaveLength(1);
      const row = result[0] as Record<string, string>;
      expect(Object.prototype.hasOwnProperty.call(row, "__proto__")).toBe(true);
      expect(row["__proto__"]).toBe("x");
      expect(row["a"]).toBe("1");
      expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    });
  });
});
