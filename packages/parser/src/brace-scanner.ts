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

import type { Parser } from "@suzumiyaaoba/tpeg-core";
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

/** Identifier-start characters in the JavaScript source embedded in action/transform bodies. */
export const JS_IDENTIFIER_START = /[a-zA-Z_$]/;

/** Identifier-continuation characters in embedded JavaScript source. */
export const JS_IDENTIFIER_CONT = /[a-zA-Z0-9_$]/;

/**
 * Keywords after which a value -- and therefore a regex literal -- can
 * start (`return /re/`, `case /x/:`, `x instanceof /re/`...). A `/`
 * following any other identifier is a division operator instead.
 */
export const REGEX_PREFIX_KEYWORDS: ReadonlySet<string> = new Set([
  "await",
  "case",
  "default",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

/**
 * Advances past a regex literal starting at `start` (which must point at
 * the opening `/`), honoring `\` escapes and `[...]` character classes (a
 * `/` inside a class does not end the pattern). Returns the index just
 * past the closing `/` and any trailing flag letters, or -1 when the text
 * starting at `start` is not a well-formed regex literal -- a regex cannot
 * contain an unescaped line break, so hitting one (or the end of input)
 * means the `/` was actually a division operator or something else.
 */
export const scanRegexLiteral = (input: string, start: number): number => {
  let i = start + 1;
  let inClass = false;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      return -1;
    }
    if (inClass) {
      if (ch === "]") {
        inClass = false;
      }
      i++;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      i++;
      continue;
    }
    if (ch === "/") {
      i++;
      while (i < input.length && input[i] >= "a" && input[i] <= "z") {
        i++;
      }
      return i;
    }
    i++;
  }
  return -1;
};

/** Advances past a `/* ... *\/` block comment starting at `start`. See {@link skipStringLiteral}. */
export const skipBlockComment = (input: string, start: number): number => {
  const endIndex = input.indexOf("*/", start + 2);
  return endIndex === -1 ? input.length : endIndex + 2;
};

/**
 * Parses a `{ ... }` block starting at (or after) `pos`, returning the raw
 * text between the braces. Braces, quotes, and comments inside string
 * literals/comments are ignored when counting depth. Regex literals are
 * recognized via the standard regex-vs-division heuristic: a `/` opens a
 * regex only where a value/expression is expected (after an operator,
 * `(`, `,`, `;`, a keyword like `return`, the start of a block, ...).
 * `)`/`]` count as operand ends, so `if (x) /re/` scans the `/` as
 * division -- a documented limitation shared with the self-hosted
 * grammar's `actionBlock` rule.
 */
export const scanBalancedBraces: Parser<string> = (
  input: string,
  pos: number,
) => {
  const openBracePos = input.indexOf("{", pos);
  if (openBracePos === -1) {
    return createFailure("Expected opening brace '{'", pos, {
      expected: ["{"],
      found: input[pos] ?? "",
      parserName: "scanBalancedBraces",
    });
  }

  let braceCount = 0;
  let closeBracePos = -1;
  let i = openBracePos;
  // Whether a `/` here could open a regex literal -- i.e. a value or
  // expression is expected at this point rather than a binary operator.
  let exprExpected = true;

  while (i < input.length) {
    const ch = input[i];

    if (ch === "{") {
      braceCount++;
      exprExpected = true;
      i++;
      continue;
    }
    if (ch === "}") {
      braceCount--;
      i++;
      // A `}` inside the body ends a statement or object literal; treating
      // it as "value expected" matches the self-hosted grammar, which folds
      // an optional trailing regex into its nested-block rule.
      exprExpected = true;
      if (braceCount === 0) {
        closeBracePos = i - 1;
        break;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipStringLiteral(input, i, ch);
      exprExpected = false;
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
    if (ch === "/" && exprExpected) {
      const regexEnd = scanRegexLiteral(input, i);
      if (regexEnd !== -1) {
        i = regexEnd;
        exprExpected = false;
        continue;
      }
      // Not a well-formed regex -- a division operator, which expects an
      // operand next.
      exprExpected = true;
      i++;
      continue;
    }
    if (JS_IDENTIFIER_START.test(ch)) {
      let wordEnd = i + 1;
      while (
        wordEnd < input.length &&
        JS_IDENTIFIER_CONT.test(input[wordEnd])
      ) {
        wordEnd++;
      }
      exprExpected = REGEX_PREFIX_KEYWORDS.has(input.slice(i, wordEnd));
      i = wordEnd;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      exprExpected = false;
      i++;
      continue;
    }
    if (ch === ")" || ch === "]") {
      exprExpected = false;
      i++;
      continue;
    }
    if ((ch === "+" || ch === "-") && input[i + 1] === ch) {
      // Postfix `++`/`--` ends an operand.
      exprExpected = false;
      i += 2;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    // Any other punctuator cannot end an operand, so a value is expected.
    exprExpected = true;
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

  return {
    success: true as const,
    val: bodyContent,
    current: pos,
    next: nextOffset,
  };
};
