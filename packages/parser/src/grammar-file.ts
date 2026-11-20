import {
  createGrammarDefinition,
  type GrammarDefinition,
  offsetToPos,
  parse,
  type ModularGrammarDefinition,
  type ModuleFile,
  type ParseError,
} from "@suzumiyaaoba/tpeg-core";
import { tpegModuleFile } from "./grammar";
import { skipGrammarTrivia } from "./whitespace-utils";

type GrammarFileResult =
  | {
      success: true;
      val: ModuleFile & { grammars: [ModularGrammarDefinition] };
    }
  | {
      success: false;
      kind: "syntax" | "trailing";
      error: ParseError;
      line: number;
      column: number;
    };

export const stripFileBom = (source: string): string =>
  source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;

/** Project a module's local grammar into the input expected by standalone generators. */
export const toGrammarDefinition = ({
  name,
  annotations,
  rules,
  transforms,
}: ModularGrammarDefinition): GrammarDefinition =>
  createGrammarDefinition(name, annotations, rules, transforms);

/**
 * Parse one complete .tpeg source file, including its imports and transforms.
 * Diagnostics refer to the text after its optional BOM. Lines and columns
 * are one-based for display; error.pos is a zero-based UTF-16 offset.
 */
export function parseGrammarFile(
  filePath: string,
  source: string,
): GrammarFileResult {
  const text = stripFileBom(source);
  const result = parse(tpegModuleFile)(text);
  let error: ParseError;
  if (result.success) {
    const end = skipGrammarTrivia(text, result.next);
    if (end === text.length) {
      const { imports, grammar } = result.val;
      return {
        success: true,
        val: {
          type: "ModuleFile",
          filePath,
          imports,
          grammars: [grammar],
          ...(grammar.moduleInfo ? { moduleInfo: grammar.moduleInfo } : {}),
        },
      };
    }
    error = text.startsWith("/*", end)
      ? { message: "Unterminated block comment", pos: end, expected: "*/" }
      : { message: "Unexpected trailing content", pos: end };
  } else {
    error = result.error;
  }
  const { line, column } = offsetToPos(text, error.pos);
  return {
    success: false,
    kind: result.success ? "trailing" : "syntax",
    error,
    line,
    column: column + 1,
  };
}
