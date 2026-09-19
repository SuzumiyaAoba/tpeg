import { parse } from "@suzumiyaaoba/tpeg-core";
import { evaluate, type ExpressionNode } from "./calculator";
import { start } from "./generated/arith.generated";

/**
 * Arithmetic parser -- `.tpeg` grammar twin.
 *
 * Same grammar as calculator.ts, expressed in `arith.tpeg` and compiled
 * by `generateTypeScriptParser` into `generated/arith.generated.ts`
 * (regenerate with `bun run regen`). The generated parser produces the
 * same ExpressionNode AST, so {@link evaluate} and `astToString` from
 * calculator.ts work on its output unchanged.
 */

/**
 * Parse an expression into the calculator's AST via the generated
 * parser. Throws on malformed input, exactly like `parseToAST`.
 */
export const parseToASTTpeg = (input: string): ExpressionNode => {
  const result = parse(start)(input);

  if (!result.success) {
    throw new Error(`Parse error: ${result.error.message}`);
  }

  return result.val as ExpressionNode;
};

/**
 * Parse and evaluate via the generated parser -- the `.tpeg` twin of
 * `calculate`.
 */
export const calculateTpeg = (input: string): number =>
  evaluate(parseToASTTpeg(input));
