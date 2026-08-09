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
  const rest = zeroOrMore(dropSeparator(separator, value));

  // Deliberately NOT `map(optional(sepByOne), ...)` (a `choice`-shaped "or
  // empty" fallback via `optional`): `optional` can only distinguish
  // "fatal" from "not fatal" (see its doc comment, `@suzumiyaaoba/tpeg-
  // core`'s `repetition.ts`), but `rest` failing with an ORDINARY
  // (non-fatal) failure doesn't always mean "no list here" -- when `value`
  // and `separator` are both nullable, `rest` (`zeroOrMore`) can itself
  // fail with its own infinite-loop guard (the parser matched but
  // consumed nothing -- see `createInfiniteLoopError`, `@suzumiyaaoba/
  // tpeg-core`'s `repetition.ts`), which is NOT marked fatal. Wrapping the
  // whole thing in `optional` would silently swallow that as "zero
  // matches", discarding `value`'s already-successful first match (and
  // every element `rest` had already parsed before tripping the guard)
  // and reporting zero consumption -- a genuine data-loss bug, not a
  // backtrack. Trying `value` manually first fixes this: once it has
  // succeeded, this position is provably the start of a real list, so ANY
  // failure from `rest` past that point (fatal or not) must propagate
  // rather than be reinterpreted as "empty".
  const parser: Parser<T[]> = (input, pos) => {
    const first = value(input, pos);
    if (!first.success) {
      if (isFatalFailure(first)) return first;
      return { success: true, val: [], current: pos, next: pos };
    }

    const restResult = rest(input, first.next);
    if (!restResult.success) return restResult;

    return {
      success: true,
      val: [first.val, ...restResult.val],
      current: pos,
      next: restResult.next,
    };
  };

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
