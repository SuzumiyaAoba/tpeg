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
import { createFailure, isValidOffset } from "@suzumiyaaoba/tpeg-core";

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
  templateDepth = 0,
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
      // `${` interpolates a single EXPRESSION, not a statement list --
      // see `scanJsToBlockClose`'s `startInStatementPosition` doc. The
      // interpolation body nests one level deeper (`templateDepth + 1`).
      const end = scanJsToBlockClose(input, i + 2, false, templateDepth + 1);
      // An unterminated (or depth-cap-rejected) interpolation means the
      // template itself is unterminated - same contract as the
      // unterminated-string case.
      if (end < 0) return input.length;
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
 * Keywords whose `( ... )` is followed by a STATEMENT, not a continuation
 * of the current expression: after `if (x)`, `while (x)`, `for (...)`,
 * `switch (x)`, `catch (e)`, or `with (x)`, the next token begins a new
 * statement/expression -- so a `/` there opens a regex literal, whereas a
 * `/` after a call or grouping paren (`foo(x) / y`, `(a + b) / c`) is
 * division. Used to decide what `)` does to `exprExpected`.
 */
const STMT_PAREN_KEYWORDS: ReadonlySet<string> = new Set([
  "if",
  "while",
  "for",
  "switch",
  "catch",
  "with",
]);

/**
 * Keywords directly followed by a BLOCK `{` (not an object literal) when a
 * value would otherwise be expected: `else {`, `try {`, `finally {`,
 * `do {`. These keywords are all in {@link REGEX_PREFIX_KEYWORDS} (a
 * value/regex may follow them), so without this set their `{` would be
 * misclassified as an object literal.
 */
const BLOCK_KEYWORDS: ReadonlySet<string> = new Set([
  "do",
  "else",
  "finally",
  "try",
]);

/**
 * Shared regex-vs-division disambiguation state for the JavaScript
 * scanners in this file (`scanJsToBlockClose`, `codeContainsIdentifier`)
 * and the mirrored copy in `grammar.ts`'s `grammarRuleExpression` -- kept
 * as one implementation so the three can never drift.
 *
 * The plain "operand just ended" heuristic is not enough on its own: `)`
 * and `}` each have TWO meanings. `)` closing a control-statement paren
 * (`if (x) /re/`) is followed by a new statement -- a `/` there opens a
 * regex -- while `)` closing a call or grouping (`f(x) / re/`) is an
 * operand end -- a `/` there is division. Likewise `}` ending a block is
 * followed by a statement, while `}` ending an object literal
 * (`{v: 1} / $$ / 2`) is an operand end. This tracker records, per `(`,
 * whether it was a statement paren, and per `{`, whether it opened an
 * object literal, so `)`/`}` can restore the right expectation.
 *
 * Still an approximation (JavaScript's real regex/division ambiguity needs
 * a full parse), but it removes the previously-documented wrong cases.
 * ASI is deliberately not modeled: `f()\n/re/` is scanned as division even
 * though a real parser inserts a `;` and treats `/re/` as a regex.
 */
export const createJsExprTracker = (startInStatementPosition = false) => {
  let exprExpected = true;
  /** Per open `(`: true iff it was a control-statement paren. */
  const parenStack: boolean[] = [];
  /** Per open `{` INSIDE a JS context: true iff it opened an object literal. */
  const braceStack: boolean[] = [];
  /** Last identifier/keyword token text (for keyword checks on `(`/`{`). */
  let prevWord: string | null = null;
  /** Whether `prevWord` was preceded by `.` -- `x.if (y)` is a call, not `if`. */
  let prevWordIsProp = false;
  /** Last punctuation character seen (`.`, `;`, ...), for context checks. */
  let prevPunct: string | null = null;
  /** Category of the last significant token. Seeding `"{"` models "just
   * consumed an opening brace": the scan starts in STATEMENT position, so
   * a `{` first up is a nested block rather than an object literal
   * (`openBrace`'s `prevTok !== "{"` check). The alternative `"none"` is
   * expression position -- inside a `` ${ ... } `` interpolation a `{`
   * first up is an object literal (`${ {a:1} }` is valid JS), and
   * `openBrace` must not be fed the `${` itself (it isn't a block
   * delimiter for `braceStack` accounting either). */
  let prevTok: "word" | "(" | ")" | "{" | "}" | "punct" | "operand" | "none" =
    startInStatementPosition ? "{" : "none";

  return {
    /** Whether a `/` at this point could open a regex literal. */
    get exprExpected(): boolean {
      return exprExpected;
    },
    /** Whether an identifier token at this point is member access
     * (`x.<word>`/`x?.<word>`) rather than a reference to a binding of
     * that name -- true when the last significant punctuator was `.`,
     * the same condition `word()` records as `prevWordIsProp`. Read it
     * BEFORE calling `word()` for the token being classified. */
    get propertyPosition(): boolean {
      return prevTok === "punct" && prevPunct === ".";
    },
    /** Record an identifier or keyword token `w`. */
    word(w: string): void {
      prevWord = w;
      prevWordIsProp = prevTok === "punct" && prevPunct === ".";
      prevTok = "word";
      prevPunct = null;
      // A keyword in property position (`x.in`, `x.return`, `x.case`)
      // ends an operand like any other member expression -- the member
      // access itself is the value, so a `/` after it is division, not
      // a regex opener. `prevWordIsProp` was already computed for
      // `openParen`'s statement-keyword check; the same exclusion must
      // apply here, or `x.in /re/` mis-scans `re` as regex contents
      // (and `codeContainsIdentifier` misses it entirely).
      exprExpected = !prevWordIsProp && REGEX_PREFIX_KEYWORDS.has(w);
    },
    /** Record a token that ends an operand: number, string, regex, `]`, `++`/`--`. */
    operand(): void {
      prevTok = "operand";
      prevWord = null;
      prevPunct = null;
      exprExpected = false;
    },
    /** Record an opening `(`. */
    openParen(): void {
      parenStack.push(
        prevTok === "word" &&
          !prevWordIsProp &&
          prevWord !== null &&
          STMT_PAREN_KEYWORDS.has(prevWord),
      );
      prevTok = "(";
      prevWord = null;
      prevPunct = null;
      exprExpected = true;
    },
    /** Record a closing `)`. */
    closeParen(): void {
      // A statement paren's `)` is followed by a statement -- a value (and
      // so a regex) is expected next; a call/grouping `)` ends an operand.
      exprExpected = parenStack.pop() === true;
      prevTok = ")";
      prevWord = null;
      prevPunct = null;
    },
    /** Record an opening `{` -- call only in a JavaScript context. */
    openBrace(): void {
      // Object literal iff a value is expected here AND the `{` doesn't
      // follow a statement boundary (`;`, `{`, `}`, a statement paren's
      // `)`, or a block keyword like `else`/`try`).
      const isObject =
        exprExpected &&
        prevTok !== "{" &&
        prevTok !== "}" &&
        prevTok !== ")" &&
        !(prevTok === "punct" && prevPunct === ";") &&
        !(
          prevTok === "word" &&
          prevWord !== null &&
          BLOCK_KEYWORDS.has(prevWord)
        );
      braceStack.push(isObject);
      prevTok = "{";
      prevWord = null;
      prevPunct = null;
      exprExpected = true;
    },
    /** Record a closing `}` -- returns true iff it closed an object literal. */
    closeBrace(): boolean {
      const isObject = braceStack.pop() ?? false;
      // A block's `}` ends a statement (regex may follow); an object
      // literal's `}` ends an operand (division follows).
      exprExpected = !isObject;
      prevTok = "}";
      prevWord = null;
      prevPunct = null;
      return isObject;
    },
    /** Record any other punctuator -- none can end an operand. */
    punct(c: string): void {
      prevTok = "punct";
      prevPunct = c;
      prevWord = null;
      exprExpected = true;
    },
  };
};

/** The tracker object `createJsExprTracker` returns -- named so the
 * shared scanning helpers below can take it as a parameter type. */
export type JsExprTracker = ReturnType<typeof createJsExprTracker>;

const isJsWhitespace = (ch: string | undefined): boolean =>
  ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

/**
 * Handles a `/` inside scanned JavaScript source: where `tracker` says a
 * value is expected, the `/` opens a regex literal -- e.g. `= /}/` or
 * `if (ok) /}/` (a `)` closing a control-statement paren is followed by a
 * statement, so `exprExpected` is true there too) -- skipped atomically
 * via `scanRegexLiteral` so its contents can't be misread as braces,
 * quotes, or comments (a `}` inside the pattern used to decrement the
 * caller's brace depth and desync the whole scan). A `/` that isn't a
 * well-formed regex, or isn't in a value position, is a division
 * operator -- an ordinary punctuator, after which an operand follows.
 * Returns the offset just past the token. Shared by every JS-aware
 * scanner (`scanJsToBlockClose`, `codeContainsIdentifier`, and
 * `grammar.ts`'s rule-body scan) so the regex-vs-division decision can't
 * drift between them.
 */
export const advanceJsSlash = (
  input: string,
  pos: number,
  tracker: JsExprTracker,
): number => {
  if (tracker.exprExpected) {
    const regexEnd = scanRegexLiteral(input, pos);
    if (regexEnd !== -1) {
      tracker.operand();
      return regexEnd;
    }
  }
  tracker.punct("/");
  return pos + 1;
};

/**
 * Extracts the identifier-ish word starting at `pos` (the caller has
 * already checked `JS_IDENTIFIER_START`), returning the word text and
 * the offset just past it. Exposed separately from `advanceJsToken` for
 * `codeContainsIdentifier`, which needs the word itself, not just its
 * tracker effect.
 */
export const scanJsWord = (
  input: string,
  pos: number,
): { word: string; end: number } => {
  let end = pos + 1;
  while (end < input.length && JS_IDENTIFIER_CONT.test(input[end] ?? "")) {
    end++;
  }
  return { word: input.slice(pos, end), end };
};

/**
 * Advances the JS-expression tracker over the single token starting at
 * `pos` and returns the offset just past it: an identifier-ish word, a
 * digit, a paren/brace/bracket, a postfix `++`/`--`, whitespace (one
 * offset, no tracker effect), or any other punctuator. `{`/`}` go
 * through `tracker.openBrace`/`closeBrace` -- callers that additionally
 * track a brace DEPTH intercept those characters first and still
 * delegate the tracker update to this function. Multi-character token
 * shapes with their own skip rules -- string/template literals,
 * comments, and `/` (regex-vs-division, see `advanceJsSlash`) -- are the
 * caller's own cases, checked before delegating.
 */
export const advanceJsToken = (
  input: string,
  pos: number,
  tracker: JsExprTracker,
): number => {
  const ch = input[pos];
  if (JS_IDENTIFIER_START.test(ch ?? "")) {
    const { word, end } = scanJsWord(input, pos);
    tracker.word(word);
    return end;
  }
  if (ch === "{") {
    tracker.openBrace();
    return pos + 1;
  }
  if (ch === "}") {
    tracker.closeBrace();
    return pos + 1;
  }
  if (ch !== undefined && ch >= "0" && ch <= "9") {
    tracker.operand();
  } else if (ch === "(") {
    tracker.openParen();
  } else if (ch === ")") {
    tracker.closeParen();
  } else if (ch === "]") {
    tracker.operand();
  } else if ((ch === "+" || ch === "-") && input[pos + 1] === ch) {
    // Postfix `++`/`--` ends an operand.
    tracker.operand();
    return pos + 2;
  } else if (ch === "." && input[pos + 1] === "." && input[pos + 2] === ".") {
    // `...` spread/rest is ONE punctuator, not a member-access `.` --
    // without this, `f(...x)` left `.` as the last punctuator and the
    // identifier after it was misclassified as a property name.
    tracker.punct("...");
    return pos + 3;
  } else if (ch !== undefined && !isJsWhitespace(ch)) {
    // Any other punctuator cannot end an operand, so a value is expected.
    tracker.punct(ch);
  }
  return pos + 1;
};

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
 * `)`/`]` normally end an operand (`f(x) / re/` is division), but the
 * tracker remembers which `(` opened a control-statement paren (`if`,
 * `while`, `for`, `switch`, `catch`, `with`), so `)` closing one of
 * THOSE restores expression position and `if (x) /re/` scans the `/` as
 * a regex opener. The self-hosted grammar's `actionBlock` mirrors this
 * with its own statement-paren rules (`02-action.tpeg`), verified
 * case-for-case by `self-hosted/action.compare.spec.ts` (#104).
 *
 * `startInStatementPosition` must be `true` when the block being closed
 * is a `{ ... }` (its contents are statements, so a leading `{` is a
 * nested block -- `{ { } /}/ }` -- and `}` ending it restores statement
 * position) and `false` when it is a `` ${ ... } `` interpolation (its
 * contents are a single expression, so a leading `{` is an object
 * literal -- `${ {a:1} }` -- and `}` restores operand position). Without
 * the distinction a `{` first up was always classified as an object
 * literal, desyncing the scan on exactly the block-statement case.
 *
 * `templateDepth` counts enclosing `` ${ ... } `` levels -- every
 * interpolation body re-enters this function one level deeper via
 * `skipStringLiteral`/`scanTemplateForIdentifier`. Past
 * `MAX_TEMPLATE_NESTING_DEPTH` the function returns `-2` (distinct from
 * `-1` "unterminated") so `scanTemplateForIdentifier` can keep the
 * conservative "identifier may be present" answer instead of dropping a
 * possibly-needed binding; `skipStringLiteral` collapses both negative
 * results into its usual "unterminated" contract.
 */

/**
 * Maximum `${ ... }` interpolation nesting the scanners recurse into.
 * Each interpolation level is a mutual-recursion hop between
 * `skipStringLiteral`/`scanTemplateForIdentifier` and
 * `scanJsToBlockClose`/`codeContainsIdentifier` -- direct JavaScript
 * calls, not the `lazy()`/`recursive()` delegation
 * `PARSER_LIMITS.MAX_RECURSION_DEPTH` already guards -- so `` `${`${`...
 * }`}` `` deep enough ran the real call stack out (`RangeError`) instead
 * of producing a graceful "unterminated" result. 256 is far past any
 * plausible handwritten action body.
 */
const MAX_TEMPLATE_NESTING_DEPTH = 256;

const scanJsToBlockClose = (
  input: string,
  pos: number,
  startInStatementPosition: boolean,
  templateDepth = 0,
): number => {
  if (templateDepth > MAX_TEMPLATE_NESTING_DEPTH) return -2;
  let braceDepth = 1;
  let i = pos;
  // Whether a `/` here could open a regex literal -- i.e. a value or
  // expression is expected at this point rather than a binary operator --
  // tracked by `createJsExprTracker`, which additionally remembers per `(`/
  // `{` whether it was a control-statement paren / object literal, so `)`
  // and `}` restore the right expectation (`if (x) /re/` vs `f(x) / re/`,
  // `{v:1} / $$ /` vs `if (x) {} /re/`).
  const tracker = createJsExprTracker(startInStatementPosition);

  while (i < input.length) {
    const ch = input[i];

    if (ch === "{") {
      braceDepth++;
      i = advanceJsToken(input, i, tracker);
      continue;
    }
    if (ch === "}") {
      braceDepth--;
      i = advanceJsToken(input, i, tracker);
      if (braceDepth === 0) {
        return i;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipStringLiteral(input, i, ch, templateDepth);
      tracker.operand();
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
    if (ch === "/") {
      i = advanceJsSlash(input, i, tracker);
      continue;
    }
    i = advanceJsToken(input, i, tracker);
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
  templateDepth = 0,
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
      const close = scanJsToBlockClose(input, i + 2, false, templateDepth + 1);
      if (close === -1) return { found: false, end: input.length };
      if (close === -2) {
        // Template-nesting depth cap (`MAX_TEMPLATE_NESTING_DEPTH`):
        // the interpolation's contents can't be scanned within the
        // recursion budget, so conservatively report `name` present --
        // a spurious binding is a loud unused-variable compile error,
        // while a dropped one is a silent runtime ReferenceError.
        return { found: true, end: input.length };
      }
      // The interpolation body is one EXPRESSION -- a `{` first up is an
      // object literal, and a `/` after it is division, so the recursive
      // scan must use expression position too (`codeContainsIdentifier`
      // defaults to statement position for action/transform bodies).
      if (
        codeContainsIdentifier(
          input.slice(i + 2, close - 1),
          name,
          false,
          templateDepth + 1,
        )
      ) {
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
 * characters can't corrupt the match. A `name` in member position
 * (`x.<name>`/`x?.<name>`) doesn't count either -- it reads a property
 * of some other object, not the binding `filterReferencedLabels` is
 * deciding whether to destructure, so counting it emitted an unused
 * binding (`noUnusedLocals` failure on a saved generated file). Shares
 * `scanJsToBlockClose`'s regex-vs-division heuristic: a `/` opens a regex
 * only where a value is expected (after an operator, `(`, `,`, a keyword
 * like `return`, the start of code, ...).
 *
 * `startInStatementPosition` mirrors `scanJsToBlockClose`'s parameter of
 * the same name: `true` (default) for statement code -- every real
 * caller passes an action/transform body, where a leading `{` is a block
 * (`{ } /re/` scans the `/` as a regex) -- and `false` for a single
 * expression, where a leading `{` is an object literal (`{a:1} / x / 2`
 * divides twice). `scanTemplateForIdentifier` passes `false` when it
 * recurses into `` ${ ... } `` bodies.
 */
export const codeContainsIdentifier = (
  code: string,
  name: string,
  startInStatementPosition = true,
  templateDepth = 0,
): boolean => {
  let i = 0;
  const tracker = createJsExprTracker(startInStatementPosition);
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      i = skipStringLiteral(code, i, ch, templateDepth);
      tracker.operand();
      continue;
    }
    if (ch === "`") {
      const result = scanTemplateForIdentifier(code, i, name, templateDepth);
      if (result.found) return true;
      i = result.end;
      tracker.operand();
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
    if (ch === "/") {
      i = advanceJsSlash(code, i, tracker);
      continue;
    }
    if (JS_IDENTIFIER_START.test(ch ?? "")) {
      const { word, end } = scanJsWord(code, i);
      // `x.<word>`/`x?.<word>` is member access on some other value --
      // the identifier never reads the `const $$`/`const { <word> }`
      // bindings an action's capture destructuring produces, so counting
      // it emitted a binding nothing used (`noUnusedLocals` failure on a
      // saved generated file). `$$.<word>` keeps working the same way:
      // `$$` itself is still counted (it's the object, not the member).
      if (word === name && !tracker.propertyPosition) return true;
      tracker.word(word);
      i = end;
      continue;
    }
    i = advanceJsToken(code, i, tracker);
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
  // An out-of-contract `pos` (`isValidOffset`, `@suzumiyaaoba/tpeg-core`)
  // must fail rather than reach `indexOf` below: `indexOf("{", -1)`
  // clamps the search start to 0 and `indexOf("{", NaN)` treats it as 0
  // too, either way potentially finding a `{` that precedes the
  // caller's actual position.
  if (!isValidOffset(pos)) {
    return createFailure("Expected a valid position", pos, {
      parserName: "scanBalancedBraces",
    });
  }

  const openBracePos = input.indexOf("{", pos);
  if (openBracePos === -1) {
    return createFailure("Expected opening brace '{'", pos, {
      expected: ["{"],
      found: input[pos] ?? "",
      parserName: "scanBalancedBraces",
    });
  }

  // A `{ ... }` action/transform body is a statement list -- see
  // `scanJsToBlockClose`'s `startInStatementPosition` doc.
  const blockEnd = scanJsToBlockClose(input, openBracePos + 1, true);
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
