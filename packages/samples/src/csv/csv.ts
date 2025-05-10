import { sepBy, takeUntil, newline } from "tpeg-combinator";
import type { Parser } from "tpeg-core";
import {
  charClass,
  choice,
  literal,
  map,
  not,
  oneOrMore,
  parse,
  seq,
} from "tpeg-core";

/**
 * CSV Parser Sample
 *
 * Parses basic CSV format:
 * - Comma-separated values
 * - Double quoted fields for escaping
 * - Lines separated by newlines
 */

// Unquoted field (doesn't contain commas or newlines)
const unquotedField = map(
  takeUntil(
    choice(literal(","), literal("\n"), literal("\r\n"), literal("\r"))
  ),
  (val) => val
);

// Parse escaped quotes ("")
const escapedQuote = map(literal('""'), () => '"');

// Character that is not the end quote (excluding double quote)
const normalChar = map(
  seq(not(literal('"')), charClass(["0", "\uFFFF"])),
  ([_, char]) => char
);

// Content inside quotes
const quotedContent = map(
  oneOrMore(choice(escapedQuote, normalChar)),
  (chars) => chars.join("")
);

// Quoted field
const quotedField = map(
  seq(literal('"'), quotedContent, literal('"')),
  ([_, content]) => content
);

// Any field (quoted or unquoted)
const field = choice(quotedField, unquotedField);

// Parse a line
const line = sepBy(field, literal(","));

// Parse multiple lines
const csvParser = (): Parser<string[][]> => {
  // Line separator (newline or EOF)
  return sepBy(line, newline);
};

// Main function to parse CSV
export const parseCSV = (input: string): string[][] => {
  const result = parse(csvParser())(input);

  if (result.success) {
    return result.val;
  }

  console.error("CSV parse error:", result.error);
  return [];
};

// Create an array of objects from CSV string with headers
export const parseCSVWithHeaders = (
  input: string
): Record<string, string>[] => {
  const parsed = parseCSV(input);

  if (parsed.length < 2) {
    return [];
  }

  const headers = parsed[0];
  const rows = parsed.slice(1);

  return rows.map((row) => {
    const obj: Record<string, string> = {};
    row.forEach((cell, index) => {
      if (index < headers.length) {
        obj[headers[index]] = cell;
      }
    });
    return obj;
  });
};
