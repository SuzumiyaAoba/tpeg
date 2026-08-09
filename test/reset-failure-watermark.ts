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
 *
 * ## Two instances, two resets
 *
 * `packages/core/src/failure.ts` (this file's own source-relative import)
 * and `@suzumiyaaoba/tpeg-core` (the package specifier every spec outside
 * `packages/core` itself uses) resolve to two DIFFERENT files -- a
 * TypeScript source module and its separately-bundled `dist/index.js` --
 * so each holds its own independent copy of this module's `watermarkPos`/
 * `watermarkExpected`/`watermarkInput` variables. A spec under
 * `packages/core/src/*.spec.ts` imports the source directly and is
 * covered by resetting the source instance alone; every other package's
 * specs (parser/cli/generator/combinator/samples -- anything importing
 * `@suzumiyaaoba/tpeg-core` by package specifier) needs the package
 * instance reset too, or this hook silently does nothing for them. Both
 * are reset here so neither family of specs depends on the other's
 * watermark instance being clean.
 */
import { beforeEach } from "bun:test";
import { resetFailureWatermark as resetFailureWatermarkFromSource } from "../packages/core/src/failure";
import { resetFailureWatermark as resetFailureWatermarkFromPackage } from "@suzumiyaaoba/tpeg-core";

beforeEach(() => {
  resetFailureWatermarkFromSource();
  resetFailureWatermarkFromPackage();
});
