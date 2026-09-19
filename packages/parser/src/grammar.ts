/**
 * Grammar Definition Block parsing implementation for TPEG
 *
 * This module implements Phase 1.6 of the TPEG parser:
 * - Grammar metadata annotations (@version, @description, etc.)
 * - Rule definitions (rule_name = pattern)
 * - Grammar block structure (grammar Name { ... })
 * - Comment handling (// and /// documentation)
 */

import type {
  ExportDeclaration,
  ImportStatement,
  ModularGrammarDefinition,
} from "@suzumiyaaoba/tpeg-core";
import {
  charClass,
  choice,
  createFailure,
  createModularGrammarDefinition,
  createModuleInfo,
  fail,
  isValidOffset,
  literal,
  map,
  oneOrMore,
  optional,
  seq as sequence,
  star as zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  advanceJsSlash,
  advanceJsToken,
  createJsExprTracker,
  skipBlockComment,
  skipLineComment,
  skipStringLiteral,
} from "./brace-scanner";
import { expression } from "./composition";
import { GRAMMAR_KEYWORDS, GRAMMAR_SYMBOLS } from "./constants";
import { identifier } from "./identifier";
import {
  DEDICATED_ANNOTATION_KEYS,
  UNIMPLEMENTED_ANNOTATION_KEYS,
  annotationKeyExcluding,
  exportDeclaration,
  importStatement,
  moduleInfoListAnnotation,
  moduleInfoRecordAnnotation,
} from "./module";
import { stringLiteral } from "./string-literal";
import { transformDefinition } from "./transforms";
import type {
  Expression,
  GrammarAnnotation,
  GrammarDefinition,
  RuleDefinition,
  TransformDefinition,
} from "./types";
import {
  createGrammarAnnotation,
  createGrammarDefinition,
  createRuleDefinition,
} from "./types";
import {
  grammarBlockWhitespace,
  optionalWhitespace,
  optionalWhitespaceOrComment,
  requiredWhitespaceOrComment,
} from "./whitespace-utils";

const IDENTIFIER_START_CHAR = /[a-zA-Z_]/;
const IDENTIFIER_CONT_CHAR = /[a-zA-Z0-9_]/;

const isSpaceOrTab = (char: string | undefined): boolean =>
  char === " " || char === "\t";

const isLineBreakOrSpaceOrTab = (char: string | undefined): boolean =>
  isSpaceOrTab(char) || char === "\n" || char === "\r";

/**
 * Scans forward from `start` through any run of whitespace and/or
 * comments (reusing `skipLineComment`/`skipBlockComment` -- the same
 * comment-skipping rules `grammarRuleExpression`'s own boundary scan
 * uses below), returning the position of the first character that is
 * neither. Used to check that `expression()` consumed the ENTIRE slice
 * `grammarRuleExpression` cut out for it, not just a leading prefix --
 * see that function's own doc comment for why a naive `result.next ===
 * ruleContent.length` check would wrongly reject a rule followed only by
 * a trailing comment (a legitimate, currently-working shape).
 *
 * Exported (in addition to its internal use here) so a caller of
 * `tpegFile`/`grammarDefinition` -- namely `packages/cli/src/cli.ts` --
 * can check that a parse consumed an ENTIRE source file the same way,
 * without re-requiring exact end-of-input (which would wrongly reject a
 * file with trailing whitespace or a trailing comment after the last
 * `transforms` block).
 */
export const skipTrailingWhitespaceAndComments = (
  text: string,
  start: number,
): number => {
  let i = start;
  while (i < text.length) {
    const char = text[i];
    if (isLineBreakOrSpaceOrTab(char)) {
      i++;
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      i = skipLineComment(text, i);
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      i = skipBlockComment(text, i);
      continue;
    }
    break;
  }
  return i;
};

/**
 * Skips a TPEG character class body starting at `pos` (which points at
 * `[`), respecting `\]` escapes, and returns the offset just past the
 * closing `]` (or end of input). The content must be skipped atomically:
 * a class like `[^"]` can contain a quote character that isn't a string
 * literal delimiter at all.
 */
const skipCharClassContent = (input: string, pos: number): number => {
  let i = pos + 1;
  while (i < input.length && input[i] !== "]") {
    if (input[i] === "\\") i++;
    i++;
  }
  return Math.min(i + 1, input.length);
};

/**
 * Decides whether the character at `checkPos` inside a rule body starts
 * a rule boundary. Called at any scan position of interest -- the
 * position after a whitespace run, and directly at any identifier-start
 * position in continuation context (see `canBeRuleBoundary` in
 * `grammarRuleExpression`). Only meaningful at `activeBraceDepth === 0`
 * (the caller checks); inside an action/transform body the same
 * characters are ordinary JavaScript. The boundary shapes:
 *
 * - `}`: can ONLY be the enclosing grammar block's own closing brace --
 *   a "}" inside a string literal or character class is never visible at
 *   this point (the main scan loop skips those bodies atomically). This
 *   check intentionally doesn't require a line break: `grammar G
 *   { r = "x" }` (a same-line block) ends the rule here too.
 * - `@`: never part of `expression()`'s own grammar -- it can only start
 *   a grammarItem annotation (`@key`/`@key: value`), whether
 *   block-level or attached to the next rule.
 * - `transforms`: a whole-word match can only start a `transforms
 *   Name@language { ... }` grammarItem -- `expression()`'s grammar has
 *   no "@"/"->" syntax, so it can't be a rule reference followed by
 *   that block's tokens. (Checked as a whole word so a rule named e.g.
 *   `transformsFoo` is unaffected.)
 * - `identifier <ws/comments> =`: unambiguously the next rule's header
 *   -- `ruleDefinition` allows whitespace AND comments between name and
 *   "=", and "=" can never begin an expression element, so the
 *   identifier can't be a sequence element continuing THIS rule. An
 *   `identifier (` shape is deliberately NOT a boundary: `name(...) ->
 *   T {...}` isn't a valid grammarItem without the `transforms`
 *   keyword, and treating "(" as one would break a legitimate
 *   multi-line sequence starting with a rule reference followed by a
 *   group.
 */
const isRuleBoundaryAt = (input: string, checkPos: number): boolean => {
  const boundaryChar = input[checkPos];
  if (boundaryChar === "}") {
    return true;
  }
  if (boundaryChar === GRAMMAR_SYMBOLS.ANNOTATION_PREFIX) {
    return true;
  }
  if (boundaryChar === undefined || !IDENTIFIER_START_CHAR.test(boundaryChar)) {
    return false;
  }

  let identEnd = checkPos + 1;
  while (
    identEnd < input.length &&
    IDENTIFIER_CONT_CHAR.test(input[identEnd] ?? "")
  ) {
    identEnd++;
  }

  if (
    input.startsWith(GRAMMAR_KEYWORDS.TRANSFORMS, checkPos) &&
    identEnd === checkPos + GRAMMAR_KEYWORDS.TRANSFORMS.length
  ) {
    return true;
  }

  // Everything `optionalWhitespaceOrComment` accepts -- whitespace
  // INCLUDING line breaks, `//` line comments, and `/* */` block
  // comments -- because that is exactly the separator `ruleDefinition`
  // puts between a rule's name and its "=".
  let afterIdent = identEnd;
  while (afterIdent < input.length) {
    if (isLineBreakOrSpaceOrTab(input[afterIdent])) {
      afterIdent++;
      continue;
    }
    if (input[afterIdent] === "/" && input[afterIdent + 1] === "/") {
      afterIdent = skipLineComment(input, afterIdent);
      continue;
    }
    if (input[afterIdent] === "/" && input[afterIdent + 1] === "*") {
      afterIdent = skipBlockComment(input, afterIdent);
      continue;
    }
    break;
  }

  return afterIdent < input.length && input[afterIdent] === "=";
};

/**
 * Skips whitespace and comments (the same set `isRuleBoundaryAt`'s own
 * inner loop skips) starting at `pos`, returning the first non-trivia
 * offset. Used by {@link isAnnotationStartAt} to look past the trivia an
 * annotation may contain (e.g. a comment between `@key` and its `:`) or
 * that separates a flag annotation from the rule it precedes
 * (`@noskip` then a newline then `rule = ...`).
 */
const skipTrivia = (input: string, pos: number): number => {
  let i = pos;
  while (i < input.length) {
    if (isLineBreakOrSpaceOrTab(input[i])) {
      i++;
      continue;
    }
    if (input[i] === "/" && input[i + 1] === "/") {
      i = skipLineComment(input, i);
      continue;
    }
    if (input[i] === "/" && input[i + 1] === "*") {
      i = skipBlockComment(input, i);
      continue;
    }
    break;
  }
  return i;
};

/**
 * Decides whether the `@` at `pos` starts a grammarItem-level ANNOTATION
 * rather than the `@expr` span (source-text extraction) operator
 * (`Span`, docs/peg-grammar.md). Both are `@`-prefixed, so the rule-body
 * scanner can't treat every depth-0 `@` as a boundary anymore -- but
 * `@identifier` is genuinely ambiguous between "span of a rule
 * reference" and the flag-annotation / `@key: value` shapes. Resolved
 * by what FOLLOWS the `@identifier` token (whitespace and comments
 * skipped, matching the trivia both annotation forms and rule headers
 * allow):
 *
 * - `:` -- the `@key: value` annotation shape (`@start: expr`,
 *   `@skip: ws`, `@version: "1.0"`, `@memoize: 256`).
 * - `@` -- another annotation: stacked rule annotations
 *   (`@memoize\n@noskip\nrule = ...`) mean this `@` begins one too.
 * - `identifier <ws/comments> =` or `transforms` -- a flag annotation
 *   (`@noskip`, `@memoize`) sitting directly before the grammarItem it
 *   annotates, via `isRuleBoundaryAt`.
 *
 * Anything else is a span operand position: `@` followed by a
 * non-identifier character (`@"lit"`, `@[a-z]`, `@(e)`, `@\b`) can
 * never be an annotation in the first place, and a bare `@identifier`
 * followed by anything but a `:`/`@`/rule-header is a span of that rule
 * reference (`@x "a"`, `@x` at the body's end). The one case this
 * still resolves to "annotation" is `@identifier` immediately before a
 * rule header -- the flag-annotation reading wins there; a span of a
 * rule reference in exactly that position needs `@(identifier)`.
 */
const isAnnotationStartAt = (input: string, pos: number): boolean => {
  const keyStart = pos + 1;
  const keyFirst = input[keyStart];
  if (keyFirst === undefined || !IDENTIFIER_START_CHAR.test(keyFirst)) {
    return false;
  }

  let i = keyStart + 1;
  while (i < input.length && IDENTIFIER_CONT_CHAR.test(input[i] ?? "")) {
    i++;
  }
  i = skipTrivia(input, i);

  const next = input[i];
  if (next === ":" || next === "@") {
    return true;
  }
  return isRuleBoundaryAt(input, i);
};

/**
 * Bounded expression parser for grammar rules.
 *
 * This parser stops at the next rule definition or the enclosing grammar
 * block's closing "}", to prevent `expression()`'s sequence operator (which
 * treats newlines as ordinary inter-element whitespace) from greedily
 * consuming subsequent rules. The boundary check runs on *any* whitespace
 * run (including newlines), not just same-line spaces/tabs, so a rule body
 * can legitimately span multiple lines (e.g. a labeled choice with `/`
 * alternatives on their own lines) as long as what follows isn't actually
 * the start of another rule or the block's end.
 *
 * A rule body may itself contain a semantic action block, `{ ... }`
 * (possibly multi-line, possibly with its own nested `{`/`}` or a `}`
 * embedded in a string/comment) - so this tracks brace depth (skipping over
 * string literals and comments the same way `brace-scanner.ts` does for the
 * action block itself) and only treats a line-broken "}" as *this* rule's
 * end, or the grammar block's end, while that depth is back to zero. Without
 * this, an action's own closing brace on its own line would be misread as
 * the enclosing grammar block's "}" and truncate the rule mid-action.
 */
const grammarRuleExpression: Parser<Expression> = (
  input: string,
  pos: number,
) => {
  // An out-of-contract `pos` (`isValidOffset`, `@suzumiyaaoba/tpeg-core`)
  // must fail rather than drive the scan below: a fractional `pos` lets
  // `input[endPos]` read `undefined` at every step until `endPos` walks
  // past `input.length`, after which `input.slice(pos, endPos)` TRUNCATES
  // the fractional index and parses the whole input as this rule's body
  // -- a bogus success like `{ current: 0.5, next: 0.5 + n }`. A `pos`
  // past the end of input is out of contract too.
  if (!isValidOffset(pos) || pos > input.length) {
    return createFailure("Expected a valid position", pos, {
      parserName: "grammarRuleExpression",
    });
  }

  let endPos = pos;
  let foundEnd = false;
  let activeBraceDepth = 0;
  // Whether an identifier-starting token at the current scan position
  // (at depth 0) may be the NEXT rule's header -- `ident <ws/comments>
  // =` or a whole-word `transforms`, per `isRuleBoundaryAt`.
  // `false` at the body's own start and right after a token that opens a
  // fresh element position (`/`, `(`, `&`, `!`): the first element of
  // each alternative, the first element inside a group, and a
  // lookahead's operand are exactly the positions the self-hosted
  // grammar's `notNextRuleStart` does not guard either, so an
  // identifier there is a genuine element (`("a" / transforms x)` and
  // `(transforms y)` both parse `transforms` as a rule reference).
  // Everywhere else the identifier IS checked -- `=` can never continue
  // an expression, so `ident <ws> =` is unambiguously a rule boundary
  // even with NO whitespace before it; requiring whitespace first (the
  // old check only ran inside the whitespace branch) let `r = "a"x="b"`
  // absorb `x` into this rule's body and then fail on the stranded `=`.
  let canBeRuleBoundary = false;
  // Inside an action/transform body (activeBraceDepth > 0) the scanned
  // text is JavaScript, so a `/` can open a regex literal -- recognized
  // via the same regex-vs-division heuristic `scanBalancedBraces` uses
  // (see `createJsExprTracker`: `)`/`}` restore different expectations
  // depending on whether they close a control-statement paren / object
  // literal or an expression paren / block). At brace depth 0 the scanned
  // text is TPEG syntax where `/` is the choice operator and the flag is
  // never consulted.
  const tracker = createJsExprTracker();

  while (endPos < input.length && !foundEnd) {
    const char = input[endPos];

    if (char === '"' || char === "'" || char === "`") {
      // A template literal in an action/transform body embeds arbitrary
      // TypeScript source verbatim -- `brace-scanner.ts`'s
      // `scanBalancedBraces` (which actually parses the action's `{ ... }`
      // block once this scanner has found the rule's end) already skips
      // backtick strings via this same `skipStringLiteral` helper. Without
      // this branch, a `}` inside a backtick string (e.g. `` `x}y` ``) was
      // miscounted as closing the action block early, desynchronizing
      // `activeBraceDepth` from the actual brace depth and corrupting
      // every following whitespace-boundary check in this rule -- and
      // often the parse of the rest of the file.
      endPos = skipStringLiteral(input, endPos, char);
      tracker.operand();
      // A completed element: an identifier after it is in continuation
      // position, where the rule-boundary check applies.
      if (activeBraceDepth === 0) canBeRuleBoundary = true;
      continue;
    }

    // Only at brace depth 0 is `[` a TPEG character class -- inside an
    // action/transform body it's ordinary JavaScript (member access,
    // array literal, computed key), and misreading `x["]"]`'s `"` as a
    // string start swallowed the rest of the file before this guard.
    // Inside a body, `[`/`]` fall through to the generic punctuator
    // handling below (`[` can't end an operand, `]` ends one), and any
    // string inside the brackets is still skipped by the string case
    // above before its contents can be misread.
    if (char === "[" && activeBraceDepth === 0) {
      endPos = skipCharClassContent(input, endPos);
      tracker.operand();
      canBeRuleBoundary = true;
      continue;
    }

    if (char === "/" && input[endPos + 1] === "/") {
      endPos = skipLineComment(input, endPos);
      continue;
    }

    if (char === "/" && input[endPos + 1] === "*") {
      endPos = skipBlockComment(input, endPos);
      continue;
    }

    if (char === "/" && activeBraceDepth > 0) {
      // Regex-vs-division inside an action/transform body -- see
      // `advanceJsSlash`'s doc comment in `brace-scanner.ts` for the
      // heuristic (a `}` inside a regex pattern must not decrement
      // `activeBraceDepth`, or the whole boundary scan desyncs).
      endPos = advanceJsSlash(input, endPos, tracker);
      continue;
    }

    if (char === "{") {
      activeBraceDepth++;
      endPos = advanceJsToken(input, endPos, tracker);
      continue;
    }

    if (char === "}") {
      // A "}" at brace depth 0 can ONLY be the enclosing grammar block's
      // own closing brace, reached with no intervening whitespace (e.g.
      // `start = "a"}`): every other "}" inside a rule body is either
      // depth-tracked as part of an action/transform/quantifier block or
      // hidden inside a string literal or character class -- both of which
      // the cases above skip atomically before this point ever sees them.
      // Requiring a whitespace run before recognizing "}" as a boundary
      // (the check inside the whitespace branch below) let such a brace be
      // silently absorbed into this rule's slice, after which
      // `expression()` stopped short at it and the full-consumption check
      // reported a parse failure on a perfectly valid rule.
      if (activeBraceDepth === 0) {
        foundEnd = true;
        break;
      }
      activeBraceDepth--;
      endPos = advanceJsToken(input, endPos, tracker);
      if (activeBraceDepth === 0) canBeRuleBoundary = true;
      continue;
    }

    // "@" at depth 0 is a boundary when it starts an ANNOTATION
    // (`@key: value`, `@noskip`, `@memoize` -- see `isAnnotationStartAt`
    // for the shape test and the span-operator disambiguation). Any
    // other depth-0 "@" is the `@expr` span operator's own syntax
    // (`@"lit"`, `@[a-z]`, `@(e)`, `@x "a"`), part of THIS rule's body.
    // Checking unconditionally (the pre-span behavior) truncated bodies
    // like `r = "a" @"b"` at the `@`, which then surfaced as a bogus
    // "unsupported annotation" or stranded-input parse error.
    if (
      char === GRAMMAR_SYMBOLS.ANNOTATION_PREFIX &&
      activeBraceDepth === 0 &&
      isAnnotationStartAt(input, endPos)
    ) {
      foundEnd = true;
      break;
    }

    if (activeBraceDepth === 0) {
      // Whitespace is trivia: it doesn't change which element position
      // the next significant token sits in, so `canBeRuleBoundary`
      // survives across it unchanged. (The rule-boundary check used to
      // run here, at the position after a whitespace run -- which meant
      // `x` in `"a"x="b"` was never checked at all, and `transforms` in
      // `"a" / transforms x` was checked where it shouldn't be. Both are
      // now handled by the identifier-start check below.)
      if (isLineBreakOrSpaceOrTab(char)) {
        endPos = advanceJsToken(input, endPos, tracker);
        continue;
      }

      if (char !== undefined && IDENTIFIER_START_CHAR.test(char)) {
        // An identifier in CONTINUATION position may be the next rule's
        // header -- check before absorbing it as a sequence element. An
        // identifier in exempt position (the body's first element, or
        // after `/`, `(`, `&`, `!`) is consumed as an element either
        // way: even `foo=` there can't be a new rule (a bare `foo=`
        // body's own first element would leave the rule bodyless).
        if (canBeRuleBoundary && isRuleBoundaryAt(input, endPos)) {
          foundEnd = true;
          break;
        }
        canBeRuleBoundary = true;
        endPos = advanceJsToken(input, endPos, tracker);
        continue;
      }

      // `/`, `(`, `&`, `!`, `@`, `:` open a fresh element position -- an
      // identifier directly after one is an alternative's first
      // element, a group's first element, a lookahead's/span's operand,
      // or a label's expression (`name:expr`'s `expr` is a
      // `prefix`-level element, just like `&`'s operand) -- not a
      // continuation element the rule-boundary check applies to.
      // `name:transforms` labels a rule reference named `transforms`;
      // treating `:` as continuation context made that valid label look
      // like a transforms-block boundary. `@` is here because this point
      // is only reached when `isAnnotationStartAt` already ruled out the
      // annotation reading, so the `@` is a span operator and the
      // identifier is its operand (`@x` in `r = "a" @x="b"` must slice
      // the body at the `=`, not at `x` -- same outcome as `&x`'s
      // operand). (A stray `:` that ISN'T a label colon is harmless
      // either way: `expression()` can't consume it, so the
      // full-consumption check below rejects the rule regardless.)
      canBeRuleBoundary =
        char !== "/" &&
        char !== "(" &&
        char !== "&" &&
        char !== "!" &&
        char !== "@" &&
        char !== ":";
    }

    // Track whether a `/` encountered inside an action body could open a
    // regex literal (see the `tracker` declaration above). The values
    // produced while outside an action are never consulted.
    endPos = advanceJsToken(input, endPos, tracker);
  }

  // Create a substring that only includes the current rule expression
  const ruleContent = input.slice(pos, endPos);

  // Parse the expression within this bounded content, then shift the
  // resulting offset back to be relative to the original input.
  const result = expression()(ruleContent, 0);

  if (result.success) {
    // `expression()` succeeding does not by itself mean it consumed the
    // WHOLE slice this function cut out -- a syntactically-impossible
    // trailing fragment (e.g. a stray `@foo` after a complete
    // expression) would otherwise be silently left for the caller's
    // outer grammarItem loop to reinterpret as something else entirely
    // (a block-level annotation), rather than surfacing as the parse
    // error it actually is. Trailing whitespace/comments are explicitly
    // allowed here (see `skipTrailingWhitespaceAndComments`) so this
    // doesn't regress the legitimate "rule followed by a comment" shape.
    const trailingEnd = skipTrailingWhitespaceAndComments(
      ruleContent,
      result.next,
    );
    if (trailingEnd !== ruleContent.length) {
      const unexpected = ruleContent.slice(trailingEnd, trailingEnd + 20);
      return {
        success: false,
        error: {
          message: `Unexpected content after rule expression: ${JSON.stringify(unexpected)}`,
          pos: pos + trailingEnd,
        },
      };
    }
    return {
      success: true,
      val: result.val,
      current: pos,
      next: pos + result.next,
    };
  }
  // Preserve every field of the inner error -- `expected`/`found`/
  // `parserName` and, critically, `fatal`: a fatal failure inside the
  // rule body (e.g. `a.b.c`'s second `.`, rejected by
  // `qualifiedIdentifier`) must stay fatal through this boundary so the
  // enclosing grammarItem choice stops instead of backtracking into
  // `transforms`/comment/`}` alternatives that can only mask the real
  // error with a generic "found <rule name>" one at the rule's start.
  return {
    success: false,
    error: {
      ...result.error,
      pos: pos + result.error.pos,
    },
  };
};

/**
 * Parse any character except newline
 * Uses a simple approach by rejecting newline characters
 */
const nonNewlineChar: Parser<string> = (input: string, pos: number) => {
  if (pos >= input.length) {
    return { success: false, error: { message: "EOF", pos } };
  }
  const char = input[pos];
  if (!char || char === "\n" || char === "\r") {
    return { success: false, error: { message: "Newline or EOF", pos } };
  }
  return {
    success: true,
    val: char,
    current: pos,
    next: pos + 1,
  };
};

/**
 * Parse single-line comments starting with //
 * Extracts and trims the comment content after the // prefix
 */
export const singleLineComment: Parser<string> = map(
  sequence(
    literal(GRAMMAR_SYMBOLS.SINGLE_LINE_COMMENT),
    zeroOrMore(nonNewlineChar),
  ),
  ([_, content]) => content.join("").trim(),
);

/**
 * Parse documentation comments starting with ///
 * Extracts and trims the documentation content after the /// prefix
 */
export const documentationComment: Parser<string> = map(
  sequence(
    literal(GRAMMAR_SYMBOLS.DOCUMENTATION_COMMENT),
    zeroOrMore(nonNewlineChar),
  ),
  ([_, content]) => content.join("").trim(),
);

/**
 * Parse a `/* ... *\/` block comment, returning its trimmed inner content.
 * Unlike `singleLineComment`/`documentationComment` (which the surrounding
 * `zeroOrMore(nonNewlineChar)` bounds at the input's own structure), a
 * block comment's extent depends on finding a matching `*\/` -- reuses
 * `skipBlockComment` (`./brace-scanner.ts`, the same rule the rule-
 * boundary scanner below and `composition.ts`'s expression-level
 * whitespace both use) for that scan rather than a second,
 * potentially-diverging one.
 *
 * An unterminated block comment (no closing `*\/` before EOF) is not
 * rejected as an error here: `skipBlockComment` already treats "ran off
 * the end of input" as "the comment extends to EOF", matching how a real
 * editor/highlighter would show it, and this parser's caller
 * (`grammarItem`) has no more useful diagnostic to offer for it than
 * "this comment consumed the rest of the file" would already convey.
 */
const blockComment: Parser<string> = (input: string, pos: number) => {
  if (input[pos] !== "/" || input[pos + 1] !== "*") {
    return createFailure('Expected "/*"', pos, {
      expected: "/*",
      parserName: "blockComment",
    });
  }
  const next = skipBlockComment(input, pos);
  return {
    success: true,
    val: input
      .slice(pos + 2, next)
      .replace(/\*\/$/, "")
      .trim(),
    current: pos,
    next,
  };
};

/**
 * Parse a quoted string value for annotations
 * Reuses the existing stringLiteral parser and extracts the value
 */
export const quotedString: Parser<string> = map(
  stringLiteral,
  (node) => node.value,
);

/**
 * Parse a bare (unquoted) identifier as an annotation value, e.g. the
 * `expression` in `@start: expression` or the `whitespace` in
 * `@skip: whitespace` - docs/peg-grammar.md uses this form for annotations
 * that name a rule, as opposed to `@version`/`@description`-style annotations
 * that hold an arbitrary string.
 */
const bareAnnotationValue: Parser<string> = map(identifier, (id) => id.name);

/**
 * Parse an annotation value: a quoted string (tried first, so existing
 * `@key: "value"` annotations are unaffected) or a bare identifier.
 */
const annotationValue: Parser<string> = choice(
  quotedString,
  bareAnnotationValue,
);

/**
 * Parse a `@key: value` annotation (with optional leading whitespace),
 * where value is a quoted string or a bare identifier.
 * Returns a GrammarAnnotation AST node with the key and value extracted.
 */
const keyValueAnnotation: Parser<GrammarAnnotation> = map(
  sequence(
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.ANNOTATION_PREFIX),
    // Refuse keys owned by a dedicated structured-annotation parser
    // (`@export`, `@dependencies`, `@conflicts`, `@requires`, `@memoize` --
    // see `DEDICATED_ANNOTATION_KEYS` in `./module.ts`): a malformed
    // `@export: "a"` must surface as a parse error, not silently re-parse
    // as an inert generic annotation that flips `@export` to its
    // "export all" default (issue #61). `moduleInfoListAnnotation`/
    // `moduleInfoRecordAnnotation` apply the same refusal for the keys
    // owned by the OTHER structured forms.
    annotationKeyExcluding(DEDICATED_ANNOTATION_KEYS),
    // Comment-tolerant on BOTH sides of ":" (see
    // `optionalWhitespaceOrComment`'s doc comment,
    // `./whitespace-utils.ts`): `@key /* c */: value` is as legitimate a
    // comment position as `@key: /* c */ value` below -- docs/
    // peg-grammar.md's Comments section accepts one in every position
    // separating two syntactic elements.
    optionalWhitespaceOrComment,
    literal(GRAMMAR_SYMBOLS.LABEL_SEPARATOR),
    // Comment-tolerant (see `optionalWhitespaceOrComment`'s doc comment,
    // `./whitespace-utils.ts`): a comment between the ":" and the value
    // (e.g. `@memoize: /* c */ 4`, `@version: /* c */ "1.0"`) is a
    // legitimate position for one per docs/peg-grammar.md's Comments
    // section, same as any other position separating two syntactic
    // elements.
    optionalWhitespaceOrComment,
    annotationValue,
  ),
  (results) => createGrammarAnnotation(results[2], results[6]),
);

/**
 * Parse a flag-only annotation with no value, e.g. `@private` or `@override`.
 * Represented as a GrammarAnnotation with an empty string value.
 *
 * Must be tried after keyValueAnnotation (see grammarAnnotation below): since
 * it doesn't require a ":", trying it first would match just the "@key" part
 * of a real "@key: value" annotation and leave ": value" as unparsed trailing
 * input, hard-failing the enclosing grammar block.
 */
const flagAnnotation: Parser<GrammarAnnotation> = map(
  sequence(
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.ANNOTATION_PREFIX),
    // Same dedicated-key refusal as keyValueAnnotation -- a bare
    // `@export`/`@requires` flag isn't a meaningful annotation either.
    annotationKeyExcluding(DEDICATED_ANNOTATION_KEYS),
  ),
  (results) => createGrammarAnnotation(results[2], ""),
);

/**
 * Parse any grammar annotation: `@key: "value"`, `@key: value`, or the
 * flag-only `@key` form.
 */
export const grammarAnnotation: Parser<GrammarAnnotation> = choice(
  keyValueAnnotation,
  flagAnnotation,
);

/**
 * Parse rule definition like rule_name = pattern (with optional leading whitespace)
 * Returns a RuleDefinition AST node with the rule name and pattern
 * Uses bounded expression parser to prevent consuming newlines
 */
export const ruleDefinition: Parser<RuleDefinition> = map(
  sequence(
    optionalWhitespace,
    identifier,
    // Comment-tolerant (see `optionalWhitespaceOrComment`'s doc comment,
    // `./whitespace-utils.ts`): a comment between a rule's name and its
    // "=" (e.g. `r /* c */ = "a"`) is a legitimate position for one, and
    // WITHOUT this, `grammarRuleExpression`'s own multi-line-sequence
    // support (comments freely inside a rule's pattern) would have this
    // one narrow gap right at the rule's own header.
    optionalWhitespaceOrComment,
    literal(GRAMMAR_SYMBOLS.RULE_ASSIGNMENT),
    // Comment-tolerant for the same reason as the whitespace above (docs/
    // peg-grammar.md's Comments section: a comment is accepted in every
    // position that separates two syntactic elements, including right
    // after "="): the whitespace immediately after "=" used to be plain
    // `optionalWhitespace`, the one asymmetric gap left after
    // `optionalWhitespaceOrComment` was added between the rule name and
    // "=" -- `r = /* c */ "a"` failed to parse even though `r /* c */ =
    // "a"` (a comment on the OTHER side of "=") already worked.
    optionalWhitespaceOrComment,
    grammarRuleExpression,
  ),
  (results) => createRuleDefinition(results[1].name, results[5]),
);

/**
 * Parse a decimal integer literal used as a rule-level annotation's value,
 * e.g. the `256` in `@memoize: 256`.
 */
const integerLiteral: Parser<string> = map(
  oneOrMore(charClass(["0", "9"])),
  (digits) => digits.join(""),
);

/**
 * Parse the `@memoize` rule-level annotation: `@memoize` (flag - memoize
 * with an unbounded cache) or `@memoize: N` (bounded to at most N cached
 * positions - see `packages/combinator/src/logic.ts`'s `memoize`'s
 * `maxCacheSize` option, which this threads through at codegen time).
 *
 * Deliberately its own parser rather than reusing the generic
 * `grammarAnnotation` (which also matches `@start`, `@skip`, and any other
 * block-level annotation): restricting the key to the literal "memoize"
 * means `annotatedRuleDefinition` below can never misfire on those. Without
 * this restriction, trying a generic "annotations then rule" alternative
 * ahead of `grammarAnnotation` in `grammarItem` would swallow
 * `@start: expression` immediately followed by `expression = ...` as a
 * rule-level annotation on `expression`, silently breaking `@start`
 * resolution for the (very common) case where a block annotation happens
 * to sit directly above the rule it describes.
 */
const memoizeAnnotation: Parser<GrammarAnnotation> = map(
  sequence(
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.ANNOTATION_PREFIX),
    literal("memoize"),
    optional(
      sequence(
        // Comment-tolerant on BOTH sides of ":", matching
        // keyValueAnnotation (`@memoize /* c */: 4`).
        optionalWhitespaceOrComment,
        literal(GRAMMAR_SYMBOLS.LABEL_SEPARATOR),
        // Comment-tolerant, matching keyValueAnnotation's own ":" handling
        // above (`@memoize: /* c */ 4`).
        optionalWhitespaceOrComment,
        integerLiteral,
      ),
    ),
  ),
  (results) => {
    const valueClause = results[3];
    return createGrammarAnnotation(
      "memoize",
      valueClause ? valueClause[3] : "",
    );
  },
);

/**
 * Parse the `@noskip` rule-level annotation: `@noskip` (flag only - no
 * value clause; `@noskip: x` fails to parse, same failure mode as a bare
 * `@noskip` with no rule after it, since `noskip` is a
 * `DEDICATED_ANNOTATION_KEYS` member no generic alternative accepts).
 * Marks the following rule exempt from `@skip`'s automatic whitespace
 * insertion -- see `applySkipDesugar` (`./skip-desugar.ts`). Its own
 * dedicated parser rather than the generic `grammarAnnotation` for the
 * same reason `memoizeAnnotation` is (see that parser's doc comment):
 * attaching it to the rule keeps a block-level `@skip: ws` written right
 * above a rule from being misread as rule-scoped.
 */
const noskipAnnotation: Parser<GrammarAnnotation> = map(
  sequence(
    optionalWhitespace,
    literal(GRAMMAR_SYMBOLS.ANNOTATION_PREFIX),
    literal("noskip"),
  ),
  () => createGrammarAnnotation("noskip", ""),
);

/**
 * Any annotation that attaches to the following rule rather than the
 * grammar block: `@memoize`/`@memoize: N` or `@noskip`. Shared by
 * `annotatedRuleDefinition` so the two can mix freely
 * (`@memoize: 4 @noskip rule = ...` attaches both).
 */
const ruleLevelAnnotation: Parser<GrammarAnnotation> = choice(
  memoizeAnnotation,
  noskipAnnotation,
);

/**
 * Parse a rule definition preceded by one or more rule-level annotations
 * (`@memoize`, `@noskip` -- see `ruleLevelAnnotation`), attaching them to
 * the resulting `RuleDefinition.annotations`. Tried as its own
 * `grammarItem` alternative *before* the generic `grammarAnnotation`
 * (see `grammarItem` below) so `@memoize`/`@noskip` immediately preceding
 * a rule is captured together with it instead of being parsed as a
 * standalone block-level annotation first.
 */
const annotatedRuleDefinition: Parser<RuleDefinition> = map(
  sequence(
    oneOrMore(ruleLevelAnnotation),
    // Comment-tolerant: a comment between the last `@memoize` annotation
    // and the rule it attaches to (e.g. `@memoize: 4\n  /* c */\n  a =
    // "x"`) is a legitimate position for one, same as everywhere else in
    // this file. `ruleDefinition`'s own leading `optionalWhitespace`
    // (plain, not comment-aware) already covers the no-comment gap here,
    // so without this a comment in that gap made `ruleDefinition` fail to
    // find its leading identifier, failing `annotatedRuleDefinition` as a
    // whole -- `grammarItem` then fell back to parsing just "@memoize"
    // (or "@memoize: N") as a standalone GENERIC annotation via
    // `grammarAnnotation`, which can't represent a numeric memoize value
    // at all (`annotationValue` only accepts a quoted string or a bare
    // identifier), producing a confusing downstream parse error instead
    // of the rule's memoize annotation working as intended.
    optionalWhitespaceOrComment,
    ruleDefinition,
  ),
  ([annotations, , rule]) => ({ ...rule, annotations }),
);

/**
 * Internal type for discriminating between grammar items during parsing
 */
type GrammarItemType =
  | { type: "annotation"; value: GrammarAnnotation }
  | { type: "export"; value: ExportDeclaration }
  | { type: "moduleInfoList"; key: string; values: string[] }
  | { type: "moduleInfoRecord"; key: string; values: Record<string, string> }
  | { type: "rule"; value: RuleDefinition }
  | { type: "transform"; value: TransformDefinition }
  | { type: "documentation"; value: string }
  | { type: "comment"; value: string };

/**
 * `@export` reached here has already failed `exportDeclaration`'s exact
 * `@export: [name, ...]` shape -- the literal key is present but the value
 * is malformed (quoted names, a record, a bare scalar, a missing colon,
 * ...). Every generic annotation alternative below refuses the reserved
 * key `export` too, so without this detector a malformed `@export` would
 * fall all the way through `grammarItem` and surface only as a generic
 * "expected }"-style error at the annotation's own position. Failing
 * FATALLY here (no backtracking out of the enclosing `choice`) names the
 * actual mistake instead.
 */
const malformedExportAnnotation: Parser<never> = (input, pos) => {
  // Leading whitespace is tolerated the same way `grammarAnnotation`'s own
  // alternatives tolerate it (grammarItem alternatives run right after
  // `grammarBlockWhitespace`, but a stray space can still intervene).
  let i = pos;
  while (isLineBreakOrSpaceOrTab(input[i])) i++;
  const keyword = "@export";
  if (!input.startsWith(keyword, i)) {
    return createFailure(`Expected "${keyword}"`, pos, {
      parserName: "malformedExportAnnotation",
    });
  }
  const after = i + keyword.length;
  if (IDENTIFIER_CONT_CHAR.test(input[after] ?? "")) {
    // `@exportFoo` is a different key entirely, not a malformed @export.
    return createFailure(`Expected "${keyword}"`, pos, {
      parserName: "malformedExportAnnotation",
    });
  }
  return {
    success: false,
    error: {
      message:
        "Malformed @export declaration -- expected `@export: [rule1, rule2, ...]` with bare rule names (quoted names, records, and scalar values are not allowed)",
      pos: i,
      expected: ["@export: [rules...]"],
      found: input.slice(i, i + 40),
      parserName: "malformedExportAnnotation",
      fatal: true,
    },
  };
};

/**
 * Reject an annotation whose key this implementation RECOGNIZES but does
 * not support (`@private`, `@namespace`, `@if`, ... -- see
 * `UNIMPLEMENTED_ANNOTATION_KEYS` in `./module.ts` for the full set and
 * the rationale). Every one of those keys parses fine as a generic
 * annotation yet nothing downstream ever reads it, so accepting it
 * silently tells the grammar author a lie: the annotation looks like it
 * does something it never will. Failing FATALLY here (tried before every
 * generic annotation alternative in `grammarItem`, so a `@private: [x]`
 * can't slip through `moduleInfoListAnnotation` first) names the actual
 * problem instead of producing an inert `GrammarAnnotation` node.
 */
const unsupportedAnnotation: Parser<never> = (input, pos) => {
  let i = pos;
  while (isLineBreakOrSpaceOrTab(input[i])) i++;
  if (input[i] !== GRAMMAR_SYMBOLS.ANNOTATION_PREFIX) {
    return createFailure('Expected "@"', pos, {
      parserName: "unsupportedAnnotation",
    });
  }
  // Read the key by regex rather than via the `identifier` parser: that
  // parser's own `[a-zA-Z0-9_]*` continuation probe records a
  // farthest-failure watermark entry PAST the annotation's position
  // (the `\n` after `@private`), which would mask this detector's error
  // in `parse()`'s farthest-failure report. `malformedExportAnnotation`
  // avoids sub-parsers for the same reason (see its doc comment above).
  const keyMatch = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(input.slice(i + 1));
  const key = keyMatch?.[0];
  if (key === undefined || !UNIMPLEMENTED_ANNOTATION_KEYS.has(key)) {
    return createFailure('Expected "@"', pos, {
      parserName: "unsupportedAnnotation",
    });
  }
  // Record this rejection into the shared farthest-failure watermark at
  // the position just past the annotation key: `parse()` reports the
  // WATERMARK's materialized error for the `FAIL` singleton that
  // ultimately reaches the top (the grammar block's `}` literal failing
  // at the annotation's position), not this concrete result -- and
  // `exportDeclaration`'s `literal("@export")` probe already reaches one
  // character into the key (`@e` vs `@p`), so an entry at `i` would lose
  // to it. Everything else tried before this alternative fails shallower
  // than the key's end, and everything after it never runs (the fatal
  // flag on the returned failure stops the enclosing choice), so this
  // entry is always the reported one. The returned concrete failure still
  // carries the full message for callers that invoke the parser directly
  // rather than through `parse()`.
  const keyEnd = i + 1 + key.length;
  fail(input, keyEnd, {
    label: `a supported annotation ("@${key}" is recognized but not implemented)`,
    parserName: "unsupportedAnnotation",
  });
  return {
    success: false,
    error: {
      message: `Annotation "@${key}" is not implemented -- it is recognized by the grammar syntax but has no effect, so it is rejected rather than silently ignored`,
      pos: keyEnd,
      expected: ["a supported annotation"],
      found: `@${key}`,
      parserName: "unsupportedAnnotation",
      fatal: true,
    },
  };
};

/**
 * Parse grammar item (export declaration, annotation, rule, transform, or comment)
 * Returns a tagged union for easier processing in the main grammar parser.
 *
 * All four "@"-prefixed alternatives are tried in most-specific-first order:
 * exportDeclaration only matches literal "@export" with an array-of-identifiers
 * value; moduleInfoListAnnotation matches any "@key" with an array-of-quoted-
 * strings value (used for @dependencies/@conflicts); moduleInfoRecordAnnotation
 * matches any "@key" with a quoted-string-keyed object-literal value (used for
 * @requires); annotatedRuleDefinition matches only the literal "@memoize"
 * key(s) followed by a rule definition; grammarAnnotation is the generic
 * "@key: value" (or flag-only "@key") fallback. Each requires a distinct
 * value shape (or, for annotatedRuleDefinition, a distinct key), so a
 * mismatched alternative fails outright rather than partially matching -
 * ordering doesn't create ambiguity between them. annotatedRuleDefinition
 * must be tried before grammarAnnotation so a leading "@memoize" attaches to
 * the rule instead of being parsed as a standalone block annotation first;
 * see its own docs for why restricting it to "memoize" is what keeps this
 * safe for every other annotation key (in particular "@start"/"@skip"
 * immediately followed by a rule, which must keep working exactly as before).
 */
const grammarItem: Parser<GrammarItemType> = choice(
  map(exportDeclaration, (decl): GrammarItemType => ({
    type: "export",
    value: decl,
  })),
  // Must precede every generic `@key` alternative: a malformed `@export`
  // (failed `exportDeclaration` above) is a fatal parse error here, not a
  // generic annotation -- see `malformedExportAnnotation`'s doc comment.
  malformedExportAnnotation,
  // Same precedence reasoning for recognized-but-unimplemented keys
  // (`@private`, `@if`, ...): a fatal error here beats re-parsing one as
  // an inert generic annotation (or, worse, a module-info list/record it
  // syntactically resembles) -- see `unsupportedAnnotation`'s doc comment.
  unsupportedAnnotation,
  map(moduleInfoListAnnotation, (decl): GrammarItemType => ({
    type: "moduleInfoList",
    key: decl.key,
    values: decl.values,
  })),
  map(moduleInfoRecordAnnotation, (decl): GrammarItemType => ({
    type: "moduleInfoRecord",
    key: decl.key,
    values: decl.values,
  })),
  map(annotatedRuleDefinition, (rule): GrammarItemType => ({
    type: "rule",
    value: rule,
  })),
  map(grammarAnnotation, (annotation): GrammarItemType => ({
    type: "annotation",
    value: annotation,
  })),
  map(ruleDefinition, (rule): GrammarItemType => ({
    type: "rule",
    value: rule,
  })),
  map(transformDefinition, (transform): GrammarItemType => ({
    type: "transform",
    value: transform,
  })),
  // `documentationComment` ("///") MUST be tried before `singleLineComment`
  // ("//"): a `///` line also starts with `//`, so the single-line
  // alternative would otherwise match first every time (consuming the
  // third `/` as comment content) and the documentation form would be
  // unreachable -- which is exactly what happened before, leaving
  // `RuleDefinition.documentation` with no producer anywhere.
  map(documentationComment, (comment): GrammarItemType => ({
    type: "documentation",
    value: comment,
  })),
  map(singleLineComment, (comment): GrammarItemType => ({
    type: "comment",
    value: comment,
  })),
  map(blockComment, (comment): GrammarItemType => ({
    type: "comment",
    value: comment,
  })),
);

/**
 * Parse a sequence of grammar items separated by optional whitespace
 */
const grammarItems: Parser<GrammarItemType[]> = map(
  sequence(
    grammarBlockWhitespace,
    zeroOrMore(
      map(sequence(grammarItem, grammarBlockWhitespace), ([item, _]) => item),
    ),
  ),
  ([_, items]) => items,
);

/**
 * Separate grammar items into annotations, rules, and transforms.
 * `///` documentation items accumulate and attach to the next rule's
 * `documentation` field (docs/peg-grammar.md documents `///` as the
 * rule-documentation form); plain `//`/`/* ... *\/` comments don't break
 * the attachment, while any other item kind (annotation, export,
 * transform, ...) drops a pending run -- a doc comment is for the rule it
 * directly precedes, not for a later one several declarations away.
 * Plain comments are otherwise ignored as they don't contribute to the
 * AST.
 * @param items Array of mixed grammar items
 * @returns Separated annotations, rules, and transforms arrays
 */
const separateGrammarItems = (
  items: GrammarItemType[],
): {
  annotations: GrammarAnnotation[];
  rules: RuleDefinition[];
  transforms: TransformDefinition[];
  exportedRules: string[];
  hasExportDeclaration: boolean;
  moduleInfoLists: Map<string, string[]>;
  moduleInfoRecords: Map<string, Record<string, string>>;
} => {
  const annotations: GrammarAnnotation[] = [];
  const rules: RuleDefinition[] = [];
  const transforms: TransformDefinition[] = [];
  const exportedRules: string[] = [];
  // Whether an `@export: [...]` declaration was present at all -- an
  // explicit `@export: []` produces no exportedRules but still counts as
  // "exports declared" (meaning "export nothing"), whereas no `@export`
  // at all means the documented default of "all rules are exported"
  // (see `modularGrammarDefinition` and `NamespaceManager.registerModule`).
  let hasExportDeclaration = false;
  const moduleInfoLists = new Map<string, string[]>();
  const moduleInfoRecords = new Map<string, Record<string, string>>();
  let pendingDocs: string[] = [];

  for (const item of items) {
    if (item.type === "annotation") {
      annotations.push(item.value);
      pendingDocs = [];
    } else if (item.type === "export") {
      hasExportDeclaration = true;
      exportedRules.push(...item.value.rules);
      pendingDocs = [];
    } else if (item.type === "moduleInfoList") {
      moduleInfoLists.set(item.key, [
        ...(moduleInfoLists.get(item.key) ?? []),
        ...item.values,
      ]);
      pendingDocs = [];
    } else if (item.type === "moduleInfoRecord") {
      moduleInfoRecords.set(item.key, {
        ...moduleInfoRecords.get(item.key),
        ...item.values,
      });
      pendingDocs = [];
    } else if (item.type === "rule") {
      rules.push(
        pendingDocs.length > 0
          ? { ...item.value, documentation: pendingDocs }
          : item.value,
      );
      pendingDocs = [];
    } else if (item.type === "transform") {
      transforms.push(item.value);
      pendingDocs = [];
    } else if (item.type === "documentation") {
      pendingDocs.push(item.value);
    }
    // Plain comments are ignored - they don't contribute to the grammar
    // structure (but they also don't break a pending doc-comment run).
  }

  return {
    annotations,
    rules,
    transforms,
    exportedRules,
    hasExportDeclaration,
    moduleInfoLists,
    moduleInfoRecords,
  };
};

/**
 * Parse one unit of leading content (comment or whitespace line)
 * Each choice must consume at least one character to avoid infinite loops
 */
const leadingContentItem: Parser<void> = map(
  choice(
    documentationComment, // Consumes /// + content -- tried before singleLineComment for the same "///" starts with "//" reason as grammarItem above (both are discarded here, but the ordering keeps the two comment parsers' precedence consistent everywhere)
    singleLineComment, // Consumes // + content + implicit newline handling
    blockComment, // Consumes /* ... */ (at least "/*", so never zero-width)
    literal("\n"), // Consumes newline
    literal("\r\n"), // Consumes CRLF
    literal("\r"), // Consumes CR
    literal(" "), // Consumes space
    literal("\t"), // Consumes tab
  ),
  () => undefined,
);

/**
 * Parse leading comments and whitespace before grammar definition
 * This handles comments and whitespace that appear before the grammar keyword
 */
const leadingContent: Parser<void> = map(
  zeroOrMore(leadingContentItem),
  () => undefined,
);

/**
 * Parse a grammar's own name, which docs/peg-grammar.md's module-resolution
 * examples (e.g. `grammar Math.Core { ... }`) allow to be dotted for
 * namespacing. Only used here - rule names and rule-body references use the
 * plain `identifier` parser, since a dot there means a qualified reference
 * (`module.rule`), an unrelated construct.
 */
const dottedGrammarName: Parser<string> = map(
  sequence(
    identifier,
    zeroOrMore(map(sequence(literal("."), identifier), ([, id]) => id.name)),
  ),
  ([first, rest]) => [first.name, ...rest].join("."),
);

/**
 * Parse an `extends Name` or `extends module.Dotted.Name` clause. Defined
 * locally (rather than reusing module.ts's `extendsClause`) because the
 * extended grammar's own name can itself be dotted (e.g. `extends
 * core.Math.Core`, extending the dotted grammar `Math.Core` via module alias
 * `core`) - module.ts's `qualifiedIdentifier` only supports a single
 * `module.name` segment pair, which is right for its other use (resolving
 * `module.rule` references) but too narrow here.
 */
const grammarExtendsClause: Parser<string> = map(
  sequence(
    literal("extends"),
    // Comment-tolerant like every other header separator (the `required`
    // part still forbids `extendsB` with no separator at all).
    requiredWhitespaceOrComment,
    dottedGrammarName,
  ),
  ([, , name]) => name,
);

/**
 * Parse an `includes a.B, c.D, e.F` mixin clause: one or more (possibly
 * module-qualified, possibly dotted) grammar names, comma-separated. Reuses
 * dottedGrammarName per-entry for the same reason grammarExtendsClause does -
 * each entry can itself be a dotted name (`module.Namespaced.Grammar`).
 */
const grammarIncludesClause: Parser<string[]> = map(
  sequence(
    literal("includes"),
    requiredWhitespaceOrComment,
    dottedGrammarName,
    zeroOrMore(
      map(
        sequence(
          optionalWhitespaceOrComment,
          literal(","),
          optionalWhitespaceOrComment,
          dottedGrammarName,
        ),
        ([, , , name]) => name,
      ),
    ),
  ),
  ([, , first, rest]) => [first, ...rest],
);

/**
 * Shared parser for the "grammar Name [extends Other] [includes A, B] { ...items... }"
 * block, used by both grammarDefinition and modularGrammarDefinition below
 * so the two stay in sync on grammar/block syntax. `extends`/`includes` are
 * optional and only meaningful to modularGrammarDefinition (plain
 * GrammarDefinition has no field for them, same treatment as
 * `@export`/`@dependencies`/`@conflicts`).
 * Format: [comments...] grammar Name { @annotations... rule_definitions... }
 */
const grammarBlock: Parser<{
  name: string;
  items: GrammarItemType[];
  extends?: string;
  includes?: string[];
}> = map(
  sequence(
    leadingContent,
    literal(GRAMMAR_KEYWORDS.GRAMMAR),
    // Comment-tolerant (see `requiredWhitespaceOrComment`'s doc comment,
    // `./whitespace-utils.ts`): a comment between the "grammar" keyword
    // and the grammar's own name (e.g. `grammar /* c */ G {`) is a
    // legitimate position for one per docs/peg-grammar.md's Comments
    // section, same as every other header position below -- this is the
    // one MANDATORY separator among them (unlike the `optionalWhitespace`/
    // `optionalWhitespaceOrComment` calls that follow, which sit between
    // optional clauses), so it can't simply become `optionalWhitespace`.
    requiredWhitespaceOrComment,
    dottedGrammarName,
    // Comment-tolerant, same as the pre-"{" position below: a comment
    // between the grammar's name and `extends`, or between `extends` and
    // `includes` (e.g. `grammar G /* c */ extends B {`), is a legitimate
    // header-level position for one per docs/peg-grammar.md's Comments
    // section -- a comment is accepted between any two syntactic
    // elements, and these are header positions, not between-items ones
    // (`grammarItem` below already accepts a comment as its own item
    // for the between-items case). See `optionalWhitespaceOrComment`'s
    // doc comment (`./whitespace-utils.ts`).
    optionalWhitespaceOrComment,
    optional(grammarExtendsClause),
    optionalWhitespaceOrComment,
    optional(grammarIncludesClause),
    optionalWhitespaceOrComment,
    literal(GRAMMAR_SYMBOLS.GRAMMAR_BLOCK_OPEN),
    grammarItems,
    grammarBlockWhitespace,
    literal(GRAMMAR_SYMBOLS.GRAMMAR_BLOCK_CLOSE),
  ),
  (results) => {
    const extendsName = results[5];
    const includesNames = results[7];
    return {
      name: results[3],
      items: results[10],
      ...(extendsName !== null ? { extends: extendsName } : {}),
      ...(includesNames !== null ? { includes: includesNames } : {}),
    };
  },
);

/**
 * Parse complete grammar definition block with optional leading comments.
 * Any `@export: [...]` declarations are parsed but discarded here - use
 * modularGrammarDefinition when the exports need to be preserved.
 */
export const grammarDefinition: Parser<GrammarDefinition> = map(
  grammarBlock,
  ({ name, items }) => {
    const { annotations, rules, transforms } = separateGrammarItems(items);

    return createGrammarDefinition(name, annotations, rules, transforms);
  },
);

/**
 * Parse a grammar definition block, preserving `@export: [...]` declarations
 * and an `extends Other`/`extends module.Other` clause as a
 * ModularGrammarDefinition (used by the module system to know which rules a
 * module makes available to importers, and what it extends). `moduleInfo` is
 * populated from the `@version` annotation and the `@dependencies`/
 * `@conflicts` array annotations when present, since those are the only
 * module-metadata annotations with parser support today (`@namespace` is
 * not).
 */
export const modularGrammarDefinition: Parser<ModularGrammarDefinition> = map(
  grammarBlock,
  ({ name, items, extends: extendsName, includes }) => {
    const {
      annotations,
      rules,
      transforms,
      exportedRules,
      hasExportDeclaration,
      moduleInfoLists,
      moduleInfoRecords,
    } = separateGrammarItems(items);
    const version = annotations.find((a) => a.key === "version")?.value;
    const dependencies = moduleInfoLists.get("dependencies");
    const conflicts = moduleInfoLists.get("conflicts");
    const requires = moduleInfoRecords.get("requires");

    return createModularGrammarDefinition(
      name,
      annotations,
      rules,
      transforms,
      undefined,
      hasExportDeclaration
        ? { type: "ExportDeclaration", rules: exportedRules }
        : undefined,
      version || dependencies || conflicts || requires
        ? createModuleInfo(
            undefined,
            dependencies,
            conflicts,
            version,
            requires,
          )
        : undefined,
      extendsName,
      includes,
    );
  },
);

/**
 * Parse a full TPEG module file: zero or more import statements (each
 * preceded by its own leading comments/whitespace, so a `//`-commented
 * import line doesn't fail leadingContent's "no arbitrary text" rule)
 * followed by a single grammar block and any trailing `transforms`
 * blocks. This is what a `.tpeg` file that begins with `import "..." as
 * alias` lines needs - grammarDefinition and modularGrammarDefinition on
 * their own only accept a grammar block, since their `leadingContent`
 * skips comments/whitespace but not `import` statements.
 *
 * Trailing `transforms Name@lang { ... }` blocks attach to the returned
 * grammar's `transforms` array exactly as `index.ts`'s `tpegFile` does,
 * so a module file can carry transforms the same way a plain grammar
 * file can.
 */
export const tpegModuleFile: Parser<{
  imports: ImportStatement[];
  grammar: ModularGrammarDefinition;
}> = map(
  sequence(
    zeroOrMore(
      map(sequence(leadingContent, importStatement), ([, stmt]) => stmt),
    ),
    modularGrammarDefinition,
    zeroOrMore(
      map(
        sequence(optionalWhitespaceOrComment, transformDefinition),
        ([, transform]) => transform,
      ),
    ),
  ),
  ([imports, grammar, transforms]) => ({
    imports,
    grammar:
      transforms.length === 0
        ? grammar
        : {
            ...grammar,
            transforms: [...(grammar.transforms ?? []), ...transforms],
          },
  }),
);
