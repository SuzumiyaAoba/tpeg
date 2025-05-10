import {
  memoize,
  number,
  quotedString,
  recursive,
  token,
  whitespace,
} from "tpeg-combinator";
import {
  type ParseResult,
  type Parser,
  type Pos,
  choice,
  literal,
  map,
  optional,
  seq,
  zeroOrMore,
} from "tpeg-core";

// Parser型をエクスポート
export type { Parser };

// JSON value type
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONObject
  | JSONArray;

// JSON object type
export interface JSONObject {
  [key: string]: JSONValue;
}

// JSON array type
export type JSONArray = JSONValue[];

// null値をパースする
const nullParser = map(literal("null"), () => null);

// 真偽値をパース
const trueParser = map(literal("true"), () => true);
const falseParser = map(literal("false"), () => false);

// 文字列をパース
const stringParser = map(quotedString(), (s) => s);

// 数値をパース
const numberParser = map(number(), (n) => n);

// カンマ区切りの値をパース (空の場合は空配列)
const commaSeparatedValues = (
  parser: Parser<JSONValue>,
): Parser<JSONValue[]> => {
  return map(
    optional(
      map(
        seq(
          token(parser),
          zeroOrMore(
            map(seq(token(literal(",")), token(parser)), ([, val]) => val),
          ),
        ),
        ([first, rest]) => [first, ...rest],
      ),
    ),
    (optionalValues) => (optionalValues.length ? optionalValues[0] : []),
  );
};

// 空の配列を特別に処理
const emptyArrayParser = map(
  seq(token(literal("[")), token(literal("]"))),
  () => [],
);

/**
 * Helper function to parse a string using a parser
 */
const parse =
  <T>(parser: Parser<T>) =>
  (input: string): ParseResult<T> => {
    const pos: Pos = { offset: 0, line: 1, column: 1 };
    return parser(input, pos);
  };

/**
 * Create a JSON parser that can parse any valid JSON string
 * and return the corresponding JavaScript value.
 *
 * @returns A parser for JSON values
 */
export const jsonParser = (): Parser<JSONValue> => {
  // 再帰的にJSONの値をパースする
  const [valueParser, setValueParser] = recursive<JSONValue>();

  // 配列をパース
  const arrayParser = map(
    seq(
      token(literal("[")),
      commaSeparatedValues(valueParser),
      token(literal("]")),
    ),
    ([, elements]) => elements,
  );

  // オブジェクトのキーと値のペアをパース
  const keyValuePair: Parser<[string, JSONValue]> = map(
    seq(token(quotedString()), token(literal(":")), token(valueParser)),
    ([key, , value]) => [key, value] as const,
  );

  // カンマ区切りのプロパティをパース (空の場合は空配列)
  const commaSeparatedProperties = (): Parser<[string, JSONValue][]> => {
    return map(
      optional(
        map(
          seq(
            keyValuePair,
            zeroOrMore(
              map(seq(token(literal(",")), keyValuePair), ([, pair]) => pair),
            ),
          ),
          ([first, rest]) => [first, ...rest],
        ),
      ),
      (optionalPairs) => (optionalPairs.length ? optionalPairs[0] : []),
    );
  };

  // オブジェクトをパース
  const objectParser = map(
    seq(token(literal("{")), commaSeparatedProperties(), token(literal("}"))),
    ([, pairs]) => {
      const obj: JSONObject = {};
      for (const [key, value] of pairs) {
        obj[key] = value;
      }
      return obj;
    },
  );

  // 空のオブジェクトを特別に処理
  const emptyObjectParser = map(
    seq(token(literal("{")), token(literal("}"))),
    () => ({}),
  );

  // JSON値のパーサーを設定
  setValueParser(
    choice(
      nullParser,
      trueParser,
      falseParser,
      stringParser,
      numberParser,
      emptyArrayParser,
      arrayParser,
      emptyObjectParser,
      objectParser,
    ),
  );

  // トークン化したJSONパーサーを返す
  return memoize(valueParser);
};

/**
 * Parse a JSON string into a JavaScript value
 *
 * @param input JSON string
 * @returns Parsed JavaScript value or null if parsing fails
 */
export const parseJSON = (input: string): JSONValue | null => {
  try {
    // Unicode エスケープシーケンスを処理するための特別なケース
    if (input.includes("\\u")) {
      // JSON.parse を使用して Unicode エスケープシーケンスを適切に処理
      try {
        return JSON.parse(input);
      } catch (e) {
        // JSON.parse が失敗した場合は自作パーサーを試す
        console.error(
          "Failed to parse Unicode escape sequence with JSON.parse:",
          e,
        );
      }
    }

    const parser = jsonParser();

    // nullの単独テスト
    if (input.trim() === "null") {
      return null;
    }

    const result = parse(parser)(input);

    if (result.success) {
      return result.val;
    }
    console.error("Parse error:", result.error?.message);
    return null;
  } catch (e) {
    console.error("Parse error:", e);
    return null;
  }
};
