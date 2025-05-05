import type { ParseFailure, Parser } from "tpeg-combinator";
import {
  between,
  choice,
  literal,
  map,
  memoize,
  number,
  parse,
  quotedString,
  recursive,
  sepBy,
  seq,
  takeUntil,
  token,
  zeroOrMore,
} from "tpeg-combinator";

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

// Wrapper to skip whitespace
const tok = <T>(parser: Parser<T>): Parser<T> => token(parser);

// JSON parser implementation
export const jsonParser = (): Parser<JSONValue> => {
  // Recursive parser
  const [valueParser, setValueParser] = recursive<JSONValue>();

  // String
  const stringParser: Parser<string> = quotedString();

  // Number
  const numberParser: Parser<number> = number();

  // Boolean and null
  const trueParser = map(tok(literal("true")), () => true);
  const falseParser = map(tok(literal("false")), () => false);
  const nullParser = map(tok(literal("null")), () => null);

  // Array
  const arrayParser: Parser<JSONArray> = map(
    between(tok(literal("[")), tok(literal("]"))),
    (content) => {
      if (content.trim() === "") return [];
      const result = parse(sepBy(valueParser, tok(literal(","))))(content);
      return result.success ? result.val : [];
    },
  );

  // Object
  const keyValueParser: Parser<[string, JSONValue]> = map(
    seq(tok(quotedString()), tok(literal(":")), valueParser),
    ([key, _, value]) => [key, value],
  );

  const objectParser: Parser<JSONObject> = map(
    between(tok(literal("{")), tok(literal("}"))),
    (content) => {
      if (content.trim() === "") return {};
      const result = parse(sepBy(keyValueParser, tok(literal(","))))(content);
      if (result.success) {
        return Object.fromEntries(result.val);
      }
      return {};
    },
  );

  // Set the definition for the value parser
  setValueParser(
    choice(
      stringParser,
      numberParser,
      objectParser,
      arrayParser,
      trueParser,
      falseParser,
      nullParser,
    ),
  );

  // Memoize for optimization
  return memoize(valueParser);
};

// Main function to parse JSON
export const parseJSON = (input: string): JSONValue | null => {
  const parser = jsonParser();
  const result = parse(parser)(input.trim());

  if (result.success) {
    return result.val;
  }

  console.error("Parse error:", (result as ParseFailure).error);
  return null;
};

// Usage example
const testJSON = (): void => {
  const jsonString = `
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
  `;

  const parsed = parseJSON(jsonString);
  console.log(JSON.stringify(parsed, null, 2));
};

// Run test when directly executed
if (typeof require !== "undefined" && require.main === module) {
  testJSON();
}
