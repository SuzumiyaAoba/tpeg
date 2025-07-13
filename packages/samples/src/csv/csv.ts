import { newline, sepBy, takeUntil } from "tpeg-combinator";
import type { Parser } from "tpeg-core";
import {
  any,
  choice,
  literal,
  map,
  not,
  parse,
  seq,
  zeroOrMore,
} from "tpeg-core";

/**
 * CSV Parser Sample
 *
 * A robust CSV parser that handles:
 * - Comma-separated values with proper escaping
 * - Double quoted fields with escaped quotes
 * - Various line endings (CRLF, LF, CR)
 * - Empty fields and trailing commas
 */

// Parse escaped quotes ("")
const escapedQuote = map(literal('""'), () => '"');

// Character that is not a quote
const normalChar = map(seq(not(literal('"')), any), ([_, c]) => c);

// Content inside quotes
const quotedContent = map(
  zeroOrMore(choice(escapedQuote, normalChar)),
  (chars) => chars.join(""),
);

// Quoted field
const quotedField = map(
  seq(literal('"'), quotedContent, literal('"')),
  ([_, content]) => content,
);

// Unquoted field (doesn't contain commas, quotes, or newlines)
const unquotedField = map(
  takeUntil(
    choice(
      literal(","),
      literal("\n"),
      literal("\r\n"),
      literal("\r"),
      literal('"'),
    ),
  ),
  (val) => val.trim(),
);

// Any field (quoted or unquoted)
const field = choice(quotedField, unquotedField);

// Parse a single CSV row
const csvRow = sepBy(field, literal(","));

// Parse multiple rows
const csvParser: Parser<string[][]> = sepBy(csvRow, newline);

/**
 * Parse CSV string and return array of string arrays.
 *
 * This function parses a CSV string and returns a 2D array where each row
 * is an array of strings representing the CSV fields. The parser handles
 * quoted fields, escaped quotes, and various line endings.
 *
 * @param input - The CSV string to parse
 * @returns Array of string arrays representing the CSV data
 * @throws Error when parsing fails
 *
 * @example
 * ```typescript
 * const csv = `name,age,city
 * John,30,New York
 * Jane,25,Boston`;
 *
 * const result = parseCSV(csv);
 * // Returns: [["name", "age", "city"], ["John", "30", "New York"], ["Jane", "25", "Boston"]]
 * ```
 */
export const parseCSV = (input: string): string[][] => {
  const result = parse(csvParser)(input);

  if (result.success) {
    // Filter out completely empty rows
    return result.val.filter(
      (row) => row.length > 0 && row.some((cell) => cell.trim() !== ""),
    );
  }

  throw new Error(`CSV parse error: ${result.error}`);
};

/**
 * Parse CSV with headers and return array of objects.
 *
 * This function parses a CSV string and returns an array of objects where
 * the first row is used as headers and subsequent rows become object properties.
 *
 * @param input - The CSV string to parse
 * @returns Array of objects with header keys and row values
 *
 * @example
 * ```typescript
 * const csv = `name,age,city
 * John,30,New York
 * Jane,25,Boston`;
 *
 * const result = parseCSVWithHeaders(csv);
 * // Returns: [
 * //   { name: "John", age: "30", city: "New York" },
 * //   { name: "Jane", age: "25", city: "Boston" }
 * // ]
 * ```
 */
export const parseCSVWithHeaders = (
  input: string,
): Record<string, string>[] => {
  const rows = parseCSV(input);

  if (rows.length < 1) {
    return [];
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);

  return dataRows.map((row) => {
    const obj: Record<string, string> = {};
    headers?.forEach((header, index) => {
      obj[header] = row[index] ?? "";
    });
    return obj;
  });
};

/**
 * Convert array of objects to CSV string.
 *
 * This function takes an array of objects and converts it to a CSV string.
 * The object keys become the header row, and object values become the data rows.
 * Fields containing commas, quotes, or newlines are automatically quoted and escaped.
 *
 * @param data - Array of objects to convert to CSV
 * @returns CSV string representation of the data
 *
 * @example
 * ```typescript
 * const data = [
 *   { name: "John", age: 30, city: "New York" },
 *   { name: "Jane", age: 25, city: "Boston" }
 * ];
 *
 * const csv = arrayToCSV(data);
 * // Returns: "name,age,city\nJohn,30,New York\nJane,25,Boston"
 * ```
 */
export const arrayToCSV = (
  data: Record<string, string | number | boolean>[],
): string => {
  if (data.length === 0) {
    return "";
  }

  const firstRow = data[0];
  if (!firstRow) {
    return "";
  }

  const headers = Object.keys(firstRow);
  if (!headers || headers.length === 0) {
    return "";
  }

  const escapeField = (field: string): string => {
    const fieldStr = String(field);

    // If field contains comma, quote, or newline, wrap in quotes
    if (
      fieldStr.includes(",") ||
      fieldStr.includes('"') ||
      fieldStr.includes("\n") ||
      fieldStr.includes("\r")
    ) {
      // Escape quotes by doubling them
      const escaped = fieldStr.replace(/"/g, '""');
      return `"${escaped}"`;
    }

    return fieldStr;
  };

  const csvRows = [
    headers.map(escapeField).join(","),
    ...data.map((row) =>
      headers.map((header) => escapeField(String(row[header] ?? ""))).join(","),
    ),
  ];

  return csvRows.join("\n");
};
