import type { NonEmptyArray, Parser } from "@suzumiyaaoba/tpeg-core";
import {
  choice,
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

  const parser = choice(
    sepByOne,
    map(notPredicate(value), () => []),
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

  const parser = choice(nonEmpty, empty);

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
