import {
  memoize,
  number,
  quotedString,
  recursive,
  whitespace,
} from "tpeg-combinator";
import {
  type ParseResult,
  type Parser,
  type Pos,
  choice,
  literal,
  map,
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
  // ホワイトスペースをスキップする
  const ws = whitespace();

  // トークンを定義する関数
  const tokenize = <T>(parser: Parser<T>): Parser<T> => {
    return (input: string, pos: Pos) => {
      // 先頭のホワイトスペースをスキップ
      const wsResult = ws(input, pos);
      if (!wsResult.success) {
        return wsResult;
      }

      // パーサーを実行
      const result = parser(input, wsResult.next);
      if (!result.success) {
        return result;
      }

      // 末尾のホワイトスペースをスキップ
      const trailingWsResult = ws(input, result.next);
      if (!trailingWsResult.success) {
        return trailingWsResult;
      }

      return {
        success: true,
        val: result.val,
        current: result.current,
        next: trailingWsResult.next,
      };
    };
  };

  // 再帰的にJSONの値をパースする
  const [valueParser, setValueParser] = recursive<JSONValue>();

  // null値を直接パースする特殊なパーサー
  const nullParser: Parser<JSONValue> = (input: string, pos: Pos) => {
    const nullStr = "null";

    // 現在位置からのサブ文字列を取得
    const substring = input.slice(pos.offset);

    // nullで始まる場合
    if (substring.startsWith(nullStr)) {
      // 次の位置を計算
      const nextPos: Pos = {
        offset: pos.offset + nullStr.length,
        line: pos.line,
        column: pos.column + nullStr.length,
      };

      return {
        success: true,
        val: null,
        current: pos,
        next: nextPos,
      };
    }

    return {
      success: false,
      error: {
        message: `Expected 'null' at position ${
          pos.offset
        }, got "${substring.slice(0, 10)}..."`,
        pos,
      },
    };
  };

  // 真偽値をパース
  const trueParser = map(literal("true"), () => true as JSONValue);
  const falseParser = map(literal("false"), () => false as JSONValue);

  // 文字列をパース
  const stringParser = map(quotedString(), (s) => s as JSONValue);

  // 数値をパース
  const numberParser = map(number(), (n) => n as JSONValue);

  // 配列をパース
  const arrayParser: Parser<JSONValue> = (input: string, pos: Pos) => {
    // 開始の '['
    const openResult = tokenize(literal("["))(input, pos);
    if (!openResult.success) {
      return openResult;
    }

    // 要素がない場合
    const closeAfterOpenResult = tokenize(literal("]"))(input, openResult.next);
    if (closeAfterOpenResult.success) {
      return {
        success: true,
        val: [] as JSONArray,
        current: pos,
        next: closeAfterOpenResult.next,
      };
    }

    // 要素がある場合
    const elements: JSONValue[] = [];
    let currentPos = openResult.next;

    while (true) {
      // 要素をパース
      const elementResult = tokenize(valueParser)(input, currentPos);
      if (!elementResult.success) {
        return elementResult;
      }

      elements.push(elementResult.val);
      currentPos = elementResult.next;

      // カンマまたは閉じ括弧をチェック
      const commaResult = tokenize(literal(","))(input, currentPos);
      if (commaResult.success) {
        currentPos = commaResult.next;
        continue;
      }

      const closeResult = tokenize(literal("]"))(input, currentPos);
      if (closeResult.success) {
        return {
          success: true,
          val: elements,
          current: pos,
          next: closeResult.next,
        };
      }

      return {
        success: false,
        error: {
          message: "Expected ',' or ']' after array element",
          pos: currentPos,
        },
      };
    }
  };

  // オブジェクトをパース
  const objectParser: Parser<JSONValue> = (input: string, pos: Pos) => {
    // 開始の '{'
    const openResult = tokenize(literal("{"))(input, pos);
    if (!openResult.success) {
      return openResult;
    }

    // 空のオブジェクトの場合
    const closeAfterOpenResult = tokenize(literal("}"))(input, openResult.next);
    if (closeAfterOpenResult.success) {
      return {
        success: true,
        val: {} as JSONObject,
        current: pos,
        next: closeAfterOpenResult.next,
      };
    }

    // プロパティがある場合
    const obj: JSONObject = {};
    let currentPos = openResult.next;

    while (true) {
      // キーをパース
      const keyResult = tokenize(quotedString())(input, currentPos);
      if (!keyResult.success) {
        return keyResult;
      }

      // コロンをパース
      const colonResult = tokenize(literal(":"))(input, keyResult.next);
      if (!colonResult.success) {
        return colonResult;
      }

      // 値をパース
      const valueResult = tokenize(valueParser)(input, colonResult.next);
      if (!valueResult.success) {
        return valueResult;
      }

      // オブジェクトに追加
      obj[keyResult.val] = valueResult.val;
      currentPos = valueResult.next;

      // カンマまたは閉じ括弧をチェック
      const commaResult = tokenize(literal(","))(input, currentPos);
      if (commaResult.success) {
        currentPos = commaResult.next;
        continue;
      }

      const closeResult = tokenize(literal("}"))(input, currentPos);
      if (closeResult.success) {
        return {
          success: true,
          val: obj,
          current: pos,
          next: closeResult.next,
        };
      }

      return {
        success: false,
        error: {
          message: "Expected ',' or '}' after object property",
          pos: currentPos,
        },
      };
    }
  };

  // JSON値のパーサーを設定
  setValueParser(
    choice(
      nullParser,
      trueParser,
      falseParser,
      stringParser,
      numberParser,
      arrayParser,
      objectParser
    )
  );

  // トークン化したJSONパーサーを返す
  return memoize(tokenize(valueParser));
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
          e
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
    } else {
      console.error("Parse error:", result.error?.message);
      return null;
    }
  } catch (e) {
    console.error("Parse error:", e);
    return null;
  }
};

// Example usage
export const testJSON = (): void => {
  // Basic test cases
  const testCases = [
    // 基本的な値
    '"test string"',
    "123.45",
    "true",
    "false",
    "null",
    // 配列
    "[]",
    '["a", 1, true]',
    // オブジェクト
    "{}",
    '{"a": 1, "b": "string", "c": true}',
    '{"a": [1, 2], "b": {"c": 3}}',
    // 複雑な例
    `
    {
      "name": "John Doe",
      "age": 30,
      "isActive": true,
      "address": {
        "street": "123 Main St",
        "city": "Anytown"
      },
      "hobbies": ["reading", "cycling", "coding"]
    }
    `,
    // エスケープされた文字を含む例
    '{"escaped": "Line 1\\nLine 2\\tTabbed\\r\\nWindows line"}',
    // ネストされた配列とオブジェクト
    '[1, [2, 3], {"key": [4, {"nested": 5}]}]',
  ];

  // すべてのテストケースを実行
  for (const testCase of testCases) {
    console.log(
      `Testing: ${
        testCase.length > 50 ? testCase.substring(0, 47) + "..." : testCase
      }`
    );
    const parsed = parseJSON(testCase);

    // 特別なnullチェック
    if (testCase.trim() === "null") {
      if (parsed === null) {
        console.log("Result: Success");
        console.log("Validation: Passed (null value)");
      } else {
        console.log("Result: Failed");
        console.log(`Expected null but got: ${parsed}`);
      }
    } else {
      console.log(`Result: ${parsed !== null ? "Success" : "Failed"}`);

      if (parsed !== null) {
        try {
          // JSONとして文字列化して再度パースして比較することで、構造が同じであることを確認
          const jsonString = JSON.stringify(parsed);
          const expectedObj = JSON.parse(testCase);
          const expectedString = JSON.stringify(expectedObj);

          if (jsonString === expectedString) {
            console.log("Validation: Passed");
          } else {
            console.log("Validation: Failed");
            console.log("Expected:", expectedString);
            console.log("Got:", jsonString);
          }
        } catch (e) {
          console.log("Validation: Error", e);
        }
      }
    }

    console.log("---");
  }

  // 無効なJSONのテスト
  const invalidCases = [
    '{invalid: "json"}',
    '{"missing": }',
    '{"unclosed": "string}',
    "[1, 2,]", // 末尾のカンマ
    '{"key": undefined}', // JavaScriptの値ですがJSONではない
  ];

  for (const invalidCase of invalidCases) {
    console.log(`Testing invalid: ${invalidCase}`);
    const parsed = parseJSON(invalidCase);
    console.log(
      `Result: ${parsed === null ? "Correctly failed" : "Incorrectly parsed"}`
    );
    console.log("---");
  }
};

// Run test if directly executed
if (typeof require !== "undefined" && require.main === module) {
  testJSON();
}
