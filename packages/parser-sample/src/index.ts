/**
 * TPEG Parser Sample - Main Export
 *
 * This package demonstrates all implemented TPEG parser capabilities.
 * Use the demo scripts to see the parser in action.
 */

// Re-export key parser functionality for external use
export {
  basicSyntax,
  characterClass,
  grammarDefinition,
  identifier,
  ruleDefinition,
  stringLiteral,
  tpegExpression,
} from "@SuzumiyaAoba/parser";

// Re-export core parsing utilities
export { parse } from "@SuzumiyaAoba/core";

// Demo functions for programmatic use
// Helper function to run demo scripts
const runDemo = async (script: string) => {
  const { spawn } = await import("bun");
  const proc = spawn(["bun", "run", script], {
    cwd: `${import.meta.dir}/..`,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return proc.exited;
};

export const runBasicDemo = () => runDemo("src/basic-demo.ts");
export const runGrammarDemo = () => runDemo("src/grammar-demo.ts");
export const runFileDemo = () => runDemo("src/file-demo.ts");
export const runCompleteDemo = () => runDemo("src/demo.ts");
