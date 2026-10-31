import type { GrammarDefinition } from "@suzumiyaaoba/tpeg-core";
import { EtaTPEGCodeGenerator } from "./eta-generator";
import { generateJavaScriptParser } from "./javascript-generator";
import {
  generateNativeParser,
  type NativeCodeGenOptions,
} from "./native-generator";
import type { CodeGenOptions } from "./types";

export interface ParserGenerationOptions
  extends NativeCodeGenOptions, Omit<Partial<CodeGenOptions>, "language"> {
  language?: string;
}

export interface GeneratedParser {
  code: string;
  language: string;
  extension: string;
  exports: string[];
  warnings: string[];
}

/** A plugin owns its output language and receives the canonical grammar AST. */
export interface CodeGeneratorPlugin {
  language: string;
  extension: string;
  generate(
    grammar: GrammarDefinition,
    options: ParserGenerationOptions,
  ): GeneratedParser | Promise<GeneratedParser>;
}

/** Registries are independent; registering a plugin never changes global state. */
export class CodeGeneratorRegistry {
  private readonly generators = new Map<string, CodeGeneratorPlugin>();

  register(plugin: CodeGeneratorPlugin): this {
    if (!plugin.language || !/^\.[a-zA-Z0-9]+$/.test(plugin.extension))
      throw new Error("A generator plugin needs a language and file extension");
    if (this.generators.has(plugin.language))
      throw new Error(
        `A generator is already registered for "${plugin.language}"`,
      );
    this.generators.set(plugin.language, plugin);
    return this;
  }

  languages(): { language: string; extension: string }[] {
    return [...this.generators.values()].map(({ language, extension }) => ({
      language,
      extension,
    }));
  }

  async generate(
    grammar: GrammarDefinition,
    options: ParserGenerationOptions = {},
  ): Promise<GeneratedParser> {
    const language = options.language ?? "typescript";
    const plugin = this.generators.get(language);
    if (!plugin)
      throw new Error(
        `Unsupported target language "${language}"; available: ${this.languages()
          .map((item) => item.language)
          .join(", ")}`,
      );
    return plugin.generate(grammar, options);
  }
}

export function createGeneratorRegistry(): CodeGeneratorRegistry {
  const registry = new CodeGeneratorRegistry();
  registry.register({
    language: "typescript",
    extension: ".ts",
    async generate(grammar, options) {
      const generated = await new EtaTPEGCodeGenerator({
        ...options,
        language: "typescript",
      }).generateGrammar(grammar);
      return {
        ...generated,
        code:
          options.header === undefined
            ? generated.code
            : `${options.header}\n${generated.code}`,
        language: "typescript",
        extension: options.includeTypes === false ? ".js" : ".ts",
      };
    },
  });
  registry.register({
    language: "javascript",
    extension: ".js",
    generate: (grammar, options) =>
      generateJavaScriptParser(grammar, { ...options, language: "typescript" }),
  });
  for (const language of ["python", "go", "rust"] as const) {
    registry.register({
      language,
      extension: { python: ".py", go: ".go", rust: ".rs" }[language],
      generate: (grammar, options) =>
        generateNativeParser(grammar, language, options),
    });
  }
  return registry;
}

export function generateParser(
  grammar: GrammarDefinition,
  options: ParserGenerationOptions = {},
): Promise<GeneratedParser> {
  return createGeneratorRegistry().generate(grammar, options);
}
