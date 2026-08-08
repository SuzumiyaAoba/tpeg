/**
 * Shared, internal-only lookup table for the ASCII fast path of
 * `charClass`/`negatedCharClass`/`charClassRun` (`./char-class.ts`) and
 * `anyChar` (`./basic.ts`). Deliberately NOT re-exported from
 * `./index.ts` -- this is an implementation detail those four hot
 * leaves share, not public API surface.
 */

/**
 * `ASCII_CHARS[c]` is the pre-built 1-code-unit string for ASCII code
 * unit `c` (0-127), built once at module load. Every ASCII character
 * match then returns this shared instance instead of allocating a fresh
 * `String.fromCodePoint(c)` on every single character consumed --
 * unobservable to callers, since JS strings are immutable and compared
 * by value (nothing in this codebase relies on string identity).
 */
export const ASCII_CHARS: readonly string[] = Array.from(
  { length: 128 },
  (_, c) => String.fromCharCode(c),
);
