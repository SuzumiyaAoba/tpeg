import { readFileSync } from "node:fs";
import {
  generateNativeParser,
  generateJavaScriptParser,
  isNativeLanguage,
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
  stripFileBom,
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
      : stripFileBom(readFileSync(options.headerPath, "utf8"));
  const sharedOptions = {
    ...(header !== undefined ? { header } : {}),
    ...(options.namePrefix !== undefined
      ? { namePrefix: options.namePrefix }
      : {}),
  };
  // Regex fusion happens inside code generation, after every AST rewrite.
  // Leave its default scope intact unless subtree fusion was requested.
  if (isNativeLanguage(options.language)) {
    return generateNativeParser(grammar, options.language, {
      ...sharedOptions,
      ...(options.packageName !== undefined
        ? { packageName: options.packageName }
        : {}),
    });
  }
  const tsOptions = { ...sharedOptions, includeTypes: options.types };
  const optimizedOptions = {
    ...tsOptions,
    ...(options.regexFusion ? { enableRegexFusion: true } : {}),
    ...(options.regexFusionSubtree
      ? { regexFusionScope: "subtree" as const }
      : {}),
  };
  if (options.language === "javascript")
    return generateJavaScriptParser(grammar, {
      ...optimizedOptions,
      optimize: options.optimize,
    });
  const generated = options.optimize
    ? generateOptimizedTypeScriptParser(grammar, optimizedOptions)
    : generateTypeScriptParser(grammar, tsOptions);
  return header === undefined
    ? generated
    : { ...generated, code: `${header}\n${generated.code}` };
};
