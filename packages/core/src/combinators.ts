import {
  ASCII_TABLE_SIZE,
  type DispatchTrieEntry,
  type DispatchTrieNode,
  buildDispatchTrie,
  walkDispatchTrie,
} from "./dispatch-trie";
import type { Expectation } from "./failure";
import { FAIL, FAIL_FATAL, fail, isFatalFailure } from "./failure";
import type { ParseResult, Parser } from "./types";
import { createFailure, isFailure } from "./utils";

/**
 * Shared ordered-choice trial loop: tries `parsers[i](input, pos)` in
 * order, returning the first success as-is (no allocation on this path),
 * stopping early and absorbing a `fatal` failure's flag at this call's own
 * boundary (see `commit`'s doc comment -- a cut is scoped to its own
 * enclosing choice, not forwarded to whatever encloses THIS one), or --
 * if every candidate fails without any being fatal -- returning the `FAIL`
 * singleton (see `./failure.ts`): each candidate's own leaf-level `fail()`
 * call already recorded its position/expectation into the shared farthest-
 * failure watermark, so there is nothing left to aggregate here.
 *
 * Used by {@link choice}, {@link predictiveChoice}, AND `captureChoice`
 * (`./capture.ts`, exported here specifically so that module can reuse
 * this instead of keeping its own, now-redundant farthest-error tracking
 * -- see that function's doc comment): all three differ only in how they
 * narrow/shape `parsers` before calling this (`predictiveChoice` via a
 * precomputed FIRST-set dispatch table, the other two not at all) -- cut/
 * commit semantics and failure propagation must behave identically across
 * all of them, so that logic lives in exactly one place rather than
 * several copies that could drift.
 */
export const tryOrderedCandidates = <T>(
  parsers: readonly Parser<T>[],
  input: string,
  pos: number,
  parserName: string,
): ParseResult<T> => {
  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i];
    if (!parser) {
      // A programming error (a hole in the alternative array), not a parse
      // failure -- stays a concrete, eagerly-built `ParseError` rather than
      // going through the singleton/watermark path. See `./failure.ts`'s
      // doc comment on the control-flow-failure/invariant-violation line.
      return createFailure(`Parser at index ${i} is undefined`, pos, {
        parserName,
      });
    }
    const result = parser(input, pos);

    if (result.success) {
      return result;
    }

    if (isFatalFailure(result)) {
      // Absorb the cut here (this choice's own boundary), not forwarded
      // to whatever encloses it -- see `commit`'s doc comment.
      if (result === FAIL_FATAL) return FAIL;
      return {
        success: false,
        error: { ...result.error, fatal: false },
      } as const;
    }
    if (result !== FAIL) {
      // A CONCRETE (non-singleton) failure -- a hand-written parser that
      // still builds its own `ParseError` via the public `createFailure`
      // (`./utils.ts`) instead of `fail` (`./failure.ts`), or this
      // function's own "Parser at index N is undefined" a few lines up
      // from a nested call. Its `.error` is already a plain object (no
      // getter to trigger), so reading it here is free -- forward its
      // expectation(s) into the shared watermark so it still participates
      // in farthest-failure diagnostics instead of being silently
      // dropped now that this function no longer builds its own
      // aggregate. Singleton failures (`FAIL`) skip this entirely: they
      // already recorded themselves at their point of origin.
      const {
        expected,
        pos: errorPos,
        parserName: errorParserName,
      } = result.error;
      const labels = Array.isArray(expected)
        ? expected
        : expected !== undefined
          ? [expected]
          : [];
      for (const label of labels) {
        fail(input, errorPos, {
          label,
          ...(errorParserName !== undefined
            ? { parserName: errorParserName }
            : {}),
        });
      }
    }
    // Every candidate's own failure -- whether recorded here (concrete) or
    // already recorded at its point of origin (singleton `FAIL`) -- has
    // now contributed to the shared farthest-failure watermark, so there
    // is nothing left to aggregate locally. Just keep trying.
  }

  return FAIL;
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
  const sequenceParser = (input: string, pos: number) => {
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
        // Relay the child's failure UNCHANGED rather than re-wrapping it
        // with an enriched message/context: virtually every rule body is
        // a `sequence`, so re-wrapping here would read (and thus
        // materialize) the `error` getter on almost every leaf failure in
        // the grammar -- the single biggest hazard to the lazy-diagnostics
        // watermark's whole point (see `./failure.ts`'s doc comment). The
        // failed element's
        // own `fail()` call already recorded its position/expectation in
        // the shared watermark; there is nothing this wrapper adds besides
        // an "in sequence" context label, which the watermark doesn't
        // carry per-frame anyway.
        return parserResult;
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
  (input: string, pos: number) => {
    const result = parser(input, pos);
    if (isFailure(result)) {
      // The common case: `parser`'s failure is the `FAIL` singleton (see
      // `./failure.ts`) -- swap it for the other singleton, `FAIL_FATAL`,
      // with zero allocation. `result === FAIL_FATAL` is already fatal
      // (idempotent, e.g. `commit` applied twice); anything else is a
      // hand-built, non-singleton failure that still needs the spread
      // fallback to set `fatal` on its own `error` object.
      if (result === FAIL) return FAIL_FATAL;
      if (result === FAIL_FATAL) return result;
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
    const emptyChoiceParser = (_input: string, pos: number) =>
      createFailure("Empty choice", pos, { parserName: "choice" });
    return emptyChoiceParser;
  }

  const candidates = parsers as unknown as readonly Parser<T[number]>[];
  const choiceParser = (input: string, pos: number) =>
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
 * ## Past FIRST_1: an optional literal-prefix trie
 *
 * FIRST_1 dispatch degenerates on keyword-dense grammars where several
 * alternatives share a first character (`true`/`this`/`throw`,
 * `if`/`import`/`interface`/`instanceof`): every one of them still
 * survives the ASCII-table filter, so `tryOrderedCandidates` ends up
 * trying most of them anyway. An alternative's tuple may carry an OPTIONAL
 * third element -- its known literal prefix, a string of length >= 2 (see
 * `packages/parser/src/codegen-optimized.ts`'s `literalPrefixForExpression`
 * for how codegen derives one) -- and each ASCII bucket that ends up with
 * two or more such prefixed alternatives gets a small trie
 * ({@link DispatchTrieNode}, built by {@link buildDispatchTrie}) checking
 * further characters one at a time, at the same per-level cost as the
 * first character (`input.charCodeAt`, no fixed lookahead depth the way a
 * FIRST_2/FIRST_3 table would need, and no per-call `RegExp`). A bucket
 * with fewer than two prefixed alternatives keeps today's flat array
 * unchanged -- see {@link DispatchTrieNode}'s own doc comment for exactly
 * when a trie gets built and how an alternative with NO literal prefix
 * (or one already exhausted at a shallower depth) is never excluded by
 * depth alone, mirroring how a `null`-filter alternative is never excluded
 * by first character alone.
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
    (string | null)?,
  ])[],
): Parser<T[number]> => {
  if (alternatives.length === 0) {
    const emptyPredictiveChoiceParser = (_input: string, pos: number) =>
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

  // Each entry is the root {@link DispatchTrieNode} for that ASCII first
  // character: `children: null` (the common case -- no
  // alternative surviving this bucket has a length->=2 literal prefix, or
  // fewer than two do) makes `.candidates` behave exactly like the flat
  // per-code array this table held before tries existed; `children`
  // non-null narrows further via `walkDispatchTrie` for a bucket with
  // multiple alternatives sharing a longer literal prefix (e.g.
  // `if`/`import`/`interface`/`instanceof` all starting with `i`).
  const asciiTable: DispatchTrieNode<T[number]>[] = new Array(ASCII_TABLE_SIZE);
  const dedupedByKey = new Map<string, DispatchTrieNode<T[number]>>();
  for (let code = 0; code < ASCII_TABLE_SIZE; code++) {
    let key = "";
    const entries: DispatchTrieEntry<T[number]>[] = [];
    for (let i = 0; i < alternatives.length; i++) {
      const [, filter, literalPrefix] = alternatives[
        i
      ] as (typeof alternatives)[number];
      if (!filter || firstCharFilterMatches(filter, code)) {
        entries.push({
          parser: parsers[i] as Parser<T[number]>,
          index: i,
          // The first character is already spent choosing this ASCII
          // bucket, so the trie built from this bucket's entries
          // discriminates starting from the prefix's SECOND character.
          remaining: literalPrefix ? literalPrefix.slice(1) : "",
        });
        key += `${i},`;
      }
    }
    const shared = dedupedByKey.get(key);
    if (shared) {
      asciiTable[code] = shared;
    } else {
      const node = buildDispatchTrie(entries);
      dedupedByKey.set(key, node);
      asciiTable[code] = node;
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

  // Precomputed once: every alternative's filter, described AND wrapped
  // as an `Expectation` (`./failure.ts`) for the "none of the parsers
  // matched" error -- doesn't depend on which character actually failed,
  // so it's wasted work to rebuild this on every failing call. Kept as
  // one `Expectation` per filter (not merged into a single joined-string
  // label) so the watermark's `expected` still comes out as an array of
  // the individual filter descriptions on a fast failure, matching what
  // `tryOrderedCandidates`'s farthest-error aggregation used to produce
  // here.
  const filterExpectations: Expectation[] = alternatives
    .map(([, filter]) => (filter ? describeFirstCharFilter(filter) : null))
    .filter((d): d is string => d !== null)
    .map((label) => ({ label, parserName: "predictiveChoice" }));

  const noCandidatesFailure = (
    input: string,
    pos: number,
  ): ParseResult<T[number]> => {
    // Every alternative reaching this branch had a non-`null` filter that
    // excluded the current code point (a `null` filter always survives
    // into `candidates`), so `filterExpectations` is never empty here.
    for (const exp of filterExpectations) fail(input, pos, exp);
    return FAIL;
  };

  const predictiveChoiceParser = (
    input: string,
    pos: number,
  ): ParseResult<T[number]> => {
    if (pos >= input.length) {
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

    const code = input.charCodeAt(pos);
    if (code < ASCII_TABLE_SIZE) {
      const node = asciiTable[code] as DispatchTrieNode<T[number]>;
      const candidates = node.children
        ? walkDispatchTrie(node, input, pos + 1)
        : node.candidates;
      if (candidates.length === 0) {
        return noCandidatesFailure(input, pos);
      }
      return tryOrderedCandidates(candidates, input, pos, "predictiveChoice");
    }

    // Non-ASCII: decode the full code point (correct for a surrogate
    // pair) and, only if some alternative's filter could actually
    // exclude it, filter the reduced candidate list exactly.
    const codePoint = input.codePointAt(pos) as number;
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
      return noCandidatesFailure(input, pos);
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

    // A cut/commit (see `commit` above) inside `parser` marks its failure
    // `fatal`, meaning "do not treat this as backtrackable" -- re-raise it
    // instead of the usual "swallow and fall back to the default", exactly
    // like `optional` (`repetition.ts`) already does for the same reason:
    // otherwise `withDefault(seq(lit("if"), commit(cond)), fallback)` would
    // silently discard the cut's intent the moment `cond` fails.
    if (isFatalFailure(result)) {
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
