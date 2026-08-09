/**
 * Regression guard for a specific build-configuration bug: `bun build`
 * with no `--external`/`--packages=external` flag inlines EVERY module a
 * package imports, including a workspace dependency it should instead
 * import at runtime. `tpeg-combinator`'s `package.json` `build` script
 * used to omit that flag, so `dist/index.js` carried its own complete,
 * separately-bundled copy of `@suzumiyaaoba/tpeg-core` -- including
 * `packages/core/src/failure.ts`'s module-scoped farthest-failure
 * watermark (`watermarkInput`/`watermarkPos`/`watermarkExpected`).
 *
 * The practical failure mode: `memoize` (`./logic.ts`) lives in
 * `tpeg-combinator` and internally calls `snapshotFailureWatermark`/
 * `mergeFailureWatermark` to replay a cache hit's diagnostic
 * contribution, while every leaf parser (`literal`/`charClass`/
 * `charClassRun`/...) a real generated parser calls lives in and is
 * imported from `tpeg-core` directly. With the duplicate-bundle bug,
 * those two families of calls read/wrote two INDEPENDENT copies of the
 * watermark -- `memoize` could never see a leaf failure's contribution at
 * all, so a cache hit's `error.pos`/`.expected` silently degraded to "not
 * recorded" (`pos: -1`, `expected: undefined`, `message: "Parse failed"`)
 * instead of reproducing the original miss's diagnostics. This never
 * changed whether a parse succeeded (per `failure.ts`'s own
 * "diagnostics-only" contract), but it made this exact class of
 * diagnostic bug invisible to `packages/combinator/src/logic.spec.ts`,
 * which imports `memoize` from `./logic` (the TypeScript source,
 * naturally a single unbundled instance) rather than through the
 * package specifier every real consumer (and every generated parser)
 * actually uses.
 *
 * This test only makes sense once BOTH packages are built (`bun run
 * build`), since it imports each package's built `dist/index.js` via its
 * package specifier -- not TypeScript sources, which can't exhibit this
 * bug at all. Run after `bun run build`, matching CI's `check` ->
 * `build` -> `typecheck` -> `test` order (see CLAUDE.md).
 */

import { describe, expect, it } from "bun:test";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import * as core from "@suzumiyaaoba/tpeg-core";

describe("tpeg-combinator's dist does not duplicate-bundle tpeg-core", () => {
  it("memoize (from the combinator package) reproduces a leaf failure's diagnostics (from the core package) on a cache hit", () => {
    // `choice`/`charClassRun` are `tpeg-core` leaf/combinator parsers,
    // called through the PACKAGE specifier (not `./` source-relative,
    // unlike `logic.spec.ts`) -- exactly how generated code imports them.
    // `memoize` is `tpeg-combinator`'s, likewise through its package
    // specifier. If `tpeg-combinator`'s dist duplicate-bundles
    // `tpeg-core`, `memoize`'s `snapshotFailureWatermark`/
    // `mergeFailureWatermark` calls operate on a watermark instance these
    // leaf parsers' `fail()` calls never touch, and the cache-hit
    // diagnostics collapse to "nothing recorded".
    const term = combinator.memoize(
      core.choice(core.literal("aa"), core.charClassRun([["0", "9"]], 1)),
    );
    const miss = core.parse(term)("zz");
    const hit = core.parse(term)("zz");

    expect(miss.success).toBe(false);
    expect(hit.success).toBe(false);
    if (!miss.success && !hit.success) {
      expect(hit.error.pos).toBe(miss.error.pos);
      // `expected`'s declared type (`string | string[] | undefined`) makes
      // `toEqual`'s generic parameter reject the `undefined` branch when
      // passed directly -- both sides are already known non-`undefined`
      // failures here, so `JSON.stringify` sidesteps that without
      // weakening what's actually being compared.
      expect(JSON.stringify(hit.error.expected)).toBe(
        JSON.stringify(miss.error.expected),
      );
      expect(hit.error.message).toBe(miss.error.message);
      // The collapsed state a duplicate-bundled `tpeg-core` produces --
      // pinned explicitly so a future regression's failure message names
      // the actual symptom, not just "these two don't match".
      expect(hit.error.message).not.toBe("Parse failed");
    }
  });
});
