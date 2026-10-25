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
): GeneratedCode => {
  const sharedOptions = {
    includeTypes: options.types,
    ...(options.namePrefix !== undefined
      ? { namePrefix: options.namePrefix }
      : {}),
  };
  // Regex fusion happens inside code generation, after every AST rewrite.
  // Leave its default scope intact unless subtree fusion was requested.
  return options.optimize
    ? generateOptimizedTypeScriptParser(grammar, {
        ...sharedOptions,
        ...(options.regexFusion ? { enableRegexFusion: true } : {}),
        ...(options.regexFusionSubtree
          ? { regexFusionScope: "subtree" as const }
          : {}),
      })
    : generateTypeScriptParser(grammar, sharedOptions);
};
