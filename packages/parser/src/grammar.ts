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
  literal,
  map,
  oneOrMore,
  optional,
  seq as sequence,
  star as zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  JS_IDENTIFIER_CONT,
  JS_IDENTIFIER_START,
  createJsExprTracker,
  scanRegexLiteral,
  skipBlockComment,
  skipLineComment,
  skipStringLiteral,
} from "./brace-scanner";
import { expression } from "./composition";
import { GRAMMAR_KEYWORDS, GRAMMAR_SYMBOLS } from "./constants";
import { identifier } from "./identifier";
import {
  DEDICATED_ANNOTATION_KEYS,
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
  let endPos = pos;
  let foundEnd = false;
  let activeBraceDepth = 0;
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
      continue;
    }

    // A character class, e.g. `[^"]`, can contain a quote character that
    // isn't a string literal delimiter at all - skip its content atomically
    // (respecting `\]` escapes) so it's never mistaken for the start of a
    // string literal above. Only at brace depth 0, though: inside an
    // action/transform body a `[` is ordinary JavaScript (member access,
    // array literal, computed key), not a TPEG character class - treating
    // it as one ends the fake "class" at the first `]` even when that `]`
    // sits inside a string (e.g. `x["]"]`), after which the leftover `"`
    // opens a phantom string literal that swallows the rest of the file.
    // Inside a body, `[`/`]` fall through to the generic punctuator
    // handling below (`[` can't end an operand, `]` ends one), and any
    // string inside the brackets is still skipped by the string case
    // above before its contents can be misread.
    if (char === "[" && activeBraceDepth === 0) {
      let i = endPos + 1;
      while (i < input.length && input[i] !== "]") {
        if (input[i] === "\\") i++;
        i++;
      }
      endPos = Math.min(i + 1, input.length);
      tracker.operand();
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

    if (char === "/" && activeBraceDepth > 0 && tracker.exprExpected) {
      // A `/` inside an action/transform body where a value is expected
      // opens a regex literal -- e.g. `= /}/` or `if (ok) /}/` (a `)`
      // closing a control-statement paren is followed by a statement, so
      // `tracker.exprExpected` is true there too) -- whose contents must
      // not be mistaken for braces, quotes, or comments. Without this, a
      // `}` inside the pattern decremented `activeBraceDepth` and desynced
      // the whole boundary scan. A `/` that does not start a well-formed
      // regex here is a division operator instead.
      const regexEnd = scanRegexLiteral(input, endPos);
      if (regexEnd !== -1) {
        endPos = regexEnd;
        tracker.operand();
        continue;
      }
      tracker.punct("/");
      endPos++;
      continue;
    }
    if (char === "/" && activeBraceDepth > 0 && !tracker.exprExpected) {
      // Division operator inside an action body -- an operand follows.
      tracker.punct("/");
      endPos++;
      continue;
    }

    if (char === "{") {
      activeBraceDepth++;
      tracker.openBrace();
      endPos++;
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
      tracker.closeBrace();
      endPos++;
      continue;
    }

    // Likewise, "@" can never appear inside an expression at depth 0 -- it
    // only ever starts a grammarItem-level annotation -- so it is a
    // boundary regardless of whether whitespace precedes it (e.g.
    // `start = "a"@skip: ws`). The same check inside the whitespace branch
    // below previously missed the no-whitespace form.
    if (char === GRAMMAR_SYMBOLS.ANNOTATION_PREFIX && activeBraceDepth === 0) {
      foundEnd = true;
      break;
    }

    if (isLineBreakOrSpaceOrTab(char)) {
      // Look ahead past this whitespace run (without committing to
      // consuming it) to see whether the current rule ends here: either the
      // next rule definition ("identifier whitespace* =") or the grammar
      // block's closing brace.
      let checkPos = endPos;
      while (
        checkPos < input.length &&
        isLineBreakOrSpaceOrTab(input[checkPos])
      ) {
        checkPos++;
      }

      if (checkPos < input.length) {
        const boundaryChar = input[checkPos];

        // A bare "}" reached here can ONLY be the enclosing grammar
        // block's own closing brace: a "}" inside a string literal or
        // character class (e.g. `sep = " }"`, `chars = [ }]`) is never
        // independently visible at this point at all -- the main scan
        // loop above skips a string/character-class body atomically
        // (the `"`/`'`/"[" cases), landing past its closing delimiter in
        // one step, long before this whitespace-triggered lookahead ever
        // runs on what's inside it. And `activeBraceDepth === 0` already
        // rules out an action/quantifier block's own "}" (their `{`/`}`
        // are depth-tracked by the main loop's own "{"/"}" cases,
        // independent of this lookahead). So no additional
        // `crossedLineBreak` requirement is needed -- and dropping it
        // fixes a real gap: `grammar G { r = "x" }` (a same-line grammar
        // block, `}` reached without ever crossing a line break) used to
        // fall through this check entirely, silently absorbing the
        // block's own closing brace into `r`'s slice instead of
        // recognizing it as the boundary it is.
        if (boundaryChar === "}" && activeBraceDepth === 0) {
          foundEnd = true;
          break;
        }

        // An annotation ("@key" or "@key: value") is never part of
        // `expression()`'s own grammar -- unlike an identifier (which
        // could legitimately continue a multi-line sequence, hence the
        // "= " lookahead just below), a leading "@" can ONLY start a new
        // grammarItem (a grammar-block-level annotation, or a rule-level
        // one immediately preceding the next rule definition). Without
        // this, a trailing annotation right after a rule -- e.g.
        // `mul_op = "*" / "/"` followed on the next line by `@skip:
        // whitespace` -- gets silently absorbed into `mul_op`'s own
        // slice (nothing else in this scan recognizes "@" as a
        // boundary), relying entirely on `expression()` stopping short
        // and the caller re-parsing the leftover as its own grammarItem
        // -- exactly the "did this rule consume its whole slice"
        // ambiguity this function's full-consumption check (below) exists
        // to catch, so a genuine annotation must be excluded from it by
        // being recognized as a boundary here instead.
        if (
          activeBraceDepth === 0 &&
          boundaryChar === GRAMMAR_SYMBOLS.ANNOTATION_PREFIX
        ) {
          foundEnd = true;
          break;
        }

        if (
          activeBraceDepth === 0 &&
          boundaryChar &&
          IDENTIFIER_START_CHAR.test(boundaryChar)
        ) {
          let identEnd = checkPos + 1;
          while (
            identEnd < input.length &&
            IDENTIFIER_CONT_CHAR.test(input[identEnd] ?? "")
          ) {
            identEnd++;
          }

          // A whole-word "transforms" here can ONLY start a new grammarItem
          // (transformDefinition, see transforms.ts) - unlike a plain
          // identifier, expression()'s own grammar has no "@"/"->"/brace-
          // parameter syntax at all, so "transforms" can never legitimately
          // continue a multi-line sequence as an ordinary rule reference
          // immediately followed by a `transforms Name@language { ... }`
          // block's own tokens. Without this, this scan doesn't stop before
          // "transforms" the way it already does before "}"/"@" above,
          // greedily absorbs the whole transforms block into the CURRENT
          // rule's slice, and fails once expression() stops short at that
          // block's "@" with no boundary check having caught it first (a
          // genuine production parse failure, not merely a self-hosting-PoC
          // gap - see packages/parser/src/self-hosted/README.md). This is
          // narrowly the whole word "transforms", not a prefix (checked via
          // identEnd === checkPos + keyword-length, not identText.startsWith)
          // so a rule legitimately named e.g. "transformsFoo" is unaffected.
          if (
            activeBraceDepth === 0 &&
            input.startsWith(GRAMMAR_KEYWORDS.TRANSFORMS, checkPos) &&
            identEnd === checkPos + GRAMMAR_KEYWORDS.TRANSFORMS.length
          ) {
            foundEnd = true;
            break;
          }

          // Everything `optionalWhitespaceOrComment` accepts --
          // whitespace INCLUDING line breaks, `//` line comments, and
          // `/* */` block comments -- because that is exactly the
          // separator `ruleDefinition` puts between a rule's name and
          // its "=". `identifier <any of those> =` is unambiguously the
          // next rule's start: "=" can never begin an expression
          // element, so the identifier can't be a sequence element
          // continuing THIS rule's body either. (This used to skip only
          // same-line space/tab plus block comments, so `y\n= "b"` -- a
          // rule header `ruleDefinition` itself accepts -- was never
          // detected as a boundary whenever a preceding rule existed:
          // that rule's slice silently absorbed the whole `y\n= "b"`
          // instead of stopping here, and the resulting error even
          // pointed back at the PRECEDING rule.)
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

          // "=" means a rule definition follows ("name = pattern"). Note
          // this deliberately does *not* also treat "identifier(" as a
          // boundary: `grammarItem`'s transform alternative is
          // transformDefinition, which requires a literal "transforms"
          // keyword (see transforms.ts) - a bare "name(params) -> Type {...}"
          // is never a valid grammarItem on its own, so there's nothing to
          // guard against there, and treating "(" as a boundary would
          // instead break a legitimate multi-line sequence whose next line
          // happens to start with "identifier (...)" (e.g. a rule reference
          // immediately followed by a group).
          if (afterIdent < input.length && input[afterIdent] === "=") {
            foundEnd = true;
            break;
          }
        }
      }
    }

    // Track whether a `/` encountered inside an action body could open a
    // regex literal (see the `tracker` declaration above). The values
    // produced while outside an action are never consulted.
    if (JS_IDENTIFIER_START.test(char ?? "")) {
      let wordEnd = endPos + 1;
      while (
        wordEnd < input.length &&
        JS_IDENTIFIER_CONT.test(input[wordEnd] ?? "")
      ) {
        wordEnd++;
      }
      tracker.word(input.slice(endPos, wordEnd));
      endPos = wordEnd;
      continue;
    }
    if (char !== undefined && char >= "0" && char <= "9") {
      tracker.operand();
    } else if (char === "(") {
      tracker.openParen();
    } else if (char === ")") {
      tracker.closeParen();
    } else if (char === "]") {
      tracker.operand();
    } else if ((char === "+" || char === "-") && input[endPos + 1] === char) {
      // Postfix `++`/`--` ends an operand.
      tracker.operand();
      endPos += 2;
      continue;
    } else if (char !== undefined && !isLineBreakOrSpaceOrTab(char)) {
      // Any other punctuator cannot end an operand, so a value is
      // expected next.
      tracker.punct(char);
    }

    endPos++;
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
    const valueClause = results[3][0];
    return createGrammarAnnotation(
      "memoize",
      valueClause ? valueClause[3] : "",
    );
  },
);

/**
 * Parse a rule definition preceded by one or more `@memoize` annotations,
 * attaching them to the resulting `RuleDefinition.annotations`. Tried as
 * its own `grammarItem` alternative *before* the generic `grammarAnnotation`
 * (see `grammarItem` below) so `@memoize` immediately preceding a rule is
 * captured together with it instead of being parsed as a standalone
 * block-level annotation first.
 */
const annotatedRuleDefinition: Parser<RuleDefinition> = map(
  sequence(
    oneOrMore(memoizeAnnotation),
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
    const extendsName = results[5]?.[0];
    const includesNames = results[7]?.[0];
    return {
      name: results[3],
      items: results[10],
      ...(extendsName !== undefined ? { extends: extendsName } : {}),
      ...(includesNames !== undefined ? { includes: includesNames } : {}),
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
