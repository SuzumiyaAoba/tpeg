import type { ParseFailure, Parser } from "tpeg-combinator";
import {
  charClass,
  choice,
  literal,
  map,
  not,
  oneOrMore,
  parse,
  sepBy,
  sepBy1,
  seq,
  takeUntil,
} from "tpeg-combinator";

/**
 * CSV Parser Sample
 *
 * Parses basic CSV format:
 * - Comma-separated values
 * - Double quoted fields for escaping
 * - Lines separated by newlines
 */

// Unquoted field (doesn't contain commas or newlines)
const unquotedField = (): Parser<string> =>
  map(
    takeUntil(
      choice(literal(","), literal("\n"), literal("\r\n"), literal("\r")),
    ),
    (val) => val,
  );

// Quoted field
const quotedField = (): Parser<string> => {
  // Parse escaped quotes ("")
  const escapedQuote = map(literal('""'), () => '"');

  // Character that is not the end quote (excluding double quote)
  const normalChar = map(
    seq(not(literal('"')), charClass(["0", "\uFFFF"])),
    ([_, char]) => char,
  );

  // Content inside quotes
  const quotedContent = map(
    oneOrMore(choice(escapedQuote, normalChar)),
    (chars) => chars.join(""),
  );

  // Quoted field - remove quotes
  return map(
    seq(literal('"'), quotedContent, literal('"')),
    ([_, content]) => content,
  );
};

// Any field (quoted or unquoted)
const field = (): Parser<string> => choice(quotedField(), unquotedField());

// Parse a line
const line = (): Parser<string[]> => sepBy(field(), literal(","));

// Parse multiple lines
const csvParser = (): Parser<string[][]> => {
  // Newline patterns (CR, LF, CRLF)
  const newline = choice(literal("\r\n"), literal("\n"), literal("\r"));

  // Line separator (newline or EOF)
  return sepBy(line(), newline);
};

// Main function to parse CSV
export const parseCSV = (input: string): string[][] => {
  const result = parse(csvParser())(input);

  if (result.success) {
    return result.val;
  }

  console.error("CSV parse error:", (result as ParseFailure).error);
  return [];
};

// Create an array of objects from CSV string with headers
export const parseCSVWithHeaders = (
  input: string,
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

// Usage example
// Version without Bun-specific import.meta.main
const testCSV = (): void => {
  // Basic CSV string (with quoted and unquoted fields)
  const csvString = `name,age,city
John,30,New York
Jane,25,Boston
Bob,40,San Francisco`;

  const parsed = parseCSVWithHeaders(csvString);
  console.log(JSON.stringify(parsed, null, 2));
};

// Run test when directly executed
if (typeof require !== "undefined" && require.main === module) {
  testCSV();
}
