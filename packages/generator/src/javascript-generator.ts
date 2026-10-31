import * as nodeModule from "node:module";
import type { GrammarDefinition } from "@suzumiyaaoba/tpeg-core";
import {
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
  type OptimizedCodeGenOptions,
} from "@suzumiyaaoba/tpeg-parser";

/** Strip types in generated wrappers, actions and transforms on Node or Bun. */
export function transpileGeneratedParser(code: string): string {
  return typeof Bun !== "undefined"
    ? new Bun.Transpiler({ loader: "ts", target: "node" }).transformSync(code)
    : nodeModule.stripTypeScriptTypes(code, { mode: "transform" });
}

export function generateJavaScriptParser(
  grammar: GrammarDefinition,
  options: Partial<OptimizedCodeGenOptions> & { header?: string } = {},
) {
  const generate = options.optimize
    ? generateOptimizedTypeScriptParser
    : generateTypeScriptParser;
  const generated = generate(grammar, { ...options, includeTypes: true });
  return {
    ...generated,
    code: transpileGeneratedParser(
      options.header === undefined
        ? generated.code
        : `${options.header}\n${generated.code}`,
    ),
    language: "javascript",
    extension: ".js",
  };
}
