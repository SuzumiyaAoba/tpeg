import type { NonEmptyArray, NonEmptyString, Parser } from "./types";
import { createFailure, getCharAt, nextPos } from "./utils";

/**
 * Represents a character class specification - either a single character or a range
 */
type CharClassSpec = NonEmptyString | [NonEmptyString, NonEmptyString];

/**
 * Converts a character class specification to a readable string representation
 * @param charOrRange Character or character range specification
 * @returns String representation for display purposes
 */
const classToString = (charOrRange: CharClassSpec): string => {
  if (typeof charOrRange === "string") {
    return charOrRange;
  }
  return `${charOrRange[0]}-${charOrRange[1]}`;
};

/** A single character is just the degenerate range `[cp, cp]` -- folding
 * both spec shapes into one uniform `{start, end}` pair removes a branch
 * from the hot per-character match loop below and lets a single char
 * participate in the same code-point range check a `["a","z"]` pair
 * does, with no separate string-equality path to keep in sync with it. */
interface CompiledSpec {
  readonly start: number;
  readonly end: number;
}

/**
 * Pre-compiles character class specifications into code-point ranges for
 * high performance.
 */
const compileSpecs = (charOrRanges: readonly CharClassSpec[]): CompiledSpec[] =>
  charOrRanges.map((spec) => {
    if (typeof spec === "string") {
      const code = spec.codePointAt(0) ?? 0;
      return { start: code, end: code };
    }
    const startCode = spec[0].codePointAt(0) ?? 0;
    const endCode = spec[1].codePointAt(0) ?? 0;
    return { start: startCode, end: endCode };
  });

/**
 * Checks whether a code point matches any of the compiled specifications.
 * A plain `for` loop rather than `.some()` -- avoids the extra closure
 * `.some()`'s callback allocates on every call and the megamorphic
 * property access `.some()` incurs iterating a mixed-shape array (moot
 * now that every element has the same shape, but a plain loop is still
 * the cheaper iteration form for a function called once per character).
 */
const matchesSpecsSlow = (
  charCode: number,
  compiledSpecs: readonly CompiledSpec[],
): boolean => {
  for (let i = 0; i < compiledSpecs.length; i++) {
    const spec = compiledSpecs[i] as CompiledSpec;
    if (charCode >= spec.start && charCode <= spec.end) return true;
  }
  return false;
};

/**
 * Builds a 128-entry ASCII membership table from `compiledSpecs`, once at
 * `charClass`/`negatedCharClass` construction time: `table[code] === 1`
 * iff code point `code` (0-127) matches some spec. Every ASCII input
 * character then costs one array lookup instead of a scan over
 * `compiledSpecs`; only a non-ASCII code point falls through to
 * `matchesSpecsSlow`. Built here (in `tpeg-core`, where `charClass`
 * itself lives) rather than reusing `packages/parser/src/
 * performance-utils.ts`'s `createCharClassLookup` -- that function is
 * unreachable dead code in `tpeg-parser`, and CLAUDE.md's dependency
 * graph has no core -> parser edge to reuse it across anyway.
 */
const buildAsciiTable = (
  compiledSpecs: readonly CompiledSpec[],
): Uint8Array => {
  const table = new Uint8Array(128);
  for (let code = 0; code < 128; code++) {
    table[code] = matchesSpecsSlow(code, compiledSpecs) ? 1 : 0;
  }
  return table;
};

const matchesSpecs = (
  charCode: number,
  compiledSpecs: readonly CompiledSpec[],
  asciiTable: Uint8Array,
): boolean =>
  charCode < 128
    ? asciiTable[charCode] === 1
    : matchesSpecsSlow(charCode, compiledSpecs);

/**
 * Parser that matches a character against a set of characters or character ranges.
 *
 * @param charOrRanges Array of characters or character ranges to match against
 * @param parserName Optional name for error reporting and debugging
 * @returns Parser<string> A parser that succeeds if the input character matches any of the given ranges.
 * @example
 *   const digit = charClass(["0", "9"]); // matches any digit
 *   const vowel = charClass("a", "e", "i", "o", "u"); // matches any vowel
 *   const alphaNumeric = charClass(["a", "z"], ["A", "Z"], ["0", "9"]); // matches alphanumeric
 */
export const charClass = (
  ...charOrRanges: NonEmptyArray<CharClassSpec>
): Parser<string> => {
  const expected = charOrRanges.map(classToString).join(", ");
  const compiledSpecs = compileSpecs(charOrRanges);
  const asciiTable = buildAsciiTable(compiledSpecs);

  return (input: string, pos: number) => {
    const char = getCharAt(input, pos);

    if (!char) {
      return createFailure(
        `Unexpected end of input, expected one of: ${expected}`,
        pos,
        {
          expected,
          found: "end of input",
          parserName: "charClass",
        },
      );
    }

    const charCode = char.codePointAt(0) ?? 0;

    if (matchesSpecs(charCode, compiledSpecs, asciiTable)) {
      return {
        success: true,
        val: char,
        current: pos,
        next: nextPos(char, pos),
      } as const;
    }

    return createFailure(
      `Unexpected character "${char}", expected one of: ${expected}`,
      pos,
      {
        expected,
        found: char,
        parserName: "charClass",
      },
    );
  };
};

/**
 * Parser that matches a character NOT belonging to a set of characters or character ranges
 * (the runtime counterpart of a PEG negated character class, e.g. `[^a-z]`).
 *
 * @param charOrRanges Array of characters or character ranges to exclude
 * @returns Parser<string> A parser that succeeds with the current character if it matches none of the given ranges.
 * @example
 *   const notDigit = negatedCharClass(["0", "9"]); // matches any non-digit character
 */
export const negatedCharClass = (
  ...charOrRanges: NonEmptyArray<CharClassSpec>
): Parser<string> => {
  const expected = `not one of: ${charOrRanges.map(classToString).join(", ")}`;
  const compiledSpecs = compileSpecs(charOrRanges);
  const asciiTable = buildAsciiTable(compiledSpecs);

  return (input: string, pos: number) => {
    const char = getCharAt(input, pos);

    if (!char) {
      return createFailure(
        `Unexpected end of input, expected ${expected}`,
        pos,
        {
          expected,
          found: "end of input",
          parserName: "negatedCharClass",
        },
      );
    }

    const charCode = char.codePointAt(0) ?? 0;

    if (matchesSpecs(charCode, compiledSpecs, asciiTable)) {
      return createFailure(
        `Unexpected character "${char}", expected ${expected}`,
        pos,
        {
          expected,
          found: char,
          parserName: "negatedCharClass",
        },
      );
    }

    return {
      success: true,
      val: char,
      current: pos,
      next: nextPos(char, pos),
    } as const;
  };
};
