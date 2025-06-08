import type { ParseError, ParseResult } from "./types";
import { isFailure } from "./utils";

/**
 * Internationalization message definitions
 */
interface I18nMessages {
  parseError: string;
  context: string;
  parser: string;
  expected: string;
  found: string;
  error: string;
  source: string;
}

const DEFAULT_MESSAGES_EN: I18nMessages = {
  parseError: "Parse error at line {line}, column {column}:",
  context: "Context: {context}",
  parser: "Parser: {parser}",
  expected: "Expected: {expected}",
  found: "Found: {found}",
  error: "Error: {message}",
  source: "Source:",
};

const DEFAULT_MESSAGES_JA: I18nMessages = {
  parseError: "行 {line}, 列 {column} でパースエラー:",
  context: "コンテキスト: {context}",
  parser: "パーサー: {parser}",
  expected: "期待値: {expected}",
  found: "実際の値: {found}",
  error: "エラー: {message}",
  source: "ソース:",
};

/**
 * Error formatting options
 */
export interface FormatErrorOptions {
  /** Number of context lines to display (default: 2, range: 0-10) */
  contextLines?: number;
  /** Whether to highlight error positions (default: true) */
  highlightErrors?: boolean;
  /** Whether to show position information (default: true) */
  showPosition?: boolean;
  /** Whether to colorize output (default: true) */
  colorize?: boolean;
  /** Language setting (default: 'en') */
  locale?: 'en' | 'ja';
  /** Custom messages */
  messages?: Partial<I18nMessages>;
}

/**
 * Color helper function
 */
const createColorHelper = (colorize: boolean) => ({
  red: (text: string) => (colorize ? `\x1b[31m${text}\x1b[0m` : text),
  green: (text: string) => (colorize ? `\x1b[32m${text}\x1b[0m` : text),
  yellow: (text: string) => (colorize ? `\x1b[33m${text}\x1b[0m` : text),
  blue: (text: string) => (colorize ? `\x1b[34m${text}\x1b[0m` : text),
  bold: (text: string) => (colorize ? `\x1b[1m${text}\x1b[0m` : text),
});

/**
 * Validates and normalizes options
 */
const validateAndNormalizeOptions = (options: FormatErrorOptions = {}): Required<FormatErrorOptions> => {
  const {
    contextLines = 2,
    highlightErrors = true,
    showPosition = true,
    colorize = true,
    locale = 'en',
    messages = {},
  } = options;

  // Range check for contextLines
  const normalizedContextLines = Math.max(0, Math.min(10, Math.floor(contextLines)));
  
  if (contextLines !== normalizedContextLines) {
    console.warn(`contextLines was adjusted from ${contextLines} to ${normalizedContextLines} (valid range: 0-10)`);
  }

  // Merge messages
  const baseMessages = locale === 'ja' ? DEFAULT_MESSAGES_JA : DEFAULT_MESSAGES_EN;
  const mergedMessages = { ...baseMessages, ...messages };

  return {
    contextLines: normalizedContextLines,
    highlightErrors,
    showPosition,
    colorize,
    locale,
    messages: mergedMessages,
  };
};

/**
 * Processes message templates
 */
const formatMessage = (template: string | undefined, params: Record<string, string | number>): string => {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    return value !== undefined ? String(value) : match;
  });
};

/**
 * Normalizes context strings
 */
const normalizeContext = (context: string | string[] | undefined): string | undefined => {
  if (!context) return undefined;
  
  if (Array.isArray(context)) {
    return context.filter(c => typeof c === 'string' && c.trim().length > 0).join(" > ");
  }
  
  return typeof context === 'string' && context.trim().length > 0 ? context.trim() : undefined;
};

/**
 * Normalizes expected value strings
 */
const normalizeExpected = (expected: string | string[] | undefined): string | undefined => {
  if (!expected) return undefined;
  
  if (Array.isArray(expected)) {
    const filtered = expected.filter(e => typeof e === 'string' && e.trim().length > 0);
    return filtered.length > 0 ? filtered.join(", ") : undefined;
  }
  
  return typeof expected === 'string' && expected.trim().length > 0 ? expected.trim() : undefined;
};

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
  options: FormatErrorOptions = {},
): string => {
  // Input validation
  if (!error || typeof error !== 'object') {
    throw new Error('Invalid error object provided');
  }

  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }

  const normalizedOptions = validateAndNormalizeOptions(options);
  const { contextLines, highlightErrors, showPosition, colorize, messages } = normalizedOptions;
  
  const color = createColorHelper(colorize);
  const { pos, message, expected, found, parserName, context } = error;
  
  // Position information validation
  if (!pos || typeof pos.line !== 'number' || typeof pos.column !== 'number') {
    throw new Error('Invalid position information in error object');
  }

  const { line, column } = pos;
  const parts: string[] = [];

  // Basic error message
  parts.push(color.bold(color.red(
    formatMessage(messages.parseError, { line, column })
  )));

  // Context information
  const normalizedContext = normalizeContext(context);
  if (normalizedContext) {
    parts.push(color.blue(
      formatMessage(messages.context, { context: normalizedContext })
    ));
  }

  // Parser name
  if (parserName && typeof parserName === 'string' && parserName.trim().length > 0) {
    parts.push(color.blue(
      formatMessage(messages.parser, { parser: parserName.trim() })
    ));
  }

  // Expected value information
  const normalizedExpected = normalizeExpected(expected);
  if (normalizedExpected) {
    parts.push(color.green(
      formatMessage(messages.expected, { expected: normalizedExpected })
    ));
  }

  // Found value
  if (found && typeof found === 'string' && found.trim().length > 0) {
    parts.push(color.red(
      formatMessage(messages.found, { found: found.trim() })
    ));
  }

  // Error message
  if (message && typeof message === 'string' && message.trim().length > 0) {
    parts.push(formatMessage(messages.error, { message: message.trim() }));
  }

  // Add source context
  if (showPosition && input.length > 0 && contextLines > 0) {
    try {
      const sourceContext = formatSourceContext(input, line, column, contextLines, highlightErrors, color);
      if (sourceContext) {
        parts.push(""); // Add empty line
        parts.push(color.bold(messages.source || "Source:"));
        parts.push(sourceContext);
      }
    } catch (error) {
      // Skip if an error occurs while displaying source context
      console.warn('Failed to format source context:', error);
    }
  }

  return parts.join('\n');
};

/**
 * Formats source context
 */
const formatSourceContext = (
  input: string,
  errorLine: number,
  errorColumn: number,
  contextLines: number,
  highlightErrors: boolean,
  color: ReturnType<typeof createColorHelper>,
): string | null => {
  const lines = input.split('\n');
  const totalLines = lines.length;

  // Line number validation
  if (errorLine < 1 || errorLine > totalLines) {
    return null;
  }

  // Calculate display range
  const startLine = Math.max(1, errorLine - contextLines);
  const endLine = Math.min(totalLines, errorLine + contextLines);

  const contextParts: string[] = [];
  const maxLineNumberWidth = endLine.toString().length;

  // Generate context lines
  for (let i = startLine; i <= endLine; i++) {
    const isErrorLine = i === errorLine;
    const lineContent = lines[i - 1] || ''; // lines are 0-indexed
    const lineNumber = i.toString().padStart(maxLineNumberWidth);

    // Format line number
    const formattedLineNumber = isErrorLine
      ? color.bold(color.red(lineNumber))
      : lineNumber;

    // Add line content
    contextParts.push(`${formattedLineNumber} | ${lineContent}`);

    // Error position pointer
    if (isErrorLine && highlightErrors && errorColumn >= 0) {
      const pointerOffset = maxLineNumberWidth + 3 + errorColumn; // " | " = 3 chars
      const pointer = ' '.repeat(pointerOffset) + color.bold(color.red('^'));
      contextParts.push(pointer);
    }
  }

  return contextParts.join('\n');
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
  options?: FormatErrorOptions,
): string | null => {
  if (!result || typeof result !== 'object') {
    throw new Error('Invalid parse result provided');
  }

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
  options?: FormatErrorOptions,
): void => {
  if (!result || typeof result !== 'object') {
    console.error('Invalid parse result provided');
    return;
  }

  if (isFailure(result)) {
    try {
      const errorMessage = formatParseError(result.error, input, options);
      console.error(errorMessage);
    } catch (error) {
      console.error('Failed to format parse error:', error);
      console.error('Original error:', result.error);
    }
  }
};
