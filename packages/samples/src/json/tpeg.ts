import { parse } from "@suzumiyaaoba/tpeg-core";
import { start } from "./generated/json.generated";
import type { JSONValue } from "./json";

/**
 * JSON parser -- `.tpeg` grammar twin.
 *
 * Same strict grammar as json.ts's fallback parser, expressed in
 * `json.tpeg` and compiled by `generateTypeScriptParser` into
 * `generated/json.generated.ts` (regenerate with `bun run regen`).
 * Unlike `parseJSON` there is no `JSON.parse` fast path -- every input
 * goes through the generated PEG parser.
 */

/**
 * Parse a JSON document via the generated parser.
 *
 * Mirrors `parseJSON`'s contract: `""` for empty input, the parsed
 * value on success, `null` on failure.
 */
export const parseJSONTpeg = (input: string): JSONValue | null | string => {
  if (!input) {
    return "";
  }

  const result = parse(start)(input);
  return result.success ? (result.val as JSONValue) : null;
};
