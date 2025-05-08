import type { ParseError, ParseResult } from "./types";
import { isFailure } from "./utils";

/**
 * Formats a parse error into a human-readable string with source context.
 *
 * @param error The parse error to format
 * @param input The original input string that was being parsed
 * @param options Formatting options
 * @returns A formatted error message with context
 */
export const formatParseError = (
  error: ParseError,
  input: string,
  options: {
    contextLines?: number;
    highlightErrors?: boolean;
    showPosition?: boolean;
    colorize?: boolean;
  } = {},
): string => {
  const {
    contextLines = 2,
    highlightErrors = true,
    showPosition = true,
    colorize = true,
  } = options;

  const { pos, message, expected, found, parserName, context } = error;
  const { line, column, offset } = pos;

  // Helper for color formatting if enabled
  const color = {
    red: (text: string) => (colorize ? `\x1b[31m${text}\x1b[0m` : text),
    green: (text: string) => (colorize ? `\x1b[32m${text}\x1b[0m` : text),
    yellow: (text: string) => (colorize ? `\x1b[33m${text}\x1b[0m` : text),
    blue: (text: string) => (colorize ? `\x1b[34m${text}\x1b[0m` : text),
    bold: (text: string) => (colorize ? `\x1b[1m${text}\x1b[0m` : text),
  };

  // Build the basic error message
  let result = color.bold(
    color.red(`Parse error at line ${line}, column ${column}:\n`),
  );

  // Add parser context if available
  if (context?.length) {
    result += color.blue(
      `Context: ${Array.isArray(context) ? context.join(" > ") : context}\n`,
    );
  }

  // Add parser name if available
  if (parserName) {
    result += color.blue(`Parser: ${parserName}\n`);
  }

  // Add expected/found info
  if (expected) {
    const expectedStr = Array.isArray(expected)
      ? expected.join(", ")
      : expected;
    result += color.green(`Expected: ${expectedStr}\n`);
  }
  if (found) {
    result += color.red(`Found: ${found}\n`);
  }

  // Add the error message
  result += `Error: ${message}\n`;

  // Add source context if showPosition is enabled
  if (showPosition && input) {
    // Split input into lines
    const lines = input.split("\n");

    // Calculate the range of lines to show
    const startLine = Math.max(1, line - contextLines);
    const endLine = Math.min(lines.length, line + contextLines);

    result += `\n${color.bold("Source:")}\n`;

    // Show the context lines
    for (let i = startLine; i <= endLine; i++) {
      const isErrorLine = i === line;
      const lineContent = lines[i - 1]; // lines are 0-indexed in array
      const lineNumber = i.toString().padStart(4);

      // Format line number
      const formattedLineNumber = isErrorLine
        ? color.bold(color.red(lineNumber))
        : lineNumber;

      // Add the line of code
      result += `${formattedLineNumber} | ${lineContent}\n`;

      // Add pointer to the error position
      if (isErrorLine && highlightErrors) {
        const pointer = " ".repeat(column + 7) + color.bold(color.red("^"));
        result += `${pointer}\n`;
      }
    }
  }

  return result;
};

/**
 * Formats a parse result for display.
 *
 * @template T Type of the parse result value
 * @param result The parse result to format
 * @param input The original input string that was being parsed
 * @param options Formatting options passed to formatParseError if the result is a failure
 * @returns A formatted string for success, or a formatted error message for failure
 */
export const formatParseResult = <T>(
  result: ParseResult<T>,
  input: string,
  options?: Parameters<typeof formatParseError>[2],
): string | null => {
  return isFailure(result)
    ? formatParseError(result.error, input, options)
    : null;
};

/**
 * Reports a parse error to the console.
 *
 * @template T Type of the parse result value
 * @param result The parse result to check
 * @param input The original input string that was being parsed
 * @param options Formatting options passed to formatParseError
 */
export const reportParseError = <T>(
  result: ParseResult<T>,
  input: string,
  options?: Parameters<typeof formatParseError>[2],
): void => {
  if (isFailure(result)) {
    console.error(formatParseError(result.error, input, options));
  }
};
