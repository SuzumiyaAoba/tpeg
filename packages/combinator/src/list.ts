import type { NonEmptyArray, Parser } from "@suzumiyaaoba/tpeg-core";
import {
  createFailure,
  invalidNextPosition,
  isFatalFailure,
  isValidOffset,
  literal,
  map,
  notPredicate,
  optional,
  tuple,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import { named } from "./error";
import { token } from "./primitive";

/**
 * Drops a separator and keeps only the value from a `tuple(sep, value)` pair.
 */
const dropSeparator = <T, S>(sep: Parser<S>, value: Parser<T>): Parser<T> =>
  map(tuple(sep, value), ([, v]) => v);

/** Only an ordinary failure on the first item selects the empty list. */
const possiblyEmptyList =
  <T>(item: Parser<T>, tail: Parser<T[]>, name: string): Parser<T[]> =>
  (input, pos) => {
    if (!isValidOffset(pos) || pos > input.length) {
      return createFailure("Expected a valid position", pos, {
        parserName: name,
      });
    }
    const first = item(input, pos);
    if (!first.success) {
      if (isFatalFailure(first)) return first;
      return { success: true, val: [], current: pos, next: pos };
    }
    const firstNext = first.next;
    const invalid = invalidNextPosition(input, pos, firstNext, name);
    if (invalid) return invalid;
    const firstValue = first.val;
    const rest = tail(input, firstNext);
    if (!rest.success) return rest;
    const next = rest.next;
    return {
      success: true,
      val: [firstValue, ...rest.val],
      current: pos,
      next,
    };
  };

/** Parse zero or more values separated by a separator. */
export const sepBy = <T, S>(
  value: Parser<T>,
  separator: Parser<S>,
  parserName?: string,
): Parser<T[]> =>
  named(
    possiblyEmptyList(
      value,
      zeroOrMore(dropSeparator(separator, value)),
      parserName ?? "sepBy",
    ),
    parserName,
  );

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
    tuple(value, zeroOrMore(dropSeparator(separator, value))),
    ([first, rest]): NonEmptyArray<T> => [first, ...rest],
  );

  return named(parser, parserName);
};

const commaSeparatedTail = <T>(
  item: Parser<T>,
  allowTrailing: boolean,
): Parser<T[]> => {
  const comma = token(literal(","));
  return map(
    tuple(
      zeroOrMore(dropSeparator(comma, item)),
      allowTrailing ? optional(comma) : notPredicate(comma),
    ),
    ([rest]) => rest,
  );
};

/**
 * Parser for comma-separated values with customizable value parser.
 */
export const commaSeparated = <T>(
  valueParser: Parser<T>,
  allowTrailing = false,
  parserName?: string,
): Parser<T[]> => {
  const item = token(valueParser);
  return named(
    possiblyEmptyList(
      item,
      commaSeparatedTail(item, allowTrailing),
      parserName ?? "commaSeparated",
    ),
    parserName,
  );
};

/**
 * Parser for comma-separated values requiring at least one value.
 */
export const commaSeparated1 = <T>(
  valueParser: Parser<T>,
  allowTrailing = false,
  parserName?: string,
): Parser<NonEmptyArray<T>> => {
  const item = token(valueParser);

  // The shared `token(valueParser)` prefix is parsed once; branching only on
  // what follows avoids re-parsing it for the (common) single-element case.
  const parser = map(
    tuple(item, commaSeparatedTail(item, allowTrailing)),
    ([first, rest]): NonEmptyArray<T> => [first, ...rest],
  );

  return named(parser, parserName);
};
