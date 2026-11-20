import { readFileSync } from "node:fs";
import type { GrammarDefinition } from "@suzumiyaaoba/tpeg-core";
import {
  generateTypeScriptParser,
  parseGrammarFile,
  toGrammarDefinition,
} from "@suzumiyaaoba/tpeg-parser";

/**
 * Shared helpers for the `.tpeg` grammar twins.
 *
 * Every sample in this package has two implementations of the same
 * parser: the original hand-combinator version (`<name>.ts`) and a
 * `.tpeg` grammar file compiled to TypeScript
 * (`generated/<name>.generated.ts`). The helpers below are the pieces
 * the twins' specs and the `regen` script all need -- loading a
 * grammar file the same way the CLI does, and checking that a
 * committed generated file is still what the current generator emits.
 */

/** Read a sample grammar using the same complete-file parser as the CLI. */
export const loadGrammar = (path: string): GrammarDefinition => {
  const result = parseGrammarFile(path, readFileSync(path, "utf8"));
  if (!result.success) {
    throw new Error(
      `failed to parse ${path} at line ${result.line}, column ${result.column}: ${result.error.message}`,
    );
  }
  return toGrammarDefinition(result.val.grammars[0]);
};

/**
 * The code `generateTypeScriptParser` emits for `grammar`, normalized
 * to a trailing newline -- the exact byte content the `regen` script
 * writes and the freshness specs compare against.
 */
export const generatedSource = (grammar: GrammarDefinition): string => {
  const generated = generateTypeScriptParser(grammar, {});
  for (const warning of generated.warnings) {
    console.warn(`tpeg generation warning: ${warning}`);
  }
  return generated.code.endsWith("\n") ? generated.code : `${generated.code}\n`;
};
