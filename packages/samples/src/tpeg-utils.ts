import { readFileSync } from "node:fs";
import {
  type GrammarDefinition,
  offsetToPos,
  parse,
} from "@suzumiyaaoba/tpeg-core";
import {
  generateTypeScriptParser,
  skipTrailingWhitespaceAndComments,
  tpegModuleFile,
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

/**
 * Reads a `.tpeg` file and returns its grammar AST.
 *
 * `tpegModuleFile` (not `tpegFile`) is what the CLI parses with -- it
 * also accepts leading `import "..."` statements. `parse()` only
 * requires a prefix match, so the trailing-content check mirrors the
 * CLI's: anything left over after the grammar/transforms blocks is
 * reported as an error at its line/column rather than silently dropped.
 */
export const loadGrammar = (path: string): GrammarDefinition => {
  const source = readFileSync(path, "utf8");
  const result = parse(tpegModuleFile)(source);
  const fullyConsumed =
    result.success &&
    skipTrailingWhitespaceAndComments(source, result.next) === source.length;

  if (!result.success || !fullyConsumed) {
    const offset = result.success ? result.next : result.error.pos;
    const { line, column } = offsetToPos(source, offset);
    const message = result.success
      ? `unexpected content after line ${line}, column ${column + 1}`
      : `line ${line}, column ${column + 1}: ${result.error.message}`;
    throw new Error(`failed to parse ${path}: ${message}`);
  }

  // `tpegModuleFile` returns a ModularGrammarDefinition carrying
  // module-only fields (imports/exports) the generators don't consume --
  // hand them the plain GrammarDefinition, exactly like the CLI does.
  const mod = result.val;
  return {
    type: "GrammarDefinition",
    name: mod.grammar.name,
    annotations: mod.grammar.annotations,
    rules: mod.grammar.rules,
    ...(mod.grammar.transforms !== undefined
      ? { transforms: mod.grammar.transforms }
      : {}),
  };
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
