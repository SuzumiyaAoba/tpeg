import { parse } from "@suzumiyaaoba/tpeg-core";
import { start } from "./generated/sexpr.generated";
import type { SExp } from "./sexpr";

/**
 * S-expression parser -- `.tpeg` grammar twin.
 *
 * Same grammar as sexpr.ts, expressed in `sexpr.tpeg` and compiled by
 * `generateTypeScriptParser` into `generated/sexpr.generated.ts`
 * (regenerate with `bun run regen`). Atoms keep their tagged shape
 * ({type:"symbol"|"string"|"number"}) so `printSExp` and any consumer
 * of {@link SExp} work unchanged.
 */

/**
 * Parse a document of S-expressions via the generated parser -- the
 * `.tpeg` twin of `parseSExprs`.
 */
export const parseSExprsTpeg = (input: string): SExp[] => {
  const result = parse(start)(input);

  if (!result.success) {
    throw new Error(`S-expression parse error: ${result.error.message}`);
  }

  return result.val as SExp[];
};

/**
 * Parse exactly one S-expression via the generated parser -- the
 * `.tpeg` twin of `parseSExpr`.
 */
export const parseSExprTpeg = (input: string): SExp => {
  const [form, ...rest] = parseSExprsTpeg(input);

  if (form === undefined || rest.length > 0) {
    throw new Error(
      `Expected exactly one S-expression, found ${
        form === undefined ? 0 : rest.length + 1
      }`,
    );
  }

  return form;
};
