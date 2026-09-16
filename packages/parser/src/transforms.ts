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
  optionalWhitespace,
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

const skipTypeWhitespace = (input: string, pos: number): number => {
  let i = pos;
  while (isTypeWhitespace(input[i])) i++;
  return i;
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
 * Parse a named type (`Name`, optionally followed by `<args...>`). Generic
 * arguments are full union types separated by commas, so nested and
 * multi-parameter generics (`Map<K, V>`, `Result<Array<number>>`) work.
 * Returns null when no identifier starts at (post-whitespace) `pos`, or the
 * `<...>` list is malformed -- in which case nothing is consumed.
 */
const parseNamedType = (input: string, pos: number): TypeMatch | null => {
  const nameStart = skipTypeWhitespace(input, pos);
  if (!TYPE_IDENT_START.test(input[nameStart] ?? "")) return null;
  let i = nameStart + 1;
  while (TYPE_IDENT_CONT.test(input[i] ?? "")) i++;
  const name = input.slice(nameStart, i);

  const open = skipTypeWhitespace(input, i);
  if (input[open] !== "<") return { end: i, named: { name } };

  const argsStart = open + 1;
  let argEnd = parseUnionType(input, argsStart);
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
    argEnd = parseUnionType(input, j + 1);
    if (!argEnd) return null;
    j = argEnd.end;
  }
};

/**
 * Parse one primary type: an object-literal type `{...}`, a parenthesized
 * type `( T )`, or a named type.
 */
const parseTypePrimary = (input: string, pos: number): TypeMatch | null => {
  const start = skipTypeWhitespace(input, pos);
  const ch = input[start];
  if (ch === "{") {
    const end = scanObjectType(input, start);
    return end === -1 ? null : { end };
  }
  if (ch === "(") {
    const inner = parseUnionType(input, start + 1);
    if (!inner) return null;
    const close = skipTypeWhitespace(input, inner.end);
    return input[close] === ")" ? { end: close + 1 } : null;
  }
  return parseNamedType(input, pos);
};

/**
 * Parse a postfix type: a primary type followed by any number of `[]`
 * array markers (`number[]`, `T[][]`). A `[` not followed by `]` (e.g. a
 * tuple type `[A, B]`, which this syntax doesn't support) is left
 * unconsumed rather than silently absorbed.
 */
const parsePostfixType = (input: string, pos: number): TypeMatch | null => {
  const primary = parseTypePrimary(input, pos);
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
 */
const parseUnionType = (input: string, pos: number): TypeMatch | null => {
  const first = parsePostfixType(input, pos);
  if (!first) return null;
  let end = first.end;
  let named = first.named;
  for (;;) {
    const i = skipTypeWhitespace(input, end);
    if (input[i] !== "|" && input[i] !== "&") break;
    const member = parsePostfixType(input, i + 1);
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
  const match = parseUnionType(input, pos);
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
    optionalWhitespace,
    literal(TRANSFORM_SYMBOLS.TYPE_SEPARATOR),
    optionalWhitespace,
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
    optionalWhitespace,
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
                optionalWhitespace,
                literal(","),
                optionalWhitespace,
                parameterType,
              ),
              (results) => results[3],
            ),
          ),
          optionalWhitespace,
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
    optionalWhitespace,
    literal(TRANSFORM_SYMBOLS.RETURN_TYPE_SEPARATOR),
    optionalWhitespace,
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

/**
 * Parse a single transform function
 * Format: function_name(params) -> ReturnType { body }
 */
const transformFunction: Parser<TransformFunction> = (
  input: string,
  pos: number,
) => {
  // optionalWhitespaceOrComment
  const whitespaceResult = optionalWhitespaceOrComment(input, pos);
  let currentPos = whitespaceResult.success ? whitespaceResult.next : pos;

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

  // 最初の空白・コメントをスキップ
  const whitespaceResult = optionalWhitespaceOrComment(input, currentPos);
  if (whitespaceResult.success) {
    currentPos = whitespaceResult.next;
  }

  // 最初の関数を解析
  const firstFunctionResult = transformFunction(input, currentPos);
  if (!firstFunctionResult.success) {
    return firstFunctionResult;
  }

  functions.push(firstFunctionResult.val);
  currentPos = firstFunctionResult.next;

  // 残りの関数を解析
  while (currentPos < input.length) {
    // 関数間の空白・改行・コメントをスキップ
    const separatorResult = optionalWhitespaceOrComment(input, currentPos);
    if (separatorResult.success) {
      currentPos = separatorResult.next;
    }

    // 次のトークンが「}」（ブロックの終端）かチェック
    if (currentPos < input.length && input[currentPos] === "}") {
      // ブロックの終端に到達したので終了
      break;
    }

    // 次の関数を試行
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
const transformSet: Parser<TransformSet> = map(
  sequence(
    transformsKeyword,
    requiredWhitespaceOrComment,
    transformSetName,
    optionalWhitespaceOrComment,
    transformBlockOpen,
    optionalWhitespaceOrComment,
    transformFunctions,
    optionalWhitespaceOrComment,
    transformBlockClose,
  ),
  (results) =>
    createTransformSet(results[2].name, results[2].language, results[6]),
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
