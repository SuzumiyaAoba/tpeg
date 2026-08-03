/**
 * Global test hook: resets `tpeg-core`'s shared farthest-failure watermark
 * (`packages/core/src/failure.ts`, Pillar 6 of the perf plan) before every
 * test in the suite.
 *
 * In production, a top-level parse always goes through `parse()`
 * (`packages/core/src/utils.ts`), which resets the watermark itself. Most
 * of this repo's specs instead call a `Parser<T>` directly (bypassing
 * `parse()`) to exercise one combinator in isolation -- entirely safe
 * before this pillar, since nothing was shared across calls. Now that
 * diagnostics (`error.message`/`.expected`/`.found`) are derived from a
 * module-global watermark, two adjacent tests that happen to call a
 * failing parser with the SAME (by-value-equal, not necessarily the same
 * reference) input string at an overlapping position would otherwise leak
 * state into each other -- entirely a test-isolation artifact (per
 * `failure.ts`'s own doc comment, a stale watermark can only make an error
 * message less precise, never change success/failure/position), but a
 * real source of order-dependent flakiness in assertions that DO check
 * message/expected content. This hook removes that dependency: every test
 * starts from the same clean slate `parse()` would give it.
 */
import { beforeEach } from "bun:test";
import { resetFailureWatermark } from "../packages/core/src/failure";

beforeEach(() => {
  resetFailureWatermark();
});
