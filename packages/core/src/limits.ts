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
  if (activeRecursionDepth >= PARSER_LIMITS.MAX_RECURSION_DEPTH) {
    return {
      success: false,
      error: {
        message: `Recursion depth limit exceeded (max ${PARSER_LIMITS.MAX_RECURSION_DEPTH}) -- the input nests deeper than the parser supports`,
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
