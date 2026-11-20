/**
 * A process-wide "parse session" counter: `parse()` (`./utils.ts`) starts
 * a new session at the beginning of every top-level parse.
 *
 * Per-input caches that outlive a single parser call -- `memoize` and
 * `commitAtTopLevel`'s prune watermark in `@suzumiyaaoba/tpeg-combinator`
 * -- used to be keyed on the input string's VALUE alone. Parsing the same
 * text twice therefore reused the first parse's memo table: semantic
 * actions of a memoized rule did not run again, and the second parse
 * returned the very same (possibly caller-mutated) value objects the
 * first one did. Those caches now also record the session they were
 * built in and discard themselves when it changes.
 *
 * A direct `parser(input, pos)` call that bypasses `parse()` does not
 * start a session on its own; call {@link beginParseSession} first to get
 * the same fresh-cache guarantee. A nested `parse()` starts its own
 * session and restores the outer session and diagnostics on return.
 */

import {
  resetFailureWatermark,
  restoreFailureWatermark,
  snapshotFailureWatermark,
} from "./failure";

let nextParseSession = 0;
let parseSession = 0;
let activeParseSessions = 0;

/** Starts a new parse session, invalidating every session-scoped cache. */
export const beginParseSession = (): number => {
  parseSession = ++nextParseSession;
  return parseSession;
};

/** The current parse session's id (see {@link beginParseSession}). */
export const currentParseSession = (): number => parseSession;

/** Runs a top-level parse with fresh caches and diagnostics. Nested calls
 * restore the enclosing parse's state even if a semantic action throws.
 * The callback must materialize any lazy failure before returning. */
export const withParseSession = <R>(call: () => R): R => {
  const previousSession = parseSession;
  const previousWatermark =
    activeParseSessions > 0 ? snapshotFailureWatermark() : undefined;
  beginParseSession();
  resetFailureWatermark();
  activeParseSessions++;
  try {
    return call();
  } finally {
    activeParseSessions--;
    if (previousWatermark) {
      parseSession = previousSession;
      restoreFailureWatermark(previousWatermark);
    }
  }
};
