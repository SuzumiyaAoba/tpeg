import type { NonEmptyArray, Parser } from "@suzumiyaaoba/tpeg-core";
import {
  isFatalFailure,
  literal,
  map,
  notPredicate,
  optional,
  seq,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import { named } from "./error";
import { token } from "./primitive";

/**
 * Drops a separator and keeps only the value from a `seq(sep, value)` pair.
 */
const dropSeparator = <T, S>(sep: Parser<S>, value: Parser<T>): Parser<T> =>
  map(seq(sep, value), ([, v]) => v);

/**
 * Parser that applies a parser repeatedly, separated by another parser.
 */
export const sepBy = <T, S>(
  value: Parser<T>,
  separator: Parser<S>,
  parserName?: string,
): Parser<T[]> => {
  const sepByOne = map(
    seq(value, zeroOrMore(dropSeparator(separator, value))),
    ([first, rest]) => [first, ...rest],
  );

  // `optional`, not `choice(sepByOne, ...)`: `sepBy` is meant to be
  // transparent sugar for "optionally present, one-or-more" -- exactly
  // what a grammar author would write by hand as `sepBy1(...)?`. A
  // `choice` absorbs a `fatal` (cut/commit) failure at ITS OWN boundary
  // (see `commit`'s doc comment, `@suzumiyaaoba/tpeg-core`), which would
  // silently swallow a cut inside `value` instead of letting it propagate
  // to whatever encloses `sepBy(...)` itself -- `optional` (unlike a
  // hand-rolled `choice`-based "or empty" fallback) already re-raises a
  // fatal failure instead of treating it as "no match", exactly the
  // behavior this needs.
  const parser = map(optional(sepByOne), (results) =>
    results.length === 0 ? [] : results[0],
  );

  return named(parser, parserName);
};

/**
 * Parser that applies a parser repeatedly at least once, separated by another parser.
 */
export const sepBy1 = <T, S>(
  value: Parser<T>,
  separator: Parser<S>,
  parserName?: string,
): Parser<NonEmptyArray<T>> => {
  // The shared `value` prefix is parsed once; branching only on what follows
  // avoids re-parsing it for the (common) single-element case.
  const parser = map(
    seq(value, zeroOrMore(dropSeparator(separator, value))),
    ([first, rest]) => [first, ...rest] as NonEmptyArray<T>,
  );

  return named(parser, parserName);
};

/**
 * Parser for comma-separated values with customizable value parser.
 */
export const commaSeparated = <T>(
  valueParser: Parser<T>,
  allowTrailing = false,
  parserName?: string,
): Parser<T[]> => {
  const comma = token(literal(","));

  const empty = map(notPredicate(valueParser), () => [] as T[]);

  const nonEmpty = map(
    seq(
      token(valueParser),
      zeroOrMore(dropSeparator(comma, token(valueParser))),
      allowTrailing ? optional(comma) : map(notPredicate(comma), () => []),
    ),
    ([first, rest]) => [first, ...rest],
  );

  // Not `choice(nonEmpty, empty)`: unlike `sepBy` above, `empty`'s
  // `notPredicate(valueParser)` check deliberately distinguishes "nothing
  // here at all" (fall back to `[]`) from "something's here but malformed"
  // (e.g. a disallowed trailing comma, which makes `nonEmpty` fail even
  // though a value WAS present -- `empty`'s own check then also fails,
  // correctly rejecting the whole thing) -- `optional(nonEmpty)` would
  // collapse that second case into a silent `[]` too. This still needs the
  // same fix `sepBy` needed, though: a `fatal` (cut/commit) failure from
  // inside `nonEmpty` must propagate to whatever encloses
  // `commaSeparated(...)`, not be laundered into "try `empty` instead" by
  // `choice`'s boundary-absorption (see `commit`'s doc comment,
  // `@suzumiyaaoba/tpeg-core`). Replicating `choice`'s two-alternative
  // trial by hand, but returning a fatal failure as-is instead of
  // absorbing it, keeps both properties.
  const parser: Parser<T[]> = (input, pos) => {
    const result = nonEmpty(input, pos);
    if (result.success || isFatalFailure(result)) return result;
    return empty(input, pos);
  };

  return named(parser, parserName);
};

/**
 * Parser for comma-separated values requiring at least one value.
 */
export const commaSeparated1 = <T>(
  valueParser: Parser<T>,
  allowTrailing = false,
  parserName?: string,
): Parser<NonEmptyArray<T>> => {
  const comma = token(literal(","));

  // The shared `token(valueParser)` prefix is parsed once; branching only on
  // what follows avoids re-parsing it for the (common) single-element case.
  const parser = map(
    seq(
      token(valueParser),
      zeroOrMore(dropSeparator(comma, token(valueParser))),
      allowTrailing ? optional(comma) : map(notPredicate(comma), () => []),
    ),
    ([first, rest]) => [first, ...rest] as NonEmptyArray<T>,
  );

  return named(parser, parserName);
};
