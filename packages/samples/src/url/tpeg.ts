import { parse } from "@suzumiyaaoba/tpeg-core";
import { start } from "./generated/url.generated";
import type { UrlParts } from "./url";

/**
 * URL parser -- `.tpeg` grammar twin.
 *
 * Same grammar as url.ts, expressed in `url.tpeg` and compiled by
 * `generateTypeScriptParser` into `generated/url.generated.ts`
 * (regenerate with `bun run regen`). The `~` cut in the grammar plays
 * the same role as url.ts's `commit`: once `//` has matched, a
 * malformed authority/path is fatal rather than a fall-back to the
 * opaque-path alternative.
 */

/**
 * Parse an absolute URL via the generated parser -- the `.tpeg` twin
 * of `parseUrl`.
 */
export const parseUrlTpeg = (input: string): UrlParts => {
  const result = parse(start)(input);

  if (!result.success) {
    throw new Error(`URL parse error: ${result.error.message}`);
  }

  return result.val as UrlParts;
};
