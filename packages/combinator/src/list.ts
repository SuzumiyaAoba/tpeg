import type { NonEmptyArray, Parser } from "@suzumiyaaoba/tpeg-core";
import {
  choice,
  literal,
  map,
  notPredicate,
  oneOrMore,
  optional,
  seq,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import { withDetailedError } from "./error";
import { token } from "./primitive";

/**
 * Parser that applies a parser repeatedly, separated by another parser.
 */
export const sepBy = <T, S>(
  value: Parser<T>,
  separator: Parser<S>,
  parserName?: string,
): Parser<T[]> => {
  const sepByOne = map(
    seq(value, zeroOrMore(map(seq(separator, value), ([_, v]) => v))),
    ([first, rest]) => [first, ...rest],
  );

  const parser = choice(
    sepByOne,
    map(notPredicate(value), () => []),
  );

  return parserName ? withDetailedError(parser, parserName) : parser;
};

/**
 * Parser that applies a parser repeatedly at least once, separated by another parser.
 */
export const sepBy1 = <T, S>(
  value: Parser<T>,
  separator: Parser<S>,
  parserName?: string,
): Parser<NonEmptyArray<T>> => {
  const single = map(value, (v) => [v] as NonEmptyArray<T>);

  const multiple = map(
    seq(value, oneOrMore(map(seq(separator, value), ([_, v]) => v))),
    ([first, rest]) => [first, ...rest] as NonEmptyArray<T>,
  );

  const parser = choice(multiple, single);

  return parserName ? withDetailedError(parser, parserName) : parser;
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
      zeroOrMore(map(seq(comma, token(valueParser)), ([_, val]) => val)),
      allowTrailing ? optional(comma) : map(notPredicate(comma), () => []),
    ),
    ([first, rest]) => [first, ...rest],
  );

  const parser = choice(nonEmpty, empty);

  return parserName ? withDetailedError(parser, parserName) : parser;
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

  const single = map(
    seq(
      token(valueParser),
      allowTrailing ? optional(comma) : map(notPredicate(comma), () => []),
    ),
    ([val]) => [val] as NonEmptyArray<T>,
  );

  const multiple = map(
    seq(
      token(valueParser),
      oneOrMore(map(seq(comma, token(valueParser)), ([_, val]) => val)),
      allowTrailing ? optional(comma) : map(notPredicate(comma), () => []),
    ),
    ([first, rest]) => [first, ...rest] as NonEmptyArray<T>,
  );

  const parser = choice(multiple, single);

  return parserName ? withDetailedError(parser, parserName) : parser;
};
