import {
  createFailure,
  isValidOffset,
  type Parser,
} from "@suzumiyaaoba/tpeg-core";

type Language = "python" | "go" | "rust";

class StringNestingLimit extends Error {
  constructor(readonly offset: number) {
    super("Native string nesting limit exceeded");
  }
}

function quoted(input: string, start: number): number {
  const quote = input[start];
  for (let index = start + 1; index < input.length; index++) {
    if (input[index] === "\\") index++;
    else if (input[index] === quote) return index + 1;
  }
  return -1;
}

function pythonString(input: string, start: number, nesting = 0): number {
  if (nesting > 128) throw new StringNestingLimit(start);
  const quote = input[start]!;
  const delimiter = input.startsWith(quote.repeat(3), start)
    ? quote.repeat(3)
    : quote;
  let prefix = start;
  while (prefix > 0 && /[a-zA-Z_0-9]/.test(input[prefix - 1]!)) prefix--;
  const formatted = /^(?:f|fr|rf|t|tr|rt)$/i.test(input.slice(prefix, start));
  let index = start + delimiter.length;
  while (index < input.length) {
    if (input[index] === "\\") {
      index +=
        formatted && (input[index + 1] === "{" || input[index + 1] === "}")
          ? 1
          : 2;
      continue;
    }
    if (input.startsWith(delimiter, index)) return index + delimiter.length;
    if (formatted && input[index] === "{") {
      if (input[index + 1] === "{") {
        index += 2;
        continue;
      }
      index = pythonReplacement(input, index + 1, nesting + 1);
      if (index < 0) return -1;
      continue;
    }
    index++;
  }
  return -1;
}

function pythonReplacement(
  input: string,
  start: number,
  nesting: number,
): number {
  let depth = 1;
  let index = start;
  while (index < input.length) {
    const char = input[index];
    if (char === '"' || char === "'") {
      index = pythonString(input, index, nesting);
      if (index < 0) return -1;
      continue;
    }
    if (char === "#") {
      const end = input.indexOf("\n", index);
      index = end < 0 ? input.length : end + 1;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return index + 1;
    index++;
  }
  return -1;
}

function rustRawString(input: string, start: number): number | undefined {
  if (start > 0 && /[a-zA-Z_0-9]/.test(input[start - 1]!)) return undefined;
  let index = start;
  if (input[index] === "b" || input[index] === "c") index++;
  if (input[index] !== "r") return undefined;
  const hashes = ++index;
  while (input[index] === "#") index++;
  if (input[index] !== '"') return undefined;
  const delimiter = '"' + input.slice(hashes, index);
  const end = input.indexOf(delimiter, index + 1);
  return end < 0 ? -1 : end + delimiter.length;
}

/** A Rust lifetime/label is not a character literal and has no closing quote. */
function rustChar(input: string, start: number): number | undefined {
  let index = start + 1;
  if (input[index] === "\\") {
    if (input[index + 1] === "u" && input[index + 2] === "{") {
      const end = input.indexOf("}", index + 3);
      if (end < 0) return undefined;
      index = end + 1;
    } else index += input[index + 1] === "x" ? 4 : 2;
  } else index += (input.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
  return input[index] === "'" ? index + 1 : undefined;
}

function blockComment(input: string, start: number, nested: boolean): number {
  let depth = 1;
  let index = start + 2;
  while (index < input.length) {
    if (nested && input.startsWith("/*", index)) {
      depth++;
      index += 2;
    } else if (input.startsWith("*/", index)) {
      index += 2;
      if (--depth === 0) return index;
    } else index++;
  }
  return -1;
}

function nativeBody(language: Language): Parser<string> {
  return (input, pos) => {
    if (!isValidOffset(pos) || input[pos] !== "{")
      return createFailure("Expected opening brace '{'", pos, {
        expected: ["{"],
        parserName: "functionBody",
      });
    let depth = 1;
    let index = pos + 1;
    try {
      while (index < input.length) {
        const char = input[index];
        let end: number | undefined;
        if (language === "python") {
          if (char === "#") {
            const next = input.indexOf("\n", index);
            end = next < 0 ? input.length : next + 1;
          } else if (char === '"' || char === "'")
            end = pythonString(input, index);
        } else {
          if (input.startsWith("//", index)) {
            const next = input.indexOf("\n", index);
            end = next < 0 ? input.length : next + 1;
          } else if (input.startsWith("/*", index))
            end = blockComment(input, index, language === "rust");
          else if (language === "rust") {
            end = rustRawString(input, index);
            if (end === undefined && char === "'") end = rustChar(input, index);
            if (end === undefined && char === '"') end = quoted(input, index);
          } else if (char === "`") {
            const next = input.indexOf("`", index + 1);
            end = next < 0 ? -1 : next + 1;
          } else if (char === '"' || char === "'") end = quoted(input, index);
        }
        if (end !== undefined) {
          if (end < 0) break;
          index = end;
          continue;
        }
        if (char === "{") depth++;
        if (char === "}" && --depth === 0)
          return {
            success: true,
            val: input.slice(pos + 1, index),
            current: pos,
            next: index + 1,
          };
        index++;
      }
    } catch (error) {
      if (!(error instanceof StringNestingLimit)) throw error;
      return createFailure(error.message, error.offset, {
        fatal: true,
        abort: true,
        parserName: "functionBody",
      });
    }
    return createFailure(
      `Unterminated ${language} transform body`,
      input.length,
      { expected: ["}"], found: "EOF", parserName: "functionBody" },
    );
  };
}

/** Lexical primitives shared by the handwritten and self-hosted TPEG parsers. */
export const nativeTransformBodies = Object.freeze({
  python: nativeBody("python"),
  go: nativeBody("go"),
  rust: nativeBody("rust"),
});
