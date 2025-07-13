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

import type { Parser } from "tpeg-core";
import {
  choice,
  literal,
  map,
  seq as sequence,
  star,
  star as zeroOrMore,
} from "tpeg-core";
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
import { optionalWhitespace, whitespace } from "./whitespace-utils";

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
const targetLanguage: Parser<string> = (
  input: string,
  pos: { offset: number; line: number; column: number },
) => {
  const supportedLanguages = [
    SUPPORTED_LANGUAGES.TYPESCRIPT,
    SUPPORTED_LANGUAGES.PYTHON,
    SUPPORTED_LANGUAGES.GO,
    SUPPORTED_LANGUAGES.RUST,
    SUPPORTED_LANGUAGES.JAVA,
    SUPPORTED_LANGUAGES.CPP,
  ];

  for (const lang of supportedLanguages) {
    if (input.startsWith(lang, pos.offset)) {
      // Check if the match is complete (not a prefix of another language)
      const remainingInput = input.slice(pos.offset + lang.length);
      const nextChar = remainingInput[0];

      // If there's a next character and it's alphanumeric, this might be a prefix
      if (nextChar && /[a-zA-Z0-9]/.test(nextChar)) {
        continue;
      }

      return {
        success: true,
        val: lang,
        current: pos,
        next: {
          offset: pos.offset + lang.length,
          line: pos.line,
          column: pos.column + lang.length,
        },
      };
    }
  }

  return {
    success: false,
    error: {
      message: "Expected supported target language",
      pos,
      expected: supportedLanguages,
      found: input.slice(pos.offset, pos.offset + 10),
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
    optionalWhitespace,
    languageSeparator,
    optionalWhitespace,
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
 * Parse complex type (including object types)
 * This is a simplified parser that captures type strings including braces
 */
const complexType: Parser<string> = (
  input: string,
  pos: { offset: number; line: number; column: number },
) => {
  let currentPos = pos.offset;
  let braceCount = 0;
  let result = "";

  while (currentPos < input.length) {
    const char = input[currentPos];

    if (!char) {
      break;
    }

    if (char === "{") {
      braceCount++;
      result += char;
      currentPos++;
    } else if (char === "}") {
      braceCount--;
      result += char;
      currentPos++;
      if (braceCount === 0) {
        break;
      }
    } else if (braceCount > 0) {
      // Inside braces, capture everything
      result += char;
      currentPos++;
    } else if (/[a-zA-Z0-9_<>[\]]/.test(char)) {
      // Outside braces, capture identifier-like characters
      result += char;
      currentPos++;
    } else {
      // Stop at other characters
      break;
    }
  }

  if (result.length === 0) {
    return {
      success: false,
      error: {
        message: "Expected type",
        pos,
        expected: ["type"],
        found: input[pos.offset] || "",
        parserName: "complexType",
      },
    };
  }

  return {
    success: true,
    val: result,
    current: pos,
    next: {
      offset: currentPos,
      line: pos.line,
      column: pos.column + (currentPos - pos.offset),
    },
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
    complexType, // Use complexType instead of identifier
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
 * Parse generic type parameter
 * Format: <type>
 */
const genericTypeParam: Parser<string> = map(
  sequence(literal("<"), identifier, literal(">")),
  (results) => results[1].name,
);

/**
 * Parse return type specification
 * Format: -> ReturnType or -> ReturnType<GenericType>
 */
const returnTypeSpec: Parser<TransformReturnType> = map(
  sequence(
    optionalWhitespace,
    literal(TRANSFORM_SYMBOLS.RETURN_TYPE_SEPARATOR),
    optionalWhitespace,
    identifier,
    choice(
      // With generic type parameter
      map(genericTypeParam, (generic) => ({ hasGeneric: true, generic })),
      // Without generic type parameter
      map(optionalWhitespace, () => ({
        hasGeneric: false,
        generic: undefined,
      })),
    ),
  ),
  (results) => {
    const baseType = results[3].name;
    const genericResult = results[4];

    if (genericResult.hasGeneric && genericResult.generic) {
      return createTransformReturnType(baseType, genericResult.generic);
    }
    return createTransformReturnType(baseType);
  },
);

// ============================================================================
// Function Body Parser
// ============================================================================

/**
 * Parse function body content
 * This is a simplified parser that captures everything between { and }
 * In a full implementation, this would parse language-specific syntax
 */
const functionBody: Parser<string> = (
  input: string,
  pos: { offset: number; line: number; column: number },
) => {
  // Find the opening brace
  const openBracePos = input.indexOf("{", pos.offset);
  if (openBracePos === -1) {
    return {
      success: false,
      error: {
        message: "Expected opening brace '{'",
        pos,
        expected: ["{"],
        found: input[pos.offset] || "",
        parserName: "functionBody",
      },
    };
  }

  // Find the matching closing brace
  let braceCount = 0;
  let closeBracePos = -1;

  for (let i = openBracePos; i < input.length; i++) {
    if (input[i] === "{") {
      braceCount++;
    } else if (input[i] === "}") {
      braceCount--;
      if (braceCount === 0) {
        closeBracePos = i;
        break;
      }
    }
  }

  if (closeBracePos === -1) {
    return {
      success: false,
      error: {
        message: "Expected closing brace '}'",
        pos,
        expected: ["}"],
        found: input[input.length - 1] || "",
        parserName: "functionBody",
      },
    };
  }

  // Extract the body content (excluding the braces)
  const bodyContent = input.slice(openBracePos + 1, closeBracePos);

  // nextは「}」の直後のみを返す
  const nextOffset = closeBracePos + 1;
  const consumed = nextOffset - pos.offset;
  // 行・カラムの更新（簡易: 複数行対応は必要に応じて拡張）
  let nextLine = pos.line;
  let nextColumn = pos.column + consumed;
  const consumedText = input.slice(pos.offset, nextOffset);
  const lines = consumedText.split("\n");
  if (lines.length > 1) {
    nextLine += lines.length - 1;
    nextColumn = (lines[lines.length - 1] ?? "").length + 1;
  }

  return {
    success: true,
    val: bodyContent,
    current: pos,
    next: {
      offset: nextOffset,
      line: nextLine,
      column: nextColumn,
    },
  };
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
  pos: { offset: number; line: number; column: number },
) => {
  // optionalWhitespace
  const whitespaceResult = optionalWhitespace(input, pos);
  let currentPos = whitespaceResult.success ? whitespaceResult.next : pos;

  // identifier
  const identifierResult = identifier(input, currentPos);
  if (!identifierResult.success) {
    return identifierResult;
  }

  currentPos = identifierResult.next;

  // optionalWhitespace
  const whitespace2Result = optionalWhitespace(input, currentPos);
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

  // optionalWhitespace
  const whitespace3Result = optionalWhitespace(input, currentPos);
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
  pos: { offset: number; line: number; column: number },
) => {
  const functions: TransformFunction[] = [];
  let currentPos = pos;

  // 最初の空白をスキップ
  const whitespaceResult = star(whitespace)(input, currentPos);
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
  while (currentPos.offset < input.length) {
    // 関数間の空白・改行をスキップ
    const separatorResult = star(whitespace)(input, currentPos);
    if (separatorResult.success) {
      currentPos = separatorResult.next;
    }

    // 次のトークンが「}」（ブロックの終端）かチェック
    if (currentPos.offset < input.length && input[currentPos.offset] === "}") {
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
    whitespace,
    transformSetName,
    optionalWhitespace,
    transformBlockOpen,
    optionalWhitespace,
    transformFunctions,
    optionalWhitespace,
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
