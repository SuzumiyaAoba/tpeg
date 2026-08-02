import type { ParseError, ParseResult, Parser, Pos } from "./types";
import { createFailure, isFailure, prependContext } from "./utils";

/** How many distinct expectations `error` carries -- used by `choice` to
 * break ties between two failures at the same (farthest) offset. */
const expectedRichness = (error: ParseError): number =>
  Array.isArray(error.expected)
    ? error.expected.length
    : error.expected
      ? 1
      : 0;

/** Adds `error`'s expectation(s) to `target`. Module-level (not a closure
 * over `choice`'s per-call state) so it isn't reallocated on every parse. */
const mergeExpectedInto = (target: Set<string>, error: ParseError): void => {
  if (!error.expected) return;
  if (Array.isArray(error.expected)) {
    for (const exp of error.expected) {
      target.add(exp);
    }
  } else {
    target.add(error.expected);
  }
};

/**
 * Shared ordered-choice trial loop: tries `parsers[i](input, pos)` in
 * order, returning the first success as-is (no allocation on this path),
 * stopping early and absorbing a `fatal` failure's flag at this call's own
 * boundary (see `commit`'s doc comment -- a cut is scoped to its own
 * enclosing choice, not forwarded to whatever encloses THIS one), or --
 * if every candidate fails without any being fatal -- aggregating a single
 * "none of the parsers matched" failure from the farthest-offset failure
 * (with an `expectedRichness` tiebreak at equal offsets).
 *
 * Used by both {@link choice} and {@link predictiveChoice}: the two differ
 * only in how they narrow `parsers` down from a full alternative list
 * before calling this (`predictiveChoice` via a precomputed FIRST-set
 * dispatch table, `choice` not at all) -- cut/commit semantics and
 * farthest-error aggregation must behave identically either way, so they
 * live in exactly one place rather than two copies that could drift.
 */
const tryOrderedCandidates = <T>(
  parsers: readonly Parser<T>[],
  input: string,
  pos: Pos,
  parserName: string,
): ParseResult<T> => {
  let expectedSet: Set<string> | null = null;
  let farthestError: ParseError | null = null;

  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i];
    if (!parser) {
      return createFailure(`Parser at index ${i} is undefined`, pos, {
        parserName,
      });
    }
    const result = parser(input, pos);

    if (result.success) {
      return result;
    }

    if (isFailure(result)) {
      if (result.error.fatal) {
        return {
          success: false,
          error: { ...result.error, fatal: false },
        } as const;
      }

      const error = result.error;
      if (!farthestError || error.pos.offset > farthestError.pos.offset) {
        farthestError = error;
        expectedSet = null;
        if (error.expected) {
          expectedSet = new Set();
          mergeExpectedInto(expectedSet, error);
        }
      } else if (error.pos.offset === farthestError.pos.offset) {
        if (error.expected) {
          if (!expectedSet) expectedSet = new Set();
          mergeExpectedInto(expectedSet, error);
        }
        if (expectedRichness(error) > expectedRichness(farthestError)) {
          farthestError = error;
        }
      }
    }
  }

  // Rebind through a fresh `const` after the loop: some TS versions'
  // control-flow analysis over a `let` reassigned across branches inside a
  // loop narrows it to `never` by this point otherwise.
  const finalFarthestError: ParseError | null = farthestError;
  const expected = expectedSet ? Array.from(expectedSet) : [];
  const found = finalFarthestError?.found;

  const customMessage = `None of the parsers matched. ${
    expected.length > 0
      ? `Expected one of: ${expected.join(", ")}`
      : "No expectations provided"
  }`;

  return createFailure(customMessage, finalFarthestError?.pos ?? pos, {
    parserName,
    ...(expected.length > 0 && { expected }),
    ...(found !== undefined && { found }),
  });
};

/**
 * Parser that parses a sequence of parsers in order.
 *
 * Executes each parser in the given sequence and returns an array of all results.
 * If any parser fails, the entire sequence fails at that position.
 *
 * @template P Array of parsers
 * @param parsers Array of parsers to run in sequence
 * @returns Parser that succeeds if all parsers succeed in sequence, returning a tuple of all results
 *
 * @example
 * ```typescript
 * const parser = sequence(literal("hello"), literal(" "), literal("world"));
 * const result = parser("hello world", 0);
 * // result.val will be ["hello", " ", "world"]
 * ```
 *
 * @example
 * ```typescript
 * // Parse a number followed by a plus sign followed by another number
 * const addExpr = sequence(number, literal("+"), number);
 * const result = addExpr("42+37", 0);
 * // result.val will be [42, "+", 37]
 * ```
 */
export const sequence = <P extends Parser<unknown>[]>(
  ...parsers: P
): Parser<{ [K in keyof P]: P[K] extends Parser<infer T> ? T : never }> => {
  const sequenceParser = (input: string, pos: Pos) => {
    if (parsers.length === 0) {
      return {
        success: true,
        val: [] as {
          [K in keyof P]: P[K] extends Parser<infer T> ? T : never;
        },
        current: pos,
        next: pos,
      } as const;
    }

    const result: unknown[] = [];
    let currentPos = pos;

    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      if (!parser) {
        return createFailure(`Parser at index ${i} is undefined`, pos, {
          parserName: "sequence",
        });
      }
      const parserResult = parser(input, currentPos);

      if (isFailure(parserResult)) {
        return createFailure(
          `Failed to parse sequence at element ${i}: ${parserResult.error.message}`,
          parserResult.error.pos,
          {
            ...parserResult.error,
            context: prependContext("in sequence", parserResult.error.context),
            parserName: "sequence",
          },
        );
      }

      result.push(parserResult.val);
      currentPos = parserResult.next;
    }

    return {
      success: true as const,
      val: result as {
        [K in keyof P]: P[K] extends Parser<infer T> ? T : never;
      },
      current: pos,
      next: currentPos,
    };
  };

  return sequenceParser;
};

/**
 * Alias for {@link sequence}.
 *
 * Provides a shorter name for the sequence combinator. Behaves identically to `sequence`.
 *
 * @template P Array of parsers
 * @param parsers Array of parsers to run in sequence
 * @returns Parser that succeeds if all parsers succeed in sequence, returning a tuple of all results
 * @see sequence
 *
 * @example
 * ```typescript
 * const parser = seq(literal("("), expr, literal(")"));
 * // Equivalent to: sequence(literal("("), expr, literal(")"))
 * ```
 */
export const seq = sequence;

/**
 * Cut/commit combinator: wraps `parser` so that, if it fails, the failure
 * is marked `fatal` (see `ParseError.fatal` in types.ts). This is the
 * runtime primitive behind the grammar's `~` cut operator (a `Sequence`
 * containing `~` compiles to `sequence(before..., commit(sequence(after...)))`
 * -- see `packages/parser/src/codegen.ts`'s `generateSequence`), but it's
 * also usable directly by hand-written parsers.
 *
 * `choice`/`captureChoice` stop trying further alternatives the moment one
 * produces a `fatal` failure, instead of backtracking to the next one; the
 * fatal flag survives being wrapped by `sequence`/`captureSequence` (they
 * either return the child failure unchanged or spread its fields), so it
 * propagates up through every enclosing `Sequence`/`Choice` until it either
 * reaches a `choice`/`captureChoice` that stops there, or the top of the
 * parse. `optional`/`zeroOrMore`/`oneOrMore`/`quantified` (repetition.ts)
 * also re-raise a fatal failure rather than treating it as "no match".
 *
 * @example
 * ```typescript
 * // Once "if" has matched, a failure to parse a condition is fatal --
 * // callers won't backtrack into trying an unrelated alternative.
 * const ifStmt = seq(literal("if"), commit(seq(condition, literal("then"), body)));
 * const stmt = choice(ifStmt, whileStmt, exprStmt);
 * ```
 */
export const commit =
  <T>(parser: Parser<T>): Parser<T> =>
  (input: string, pos: Pos) => {
    const result = parser(input, pos);
    if (isFailure(result)) {
      return {
        ...result,
        error: { ...result.error, fatal: true },
      };
    }
    return result;
  };

/**
 * Parser that attempts multiple parsers and returns the result of the first successful one.
 *
 * Tries each parser in order until one succeeds. If all parsers fail, returns a failure
 * with aggregated error information from all attempts.
 *
 * @template T Array of possible result types
 * @param parsers Array of parsers to try in order
 * @returns Parser that succeeds if any of the parsers succeed, returning the result of the first successful parser
 *
 * @example
 * ```typescript
 * const numberOrString = choice(
 *   number,           // Try to parse a number first
 *   quotedString,     // If that fails, try a quoted string
 *   identifier        // If that fails, try an identifier
 * );
 * ```
 *
 * @example
 * ```typescript
 * // Parse different types of literals
 * const booleanLiteral = choice(
 *   literal("true"),
 *   literal("false"),
 *   literal("null")
 * );
 * ```
 */
export const choice = <T extends unknown[]>(
  ...parsers: { [K in keyof T]: Parser<T[K]> }
): Parser<T[number]> => {
  if (parsers.length === 0) {
    const emptyChoiceParser = (_input: string, pos: Pos) =>
      createFailure("Empty choice", pos, { parserName: "choice" });
    return emptyChoiceParser;
  }

  const candidates = parsers as unknown as readonly Parser<T[number]>[];
  const choiceParser = (input: string, pos: Pos) =>
    tryOrderedCandidates(candidates, input, pos, "choice");

  return choiceParser;
};

/**
 * A statically-computed set of characters an alternative's match could
 * start with, as used by {@link predictiveChoice}. `ranges` is a sorted,
 * non-overlapping list of *inclusive Unicode code-point* intervals (a
 * single character is just `lo === hi`) -- there is no "negated" or
 * "unknown" flag here because a `null` filter (not a `FirstCharFilter`
 * value) is how a caller says "this alternative's FIRST set couldn't be
 * computed -- always attempt it" (see `packages/parser/src/first-sets.ts`
 * for how these are derived from a grammar, via that package's `CharSet`,
 * whose normalized `{lo, hi}` intervals are exactly this shape).
 *
 * Code points, not UTF-16 code units, so a match is checked with
 * `input.codePointAt(offset)` (see {@link firstCharFilterMatches}) rather
 * than `input[offset]` -- `codePointAt` decodes a surrogate pair into its
 * one astral code point automatically, so an astral range here is checked
 * *exactly*, with no over-approximation and no bail-out for surrogate
 * pairs (unlike the single-UTF-16-code-unit comparison this replaced).
 */
export interface FirstCharFilter {
  readonly ranges: readonly { readonly lo: number; readonly hi: number }[];
}

const firstCharFilterMatches = (
  filter: FirstCharFilter,
  codePoint: number,
): boolean => filter.ranges.some((r) => r.lo <= codePoint && codePoint <= r.hi);

const describeFirstCharFilter = (filter: FirstCharFilter): string => {
  const parts = filter.ranges.map((r) =>
    r.lo === r.hi
      ? `"${String.fromCodePoint(r.lo)}"`
      : `[${String.fromCodePoint(r.lo)}-${String.fromCodePoint(r.hi)}]`,
  );
  return parts.join(" or ");
};

/** The dispatch table only ever covers ASCII code UNITS (0-127), which
 * coincide 1:1 with ASCII code POINTS -- ASCII is a subset of both
 * encodings by definition, so a table entry can be looked up straight
 * from `input.charCodeAt(offset)` with no `codePointAt` decoding needed
 * for that fast path. Every code point at or above this is handled by the
 * non-ASCII fallback in {@link predictiveChoice}. */
const ASCII_TABLE_SIZE = 128;

/**
 * Predictive (FIRST-set-gated) variant of {@link choice}: before running
 * any alternative, checks the next input character against each
 * alternative's precomputed `FirstCharFilter` and skips any alternative
 * whose filter provably excludes that character -- it cannot possibly
 * match there, so running it would only reproduce a failure at `pos`
 * itself. A `null` filter means "unknown FIRST set" and is never skipped.
 *
 * This realizes FIRST-set-based predictive dispatch (the PEG-theory
 * optimization referenced in the project's performance plan) *without*
 * changing codegen's output format: it's an ordinary combinator call,
 * like `choice(...)`, not a generated `switch`. See
 * `packages/parser/src/first-sets.ts` for how a grammar's alternatives
 * are turned into `FirstCharFilter`s -- always a safe over-approximation
 * of a Choice alternative's possible FIRST characters (never a smaller
 * set than the truth), though the code-point-based matching itself (see
 * {@link firstCharFilterMatches}) is exact once a filter is computed --
 * see that module's doc comment on soundness.
 *
 * Ordered-choice semantics are fully preserved: surviving candidates are
 * tried via the same {@link tryOrderedCandidates} helper `choice` uses --
 * including its cut/commit and farthest-error-aggregation behavior --
 * in their original relative order, so which alternative wins on an input
 * where more than one's filter matches is unaffected by this filtering
 * step.
 *
 * ## Construction-time dispatch table, not a per-call filter
 *
 * All of the work that depends only on `alternatives` (never on a
 * specific parse) happens once, when `predictiveChoice(...)` is called --
 * typically once per grammar rule, at module load, not once per parse
 * attempt. This builds a 128-entry table indexed directly by ASCII code
 * unit, each entry a candidate-parser array pre-filtered for that one
 * code point; identical entries (extremely common -- e.g. every digit
 * `'0'`-`'9'` usually admits the same candidates) share a single array
 * instance rather than each getting their own. The per-parse hot path for
 * an ASCII input character is then just an array index and a call into
 * {@link tryOrderedCandidates} over an already-built array -- no
 * `.filter()`/`.map()`, no new array, no new closure, on every parse.
 *
 * Non-ASCII code points (U+0080 and above, including astral/surrogate-
 * pair characters) are rare enough in most grammars' hot paths that they
 * fall back to a per-call `.filter()` over a precomputed *reduced*
 * candidate-index list (alternatives whose filter is `null` or has any
 * range reaching into non-ASCII) rather than a full 0x10FFFF-entry table
 * (infeasible to build) or a per-call re-scan of every alternative. Uses
 * `input.codePointAt(offset)` (not `input[offset]`/`charCodeAt`), which is
 * required for correctness here -- see this module's `FirstCharFilter`
 * doc comment and `firstCharFilterMatches` for why a UTF-16-code-unit
 * comparison would silently mismatch a surrogate pair.
 *
 * ## Failure diagnostics differ from `choice`
 *
 * If a character is provided (not EOF) and it matches zero alternatives'
 * filters, this returns an immediate, precise failure whose `expected`
 * lists every alternative's filter (not just the ones that would have
 * been tried, since none were) -- more informative than running each and
 * aggregating their errors would be, and cheaper. That `expected` list is
 * itself precomputed once at construction (it doesn't depend on which
 * character actually failed to match), so a failing call only has to
 * attach the position-specific `found` value.
 *
 * If at least one alternative survives filtering but all of them still
 * fail, the failure comes from `tryOrderedCandidates`'s usual farthest-
 * error aggregation over *only the surviving candidates*. A skipped
 * alternative's hypothetical failure (it would have failed at `pos`
 * itself, immediately, since its filter proved it can't start there) is
 * never farther than a surviving candidate's failure, *unless* a
 * surviving candidate also fails at `pos` with zero progress -- in that
 * exact tie, this function's `expected` will be missing the skipped
 * alternatives' filter chars, a narrower diagnostic than plain `choice`
 * would give in the same spot. This never affects whether a parse
 * succeeds or where it stops, only the completeness of an error message
 * in that one narrow case; deliberately accepted rather than paying to
 * pre-seed `expected` from every skipped alternative on every call.
 */
export const predictiveChoice = <T extends unknown[]>(
  alternatives: readonly (readonly [
    Parser<T[number]>,
    FirstCharFilter | null,
  ])[],
): Parser<T[number]> => {
  if (alternatives.length === 0) {
    const emptyPredictiveChoiceParser = (_input: string, pos: Pos) =>
      createFailure("Empty choice", pos, { parserName: "predictiveChoice" });
    return emptyPredictiveChoiceParser;
  }

  // ---- everything below runs once per `predictiveChoice(...)` call ----

  const parsers = alternatives.map(([p]) => p);

  // Every alternative, unfiltered: what EOF (no character to filter by)
  // and an all-`null`-filter fast path both fall back to. Reusing one
  // shared array rather than allocating `alternatives.map(([p]) => p)`
  // again is itself a small win, but the main point is avoiding a fresh
  // `.filter()` on every such call.
  const allCandidates: readonly Parser<T[number]>[] = parsers;

  const asciiTable: (readonly Parser<T[number]>[])[] = new Array(
    ASCII_TABLE_SIZE,
  );
  const dedupedByKey = new Map<string, readonly Parser<T[number]>[]>();
  for (let code = 0; code < ASCII_TABLE_SIZE; code++) {
    let key = "";
    const candidates: Parser<T[number]>[] = [];
    for (let i = 0; i < alternatives.length; i++) {
      const filter = (alternatives[i] as (typeof alternatives)[number])[1];
      if (!filter || firstCharFilterMatches(filter, code)) {
        candidates.push(parsers[i] as Parser<T[number]>);
        key += `${i},`;
      }
    }
    const shared = dedupedByKey.get(key);
    if (shared) {
      asciiTable[code] = shared;
    } else {
      dedupedByKey.set(key, candidates);
      asciiTable[code] = candidates;
    }
  }

  // The reduced candidate set for the non-ASCII fallback: an alternative
  // can be skipped here only if its filter provably excludes EVERY
  // non-ASCII code point (i.e. every one of its ranges tops out below
  // `ASCII_TABLE_SIZE`) -- the exact per-character check against this
  // narrowed set still happens at call time, since "could match some
  // non-ASCII code point" doesn't mean "matches this one".
  const nonAsciiAlternatives = alternatives.filter(
    ([, filter]) =>
      !filter || filter.ranges.some((r) => r.hi >= ASCII_TABLE_SIZE),
  );
  // If nothing can be ruled out for non-ASCII input, skip the per-call
  // filter entirely and reuse `allCandidates` (common: most grammars'
  // filters are ASCII literals/ranges with no non-ASCII-excluding filter
  // at all, i.e. every alternative here is either `null` or already
  // unbounded above -- in which case this list equals `alternatives`).
  const nonAsciiFallbackNeeded =
    nonAsciiAlternatives.length < alternatives.length;

  // Precomputed once: every alternative's filter, described for the
  // "none of the parsers matched" error -- doesn't depend on which
  // character actually failed, so it's wasted work to rebuild this list
  // on every failing call.
  const describedFilters = alternatives
    .map(([, filter]) => (filter ? describeFirstCharFilter(filter) : null))
    .filter((d): d is string => d !== null);

  const noCandidatesFailure = (
    pos: Pos,
    codePoint: number,
  ): ParseResult<T[number]> =>
    createFailure(
      `None of the parsers matched. Expected one of: ${describedFilters.join(", ")}`,
      pos,
      {
        parserName: "predictiveChoice",
        ...(describedFilters.length > 0 && { expected: describedFilters }),
        found: String.fromCodePoint(codePoint),
      },
    );

  const predictiveChoiceParser = (
    input: string,
    pos: Pos,
  ): ParseResult<T[number]> => {
    if (pos.offset >= input.length) {
      // EOF: no character to filter by, so every alternative is
      // attempted -- matches `choice`'s own behavior on an empty match
      // attempt at end of input.
      return tryOrderedCandidates(
        allCandidates,
        input,
        pos,
        "predictiveChoice",
      );
    }

    const code = input.charCodeAt(pos.offset);
    if (code < ASCII_TABLE_SIZE) {
      const candidates = asciiTable[code] as readonly Parser<T[number]>[];
      if (candidates.length === 0) {
        return noCandidatesFailure(pos, code);
      }
      return tryOrderedCandidates(candidates, input, pos, "predictiveChoice");
    }

    // Non-ASCII: decode the full code point (correct for a surrogate
    // pair) and, only if some alternative's filter could actually
    // exclude it, filter the reduced candidate list exactly.
    const codePoint = input.codePointAt(pos.offset) as number;
    if (!nonAsciiFallbackNeeded) {
      return tryOrderedCandidates(
        allCandidates,
        input,
        pos,
        "predictiveChoice",
      );
    }
    const candidates = nonAsciiAlternatives
      .filter(
        ([, filter]) => !filter || firstCharFilterMatches(filter, codePoint),
      )
      .map(([p]) => p);
    if (candidates.length === 0) {
      return noCandidatesFailure(pos, codePoint);
    }
    return tryOrderedCandidates(candidates, input, pos, "predictiveChoice");
  };

  return predictiveChoiceParser;
};

/**
 * Parser that tries to parse with the given parser and returns a default value if it fails.
 *
 * This combinator makes a parser optional by providing a fallback value when parsing fails.
 * The parser position is not advanced if the main parser fails.
 *
 * @template T Type of the parser result and default value
 * @param parser The parser to try
 * @param defaultValue The default value to return if parser fails
 * @returns Parser that always succeeds, returning either the parsed result or the default value
 *
 * @example
 * ```typescript
 * // Parse an optional sign, defaulting to "+"
 * const optionalSign = withDefault(choice(literal("+"), literal("-")), "+");
 *
 * const result1 = optionalSign("-123", 0); // Returns "-"
 * const result2 = optionalSign("123", 0);  // Returns "+" (default)
 * ```
 *
 * @example
 * ```typescript
 * // Parse an optional configuration with defaults
 * const config = withDefault(
 *   parseConfigObject,
 *   { debug: false, timeout: 5000 }
 * );
 * ```
 */
export const withDefault =
  <T>(parser: Parser<T>, defaultValue: T): Parser<T> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return result;
    }

    return {
      success: true,
      val: defaultValue,
      current: pos,
      next: pos,
    };
  };

/**
 * Parser that makes a parser optional, returning the value or null.
 * Different from repetition.ts optional which returns [T] | [].
 *
 * @template T Type of the parser result
 * @param parser The parser to make optional
 * @returns Parser that always succeeds, returning T | null
 *
 * @example
 * ```typescript
 * const parser = maybe(char('a'));
 * const result1 = parser('a', 0); // Success: 'a'
 * const result2 = parser('b', 0); // Success: null
 * ```
 */
export const maybe = <T>(parser: Parser<T>): Parser<T | null> =>
  withDefault<T | null>(parser, null);

/**
 * Parser that succeeds if the given parser fails (without consuming input).
 *
 * This is a negative assertion parser that succeeds only when the given parser fails.
 * It does not consume any input and returns null as a meaningful indicator.
 * This is different from lookahead combinators as it's designed for rejection logic.
 *
 * @template T Type of the parser result (not used in the result, parser should fail)
 * @param parser The parser that should fail for this combinator to succeed
 * @returns Parser that returns null if the given parser fails, or fails if the parser succeeds
 *
 * @example
 * ```typescript
 * const notKeyword = reject(literal("if"));
 * const identifier = sequence(notKeyword, parseIdentifier);
 * ```
 */
export const reject =
  <T>(parser: Parser<T>, parserName = "reject"): Parser<null> =>
  (input: string, pos) => {
    const result = parser(input, pos);

    if (result.success) {
      return createFailure("Expected parser to fail", pos, {
        parserName,
        expected: "parser to fail",
      });
    }

    return {
      success: true,
      val: null,
      current: pos,
      next: pos,
    };
  };

/**
 * Parser that defers resolving its underlying parser until first invoked.
 *
 * A rule defined as `const a = sequence(literal("("), b, literal(")"))`
 * throws a `ReferenceError` (temporal dead zone) as soon as `b` is a `const`
 * declared later in the same module - the common shape for generated,
 * mutually- or self-recursive grammar rules. Wrapping the reference in
 * `lazy(() => b)` defers reading `b` until the wrapped parser actually runs,
 * by which point every top-level `const` in the module has finished
 * initializing.
 *
 * @template T Type of the parser result
 * @param fn Thunk returning the parser to delegate to, evaluated on every call
 * @returns Parser that calls `fn()` and delegates to its result
 *
 * @example
 * ```typescript
 * // "a" and "b" reference each other; whichever is declared second would
 * // otherwise throw a ReferenceError when the other's initializer runs.
 * const a: Parser<unknown> = sequence(literal("("), lazy(() => b), literal(")"));
 * const b: Parser<unknown> = choice(a, literal("x"));
 * ```
 */
export const lazy =
  <T>(fn: () => Parser<T>): Parser<T> =>
  (input: string, pos) =>
    fn()(input, pos);
