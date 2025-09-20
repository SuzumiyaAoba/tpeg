import type { ParseError, ParseResult } from "./types";
import { isFailure } from "./utils";

/**
 * Internationalization message definitions for error formatting.
 *
 * All properties are readonly to ensure message template immutability.
 * Message templates support parameter substitution using {paramName} syntax.
 *
 * @example
 * ```typescript
 * const messages: I18nMessages = {
 *   parseError: "Parse error at line {line}, column {column}:",
 *   // ...other messages
 * };
 * ```
 */
interface I18nMessages {
  /** Main parse error message template. Supports {line} and {column} parameters. */
  readonly parseError: string;
  /** Context information message template. Supports {context} parameter. */
  readonly context: string;
  /** Parser name message template. Supports {parser} parameter. */
  readonly parser: string;
  /** Expected value message template. Supports {expected} parameter. */
  readonly expected: string;
  /** Found value message template. Supports {found} parameter. */
  readonly found: string;
  /** Error message template. Supports {message} parameter. */
  readonly error: string;
  /** Source code header message. */
  readonly source: string;
}

/**
 * Default English message templates.
 *
 * These messages provide clear, concise error information with proper
 * parameter substitution support.
 */
const DEFAULT_MESSAGES_EN: I18nMessages = {
  parseError: "Parse error at line {line}, column {column}:",
  context: "Context: {context}",
  parser: "Parser: {parser}",
  expected: "Expected: {expected}",
  found: "Found: {found}",
  error: "Error: {message}",
  source: "Source:",
} as const;

/**
 * Default Japanese message templates.
 *
 * Japanese translations that maintain the same semantic meaning
 * while being culturally appropriate for Japanese users.
 */
const DEFAULT_MESSAGES_JA: I18nMessages = {
  parseError: "行 {line}, 列 {column} でパースエラー:",
  context: "コンテキスト: {context}",
  parser: "パーサー: {parser}",
  expected: "期待値: {expected}",
  found: "実際の値: {found}",
  error: "エラー: {message}",
  source: "ソース:",
} as const;

/**
 * Enhanced error message templates with more user-friendly messages.
 */
const ENHANCED_MESSAGES_EN: I18nMessages = {
  parseError: "Parsing failed at line {line}, column {column}",
  context: "In {context}",
  parser: "While parsing {parser}",
  expected: "Expected {expected}",
  found: "But found {found}",
  error: "Error: {message}",
  source: "Source code:",
} as const;

/**
 * Enhanced Japanese message templates with more user-friendly messages.
 */
const ENHANCED_MESSAGES_JA: I18nMessages = {
  parseError: "行 {line}, 列 {column} でパースに失敗しました",
  context: "{context} の中で",
  parser: "{parser} を解析中に",
  expected: "{expected} を期待していました",
  found: "しかし {found} が見つかりました",
  error: "エラー: {message}",
  source: "ソースコード:",
} as const;

/**
 * Supported locales for internationalization.
 *
 * Currently supports English and Japanese. Can be extended
 * to support additional languages by adding locale identifiers
 * and corresponding message templates.
 */
type SupportedLocale = "en" | "ja";

/**
 * Configuration options for error message formatting.
 *
 * All properties are readonly to prevent accidental modification
 * during the formatting process.
 *
 * @example
 * ```typescript
 * const options: FormatErrorOptions = {
 *   contextLines: 3,
 *   highlightErrors: true,
 *   locale: "ja",
 *   maxLineLength: 100
 * };
 * ```
 */
export interface FormatErrorOptions {
  /**
   * Number of context lines to display around the error (default: 2).
   *
   * Valid range: 0-10. Values outside this range will be clamped
   * and a warning will be logged.
   */
  readonly contextLines?: number;

  /**
   * Whether to highlight error positions with visual indicators (default: true).
   *
   * When enabled, adds pointer characters (^) below the error position.
   */
  readonly highlightErrors?: boolean;

  /**
   * Whether to show position information and source context (default: true).
   *
   * When disabled, only the basic error message is displayed without
   * source code context.
   */
  readonly showPosition?: boolean;

  /**
   * Whether to colorize output using ANSI escape codes (default: true).
   *
   * Should be disabled for environments that don't support color output
   * or when writing to files.
   */
  readonly colorize?: boolean;

  /**
   * Language setting for error messages (default: 'en').
   *
   * Determines which message template set to use. Unsupported locales
   * will fall back to English with a warning.
   */
  readonly locale?: SupportedLocale;

  /**
   * Custom message templates to override defaults.
   *
   * Partial override is supported - only specified messages will be
   * replaced, others will use the default for the selected locale.
   */
  readonly messages?: Partial<I18nMessages>;

  /**
   * Maximum line length for truncation (default: 120).
   *
   * Valid range: 40-500. Lines exceeding this length will be truncated
   * with an ellipsis indicator.
   */
  readonly maxLineLength?: number;

  /**
   * Whether to show line numbers in source context (default: true).
   *
   * When disabled, source context is shown without line number prefixes.
   */
  readonly showLineNumbers?: boolean;
}

/**
 * Color helper interface for consistent text formatting.
 *
 * Provides a unified interface for text coloring that can be disabled
 * when color output is not desired or supported.
 */
interface ColorHelper {
  /** Formats text in red color (typically for errors). */
  readonly red: (text: string) => string;
  /** Formats text in green color (typically for success/expected values). */
  readonly green: (text: string) => string;
  /** Formats text in yellow color (typically for warnings). */
  readonly yellow: (text: string) => string;
  /** Formats text in blue color (typically for information). */
  readonly blue: (text: string) => string;
  /** Formats text in bold style. */
  readonly bold: (text: string) => string;
  /** Formats text in dimmed/faded style. */
  readonly dim: (text: string) => string;
}

/**
 * Creates a color helper with optimized performance.
 *
 * When colorization is disabled, returns identity functions to avoid
 * unnecessary string concatenation and ANSI escape code processing.
 *
 * @param colorize - Whether to enable color formatting
 * @returns Color helper interface with appropriate implementations
 *
 * @example
 * ```typescript
 * const color = createColorHelper(true);
 * console.log(color.red("Error text")); // Red colored text
 *
 * const noColor = createColorHelper(false);
 * console.log(noColor.red("Error text")); // Plain text
 * ```
 */
const createColorHelper = (colorize: boolean): ColorHelper => {
  if (!colorize) {
    const identity = (text: string) => text;
    return {
      red: identity,
      green: identity,
      yellow: identity,
      blue: identity,
      bold: identity,
      dim: identity,
    };
  }

  return {
    red: (text: string) => `\x1b[31m${text}\x1b[0m`,
    green: (text: string) => `\x1b[32m${text}\x1b[0m`,
    yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
    blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
    dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
  };
};

/**
 * Validates and clamps a numeric value within a specified range.
 *
 * Logs a warning if the value needs to be adjusted, helping developers
 * identify configuration issues.
 *
 * @param value - The value to validate and clamp
 * @param min - Minimum allowed value (inclusive)
 * @param max - Maximum allowed value (inclusive)
 * @param name - Parameter name for warning messages
 * @returns The clamped value as an integer
 *
 * @example
 * ```typescript
 * const lines = clampValue(15, 0, 10, "contextLines"); // Returns 10, logs warning
 * ```
 */
const clampValue = (
  value: number,
  min: number,
  max: number,
  name: string,
): number => {
  const normalized = Math.max(min, Math.min(max, Math.floor(value)));

  if (value !== normalized) {
    console.warn(
      `${name} was adjusted from ${value} to ${normalized} (valid range: ${min}-${max})`,
    );
  }

  return normalized;
};

/**
 * Validates and normalizes locale values with fallback handling.
 *
 * @param locale - The locale value to validate
 * @returns A valid supported locale, with fallback to 'en'
 *
 * @example
 * ```typescript
 * const validLocale = validateLocale("ja"); // Returns "ja"
 * const fallbackLocale = validateLocale("fr"); // Returns "en", logs warning
 * ```
 */
const validateLocale = (locale: unknown): SupportedLocale => {
  if (locale === "en" || locale === "ja") {
    return locale;
  }

  console.warn(`Invalid locale '${locale}', falling back to 'en'`);
  return "en";
};

/**
 * Validates and normalizes formatting options with comprehensive type safety.
 *
 * Performs range validation, type coercion, and message template merging
 * to ensure all options are valid and complete.
 *
 * @param options - Partial options object to validate and normalize
 * @returns Complete, validated options object with all required properties
 *
 * @example
 * ```typescript
 * const normalized = validateAndNormalizeOptions({
 *   contextLines: 15, // Will be clamped to 10
 *   locale: "invalid" // Will fallback to "en"
 * });
 * ```
 */
const validateAndNormalizeOptions = (
  options: FormatErrorOptions = {},
): Required<FormatErrorOptions> => {
  const {
    contextLines = 2,
    highlightErrors = true,
    showPosition = true,
    colorize = true,
    locale = "en",
    messages = {},
    maxLineLength = 120,
    showLineNumbers = true,
  } = options;

  // Validate and normalize values
  const normalizedContextLines = clampValue(
    contextLines,
    0,
    10,
    "contextLines",
  );
  const normalizedMaxLineLength = clampValue(
    maxLineLength,
    40,
    500,
    "maxLineLength",
  );
  const validatedLocale = validateLocale(locale);

  // Merge messages with type safety - use default messages by default
  const baseMessages =
    validatedLocale === "ja" ? DEFAULT_MESSAGES_JA : DEFAULT_MESSAGES_EN;
  const mergedMessages: I18nMessages = { ...baseMessages, ...messages };

  return {
    contextLines: normalizedContextLines,
    highlightErrors: Boolean(highlightErrors),
    showPosition: Boolean(showPosition),
    colorize: Boolean(colorize),
    locale: validatedLocale,
    messages: mergedMessages,
    maxLineLength: normalizedMaxLineLength,
    showLineNumbers: Boolean(showLineNumbers),
  };
};

/**
 * Template parameter type for message formatting.
 *
 * Supports both string and numeric values for flexible template substitution.
 */
type TemplateParams = Record<string, string | number>;

/**
 * Processes message templates with parameter substitution and error handling.
 *
 * Replaces {paramName} placeholders with corresponding values from the params object.
 * Gracefully handles template processing errors by returning the original template.
 *
 * @param template - The template string with {param} placeholders
 * @param params - Object containing parameter values for substitution
 * @returns Formatted message with substituted parameters
 *
 * @example
 * ```typescript
 * const result = formatMessage("Error at line {line}, column {col}", {
 *   line: 5,
 *   col: 10
 * });
 * // Returns: "Error at line 5, column 10"
 * ```
 */
const formatMessage = (
  template: string | undefined,
  params: TemplateParams,
): string => {
  if (!template) return "";

  try {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      const value = params[key];
      return value !== undefined ? String(value) : match;
    });
  } catch (error) {
    console.warn(`Failed to format message template: ${template}`, error);
    return template;
  }
};

/**
 * Safely trims and validates string values with type safety.
 *
 * @param value - The value to trim and validate
 * @returns Trimmed string if valid and non-empty, undefined otherwise
 *
 * @example
 * ```typescript
 * safeStringTrim("  hello  "); // Returns "hello"
 * safeStringTrim(""); // Returns undefined
 * safeStringTrim(null); // Returns undefined
 * ```
 */
const safeStringTrim = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Normalizes context strings with proper validation and array handling.
 *
 * Supports both single strings and arrays of strings, filtering out
 * invalid entries and joining array elements with hierarchical separators.
 *
 * @param context - Context information as string or array of strings
 * @returns Normalized context string or undefined if no valid context
 *
 * @example
 * ```typescript
 * normalizeContext(["parser", "rule", "token"]); // Returns "parser > rule > token"
 * normalizeContext("  simple context  "); // Returns "simple context"
 * normalizeContext(["", null, "valid"]); // Returns "valid"
 * ```
 */
const normalizeContext = (
  context: string | string[] | undefined,
): string | undefined => {
  if (!context) return undefined;

  if (Array.isArray(context)) {
    const validItems = context
      .map(safeStringTrim)
      .filter((item): item is string => item !== undefined);

    return validItems.length > 0 ? validItems.join(" > ") : undefined;
  }

  return safeStringTrim(context);
};

/**
 * Normalizes expected value strings with deduplication and proper formatting.
 *
 * Handles both single strings and arrays, removing duplicates while preserving
 * order for consistent error messages.
 *
 * @param expected - Expected values as string or array of strings
 * @returns Normalized expected values string or undefined if no valid values
 *
 * @example
 * ```typescript
 * normalizeExpected(["number", "string", "number"]); // Returns "number, string"
 * normalizeExpected("identifier"); // Returns "identifier"
 * normalizeExpected(["", null]); // Returns undefined
 * ```
 */
const normalizeExpected = (
  expected: string | string[] | undefined,
): string | undefined => {
  if (!expected) return undefined;

  if (Array.isArray(expected)) {
    const validItems = expected
      .map(safeStringTrim)
      .filter((item): item is string => item !== undefined);

    // Remove duplicates while preserving order
    const uniqueItems = Array.from(new Set(validItems));
    return uniqueItems.length > 0 ? uniqueItems.join(", ") : undefined;
  }

  return safeStringTrim(expected);
};

/**
 * Type guard to validate parse error object structure.
 *
 * Ensures the error object has the required position information
 * with proper types and valid values.
 *
 * @param error - The error object to validate
 * @returns True if the error is a valid ParseError, false otherwise
 *
 * @example
 * ```typescript
 * if (validateParseError(someError)) {
 *   // someError is now typed as ParseError
 *   console.log(`Error at line ${someError.pos.line}`);
 * }
 * ```
 */
const validateParseError = (error: unknown): error is ParseError => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const err = error as ParseError;
  return (
    err.pos &&
    typeof err.pos.line === "number" &&
    typeof err.pos.column === "number" &&
    err.pos.line >= 1 &&
    err.pos.column >= 0
  );
};

/**
 * Calculates the visual width of a string, handling multi-byte characters.
 *
 * Provides accurate width calculation for proper alignment in terminal output,
 * accounting for full-width characters commonly used in Asian languages.
 *
 * @param str - The string to measure (can be undefined for safety)
 * @returns Visual width in character columns
 *
 * @example
 * ```typescript
 * getStringWidth("hello"); // Returns 5
 * getStringWidth("こんにちは"); // Returns 10 (full-width characters)
 * getStringWidth("Hello世界"); // Returns 9 (mixed width)
 * ```
 *
 * @remarks
 * This is a simplified implementation. For production use, consider using
 * a dedicated library like 'string-width' for more accurate Unicode handling.
 */
const getStringWidth = (str: string | undefined): number => {
  if (!str || typeof str !== "string") {
    return 0;
  }

  // Simple approximation - in real implementation, you might want to use a library
  // like string-width for accurate unicode width calculation
  let width = 0;
  for (const char of str) {
    // Basic handling for common cases
    const code = char.codePointAt(0) || 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      // Control characters
      width += 0;
    } else if (
      code >= 0x1100 &&
      (code <= 0x115f || // Hangul Jamo
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) || // CJK
        (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
        (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
        (code >= 0xfe10 && code <= 0xfe19) || // Vertical forms
        (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
        (code >= 0xff00 && code <= 0xff60) || // Fullwidth Forms
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x20000 && code <= 0x2fffd) ||
        (code >= 0x30000 && code <= 0x3fffd))
    ) {
      // Wide characters (typically Asian)
      width += 2;
    } else {
      // Regular characters
      width += 1;
    }
  }
  return width;
};

/**
 * Truncates a line if it exceeds the maximum length with proper width calculation.
 *
 * Handles multi-byte characters correctly to ensure proper truncation at the
 * visual boundary rather than byte boundary.
 *
 * @param line - The line to potentially truncate
 * @param maxLength - Maximum allowed visual width
 * @returns Original line or truncated line with ellipsis
 *
 * @example
 * ```typescript
 * truncateLine("This is a very long line", 10); // Returns "This is..."
 * truncateLine("短い行", 10); // Returns "短い行" (no truncation needed)
 * ```
 */
const truncateLine = (line: string, maxLength: number): string => {
  if (!line || typeof line !== "string") {
    return "";
  }

  if (getStringWidth(line) <= maxLength) {
    return line;
  }

  const ellipsis = "...";
  const targetLength = maxLength - ellipsis.length;

  let truncated = "";
  let width = 0;

  for (const char of line) {
    const charWidth = getStringWidth(char);
    if (width + charWidth > targetLength) {
      break;
    }
    truncated += char;
    width += charWidth;
  }

  return truncated + ellipsis;
};

/**
 * Formats a parse error into a human-readable string with comprehensive source context.
 *
 * This is the main error formatting function that provides rich, user-friendly error messages
 * with configurable styling, internationalization support, and proper multi-byte character handling.
 *
 * @param error - The parse error object containing position and context information
 * @param input - The original input string that was being parsed
 * @param options - Configuration options for formatting behavior and appearance
 * @returns A formatted, multi-line error message with context and source code display
 *
 * @throws {Error} When the error object is invalid or missing required position information
 * @throws {Error} When the input is not a string
 *
 * @example
 * ```typescript
 * const error: ParseError = {
 *   pos: { line: 3, column: 5 },
 *   message: "Unexpected token",
 *   expected: ["identifier", "number"],
 *   found: ";"
 * };
 *
 * const formatted = formatParseError(error, sourceCode, {
 *   contextLines: 2,
 *   highlightErrors: true,
 *   locale: "ja"
 * });
 *
 * console.log(formatted);
 * // Outputs formatted error with Japanese messages and context
 * ```
 *
 * @since 1.0.0
 */
export const formatParseError = (
  error: ParseError,
  input: string,
  options: FormatErrorOptions = {},
): string => {
  // Enhanced input validation
  if (!validateParseError(error)) {
    throw new Error("Invalid error object provided");
  }

  if (typeof input !== "string") {
    throw new Error("Input must be a string");
  }

  const normalizedOptions = validateAndNormalizeOptions(options);
  const {
    contextLines,
    highlightErrors,
    showPosition,
    colorize,
    messages,
    maxLineLength,
    showLineNumbers,
  } = normalizedOptions;

  // Auto-detect colorize if not explicitly provided (TTY-aware)
  const effectiveColorize =
    typeof options.colorize === "boolean"
      ? options.colorize
      : (() => {
          const g = globalThis as unknown as {
            process?: { stdout?: { isTTY?: boolean } };
          };
          return Boolean(g.process?.stdout?.isTTY);
        })();

  const color = createColorHelper(effectiveColorize);
  const { pos, message, expected, found, parserName, context } = error;
  const { line, column } = pos;

  const parts: string[] = [];

  // Basic error message
  parts.push(
    color.bold(color.red(formatMessage(messages.parseError, { line, column }))),
  );

  // Context information
  const normalizedContext = normalizeContext(context);
  if (normalizedContext) {
    parts.push(
      color.blue(
        formatMessage(messages.context, { context: normalizedContext }),
      ),
    );
  }

  // Parser name
  const normalizedParserName = safeStringTrim(parserName);
  if (normalizedParserName) {
    parts.push(
      color.blue(
        formatMessage(messages.parser, { parser: normalizedParserName }),
      ),
    );
  }

  // Expected value information
  const normalizedExpected = normalizeExpected(expected);
  if (normalizedExpected) {
    parts.push(
      color.green(
        formatMessage(messages.expected, { expected: normalizedExpected }),
      ),
    );
  }

  // Found value
  const normalizedFound = safeStringTrim(found);
  if (normalizedFound) {
    parts.push(
      color.red(formatMessage(messages.found, { found: normalizedFound })),
    );
  }

  // Error message
  const normalizedMessage = safeStringTrim(message);
  if (normalizedMessage) {
    parts.push(formatMessage(messages.error, { message: normalizedMessage }));
  }

  // Add source context
  if (showPosition && input.length > 0 && contextLines > 0) {
    try {
      const sourceContext = formatSourceContext(
        input,
        line,
        column,
        contextLines,
        highlightErrors,
        color,
        maxLineLength,
        showLineNumbers,
      );
      if (sourceContext) {
        parts.push(""); // Add empty line
        parts.push(color.bold(messages.source || "Source:"));
        parts.push(sourceContext);
      }
    } catch (contextError) {
      // Log warning but don't fail the entire formatting
      console.warn("Failed to format source context:", contextError);
    }
  }

  return parts.join("\n");
};

/**
 * Formats source code context around an error position with enhanced multi-byte character support.
 *
 * Creates a visual representation of the source code with line numbers, error highlighting,
 * and proper alignment for multi-byte characters. Handles edge cases like invalid line numbers
 * and provides appropriate fallbacks.
 *
 * @param input - The complete source code string
 * @param errorLine - The line number where the error occurred (1-based)
 * @param errorColumn - The column position where the error occurred (0-based)
 * @param contextLines - Number of lines to show before and after the error line
 * @param highlightErrors - Whether to add visual error position indicators
 * @param color - Color helper for formatting output
 * @param maxLineLength - Maximum line length before truncation
 * @param showLineNumbers - Whether to prefix lines with line numbers
 * @returns Formatted source context string, or null if the error position is invalid
 *
 * @example
 * ```typescript
 * const context = formatSourceContext(
 *   "line 1\nline 2 error here\nline 3",
 *   2, 10, 1, true, colorHelper, 80, true
 * );
 * // Returns formatted context with error pointer
 * ```
 *
 * @internal This function is used internally by formatParseError
 */
const formatSourceContext = (
  input: string,
  errorLine: number,
  errorColumn: number,
  contextLines: number,
  highlightErrors: boolean,
  color: ColorHelper,
  maxLineLength: number,
  showLineNumbers: boolean,
): string | null => {
  const lines = input.split("\n");
  const totalLines = lines.length;

  // Enhanced line number validation
  if (errorLine < 1 || errorLine > totalLines) {
    console.warn(`Error line ${errorLine} is out of range (1-${totalLines})`);
    return null;
  }

  // Calculate display range
  const startLine = Math.max(1, errorLine - contextLines);
  const endLine = Math.min(totalLines, errorLine + contextLines);

  const contextParts: string[] = [];
  const maxLineNumberWidth = showLineNumbers ? endLine.toString().length : 0;

  // Generate context lines
  for (let i = startLine; i <= endLine; i++) {
    const isErrorLine = i === errorLine;
    const lineContent = lines[i - 1] || ""; // lines are 0-indexed
    const truncatedContent = truncateLine(lineContent, maxLineLength);

    let formattedLine = "";

    // Add line number if enabled
    if (showLineNumbers) {
      const lineNumber = i.toString().padStart(maxLineNumberWidth);
      const formattedLineNumber = isErrorLine
        ? color.bold(color.red(lineNumber))
        : color.dim(lineNumber);
      formattedLine += `${formattedLineNumber} | `;
    }

    // Add line content
    formattedLine += isErrorLine
      ? color.bold(truncatedContent)
      : truncatedContent;
    contextParts.push(formattedLine);

    // Error position pointer with better column calculation
    if (isErrorLine && highlightErrors && errorColumn >= 0) {
      const linePrefix = showLineNumbers ? maxLineNumberWidth + 3 : 0; // " | " = 3 chars

      // Calculate visual position considering multi-byte characters
      const beforeColumn = lineContent.slice(0, errorColumn);
      const visualColumn = getStringWidth(beforeColumn);

      const pointerOffset =
        linePrefix + Math.min(visualColumn, getStringWidth(truncatedContent));
      const pointer =
        " ".repeat(Math.max(0, pointerOffset)) + color.bold(color.red("^"));
      contextParts.push(pointer);
    }
  }

  return contextParts.join("\n");
};

/**
 * Formats a parse result for display, handling both success and failure cases.
 *
 * Provides a convenient wrapper around formatParseError that works directly with
 * ParseResult objects. Returns null for successful parses and formatted error
 * messages for failures.
 *
 * @template T - The type of the successfully parsed value
 * @param result - The parse result object to examine and potentially format
 * @param input - The original input string that was being parsed
 * @param options - Formatting options passed to formatParseError for failure cases
 * @returns Formatted error message string for failures, null for successful parses
 *
 * @throws {Error} When the result object is invalid or malformed
 *
 * @example
 * ```typescript
 * const result = parser.parse(input);
 * const errorMessage = formatParseResult(result, input, { locale: "ja" });
 *
 * if (errorMessage) {
 *   console.error(errorMessage); // Only prints on parse failure
 * } else {
 *   console.log("Parse successful:", result.value);
 * }
 * ```
 *
 * @see {@link formatParseError} for detailed error formatting
 * @since 1.0.0
 */
export const formatParseResult = <T>(
  result: ParseResult<T>,
  input: string,
  options?: FormatErrorOptions,
): string | null => {
  if (!result || typeof result !== "object") {
    throw new Error("Invalid parse result provided");
  }

  return isFailure(result)
    ? formatParseError(result.error, input, options)
    : null;
};

/**
 * Reports a parse error to the console with comprehensive error handling.
 *
 * Convenience function that checks if a parse result represents a failure and,
 * if so, formats and logs the error to console.error. Handles formatting errors
 * gracefully by falling back to basic error information.
 *
 * @template T - The type of the successfully parsed value
 * @param result - The parse result object to check for errors
 * @param input - The original input string that was being parsed
 * @param options - Formatting options for error display customization
 *
 * @example
 * ```typescript
 * const result = parser.parse(input);
 * reportParseError(result, input, {
 *   contextLines: 3,
 *   colorize: process.stdout.isTTY,
 *   locale: "ja"
 * });
 * // Automatically logs formatted error if parsing failed
 * ```
 *
 * @remarks
 * This function is safe to call on both successful and failed parse results.
 * It will only output to the console for actual failures.
 *
 * @see {@link formatParseError} for the underlying error formatting logic
 * @see {@link formatParseResult} for a similar function that returns the formatted string
 * @since 1.0.0
 */
export const reportParseError = <T>(
  result: ParseResult<T>,
  input: string,
  options?: FormatErrorOptions,
): void => {
  if (!result || typeof result !== "object") {
    console.error("Invalid parse result provided");
    return;
  }

  if (isFailure(result)) {
    try {
      const errorMessage = formatParseError(result.error, input, options);
      console.error(errorMessage);
    } catch (error) {
      console.error("Failed to format parse error:", error);
      console.error("Original error:", result.error);
    }
  }
};
