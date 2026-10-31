import { readFileSync } from "node:fs";
import {
  generateNativeParser,
  transpileGeneratedParser,
  type NativeLanguage,
} from "@suzumiyaaoba/tpeg-generator";
import {
  type GeneratedCode,
  type GrammarDefinition,
  analyzeFirstSets,
  applyAstOptimizations,
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
  insertAutomaticCuts,
  promoteGlobalCuts,
} from "@suzumiyaaoba/tpeg-parser";
import type { CliOptions } from "./options";

/** Applies the requested AST rewrites in their required order. */
export const prepareGrammar = (
  grammar: GrammarDefinition,
  options: CliOptions,
): GrammarDefinition => {
  const astOptimized = options.astOptimize
    ? applyAstOptimizations(grammar)
    : grammar;
  // Left factoring can expose additional cut sites, so insert cuts second.
  const cutInserted = options.autoCut
    ? insertAutomaticCuts(astOptimized)
    : astOptimized;
  // Promotion needs FIRST sets for the grammar after all preceding rewrites.
  return options.promoteCuts
    ? promoteGlobalCuts(cutInserted, analyzeFirstSets(cutInserted)).grammar
    : cutInserted;
};

/** Selects a generator without mixing optimized-only options into the base API. */
export const generateParser = (
  grammar: GrammarDefinition,
  options: CliOptions,
): Pick<GeneratedCode, "code" | "exports" | "warnings"> => {
  const header =
    options.headerPath === undefined
      ? undefined
      : readFileSync(options.headerPath, "utf8").replace(/^\uFEFF/, "");
  const sharedOptions = {
    includeTypes: options.language === "javascript" || options.types,
    ...(options.namePrefix !== undefined
      ? { namePrefix: options.namePrefix }
      : {}),
  };
  // Regex fusion happens inside code generation, after every AST rewrite.
  // Leave its default scope intact unless subtree fusion was requested.
  if (["python", "go", "rust"].includes(options.language)) {
    return generateNativeParser(grammar, options.language as NativeLanguage, {
      ...(options.namePrefix !== undefined
        ? { namePrefix: options.namePrefix }
        : {}),
      ...(options.packageName !== undefined
        ? { packageName: options.packageName }
        : {}),
      ...(header !== undefined ? { header } : {}),
    });
  }
  const generated = options.optimize
    ? generateOptimizedTypeScriptParser(grammar, {
        ...sharedOptions,
        ...(options.regexFusion ? { enableRegexFusion: true } : {}),
        ...(options.regexFusionSubtree
          ? { regexFusionScope: "subtree" as const }
          : {}),
      })
    : generateTypeScriptParser(grammar, sharedOptions);
  if (header !== undefined) generated.code = `${header}\n${generated.code}`;
  if (options.language === "javascript")
    generated.code = transpileGeneratedParser(generated.code);
  return generated;
};
