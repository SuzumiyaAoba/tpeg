/**
 * Shared test utilities for TPEG parser tests
 *
 * Deliberately tiny: this module used to carry a dozen helpers
 * (`expectSuccess`/`expectFailure`, `createSuccessTestCases`, `TEST_INPUTS`,
 * ...) that no spec ever imported, while several specs each re-defined the
 * one helper they actually needed (`testParse`) locally. What remains is
 * exactly what the specs use.
 */

import type { ParseResult, Parser } from "@suzumiyaaoba/tpeg-core";
import { parse } from "@suzumiyaaoba/tpeg-core";

/**
 * Create a test position at a specific offset
 * @param offset Character offset in input
 * @returns The offset, for use as a parser position in tests
 */
export const createPositionAt = (offset: number): number => offset;

/**
 * Parse input with the given parser - simplified test interface
 * @param parser Parser to use
 * @param input Input string to parse
 * @returns Parse result
 */
export const testParse = <T>(
  parser: Parser<T>,
  input: string,
): ParseResult<T> => parse(parser)(input);
