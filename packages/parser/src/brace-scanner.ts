/**
 * Shared Balanced-Brace Scanner
 *
 * Scans a `{ ... }` block and returns its inner content, tracking brace
 * depth so nested `{`/`}` don't end the block early. Unlike naive brace
 * counting, this skips over the contents of string/template literals and
 * comments, so a `}` appearing inside e.g. `{ return "}"; }` or a `//` line
 * comment doesn't prematurely close the block.
 *
 * Used by both the transform function body parser (`transforms.ts`) and the
 * semantic action block parser (`composition.ts`), which both embed raw
 * TypeScript source text between braces.
 */

import type { Parser, Pos } from "@suzumiyaaoba/tpeg-core";
import { createFailure } from "@suzumiyaaoba/tpeg-core";

/**
 * Advances past a quoted string literal starting at `start` (which must
 * point at the opening `quote` character), honoring backslash escapes.
 * Returns the index just past the closing quote (or `input.length` if
 * unterminated). Exported so other scanners that need to skip over
 * arbitrary embedded code - e.g. `grammar.ts`'s rule-boundary detector, which
 * must not mistake a `{`/`}` inside a string literal for a brace to count -
 * can reuse the exact same rule instead of a second, potentially-diverging
 * implementation.
 */
export const skipStringLiteral = (
  input: string,
  start: number,
  quote: string,
): number => {
  let i = start + 1;
  while (i < input.length) {
    if (input[i] === "\\") {
      i += 2;
      continue;
    }
    if (input[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return i;
};

/** Advances past a `// ...` line comment starting at `start`. See {@link skipStringLiteral}. */
export const skipLineComment = (input: string, start: number): number => {
  const newlineIndex = input.indexOf("\n", start);
  return newlineIndex === -1 ? input.length : newlineIndex;
};

/** Advances past a `/* ... *\/` block comment starting at `start`. See {@link skipStringLiteral}. */
export const skipBlockComment = (input: string, start: number): number => {
  const endIndex = input.indexOf("*/", start + 2);
  return endIndex === -1 ? input.length : endIndex + 2;
};

/**
 * Parses a `{ ... }` block starting at (or after) `pos`, returning the raw
 * text between the braces. Braces, quotes, and comments inside string
 * literals/comments are ignored when counting depth.
 */
export const scanBalancedBraces: Parser<string> = (input: string, pos: Pos) => {
  const openBracePos = input.indexOf("{", pos.offset);
  if (openBracePos === -1) {
    return createFailure("Expected opening brace '{'", pos, {
      expected: ["{"],
      found: input[pos.offset] ?? "",
      parserName: "scanBalancedBraces",
    });
  }

  let braceCount = 0;
  let closeBracePos = -1;
  let i = openBracePos;

  while (i < input.length) {
    const ch = input[i];

    if (ch === "{") {
      braceCount++;
      i++;
      continue;
    }
    if (ch === "}") {
      braceCount--;
      i++;
      if (braceCount === 0) {
        closeBracePos = i - 1;
        break;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipStringLiteral(input, i, ch);
      continue;
    }
    if (ch === "/" && input[i + 1] === "/") {
      i = skipLineComment(input, i);
      continue;
    }
    if (ch === "/" && input[i + 1] === "*") {
      i = skipBlockComment(input, i);
      continue;
    }
    i++;
  }

  if (closeBracePos === -1) {
    return createFailure("Expected closing brace '}'", pos, {
      expected: ["}"],
      found: input[input.length - 1] ?? "",
      parserName: "scanBalancedBraces",
    });
  }

  const bodyContent = input.slice(openBracePos + 1, closeBracePos);
  const nextOffset = closeBracePos + 1;
  const consumed = nextOffset - pos.offset;
  let nextLine = pos.line;
  let nextColumn = pos.column + consumed;
  const consumedText = input.slice(pos.offset, nextOffset);
  const lines = consumedText.split("\n");
  if (lines.length > 1) {
    nextLine += lines.length - 1;
    nextColumn = (lines[lines.length - 1] ?? "").length + 1;
  }

  return {
    success: true as const,
    val: bodyContent,
    current: pos,
    next: {
      offset: nextOffset,
      line: nextLine,
      column: nextColumn,
    },
  };
};
