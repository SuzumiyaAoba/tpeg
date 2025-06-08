import type { Pos } from "./types";

/**
 * Test utility function to create a position object.
 *
 * @param offset The absolute offset from the start of the input (0-based)
 * @param line The line number (1-based), defaults to 1
 * @param column The column number (0-based). If not provided, defaults to offset
 * @returns Position object for testing
 */
export const createPos = (offset: number, line = 1, column?: number): Pos => ({
  offset,
  line,
  column: column ?? offset,
});
