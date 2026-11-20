import { ASCII_CHARS } from "./char-tables";
import { escapeControlCharsForDisplay, safeStringForDisplay } from "./escape";
import type { Expectation } from "./failure";
import { fail } from "./failure";
import type { NonEmptyArray, NonEmptyString, Parser } from "./types";
import { getSingleCodePoint, isValidOffset } from "./utils";

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
  // Display-only (an `Expectation` label): control characters escaped
  // so a class like `[\x00-\x1f]` doesn't splice raw control bytes into
  // the error message -- see `escapeControlCharsForDisplay`.
  if (typeof charOrRange === "string") {
    return escapeControlCharsForDisplay(charOrRange);
  }
  return `${escapeControlCharsForDisplay(charOrRange[0])}-${escapeControlCharsForDisplay(charOrRange[1])}`;
};

/** Inclusive Unicode code-point bounds for one character-class member. */
export interface CodePointInterval {
  readonly lo: number;
  readonly hi: number;
}

/** Decode a literal member or range once, before matching or generating code. */
export function compileCharRange(
  start: string,
  end?: string,
): CodePointInterval {
  const lo = getSingleCodePoint(start);
  const hi = end === undefined ? lo : getSingleCodePoint(end);
  if (lo === undefined || hi === undefined) {
    const bound = lo === undefined ? start : end;
    throw new Error(
      `Invalid character class range bound: ${JSON.stringify(bound)} is not exactly one character`,
    );
  }
  if (lo > hi) {
    throw new Error(
      `Invalid character class range: [${JSON.stringify(start)}, ${JSON.stringify(end)}] -- start (U+${lo.toString(16).toUpperCase()}) is greater than end (U+${hi.toString(16).toUpperCase()})`,
    );
  }
  return { lo, hi };
}

const compileSpecs = (specs: readonly CharClassSpec[]): CodePointInterval[] =>
  specs.map((spec) => {
    if (typeof spec === "string") return compileCharRange(spec);
    const [start, end] = spec;
    if (end === undefined)
      throw new TypeError("Invalid character class range: missing end bound");
    return compileCharRange(start, end);
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
  compiledSpecs: readonly CodePointInterval[],
): boolean => {
  for (let i = 0; i < compiledSpecs.length; i++) {
    const spec = compiledSpecs[i] as CodePointInterval;
    if (charCode >= spec.lo && charCode <= spec.hi) return true;
  }
  return false;
};

/** Build the ASCII fast path once. TypedArray.fill clips each range at 128. */
const buildAsciiTable = (
  intervals: readonly CodePointInterval[],
): Uint8Array => {
  const table = new Uint8Array(128);
  for (const { lo, hi } of intervals) {
    if (lo < table.length) table.fill(1, lo, hi + 1);
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
    compiledSpecs: readonly CodePointInterval[],
    asciiTable: Uint8Array,
    negated: boolean,
    expectation: Expectation,
  ): Parser<string> =>
  (input: string, pos: number) => {
    // One validity+bounds pair of compares, before any decode.
    // `isValidOffset` (`./utils.ts`) first: `(pos >>> 0)` alone folds a
    // negative `pos` into a huge unsigned value (always >= any real
    // `input.length`) but lets a fractional/`NaN`/`>= 2**32` `pos`
    // through to `charCodeAt`/`codePointAt`, which coerce the index
    // (truncate/`NaN`) and used to return bogus successes like
    // `{ current: 0.5, next: 1.5 }`. Then the ordinary bounds compare,
    // which keeps `pos` in Smi range for the `charCodeAt` below.
    if (!isValidOffset(pos) || pos >= input.length) {
      return fail(input, pos, expectation);
    }

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
 * result array, no per-character closure call and no
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
 * @throws {Error} If `min` is neither 0 nor 1.
 */
export const charClassRun = (
  specs: NonEmptyArray<CharClassSpec>,
  min: 0 | 1,
  negated = false,
  parserName = negated ? "negatedCharClassRun" : "charClassRun",
): Parser<string[]> => {
  if (min !== 0 && min !== 1) {
    throw new Error(
      `Invalid character class run minimum (${safeStringForDisplay(min)}): expected 0 or 1`,
    );
  }
  const expected = `${negated ? "not one of: " : ""}${specs.map(classToString).join(", ")}`;
  const compiledSpecs = compileSpecs(specs);
  const asciiTable = buildAsciiTable(compiledSpecs);
  const expectation: Expectation = { label: expected, parserName };

  return (input: string, pos: number) => {
    // Same validity+bounds guard pair as `makeCharClassParser` above
    // (see its own comment), split into two branches here because
    // reaching end-of-input legitimately produces an empty run (`min =
    // 0`) rather than a failure, while an out-of-contract `pos` must
    // always fail. Without the `isValidOffset` half, a negative `pos`
    // would reach the `while` loop below with `offset < input.length`
    // vacuously true, and `charCodeAt`/`codePointAt` at a negative index
    // return `NaN`/`undefined` -- which, under `negated = true`, satisfies
    // `matchesSpecsSlow(undefined, ...) !== true` as a "match", walking
    // `offset` further negative and returning garbage from
    // `input.slice(pos, ...)`; a fractional/`NaN`/`>= 2**32` `pos`
    // slipped past `(pos >>> 0)`'s negative-fold the same way it did in
    // `makeCharClassParser`. Unreachable via the public `parse()` entry
    // point (which never calls a parser with `pos < 0`), but every other
    // leaf parser in this file enforces it regardless of caller.
    if (!isValidOffset(pos) || pos > input.length) {
      return fail(input, pos, expectation);
    }
    const results: string[] = [];
    let offset = pos;
    while (offset < input.length) {
      const code = input.charCodeAt(offset);
      if (code < 128) {
        if ((asciiTable[code] === 1) === negated) break;
        results.push(ASCII_CHARS[code] as string);
        offset++;
      } else {
        const cp = input.codePointAt(offset) as number;
        if (matchesSpecsSlow(cp, compiledSpecs) === negated) break;
        const end = offset + (cp > 0xffff ? 2 : 1);
        results.push(input.slice(offset, end));
        offset = end;
      }
    }
    if (offset === pos && min === 1) return fail(input, pos, expectation);
    return { success: true, val: results, current: pos, next: offset };
  };
};
