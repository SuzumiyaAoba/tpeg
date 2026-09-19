import { parse } from "@suzumiyaaoba/tpeg-core";
import { start } from "./generated/ini.generated";
import { assembleIniData, type IniData, type IniLine } from "./ini";

/**
 * INI parser -- `.tpeg` grammar twin.
 *
 * Same grammar as ini.ts, expressed in `ini.tpeg` and compiled by
 * `generateTypeScriptParser` into `generated/ini.generated.ts`
 * (regenerate with `bun run regen`). The generated parser produces the
 * same IniLine stream; the shared {@link assembleIniData} folds it into
 * IniData so the assembly rules live in one place.
 */

/**
 * Parse an INI document via the generated parser -- the `.tpeg` twin
 * of `parseINI`.
 */
export const parseINITpeg = (input: string): IniData => {
  const result = parse(start)(input);

  if (!result.success) {
    throw new Error(`INI parse error: ${result.error.message}`);
  }

  return assembleIniData(result.val as IniLine[]);
};
