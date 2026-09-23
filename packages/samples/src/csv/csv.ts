import { sepBy, takeUntil } from "@suzumiyaaoba/tpeg-combinator";
import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  andPredicate,
  any,
  choice,
  filter,
  literal,
  map,
  not,
  parse,
  seq,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";

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

// Line ending: CRLF (Windows), LF (Unix), or CR (Mac)
const newline = choice(literal("\r\n"), literal("\n"), literal("\r"));

// A blank line -- nothing but (trimmed-away) unquoted whitespace before
// the line break or end of input. Recognized HERE, while it is still
// known that the lone field was unquoted: after parsing, a blank line
// and a row holding one quoted empty/whitespace field (`""`, `"  "`)
// both look like `[""]`/`["  "]`, and dropping by value discarded those
// real records too.
const blankLine: Parser<null> = map(
  seq(
    filter(unquotedField, (value) => value === "", "blank line"),
    andPredicate(choice(newline, not(any))),
  ),
  () => null,
);

// Parse multiple rows
//
// sepBy never fails on its own -- when `value` doesn't match at a position
// it falls back to succeeding with an empty result there (see
// packages/combinator/src/list.ts). Without an explicit end-of-input check,
// that means any malformed trailing content (e.g. a stray, unterminated
// quote) is silently dropped instead of surfacing as a parse error, even
// though parseCSV's contract is to throw on malformed input.
const csvParser: Parser<(string[] | null)[]> = map(
  seq(sepBy(choice(blankLine, csvRow), newline), not(any)),
  ([rows]) => rows,
);

/**
 * Drop the phantom rows blank lines (including a trailing line break)
 * leave behind -- represented as `null` in the pre-filter row stream.
 * Every other row is a real record, including one whose only field is
 * a quoted empty or whitespace-only string (`""`, `"  "`), and a row of
 * several empty fields (`,,` or `"",""`).
 *
 * Shared by {@link parseCSV} and the `.tpeg` grammar twin (`csv.tpeg`),
 * which produces the same pre-filter row stream.
 */
export const dropPhantomRows = (
  rows: readonly (readonly string[] | null)[],
): string[][] =>
  rows
    .filter((row): row is readonly string[] => row !== null)
    .map((row) => [...row]);

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
    return dropPhantomRows(result.val);
  }

  throw new Error(`CSV parse error: ${result.error.message}`);
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
      // `obj[header] = ...` with a header literally named "__proto__"
      // would hit Object.prototype's __proto__ setter instead of storing
      // the field -- same fix as the JSON sample's objectParser.
      Object.defineProperty(obj, header, {
        value: row[index] ?? "",
        enumerable: true,
        writable: true,
        configurable: true,
      });
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

    // A single-column row whose value is empty would be written as an
    // empty line, which reads back as a blank line and is dropped --
    // quote it so the record survives a write/parse round trip.
    if (fieldStr === "" && headers.length === 1) {
      return '""';
    }

    // If field contains comma, quote, or newline, wrap in quotes. A field
    // whose stringification differs from its own trim must ALSO be quoted:
    // `unquotedField` trims surrounding whitespace on the read side (see
    // above), so writing ` John ` unquoted would read back as `John` --
    // silent data loss on a write/parse round trip.
    if (
      fieldStr.includes(",") ||
      fieldStr.includes('"') ||
      fieldStr.includes("\n") ||
      fieldStr.includes("\r") ||
      fieldStr !== fieldStr.trim()
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
