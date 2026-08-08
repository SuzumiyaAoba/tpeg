import { ASCII_CHARS } from "./char-tables";
import type { Expectation } from "./failure";
import { fail } from "./failure";
import type { NonEmptyArray, NonEmptyString, Parser } from "./types";

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
 * `charClass`/`negatedCharClass`/`charClassRun` construction time:
 * `table[code] === 1` iff code point `code` (0-127) matches some spec.
 * Every ASCII input character then costs one array lookup instead of a
 * scan over `compiledSpecs`; only a non-ASCII code point falls through to
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

/**
 * Shared hot path for `charClass` and `negatedCharClass`: one `table`
 * (membership, NOT complemented) plus a `negated` flag rather than two
 * separately-built tables/bodies, so the two combinators can never drift
 * apart. `hit !== negated` gives the right success condition either way
 * -- `charClass` (`negated=false`) succeeds when `hit`, `negatedCharClass`
 * (`negated=true`) succeeds when `!hit`.
 *
 * The failure path allocates and decodes NOTHING: `charCodeAt` is read
 * before any string is built, the bounds check happens before that, and
 * a non-matching ASCII code point returns the `FAIL` singleton (via
 * `fail()`) having touched only a `Uint8Array` index. Only a successful
 * match -- ASCII or not -- ever builds the result string.
 */
const makeCharClassParser =
  (
    compiledSpecs: readonly CompiledSpec[],
    asciiTable: Uint8Array,
    negated: boolean,
    expectation: Expectation,
  ): Parser<string> =>
  (input: string, pos: number) => {
    // One bounds compare, before any decode. `(pos >>> 0)` folds the
    // negative-offset guard `getCharAt` used to do into the same
    // compare (a negative `pos` becomes a huge unsigned value, which is
    // always >= any real `input.length`), and keeps `pos` in Smi range
    // for the `charCodeAt` below.
    if (pos >>> 0 >= input.length) return fail(input, pos, expectation);

    const code = input.charCodeAt(pos);

    if (code < 128) {
      // ASCII: one table lookup, one pre-built shared string on
      // success, zero allocation on failure.
      if ((asciiTable[code] === 1) !== negated) {
        return {
          success: true,
          val: ASCII_CHARS[code] as string,
          current: pos,
          next: pos + 1,
        };
      }
      return fail(input, pos, expectation);
    }

    // Non-ASCII (cold path). `codePointAt` decodes a surrogate pair when
    // one is actually present and leaves an unpaired lead/trail
    // surrogate as its own code unit's value -- exactly what the old
    // `getCharAt` (via `String.fromCodePoint` + a re-decode) produced,
    // without allocating a string just to test membership.
    const cp = input.codePointAt(pos) as number;
    const len = cp > 0xffff ? 2 : 1;
    if (matchesSpecsSlow(cp, compiledSpecs) !== negated) {
      return {
        success: true,
        // `slice` reproduces the input's own text exactly -- for a
        // well-formed pair and for a lone surrogate alike -- without a
        // decode/re-encode round trip.
        val: input.slice(pos, pos + len),
        current: pos,
        next: pos + len,
      };
    }
    return fail(input, pos, expectation);
  };

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
  // One `Expectation` per `charClass(...)` call (construction time), not
  // per attempted match -- see `./failure.ts`'s `Expectation` doc comment.
  const expectation: Expectation = { label: expected, parserName: "charClass" };

  return makeCharClassParser(compiledSpecs, asciiTable, false, expectation);
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
  const expectation: Expectation = {
    label: expected,
    parserName: "negatedCharClass",
  };

  return makeCharClassParser(compiledSpecs, asciiTable, true, expectation);
};

/**
 * `zeroOrMore(charClass(...specs))` (`min = 0`) or `oneOrMore(charClass(...specs))`
 * (`min = 1`), collapsed into a single scan: one `ParseSuccess`, one
 * exact-size result array, no per-character closure call and no
 * per-character `ParseSuccess` the way `zeroOrMore`/`oneOrMore` driving
 * `charClass`/`negatedCharClass` one character at a time would produce.
 *
 * Returns EXACTLY the array `zeroOrMore`/`oneOrMore` over the same class
 * returns -- one 1-code-point string per code point consumed, in the
 * same order -- so it is a drop-in replacement at any site that
 * observes the value (a label, an action, a transform, or a rule's own
 * return value). Code-point correct: an astral character is one array
 * element and advances the offset by 2 code units, exactly like the
 * per-character combinators.
 *
 * This is sound as a single-scan replacement specifically BECAUSE a PEG
 * `*`/`+` is possessive: once a maximal run of matching characters has
 * been consumed, nothing can ever cause backtracking to give any of them
 * back (unlike a greedy regex quantifier -- see `packages/parser/src/
 * regex-fusion.ts`'s module doc for the case where sealing a repetition
 * into its own atomic unit is NOT sound, which is a different construct
 * entirely: a JS `RegExp`, not this plain scan-and-return).
 *
 * @param specs - Same character-or-range specs `charClass`/`negatedCharClass` take.
 * @param min - `0` for a `Star`-shaped run (always succeeds), `1` for a `Plus`-shaped run (fails on zero matches).
 * @param negated - `true` to run over the specs' complement (mirrors `negatedCharClass`). Defaults to `false`.
 * @param parserName - Optional name for error reporting and debugging.
 */
export const charClassRun = (
  specs: NonEmptyArray<CharClassSpec>,
  min: 0 | 1,
  negated = false,
  parserName = negated ? "negatedCharClassRun" : "charClassRun",
): Parser<string[]> => {
  const expected = `${negated ? "not one of: " : ""}${specs.map(classToString).join(", ")}`;
  const compiledSpecs = compileSpecs(specs);
  const asciiTable = buildAsciiTable(compiledSpecs);
  const expectation: Expectation = { label: expected, parserName };

  return (input: string, pos: number) => {
    // Pass 1: scan to find the run's end offset and code-point count.
    // Touches no heap at all -- pure index arithmetic over `input`, one
    // `charCodeAt`/`codePointAt` per code point, no intermediate string.
    let offset = pos;
    let count = 0;
    while (offset < input.length) {
      const code = input.charCodeAt(offset);
      if (code < 128) {
        if ((asciiTable[code] === 1) !== negated) {
          offset += 1;
          count += 1;
          continue;
        }
        break;
      }
      const cp = input.codePointAt(offset) as number;
      if (matchesSpecsSlow(cp, compiledSpecs) !== negated) {
        offset += cp > 0xffff ? 2 : 1;
        count += 1;
        continue;
      }
      break;
    }

    if (count === 0) {
      if (min === 1) return fail(input, pos, expectation);
      return { success: true, val: [], current: pos, next: pos };
    }

    // Pass 2: fill an exact-size array by re-walking the same span --
    // cheaper than push()-ing into a growing array one element at a
    // time, and the span was already proven valid by pass 1 so this
    // walk cannot itself fail or diverge from it.
    const results = new Array<string>(count);
    let p = pos;
    for (let i = 0; i < count; i++) {
      const code = input.charCodeAt(p);
      if (code < 128) {
        results[i] = ASCII_CHARS[code] as string;
        p += 1;
        continue;
      }
      const cp = input.codePointAt(p) as number;
      const len = cp > 0xffff ? 2 : 1;
      results[i] = input.slice(p, p + len);
      p += len;
    }

    return { success: true, val: results, current: pos, next: p };
  };
};
