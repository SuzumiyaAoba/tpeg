/**
 * Test utility function to create a parser position.
 *
 * The threaded parser position is a plain offset (see `Parser` in
 * `./types.ts`) -- this is kept as a named function, rather than using
 * a bare number at every call site, purely for test readability
 * (`createTestPos(5)` reads as "position" where `5` alone wouldn't).
 *
 * @param offset The absolute offset from the start of the input (0-based)
 * @returns The offset, for use as a parser position in tests
 */
export const createTestPos = (offset: number): number => offset;
