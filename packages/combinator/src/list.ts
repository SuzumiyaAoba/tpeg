import type { NonEmptyArray, Parser } from "@suzumiyaaoba/tpeg-core";
import {
  createFailure,
  isFatalFailure,
  isValidOffset,
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
  // tpeg-core`'s `repetition.ts`), which is fatal but was NOT always so
  // (the pre-fatal design is why this hand-rolled shape exists). Wrapping
  // the whole thing in `optional` would have silently swallowed that as
  // "zero matches", discarding `value`'s already-successful first match
  // (and every element `rest` had already parsed before tripping the
  // guard) and reporting zero consumption -- a genuine data-loss bug, not
  // a backtrack. Trying `value` manually first fixes this: once it has
  // succeeded, this position is provably the start of a real list, so ANY
  // failure from `rest` past that point (fatal or not) must propagate
  // rather than be reinterpreted as "empty".
  const parser: Parser<T[]> = (input, pos) => {
    // Same out-of-contract-`pos` guard every leaf parser already applies
    // (`isValidOffset`, `@suzumiyaaoba/tpeg-core`): an invalid offset must
    // fail here rather than fall into the "no first element -> []" branch
    // below and echo itself back as a bogus zero-width success. `pos ===
    // input.length` stays legal -- an empty list at EOF.
    if (!isValidOffset(pos) || pos > input.length) {
      return createFailure("Expected a valid position", pos, {
        parserName: parserName ?? "sepBy",
      });
    }

    const first = value(input, pos);
    if (!first.success) {
      if (isFatalFailure(first)) return first;
      return { success: true, val: [], current: pos, next: pos };
    }

    // A child parser may reuse its result object on the next invocation.
    // Keep the first value before asking it to parse the remaining items.
    const firstNext = first.next;
    const firstValue = first.val;
    const restResult = rest(input, firstNext);
    if (!restResult.success) return restResult;
    const next = restResult.next;

    return {
      success: true,
      val: [firstValue, ...restResult.val],
      current: pos,
      next,
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

const commaSeparatedTail = <T>(
  item: Parser<T>,
  allowTrailing: boolean,
): Parser<T[]> => {
  const comma = token(literal(","));
  return map(
    seq(
      zeroOrMore(dropSeparator(comma, item)),
      allowTrailing ? optional(comma) : map(notPredicate(comma), () => []),
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
  const tail = commaSeparatedTail(item, allowTrailing);

  // Decide whether the list is empty from the first token's result. A
  // separate raw valueParser probe would miss leading whitespace and
  // could turn a malformed nonempty list into []. Once an item matches,
  // every failure from the tail must propagate. Cut/abort failures from
  // the first item likewise stay failures rather than selecting [].
  const parser: Parser<T[]> = (input, pos) => {
    if (!isValidOffset(pos) || pos > input.length) {
      return createFailure("Expected a valid position", pos, {
        parserName: parserName ?? "commaSeparated",
      });
    }

    const first = item(input, pos);
    if (!first.success) {
      if (isFatalFailure(first)) return first;
      return { success: true, val: [], current: pos, next: pos };
    }

    const firstNext = first.next;
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
  const item = token(valueParser);

  // The shared `token(valueParser)` prefix is parsed once; branching only on
  // what follows avoids re-parsing it for the (common) single-element case.
  const parser = map(
    seq(item, commaSeparatedTail(item, allowTrailing)),
    ([first, rest]) => [first, ...rest] as NonEmptyArray<T>,
  );

  return named(parser, parserName);
};
