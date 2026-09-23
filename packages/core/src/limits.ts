import type { ParseResult } from "./types";

/**
 * Enforced parser resource limits.
 *
 * PEG parsers are recursive descent: a grammar rule like
 * `nested = "(" nested ")" / "x"` recurses once per nesting level of the
 * INPUT, and the hand-written grammar parser recurses once per `( ... )`
 * group in the `.tpeg` source. Without a depth guard both paths end in an
 * uncaught `RangeError: Maximum call stack size exceeded` instead of a
 * `ParseFailure` a caller can handle -- a real DoS surface for
 * grammar-driven parsers fed untrusted input.
 *
 * The recursion guard counts entries through the two recursion adapters
 * parsers recurse through -- `lazy()` (every generated rule reference is
 * emitted as `lazy(() => ...)`) and `recursive()` (the hand-written
 * grammar parser's expression recursion) -- not raw stack frames, so the
 * limit trips well below the engine's real stack capacity.
 */
export const PARSER_LIMITS = {
  /** Maximum input length `parse()` will attempt, in UTF-16 code units. */
  MAX_INPUT_LENGTH: 1_000_000,
  /** Maximum live depth of `lazy()`/`recursive()` delegation. */
  MAX_RECURSION_DEPTH: 1000,
} as const;

/**
 * Number of in-flight `guardedParserCall` delegations. Module-global
 * rather than per-parse: parser invocation is synchronous and
 * single-threaded, so one counter is a faithful proxy for live stack
 * depth -- including a semantic action that itself runs a nested parse
 * mid-parse, which correctly keeps counting against the same budget.
 */
let activeRecursionDepth = 0;

/**
 * The recursion-depth budget currently in force. `PARSER_LIMITS` holds the
 * defaults; `parse(parser, { maxRecursionDepth })` (`./utils.ts`) raises or
 * lowers it for the duration of one top-level parse via
 * {@link withRecursionDepthLimit}. Previously both limits were hard-coded
 * constants, so e.g. a JSON document nested a few hundred levels deep (each
 * level is two rule references) could not be parsed at all.
 */
let maxRecursionDepth: number = PARSER_LIMITS.MAX_RECURSION_DEPTH;

/**
 * Resource limits a single `parse()` call may override. Each must be a
 * positive integer or `Infinity`.
 */
export interface ParseLimitOptions {
  /** Overrides `PARSER_LIMITS.MAX_INPUT_LENGTH` for this parse. */
  readonly maxInputLength?: number;
  /** Overrides `PARSER_LIMITS.MAX_RECURSION_DEPTH` for this parse. Raising
   * it far beyond the default trades the clean `abort` failure for the
   * engine's own `RangeError` once the real call stack runs out. */
  readonly maxRecursionDepth?: number;
}

/** Throws a `RangeError` for a limit option that is not a positive
 * integer or `Infinity`. */
export const validateLimitOption = (name: string, value: number): void => {
  if (
    value !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(value) || value < 1)
  ) {
    throw new RangeError(
      `Invalid ${name}: ${value} -- must be a positive integer or Infinity`,
    );
  }
};

/** Runs `call` with the recursion-depth budget set to `limit`, restoring
 * the previous budget afterwards (also when `call` throws), so a nested
 * `parse()` with its own limit cannot leak it into the outer parse. */
export const withRecursionDepthLimit = <R>(limit: number, call: () => R): R => {
  const previous = maxRecursionDepth;
  maxRecursionDepth = limit;
  try {
    return call();
  } finally {
    maxRecursionDepth = previous;
  }
};

/**
 * Runs `call()` -- a parser invocation -- under the recursion-depth
 * budget, returning a `fatal` `ParseFailure` when the budget is already
 * exhausted.
 *
 * `fatal` (not a plain failure) is required: an ordinary failure would be
 * swallowed by `choice`/`optional`/`zeroOrMore` as "this alternative
 * didn't match", turning a resource-limit hit into silent backtracking
 * and a wrong-but-successful parse. Fatal failures propagate unchanged
 * through every combinator, so the limit always surfaces to the caller.
 *
 * The failure object is built inline rather than via `createFailure` so
 * this module stays dependency-free (`utils.ts` imports this file for
 * `parse()`'s input-length check -- a reverse edge would be circular).
 */
export const guardedParserCall = <T>(
  call: () => ParseResult<T>,
  pos: number,
): ParseResult<T> => {
  if (activeRecursionDepth >= maxRecursionDepth) {
    return {
      success: false,
      error: {
        message: `Recursion depth limit exceeded (max ${maxRecursionDepth}) -- the input nests deeper than the parser supports`,
        pos,
        // `abort` in addition to `fatal`: `fatal` alone is cut semantics,
        // absorbed at the enclosing `choice` boundary -- a limit must
        // abort the whole parse instead (see `ParseError.abort`).
        fatal: true,
        abort: true,
      },
    };
  }
  activeRecursionDepth++;
  try {
    return call();
  } finally {
    activeRecursionDepth--;
  }
};
