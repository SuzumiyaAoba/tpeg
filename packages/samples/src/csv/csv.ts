import { newline, sepBy, takeUntil } from "tpeg-combinator";
import type { Parser } from "tpeg-core";
import {
  any,
  choice,
  literal,
  map,
  not,
  oneOrMore,
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
const normalChar = map(seq(not(literal('"')), any()), ([_, c]) => c);

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
 * Parse CSV string and return array of string arrays
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
 * Parse CSV with headers and return array of objects
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
    headers.forEach((header, index) => {
      obj[header] = row[index] ?? "";
    });
    return obj;
  });
};

/**
 * Convert array of objects to CSV string
 */
export const arrayToCSV = (
  data: Record<string, string | number | boolean>[],
): string => {
  if (data.length === 0) {
    return "";
  }

  const headers = Object.keys(data[0]);

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
