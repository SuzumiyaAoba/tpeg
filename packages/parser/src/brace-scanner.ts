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
 *
 * Template literals (backtick) additionally track `` ${ ... } ``
 * interpolations: the text between `${` and its matching `}` is JavaScript
 * code, not string content, so it is scanned with the same brace/string/
 * comment/regex-aware machinery `scanBalancedBraces` uses (see
 * `scanJsToBlockClose` below) - a `}` inside an interpolation's own nested
 * block, string, or template no longer ends the template early, and the
 * `}` matching the `${` itself correctly returns to template mode.
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
    if (quote === "`" && input[i] === "$" && input[i + 1] === "{") {
      const end = scanJsToBlockClose(input, i + 2);
      // An unterminated interpolation means the template itself is
      // unterminated - same contract as the unterminated-string case.
      if (end === -1) return input.length;
      i = end;
      continue;
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
      for (;;) {
        const flag = input[i];
        if (flag === undefined || flag < "a" || flag > "z") break;
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
 * Scans JavaScript source from `pos` -- the offset just AFTER an opening
 * `{` or `${` -- until it consumes the `}` that closes that block,
 * returning the index just past it (or -1 when unterminated). This is the
 * shared code-scanning loop behind both `scanBalancedBraces` (a `{ ... }`
 * action/transform body) and `skipStringLiteral`'s `` ${ ... } ``
 * interpolation handling: inside either, braces nest, string/template
 * literals and comments are skipped atomically, and regex literals are
 * recognized via the standard regex-vs-division heuristic (a `/` opens a
 * regex only where a value/expression is expected -- after an operator,
 * `(`, `,`, `;`, a keyword like `return`, the start of a block, ...).
 * `)`/`]` count as operand ends, so `if (x) /re/` scans the `/` as
 * division -- a documented limitation shared with the self-hosted
 * grammar's `actionBlock` rule.
 */
const scanJsToBlockClose = (input: string, pos: number): number => {
  let braceDepth = 1;
  let i = pos;
  // Whether a `/` here could open a regex literal -- i.e. a value or
  // expression is expected at this point rather than a binary operator.
  let exprExpected = true;

  while (i < input.length) {
    const ch = input[i];

    if (ch === "{") {
      braceDepth++;
      exprExpected = true;
      i++;
      continue;
    }
    if (ch === "}") {
      braceDepth--;
      i++;
      // A `}` inside the body ends a statement or object literal; treating
      // it as "value expected" matches the self-hosted grammar, which folds
      // an optional trailing regex into its nested-block rule.
      exprExpected = true;
      if (braceDepth === 0) {
        return i;
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
    if (JS_IDENTIFIER_START.test(ch ?? "")) {
      let wordEnd = i + 1;
      while (
        wordEnd < input.length &&
        JS_IDENTIFIER_CONT.test(input[wordEnd] ?? "")
      ) {
        wordEnd++;
      }
      exprExpected = REGEX_PREFIX_KEYWORDS.has(input.slice(i, wordEnd));
      i = wordEnd;
      continue;
    }
    if (ch !== undefined && ch >= "0" && ch <= "9") {
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

  return -1;
};

/**
 * Scans a template literal starting at `pos` (which must point at the
 * opening backtick) for a whole-word occurrence of `name`, returning
 * whether one was found and the index just past the closing backtick.
 * Raw template text is skipped -- `` `literal ${name}` `` only counts a
 * `name` inside `${ ... }`, where it is real JavaScript -- and each
 * interpolation body is located with `scanJsToBlockClose` (so nested
 * braces/strings/comments are handled exactly) then checked recursively.
 */
const scanTemplateForIdentifier = (
  input: string,
  pos: number,
  name: string,
): { found: boolean; end: number } => {
  let i = pos + 1;
  while (i < input.length) {
    if (input[i] === "\\") {
      i += 2;
      continue;
    }
    if (input[i] === "`") {
      return { found: false, end: i + 1 };
    }
    if (input[i] === "$" && input[i + 1] === "{") {
      const close = scanJsToBlockClose(input, i + 2);
      if (close === -1) return { found: false, end: input.length };
      if (codeContainsIdentifier(input.slice(i + 2, close - 1), name)) {
        return { found: true, end: close };
      }
      i = close;
      continue;
    }
    i++;
  }
  return { found: false, end: i };
};

/**
 * Whether `name` appears as a whole JavaScript identifier token anywhere
 * in `code` -- embedded action/transform source -- with string contents,
 * comments, and regex literals skipped (so `"$$"` or `// label` no longer
 * count as references, which is the false-positive that used to force a
 * spurious `const $$`/`const { label }` declaration under
 * `noUnusedLocals`), while `` ${ ... } `` interpolation bodies DO count
 * (they're real code -- `` `${$$}` `` genuinely references `$$`).
 *
 * Whole-token matching replaces the previous `includes("$$")` /
 * `new RegExp("\\b" + label + "\\b")` checks: `$$` is a legal JS
 * identifier token (`$` is an identifier char), so `$$$` or `$$foo` no
 * longer match `$$`, and label names containing regex-significant
 * characters can't corrupt the match. Shares
 * `scanJsToBlockClose`'s regex-vs-division heuristic: a `/` opens a regex
 * only where a value is expected (after an operator, `(`, `,`, a keyword
 * like `return`, the start of code, ...).
 */
export const codeContainsIdentifier = (code: string, name: string): boolean => {
  let i = 0;
  let exprExpected = true;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      i = skipStringLiteral(code, i, ch);
      exprExpected = false;
      continue;
    }
    if (ch === "`") {
      const result = scanTemplateForIdentifier(code, i, name);
      if (result.found) return true;
      i = result.end;
      exprExpected = false;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      i = skipLineComment(code, i);
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      i = skipBlockComment(code, i);
      continue;
    }
    if (ch === "/" && exprExpected) {
      const regexEnd = scanRegexLiteral(code, i);
      if (regexEnd !== -1) {
        i = regexEnd;
        exprExpected = false;
        continue;
      }
      exprExpected = true;
      i++;
      continue;
    }
    if (JS_IDENTIFIER_START.test(ch ?? "")) {
      let wordEnd = i + 1;
      while (
        wordEnd < code.length &&
        JS_IDENTIFIER_CONT.test(code[wordEnd] ?? "")
      ) {
        wordEnd++;
      }
      const word = code.slice(i, wordEnd);
      if (word === name) return true;
      exprExpected = REGEX_PREFIX_KEYWORDS.has(word);
      i = wordEnd;
      continue;
    }
    if (ch !== undefined && ch >= "0" && ch <= "9") {
      exprExpected = false;
      i++;
      continue;
    }
    if (ch === ")" || ch === "]") {
      exprExpected = false;
      i++;
      continue;
    }
    if ((ch === "+" || ch === "-") && code[i + 1] === ch) {
      exprExpected = false;
      i += 2;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    // Any other punctuator cannot end an operand, so a value is expected --
    // the same rule `scanJsToBlockClose` applies to `{`, `}`, `(`, `=`, ...
    exprExpected = true;
    i++;
  }
  return false;
};

/**
 * Parses a `{ ... }` block starting at (or after) `pos`, returning the raw
 * text between the braces. See `scanJsToBlockClose` above for the scanning
 * rules (nested braces, string/template literals including `` ${ ... } ``
 * interpolations, comments, and regex literals are all skipped atomically
 * so their contents never affect the brace count).
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

  const blockEnd = scanJsToBlockClose(input, openBracePos + 1);
  if (blockEnd === -1) {
    return createFailure("Expected closing brace '}'", pos, {
      expected: ["}"],
      found: input[input.length - 1] ?? "",
      parserName: "scanBalancedBraces",
    });
  }
  const closeBracePos = blockEnd - 1;

  const bodyContent = input.slice(openBracePos + 1, closeBracePos);
  const nextOffset = closeBracePos + 1;

  return {
    success: true as const,
    val: bodyContent,
    current: pos,
    next: nextOffset,
  };
};
