/**
 * TPEG Repetition Operators Parser
 *
 * Implements parsing of repetition operators: *, +, ?, {n,m}
 * Based on docs/peg-grammar.md specification.
 *
 * Repetition operators are postfix operators with high precedence:
 * - expr* (zero or more)
 * - expr+ (one or more)
 * - expr? (zero or one)
 * - expr{n} (exactly n times)
 * - expr{n,m} (n to m times)
 * - expr{n,} (n or more times)
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  charClass,
  choice,
  createFailure,
  literal,
  map,
  oneOrMore,
  optional,
  seq,
} from "@suzumiyaaoba/tpeg-core";
import { scanBalancedBraces } from "./brace-scanner";
import type { Expression, Optional, Plus, Quantified, Star } from "./types";
import {
  createOptional,
  createPlus,
  createQuantified,
  createStar,
} from "./types";

/**
 * Parses a star repetition operator: expr*
 * Zero or more repetitions of the given expression.
 */
export const starOperator: Parser<string> = literal("*");

/**
 * Parses a plus repetition operator: expr+
 * One or more repetitions of the given expression.
 */
export const plusOperator: Parser<string> = literal("+");

/**
 * Parses an optional operator: expr?
 * Zero or one occurrence of the given expression.
 */
export const optionalOperator: Parser<string> = literal("?");

/**
 * Parses a quantified repetition operator: expr{n}, expr{n,m}, expr{n,}
 * Supports exact count, range, and minimum repetitions.
 */
export const quantifiedOperator: Parser<{ min: number; max?: number }> =
  (() => {
    // Parse a positive integer
    const positiveInt: Parser<number> = map(
      oneOrMore(charClass(["0", "9"])),
      (digits) => Number.parseInt(digits.join(""), 10),
    );

    // Parse {n} - exactly n times
    const exactCount: Parser<{ min: number; max?: number }> = map(
      seq(literal("{"), positiveInt, literal("}")),
      ([_, count, __]) => ({ min: count, max: count }),
    );

    // Parse {n,} - n or more times
    const minCount: Parser<{ min: number; max?: number }> = map(
      seq(literal("{"), positiveInt, literal(","), literal("}")),
      ([_, min, __, ___]) => ({ min }),
    );

    // Parse {n,m} - n to m times. Not a plain `map` (which can't turn a
    // success into a failure): a reversed range like `{5,2}` must be
    // rejected here -- `tpeg-core`'s own `quantified()` (repetition.ts)
    // throws eagerly for `max < min`, but that only fires once the
    // GENERATED parser module loads, disconnected from the source
    // grammar's file/line; nothing upstream of that validates it at parse
    // time, so a typo like this previously compiled successfully and only
    // surfaced as a crash far removed from its cause.
    const rangeCount: Parser<{ min: number; max?: number }> = (
      input: string,
      pos: number,
    ) => {
      const result = seq(
        literal("{"),
        positiveInt,
        literal(","),
        positiveInt,
        literal("}"),
      )(input, pos);
      if (!result.success) return result;
      const [, min, , max] = result.val;
      if (min > max) {
        return createFailure(
          `Invalid quantifier range: {${min},${max}} (minimum must not be greater than maximum)`,
          pos,
          { parserName: "quantifiedOperator" },
        );
      }
      return {
        success: true,
        val: { min, max },
        current: result.current,
        next: result.next,
      };
    };

    return choice(rangeCount, minCount, exactCount);
  })();

/**
 * Applies a repetition operator to a base expression.
 * Creates the appropriate AST node based on the operator type.
 */
export const applyRepetition = (
  expression: Expression,
  operator: string | { min: number; max?: number },
): Expression => {
  if (typeof operator === "string") {
    switch (operator) {
      case "*":
        return createStar(expression);
      case "+":
        return createPlus(expression);
      case "?":
        return createOptional(expression);
      default:
        return expression;
    }
  }
  // Quantified repetition
  return createQuantified(expression, operator.min, operator.max);
};

/**
 * Parses any repetition operator.
 * Returns the operator information for later application.
 */
export const repetitionOperator: Parser<
  string | { min: number; max?: number }
> = choice(starOperator, plusOperator, optionalOperator, quantifiedOperator);

/**
 * The "optional repetition operator" parser used by {@link withRepetition},
 * built once at module scope instead of per call (see below).
 */
const optionalRepetitionOperator = optional(repetitionOperator);

/** Content that looks like a BOTCHED attempt at `{n}`/`{n,}`/`{n,m}`
 * rather than genuine semantic-action code -- see the doc comment on the
 * check in {@link withRepetition} that uses this. Real action bodies
 * essentially always contain a keyword, an operator, a string, or at
 * least a semicolon; none of those are digits, commas, or whitespace. */
const LOOKS_LIKE_MALFORMED_QUANTIFIER = /^[\d,\s]*$/;

/**
 * Creates a parser that handles repetition for any base expression parser.
 * This is a higher-order function that wraps any expression parser with repetition support.
 *
 * Every postfix expression in a grammar (identifiers, groups, char classes, ...)
 * is wrapped with this, so it reuses a module-level operator parser built once
 * rather than constructing a fresh combinator tree on every invocation.
 */
export const withRepetition = <T extends Expression>(
  expressionParser: Parser<T>,
): Parser<Expression> => {
  return (input: string, pos) => {
    // First parse the base expression
    const baseResult = expressionParser(input, pos);
    if (!baseResult.success) {
      return baseResult;
    }

    // Then try to parse repetition operators (never fails: optional() always succeeds)
    const opResult = optionalRepetitionOperator(input, baseResult.next);
    if (!opResult.success) {
      return opResult;
    }
    const [repetitionOp] = opResult.val;

    if (
      repetitionOp !== undefined &&
      repetitionOperator(input, opResult.next).success
    ) {
      // A second repetition operator immediately chained onto the first
      // (`item{2}{4}`, `item**`, `item?+`, ...) is not a valid TPEG
      // construct -- `repetitionOperator` only ever consumes ONE operator
      // per call, by design (see this module's own doc comment: postfix
      // operators, not a loop). Left unchecked, a numeric-only second
      // `{n}`-shaped suffix is syntactically indistinguishable at this
      // point from the start of a semantic action block (`{ code }`, see
      // `docs/peg-grammar.md`'s "Semantic Actions" section) --
      // `composition.ts`'s `withOptionalAction` would silently accept it
      // as one, with the digits inside evaluated as the action's
      // (return-less, so always-`undefined`) body -- a silently-wrong
      // generated parser with no diagnostic anywhere. Failing here instead
      // surfaces the mistake as a real parse error.
      return createFailure(
        "A repetition operator cannot be immediately followed by another repetition operator",
        opResult.next,
        { parserName: "withRepetition" },
      );
    }

    // A `{` here that ISN'T a valid repetition operator (whether or not
    // one was already consumed above -- e.g. `"a"{,3}` matches zero
    // operators, `"a"*{,3}` matches one valid `*` first) is otherwise
    // silently reinterpreted by `withOptionalAction`
    // (`composition.ts`) as the START of a semantic action block:
    // `scanBalancedBraces` (`brace-scanner.ts`) only checks brace
    // balance, not whether the content is meaningful code, so e.g.
    // `"a"{,3}` (a typo'd quantifier missing its minimum) would silently
    // compile to an action whose body is the bare text `,3` -- a
    // `SyntaxError` only once the generated module is actually loaded,
    // with no diagnostic anywhere pointing at the real mistake (a
    // missing digit before the comma). Reject it HERE instead, but only
    // when the braced content looks like an attempted-but-malformed
    // quantifier (see `LOOKS_LIKE_MALFORMED_QUANTIFIER`'s doc comment)
    // rather than genuine action code, so a real `{ return 1; }` (or
    // even a pointless-but-valid `{ someIdentifier }`) is never misread
    // as a botched quantifier. Deliberately only checked when `{` is
    // IMMEDIATELY adjacent (no whitespace) to the base expression --
    // real quantifier syntax never has whitespace before `{` either (see
    // `quantifiedOperator` above, which has no whitespace-skip built in),
    // so adjacency is itself part of what marks this as a quantifier
    // attempt rather than an action; `"a" {,3}` (WITH a leading space)
    // still falls through to `withOptionalAction` unchanged, since a
    // leading space reads far more like "this really was meant as an
    // action" than "this was meant as `{n,m}`.
    if (input[opResult.next] === "{") {
      const brace = scanBalancedBraces(input, opResult.next);
      if (brace.success && LOOKS_LIKE_MALFORMED_QUANTIFIER.test(brace.val)) {
        return createFailure(
          `Invalid quantifier syntax: "{${brace.val}}" is not a valid repetition operator (expected "{n}", "{n,}", or "{n,m}" with no whitespace)`,
          opResult.next,
          { parserName: "withRepetition" },
        );
      }
    }

    return {
      success: true,
      val:
        repetitionOp !== undefined
          ? applyRepetition(baseResult.val, repetitionOp)
          : baseResult.val,
      current: baseResult.next,
      next: opResult.next,
    };
  };
};

/**
 * Parses a star repetition expression specifically.
 * Exported for direct use when star parsing is needed.
 */
export const starExpression = (baseExpression: Expression): Star =>
  createStar(baseExpression);

/**
 * Parses a plus repetition expression specifically.
 * Exported for direct use when plus parsing is needed.
 */
export const plusExpression = (baseExpression: Expression): Plus =>
  createPlus(baseExpression);

/**
 * Parses an optional expression specifically.
 * Exported for direct use when optional parsing is needed.
 */
export const optionalExpression = (baseExpression: Expression): Optional =>
  createOptional(baseExpression);

/**
 * Parses a quantified expression specifically.
 * Exported for direct use when quantified parsing is needed.
 */
export const quantifiedExpression = (
  baseExpression: Expression,
  min: number,
  max?: number,
): Quantified => createQuantified(baseExpression, min, max);
