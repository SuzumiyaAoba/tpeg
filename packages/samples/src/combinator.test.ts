import { describe, expect, it } from "bun:test";
import {
  between,
  int,
  labeled,
  memoize,
  number,
  quotedString,
  recursive,
  sepBy,
  sepBy1,
  takeUntil,
  token,
  whitespace,
  withPosition,
} from "tpeg-combinator";
import type { ParseSuccess, Parser } from "tpeg-core";
import { choice, literal, map, parse, seq } from "tpeg-core";

describe("JSON Parser Integration Test", () => {
  it("parses valid JSON", () => {
    // Simple JSON that can be processed by JSON.parse
    const jsonString = `
      {
        "name": "John Doe",
        "age": 30,
        "isActive": true,
        "children": null,
        "scores": [85, 90, 78]
      }
      `;

    const { parseJSON } = require("./json/json");
    const result = parseJSON(jsonString);

    expect(result).toEqual({
      name: "John Doe",
      age: 30,
      isActive: true,
      children: null,
      scores: [85, 90, 78],
    });
  });
});

describe("CSV Parser Integration Test", () => {
  it("parses basic CSV", () => {
    const csvString =
      "name,age,city\nJohn,30,New York\nJane,25,Boston\nBob,40,Chicago";

    const { parseCSV } = require("./csv/csv");
    const result = parseCSV(csvString);

    expect(result).toEqual([
      ["name", "age", "city"],
      ["John", "30", "New York"],
      ["Jane", "25", "Boston"],
      ["Bob", "40", "Chicago"],
    ]);
  });

  it("handles quoted fields", () => {
    // Simple example with quoted fields
    const csvString = `name,age\n"John",30\n"Jane",25`;

    const { parseCSV } = require("./csv/csv");
    const result = parseCSV(csvString);

    expect(result).toEqual([
      ["name", "age"],
      ["John", "30"],
      ["Jane", "25"],
    ]);
  });

  it("parses CSV with headers into an array of objects", () => {
    const csvString = "name,age,city\nJohn,30,New York\nJane,25,Boston";

    const { parseCSVWithHeaders } = require("./csv/csv");
    const result = parseCSVWithHeaders(csvString);

    expect(result).toEqual([
      { name: "John", age: "30", city: "New York" },
      { name: "Jane", age: "25", city: "Boston" },
    ]);
  });
});
