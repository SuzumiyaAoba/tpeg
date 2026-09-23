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
 * the same fresh-cache guarantee. A nested `parse()` (e.g. from inside a
 * semantic action) also starts a session, which only costs the outer
 * parse its cached entries -- never correctness, since an evicted entry
 * is simply recomputed.
 */

let parseSession = 0;

/** Starts a new parse session, invalidating every session-scoped cache. */
export const beginParseSession = (): number => {
  parseSession++;
  return parseSession;
};

/** The current parse session's id (see {@link beginParseSession}). */
export const currentParseSession = (): number => parseSession;
