/**
 * TPEG Transforms Parser
 *
 * Implements parsing of transform definitions for TPEG grammar.
 * Based on docs/peg-grammar.md specification.
 *
 * Supports parsing:
 * - Transform set declarations: transforms Name@language { ... }
 * - Transform functions with parameters and return types
 * - Language-specific function bodies
 * - Result type specifications
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  choice,
  createFailure,
  isValidOffset,
  literal,
  map,
  seq as sequence,
  star as zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";
import {
  scanBalancedBraces,
  skipBlockComment,
  skipLineComment,
  skipStringLiteral,
} from "./brace-scanner";
import {
  GRAMMAR_KEYWORDS,
  SUPPORTED_LANGUAGES,
  TRANSFORM_SYMBOLS,
} from "./constants";
import { identifier } from "./identifier";
import {
  type TransformDefinition,
  type TransformFunction,
  type TransformParameter,
  type TransformReturnType,
  type TransformSet,
  createTransformDefinition,
  createTransformFunction,
  createTransformParameter,
  createTransformReturnType,
  createTransformSet,
} from "./types";
import {
  optionalWhitespaceOrComment,
  requiredWhitespaceOrComment,
} from "./whitespace-utils";

// ============================================================================
// Basic Transform Syntax Parsers
// ============================================================================

/**
 * Parse the "transforms" keyword
 */
const transformsKeyword: Parser<string> = literal(GRAMMAR_KEYWORDS.TRANSFORMS);

/**
 * Parse language separator "@"
 */
const languageSeparator: Parser<string> = literal(
  TRANSFORM_SYMBOLS.LANGUAGE_SEPARATOR,
);

/**
 * Parse supported target language
 */
const targetLanguage: Parser<string> = (input: string, pos: number) => {
  // An out-of-contract `pos` (`isValidOffset`, `@suzumiyaaoba/tpeg-core`)
  // must fail rather than reach `startsWith` below, which CLAMPS its
  // position argument into `0..input.length` -- a negative/`NaN`/
  // fractional `pos` would otherwise match a language keyword at index 0
  // and report `{ current: pos, next: pos + lang.length }`.
  if (!isValidOffset(pos) || pos > input.length) {
    return createFailure("Expected a valid position", pos, {
      parserName: "targetLanguage",
    });
  }

  const supportedLanguages = [
    SUPPORTED_LANGUAGES.TYPESCRIPT,
    SUPPORTED_LANGUAGES.PYTHON,
    SUPPORTED_LANGUAGES.GO,
    SUPPORTED_LANGUAGES.RUST,
    SUPPORTED_LANGUAGES.JAVA,
    SUPPORTED_LANGUAGES.CPP,
  ];

  for (const lang of supportedLanguages) {
    if (input.startsWith(lang, pos)) {
      // Check if the match is complete (not a prefix of another language)
      const remainingInput = input.slice(pos + lang.length);
      const nextChar = remainingInput[0];

      // If there's a next character and it's alphanumeric, this might be a prefix
      if (nextChar && /[a-zA-Z0-9]/.test(nextChar)) {
        continue;
      }

      return {
        success: true,
        val: lang,
        current: pos,
        next: pos + lang.length,
      };
    }
  }

  return {
    success: false,
    error: {
      message: "Expected supported target language",
      pos,
      expected: supportedLanguages,
      found: input.slice(pos, pos + 10),
      parserName: "targetLanguage",
    },
  };
};

/**
 * Parse transform set name with language specification
 * Format: Name@language
 */
const transformSetName: Parser<{ name: string; language: string }> = map(
  sequence(
    identifier,
    optionalWhitespaceOrComment,
    languageSeparator,
    optionalWhitespaceOrComment,
    targetLanguage,
  ),
  (results) => ({
    name: results[0].name,
    language: results[4],
  }),
);

/**
 * Parse transform block opening "{"
 */
const transformBlockOpen: Parser<string> = literal(
  TRANSFORM_SYMBOLS.TRANSFORM_BLOCK_OPEN,
);

/**
 * Parse transform block closing "}"
 */
const transformBlockClose: Parser<string> = literal(
  TRANSFORM_SYMBOLS.TRANSFORM_BLOCK_CLOSE,
);

// ============================================================================
// Function Parameter and Return Type Parsers
// ============================================================================

/**
 * A parsed transform-signature type expression: the raw source `text`, plus
 * `head` when the whole type is exactly a named type (`Name`) or a single
 * generic application (`Name<args...>`) -- `head.generic` then holds the raw
 * text between the outer `<`/`>`, so `returnTypeSpec` keeps producing
 * `{ type: "Result", generic: "number" }` for the common `Result<T>` shape.
 * For every other shape (unions/intersections, `T[]`, object-literal and
 * parenthesized types, `Name<T>[]`, ...) `head` is absent and `text` is the
 * full type as written -- nothing is silently truncated to a
 * wrong-but-plausible prefix the way the old TYPE_CHAR scanner and
 * `identifier<identifier>` return-type pair did (e.g. `string | number`
 * becoming `{ type: "string" }`, or `Map<K, V>` failing outright).
 */
interface ParsedTypeExpression {
  text: string;
  head?: { name: string; generic?: string };
}

const TYPE_IDENT_START = /[a-zA-Z_]/;
const TYPE_IDENT_CONT = /[a-zA-Z0-9_]/;

const isTypeWhitespace = (char: string | undefined): boolean =>
  char === " " || char === "\t" || char === "\n" || char === "\r";

/**
 * Skips whitespace AND comments between type-expression tokens, matching
 * `scanObjectType`'s existing comment skipping inside `{...}` types (and
 * `optionalWhitespaceOrComment`'s rule everywhere else a signature
 * separator can appear) -- `Map<K, /* c *\/ V>` is a comment between two
 * syntactic elements, same as anywhere else.
 */
const skipTypeWhitespace = (input: string, pos: number): number => {
  let i = pos;
  for (;;) {
    if (isTypeWhitespace(input[i])) {
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
    return i;
  }
};

/**
 * Scan a `{...}` object-literal type starting at `pos` (which must be `{`),
 * skipping string literals and comments so a `}` inside e.g. a literal
 * member type doesn't close the type early. Returns the offset just past
 * the matching `}`, or -1 if unterminated.
 */
const scanObjectType = (input: string, pos: number): number => {
  let depth = 0;
  let i = pos;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      depth--;
      i++;
      if (depth === 0) return i;
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
  return -1;
};

/** A matched type fragment: `end` offset, plus `named` info when the
 *  fragment is exactly `Name` or `Name<args...>` (see ParsedTypeExpression). */
interface TypeMatch {
  end: number;
  named?: { name: string; generic?: string };
}

/**
 * Maximum generic/parenthesized nesting depth the type grammar recurses
 * into. `A<A<A<...>>>` and `((((...))))` nest one `parseUnionType` call
 * per level, and the recursion is direct JavaScript calls (not the
 * `lazy()`/`recursive()` delegation `PARSER_LIMITS.MAX_RECURSION_DEPTH`
 * already guards), so an unbounded nested input ran the real call stack
 * out -- a `RangeError` crash instead of a graceful "Expected type"
 * failure. 256 is far past any plausible handwritten type while keeping
 * worst-case stack use small.
 */
const MAX_TYPE_NESTING_DEPTH = 256;

/**
 * Parse a named type (`Name`, optionally followed by `<args...>`). Generic
 * arguments are full union types separated by commas, so nested and
 * multi-parameter generics (`Map<K, V>`, `Result<Array<number>>`) work.
 * Returns null when no identifier starts at (post-whitespace) `pos`, or the
 * `<...>` list is malformed -- in which case nothing is consumed.
 */
const parseNamedType = (
  input: string,
  pos: number,
  depth: number,
): TypeMatch | null => {
  const nameStart = skipTypeWhitespace(input, pos);
  if (!TYPE_IDENT_START.test(input[nameStart] ?? "")) return null;
  let i = nameStart + 1;
  while (TYPE_IDENT_CONT.test(input[i] ?? "")) i++;
  const name = input.slice(nameStart, i);

  const open = skipTypeWhitespace(input, i);
  if (input[open] !== "<") return { end: i, named: { name } };

  const argsStart = open + 1;
  let argEnd = parseUnionType(input, argsStart, depth + 1);
  if (!argEnd) return null;
  let j = argEnd.end;
  for (;;) {
    j = skipTypeWhitespace(input, j);
    if (input[j] === ">") {
      return {
        end: j + 1,
        named: { name, generic: input.slice(argsStart, j) },
      };
    }
    if (input[j] !== ",") return null;
    argEnd = parseUnionType(input, j + 1, depth + 1);
    if (!argEnd) return null;
    j = argEnd.end;
  }
};

/**
 * Parse one primary type: an object-literal type `{...}`, a parenthesized
 * type `( T )`, or a named type.
 */
const parseTypePrimary = (
  input: string,
  pos: number,
  depth: number,
): TypeMatch | null => {
  const start = skipTypeWhitespace(input, pos);
  const ch = input[start];
  if (ch === "{") {
    const end = scanObjectType(input, start);
    return end === -1 ? null : { end };
  }
  if (ch === "(") {
    const inner = parseUnionType(input, start + 1, depth + 1);
    if (!inner) return null;
    const close = skipTypeWhitespace(input, inner.end);
    return input[close] === ")" ? { end: close + 1 } : null;
  }
  return parseNamedType(input, pos, depth);
};

/**
 * Parse a postfix type: a primary type followed by any number of `[]`
 * array markers (`number[]`, `T[][]`). A `[` not followed by `]` (e.g. a
 * tuple type `[A, B]`, which this syntax doesn't support) is left
 * unconsumed rather than silently absorbed.
 */
const parsePostfixType = (
  input: string,
  pos: number,
  depth: number,
): TypeMatch | null => {
  const primary = parseTypePrimary(input, pos, depth);
  if (!primary) return null;
  let end = primary.end;
  let named = primary.named;
  for (;;) {
    const i = skipTypeWhitespace(input, end);
    if (input[i] !== "[") break;
    const close = skipTypeWhitespace(input, i + 1);
    if (input[close] !== "]") break;
    end = close + 1;
    named = undefined;
  }
  return named ? { end, named } : { end };
};

/**
 * Parse a union/intersection type: postfix types separated by `|` or `&`.
 * A trailing separator with no following member is left unconsumed.
 * `depth` is the enclosing `<...>`/`(...)` nesting level -- the recursion
 * re-enters here, so this is the one place the bound is enforced.
 */
const parseUnionType = (
  input: string,
  pos: number,
  depth: number,
): TypeMatch | null => {
  if (depth > MAX_TYPE_NESTING_DEPTH) return null;
  const first = parsePostfixType(input, pos, depth);
  if (!first) return null;
  let end = first.end;
  let named = first.named;
  for (;;) {
    const i = skipTypeWhitespace(input, end);
    if (input[i] !== "|" && input[i] !== "&") break;
    const member = parsePostfixType(input, i + 1, depth);
    if (!member) break;
    end = member.end;
    named = undefined;
  }
  return named ? { end, named } : { end };
};

/**
 * Parse a transform-signature type expression (parameters and `->` return
 * types share this grammar). Fails only when no type starts at `pos`;
 * unsupported-but-partial forms (tuple types, function types) stop at the
 * token they can't consume, leaving it for the caller's next expected token
 * to reject -- the type text is never silently truncated.
 */
const typeExpression: Parser<ParsedTypeExpression> = (
  input: string,
  pos: number,
) => {
  const match = parseUnionType(input, pos, 0);
  if (!match) {
    return createFailure("Expected type", pos, {
      expected: ["type"],
      found: input[pos] ?? "end of input",
      parserName: "typeExpression",
    });
  }
  const text = input.slice(skipTypeWhitespace(input, pos), match.end);
  return {
    success: true,
    val: match.named ? { text, head: match.named } : { text },
    current: pos,
    next: match.end,
  };
};

/**
 * Parse parameter type annotation
 * Format: name: type (supports both simple and complex types)
 */
const parameterType: Parser<{ name: string; type: string }> = map(
  sequence(
    identifier,
    // Comment-tolerant around ":" and the type, same as every other
    // signature separator (optionalWhitespaceOrComment, see
    // `./whitespace-utils.ts`) -- `f(a /* c *\/: string)` is a comment
    // between two syntactic elements, per docs/peg-grammar.md.
    optionalWhitespaceOrComment,
    literal(TRANSFORM_SYMBOLS.TYPE_SEPARATOR),
    optionalWhitespaceOrComment,
    map(typeExpression, (t) => t.text),
  ),
  (results) => ({
    name: results[0].name,
    type: results[4],
  }),
);

/**
 * Parse function parameter list
 * Format: (param1: type1, param2: type2, ...)
 */
const parameterList: Parser<TransformParameter[]> = map(
  sequence(
    literal(TRANSFORM_SYMBOLS.PARAMETER_START),
    optionalWhitespaceOrComment,
    choice(
      // Empty parameter list
      map(literal(TRANSFORM_SYMBOLS.PARAMETER_END), () => []),
      // Non-empty parameter list
      map(
        sequence(
          parameterType,
          zeroOrMore(
            map(
              sequence(
                optionalWhitespaceOrComment,
                literal(","),
                optionalWhitespaceOrComment,
                parameterType,
              ),
              (results) => results[3],
            ),
          ),
          optionalWhitespaceOrComment,
          literal(TRANSFORM_SYMBOLS.PARAMETER_END),
        ),
        (results) => [results[0], ...results[1]],
      ),
    ),
  ),
  (results) => {
    const params = results[2];
    if (Array.isArray(params)) {
      return params.map((param) =>
        createTransformParameter(param.name, param.type),
      );
    }
    return [];
  },
);

/**
 * Parse return type specification
 * Format: -> ReturnType, -> ReturnType<GenericType, ...>, or any other
 * type expression (`-> string | number`, `-> number[]`, `-> { x: number }`)
 */
const returnTypeSpec: Parser<TransformReturnType> = map(
  sequence(
    optionalWhitespaceOrComment,
    literal(TRANSFORM_SYMBOLS.RETURN_TYPE_SEPARATOR),
    optionalWhitespaceOrComment,
    typeExpression,
  ),
  (results) => {
    const parsed = results[3];
    return parsed.head
      ? createTransformReturnType(parsed.head.name, parsed.head.generic)
      : createTransformReturnType(parsed.text);
  },
);

// ============================================================================
// Function Body Parser
// ============================================================================

/**
 * Parse function body content: everything between a `{` and its matching
 * `}`, skipping over string/comment contents so an embedded `}` doesn't
 * close the block early. See `brace-scanner.ts` for the shared scanner
 * (also used by the semantic action block parser in `composition.ts`).
 *
 * The `{` must be the very next character after the signature's trailing
 * trivia: `scanBalancedBraces` alone forward-searches for the next `{`
 * anywhere in the remaining input, which would silently swallow garbage
 * between the return type and the body -- and a missing body would
 * mis-parse against the NEXT function's `{`. Gating on the character
 * here (like `composition.ts`'s `actionBlock`) rejects both cleanly.
 */
const functionBody: Parser<string> = (input, pos) => {
  if (input[pos] !== "{") {
    return createFailure("Expected opening brace '{'", pos, {
      expected: ["{"],
      found: input[pos] ?? "",
      parserName: "functionBody",
    });
  }
  return scanBalancedBraces(input, pos);
};

// ============================================================================
// Transform Function Parser
// ============================================================================

const TRANSFORM_WS_CHARS: ReadonlySet<string> = new Set([
  " ",
  "\t",
  "\n",
  "\r",
]);

/**
 * Skips a whitespace/comment run exactly like `optionalWhitespaceOrComment`,
 * but returns the contents of every `///` documentation comment encountered
 * (checked before the `//` case, since `///` starts with `//` too) so they
 * can attach to the following function's `documentation` field -- the
 * transform-level counterpart of `grammar.ts`'s `///`-before-a-rule
 * attachment.
 */
const docCollectingSeparator: Parser<string[]> = (input, pos) => {
  // An out-of-contract `pos` (`isValidOffset`, `@suzumiyaaoba/tpeg-core`)
  // must fail rather than echo itself back in a bogus success -- see the
  // identical guard on `optionalWhitespaceOrComment`
  // (`./whitespace-utils.ts`), whose scanning rule this mirrors.
  if (!isValidOffset(pos) || pos > input.length) {
    return createFailure("Expected a valid position", pos, {
      parserName: "docCollectingSeparator",
    });
  }

  const docs: string[] = [];
  let i = pos;
  while (i < input.length) {
    if (TRANSFORM_WS_CHARS.has(input[i] as string)) {
      i++;
      continue;
    }
    if (input[i] === "/" && input[i + 1] === "/" && input[i + 2] === "/") {
      const end = skipLineComment(input, i);
      docs.push(input.slice(i + 3, end).trim());
      i = end;
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
  return { success: true, val: docs, current: pos, next: i };
};

/**
 * Parse a single transform function
 * Format: function_name(params) -> ReturnType { body }
 * Leading `///` documentation comments are attached to the function's
 * `documentation` field.
 */
const transformFunction: Parser<TransformFunction> = (
  input: string,
  pos: number,
) => {
  // optionalWhitespaceOrComment + `///` doc collection
  const whitespaceResult = docCollectingSeparator(input, pos);
  let currentPos = whitespaceResult.success ? whitespaceResult.next : pos;
  const documentation = whitespaceResult.success ? whitespaceResult.val : [];

  // identifier
  const identifierResult = identifier(input, currentPos);
  if (!identifierResult.success) {
    return identifierResult;
  }

  currentPos = identifierResult.next;

  // optionalWhitespaceOrComment
  const whitespace2Result = optionalWhitespaceOrComment(input, currentPos);
  currentPos = whitespace2Result.success ? whitespace2Result.next : currentPos;

  // parameterList
  const parameterListResult = parameterList(input, currentPos);
  if (!parameterListResult.success) {
    return parameterListResult;
  }

  currentPos = parameterListResult.next;

  // returnTypeSpec
  const returnTypeSpecResult = returnTypeSpec(input, currentPos);
  if (!returnTypeSpecResult.success) {
    return returnTypeSpecResult;
  }

  currentPos = returnTypeSpecResult.next;

  // optionalWhitespaceOrComment
  const whitespace3Result = optionalWhitespaceOrComment(input, currentPos);
  currentPos = whitespace3Result.success ? whitespace3Result.next : currentPos;

  // functionBody
  const functionBodyResult = functionBody(input, currentPos);
  if (!functionBodyResult.success) {
    return functionBodyResult;
  }

  return {
    success: true,
    val: createTransformFunction(
      identifierResult.val.name,
      parameterListResult.val,
      returnTypeSpecResult.val,
      functionBodyResult.val,
      documentation.length > 0 ? documentation : undefined,
    ),
    current: pos,
    next: functionBodyResult.next,
  };
};

// ============================================================================
// Transform Set Parser
// ============================================================================

/**
 * Parse transform functions within a transform set
 */
const transformFunctions: Parser<TransformFunction[]> = (
  input: string,
  pos: number,
) => {
  const functions: TransformFunction[] = [];
  let currentPos = pos;

  // 最初の関数を解析 -- transformFunction's own leading separator
  // (docCollectingSeparator) skips whitespace/comments AND collects any
  // `///` documentation lines so they attach to the function that follows
  // them, so there is deliberately no separate whitespace skip here.
  const firstFunctionResult = transformFunction(input, currentPos);
  if (!firstFunctionResult.success) {
    return firstFunctionResult;
  }

  functions.push(firstFunctionResult.val);
  currentPos = firstFunctionResult.next;

  // 残りの関数を解析
  while (currentPos < input.length) {
    // Peek past whitespace/comments WITHOUT letting a plain separator eat
    // `///` doc lines before transformFunction can collect them -- the
    // collected lines re-attach inside transformFunction's own separator.
    const separatorResult = docCollectingSeparator(input, currentPos);
    const afterSeparator = separatorResult.success
      ? separatorResult.next
      : currentPos;

    // 次のトークンが「}」（ブロックの終端）かチェック
    if (afterSeparator < input.length && input[afterSeparator] === "}") {
      // ブロックの終端に到達したので終了
      currentPos = afterSeparator;
      break;
    }

    // 次の関数を試行 (transformFunction re-runs the same doc-collecting
    // separator internally, so pending `///` lines attach to it)
    const nextFunctionResult = transformFunction(input, currentPos);
    if (!nextFunctionResult.success) {
      // 関数が見つからない場合は終了
      break;
    }

    functions.push(nextFunctionResult.val);
    currentPos = nextFunctionResult.next;
  }

  return {
    success: true,
    val: functions,
    current: pos,
    next: currentPos,
  };
};

/**
 * Parse complete transform set
 * Format: transforms Name@language { functions... }
 */
// No separator between "{" and transformFunctions on purpose:
// transformFunction's own leading docCollectingSeparator already skips
// whitespace/comments AND collects `///` doc lines for the first
// function -- a plain optionalWhitespaceOrComment here would eat those
// doc lines before transformFunctions could see them (the same reason
// the loop inside transformFunctions peeks with docCollectingSeparator).
const transformSet: Parser<TransformSet> = map(
  sequence(
    transformsKeyword,
    requiredWhitespaceOrComment,
    transformSetName,
    optionalWhitespaceOrComment,
    transformBlockOpen,
    transformFunctions,
    optionalWhitespaceOrComment,
    transformBlockClose,
  ),
  (results) =>
    createTransformSet(results[2].name, results[2].language, results[5]),
);

// ============================================================================
// Main Transform Definition Parser
// ============================================================================

/**
 * Parse a complete transform definition
 * @returns Parser<TransformDefinition> Parser for transform definitions
 */
export const transformDefinition: Parser<TransformDefinition> = map(
  transformSet,
  (transformSet) => createTransformDefinition(transformSet),
);

// ============================================================================
// Export individual parsers for testing and composition
// ============================================================================

export {
  transformsKeyword,
  targetLanguage,
  transformSetName,
  parameterType,
  parameterList,
  returnTypeSpec,
  functionBody,
  transformFunction,
  transformFunctions,
  transformSet,
};
