/**
 * Common parser utility functions for TPEG
 * 
 * This module provides reusable utility functions to handle common parsing patterns
 * and reduce code duplication throughout the parser implementation.
 */

import type { Parser } from "tpeg-core";

/**
 * Extract the first element from an optional array result, or return a default value
 * @param optArray Array result from optional parser (may be empty)
 * @param defaultValue Value to return if array is empty or first element is undefined
 * @returns First element or default value
 */
export const extractOptional = <T>(optArray: T[], defaultValue: T): T => 
  optArray[0] ?? defaultValue;

/**
 * Apply a function to the first element of an optional array, or return a default value
 * @param optArray Array result from optional parser (may be empty)
 * @param applyFn Function to apply to the first element if it exists
 * @param defaultValue Value to return if array is empty or first element is undefined
 * @returns Result of applying function or default value
 */
export const applyOptional = <T, R>(
  optArray: T[], 
  applyFn: (value: T) => R, 
  defaultValue: R
): R => optArray[0] ? applyFn(optArray[0]) : defaultValue;

/**
 * Helper function to handle optional parser results that wrap values in arrays
 * Extracts the wrapped value or returns empty string for common string cases
 * @param optionalResult Result from optional parser
 * @returns Extracted string value or empty string
 */
export const extractOptionalString = (optionalResult: string[]): string =>
  extractOptional(optionalResult, "");

/**
 * Helper function to safely extract array elements with proper bounds checking
 * Useful for avoiding magic number destructuring patterns
 * @param array Array to extract from
 * @param index Index to extract
 * @returns Element at index or undefined
 */
export const safeArrayAccess = <T>(array: readonly T[], index: number): T | undefined =>
  index >= 0 && index < array.length ? array[index] : undefined;

/**
 * Helper to create a parser that always succeeds with a default value
 * @param defaultValue Value to return on success
 * @returns Parser that always succeeds
 */
export const succeed = <T>(defaultValue: T): Parser<T> => 
  () => ({
    success: true,
    val: defaultValue,
    current: { offset: 0, line: 1, column: 1 },
    next: { offset: 0, line: 1, column: 1 },
  });

/**
 * Helper to create a parser that always fails with a specific error message
 * @param message Error message
 * @returns Parser that always fails
 */
export const fail = <T>(message: string): Parser<T> => 
  (input, pos) => ({
    success: false,
    error: {
      message,
      pos,
      expected: undefined,
      found: input[pos.offset],
    },
  });

/**
 * Type guard to check if a value is a non-empty array
 * @param value Value to check
 * @returns True if value is a non-empty array
 */
export const isNonEmptyArray = <T>(value: T[]): value is [T, ...T[]] =>
  Array.isArray(value) && value.length > 0;

/**
 * Type guard to check if a value is an empty array
 * @param value Value to check
 * @returns True if value is an empty array
 */
export const isEmptyArray = <T>(value: T[]): value is [] =>
  Array.isArray(value) && value.length === 0;