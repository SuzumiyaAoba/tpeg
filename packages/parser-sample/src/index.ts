/**
 * TPEG Parser Sample - Main Export
 *
 * This package demonstrates all implemented TPEG parser capabilities.
 * Use the demo scripts to see the parser in action.
 */

import { spawn } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

// Re-export key parser functionality for external use
export {
  basicSyntax,
  characterClass,
  grammarDefinition,
  identifier,
  ruleDefinition,
  stringLiteral,
  tpegExpression,
} from "@suzumiyaaoba/tpeg-parser";

// Re-export core parsing utilities
export { parse } from "@suzumiyaaoba/tpeg-core";

// Demo functions for programmatic use.
// The demos are separate pack entry points, so the same helper works both
// from source (`bun run src/index.ts`) and from the published bundle
// (`dist/index.js`).
const runDemo = async (script: string) => {
  const packageDir = join(moduleDir, "..");
  const extension = basename(moduleDir) === "dist" ? ".js" : ".ts";
  const scriptPath = join(moduleDir, `${script}${extension}`);
  const proc = spawn("bun", ["run", scriptPath], {
    cwd: packageDir,
    stdio: "inherit",
  });

  return new Promise<number>((resolve) => {
    proc.once("error", (error) => {
      console.error(`Failed to start Bun for ${scriptPath}:`, error);
      resolve(1);
    });
    proc.once("close", (code) => resolve(code ?? 1));
  });
};

export const runBasicDemo = () => runDemo("basic-demo");
export const runGrammarDemo = () => runDemo("grammar-demo");
export const runFileDemo = () => runDemo("file-demo");
export const runCompleteDemo = () => runDemo("demo");
