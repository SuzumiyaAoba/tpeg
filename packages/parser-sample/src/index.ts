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
} from "tpeg-parser";

// Re-export core parsing utilities
export { parse } from "tpeg-core";

// Demo functions for programmatic use
export const runBasicDemo = async () => {
  const { spawn } = await import("bun");
  const proc = spawn(["bun", "run", "src/basic-demo.ts"], {
    cwd: import.meta.dir + "/..",
    stdio: ["inherit", "inherit", "inherit"],
  });
  return proc.exited;
};

export const runGrammarDemo = async () => {
  const { spawn } = await import("bun");
  const proc = spawn(["bun", "run", "src/grammar-demo.ts"], {
    cwd: import.meta.dir + "/..",
    stdio: ["inherit", "inherit", "inherit"],
  });
  return proc.exited;
};

export const runCompleteDemo = async () => {
  const { spawn } = await import("bun");
  const proc = spawn(["bun", "run", "src/demo.ts"], {
    cwd: import.meta.dir + "/..",
    stdio: ["inherit", "inherit", "inherit"],
  });
  return proc.exited;
};