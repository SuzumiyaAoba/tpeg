// Re-export all types and functions from grammar-types.ts
export * from "./grammar-types";

// Re-export public surface from other modules (avoid exporting internals like benchmarkParser)
export { any, anyChar, lit, literal } from "./basic";
export * from "./capture";
export * from "./char-class";
export * from "./combinators";
export * from "./error";
export * from "./error-handling";
export * from "./lookahead";
export * from "./repetition";
export * from "./test-utils";
export * from "./transform";
export * from "./types";
export * from "./utils";

// ============================================================================
// Namespaced API for Better Organization
// ============================================================================

/**
 * Namespaced parsers for better API organization.
 */
import { any, anyChar, lit, literal } from "./basic";
import { capture, captureChoice, captureSequence } from "./capture";
import { charClass } from "./char-class";
import {
  choice,
  maybe,
  reject,
  seq,
  sequence,
  withDefault,
} from "./combinators";
import { formatParseError, formatParseResult, reportParseError } from "./error";
import { and, andPredicate, not, notPredicate } from "./lookahead";
import { oneOrMore, optional, quantified, zeroOrMore } from "./repetition";
import { filter, map, mapError, mapResult, tap } from "./transform";
import {
  advancePos,
  createFailure,
  createPos,
  extractValue,
  getCharAndLength,
  getCharAt,
  isEmptyArray,
  isFailure,
  isNewline,
  isNonEmptyArray,
  isSuccess,
  isWhitespace,
  nextPos,
  parse,
  safeExtractValue,
  unicodeLength,
} from "./utils";
export const parsers = {
  // Basic parsers
  any,
  anyChar,
  literal,
  lit,

  // Character class parsers
  charClass,

  // Combinators
  sequence,
  seq,
  choice,
  maybe,
  withDefault,
  reject,

  // Repetition parsers
  zeroOrMore,
  oneOrMore,
  optional,
  quantified,

  // Lookahead parsers
  andPredicate,
  notPredicate,
  and,
  not,

  // Capture parsers
  capture,
  captureSequence,
  captureChoice,

  // Transform parsers
  map,
  mapResult,
  mapError,
  filter,
  tap,
} as const;

/**
 * Namespaced utilities for better API organization.
 */
export const utils = {
  // Parse utilities
  parse,

  // Position utilities
  createPos,
  nextPos,
  advancePos,

  // Result utilities
  isSuccess,
  isFailure,
  extractValue,
  safeExtractValue,

  // Error utilities
  createFailure,
  formatParseError,
  formatParseResult,
  reportParseError,

  // Character utilities
  getCharAndLength,
  getCharAt,
  unicodeLength,
  isWhitespace,
  isNewline,

  // Array utilities
  isEmptyArray,
  isNonEmptyArray,
} as const;

/**
 * Namespaced combinators for better API organization.
 */
export const combinators = {
  sequence,
  seq,
  choice,
  maybe,
  withDefault,
  reject,
} as const;
