import type { Pos } from "@suzumiyaaoba/tpeg-core";

/**
 * The starting position for parsing a string from the beginning.
 *
 * `Pos`'s fields are readonly and every demo here only ever reads from
 * this position (it's never mutated), so a single shared instance is
 * safe to reuse across all of them instead of each file redeclaring the
 * same `{ offset: 0, line: 1, column: 1 }` literal.
 */
export const initialPos: Pos = { offset: 0, line: 1, column: 1 };
