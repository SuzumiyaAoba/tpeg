import { parse } from "@suzumiyaaoba/tpeg-core";
import { dropPhantomRows } from "./csv";
import { start } from "./generated/csv.generated";

/**
 * CSV parser -- `.tpeg` grammar twin.
 *
 * Same grammar as csv.ts, expressed in `csv.tpeg` and compiled by
 * `generateTypeScriptParser` into `generated/csv.generated.ts`
 * (regenerate with `bun run regen`). The generated parser produces the
 * raw row stream; the shared {@link dropPhantomRows} applies the same
 * trailing-newline filtering `parseCSV` does.
 */

/**
 * Parse CSV text into rows of fields via the generated parser -- the
 * `.tpeg` twin of `parseCSV`.
 */
export const parseCSVTpeg = (input: string): string[][] => {
  const result = parse(start)(input);

  if (!result.success) {
    throw new Error(`CSV parse error: ${result.error.message}`);
  }

  return dropPhantomRows(result.val as (string[] | null)[]);
};
