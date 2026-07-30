import {
  commaSeparated,
  labeled,
  memoize,
  number,
  quotedString,
  recursive,
  token,
} from "@suzumiyaaoba/tpeg-combinator";
import {
  type Parser,
  any,
  choice,
  literal,
  map,
  not,
  parse,
  seq,
} from "@suzumiyaaoba/tpeg-core";

// Export Parser type
export type { Parser };

/**
 * JSON value type representing all valid JSON data types.
 *
 * This union type covers all possible JSON values including primitive types,
 * objects, and arrays.
 */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONObject
  | JSONArray;

/**
 * JSON object type representing key-value pairs.
 *
 * JSON objects are collections of key-value pairs where keys are strings
 * and values can be any valid JSON value.
 */
export interface JSONObject {
  [key: string]: JSONValue;
}

/**
 * JSON array type representing ordered collections of JSON values.
 *
 * JSON arrays are ordered lists of JSON values, which can be of any type
 * including nested objects and arrays.
 */
export type JSONArray = JSONValue[];

// Parse null value
const nullParser = map(labeled(literal("null"), "Expected 'null'"), () => null);

// Parse boolean values
const trueParser = map(literal("true"), () => true);
const falseParser = map(literal("false"), () => false);

// Parse string values
const stringParser = map(quotedString, (s) => s);

// Parse number values
const numberParser = map(number, (n) => n);

// Handle empty arrays specifically
const emptyArrayParser = map(
  seq(token(literal("[")), token(literal("]"))),
  () => [],
);

/**
 * Create a JSON parser that can parse any valid JSON string
 * and return the corresponding JavaScript value.
 *
 * This function creates a complete JSON parser that handles all JSON
 * data types including objects, arrays, strings, numbers, booleans, and null.
 * The parser uses recursive parsing to handle nested structures and includes
 * proper error handling and whitespace management.
 *
 * @returns A parser for JSON values
 *
 * @example
 * ```typescript
 * const jsonParser = jsonParser();
 * const result = parse(jsonParser)('{"name": "John", "age": 30}');
 * // Returns: { name: "John", age: 30 }
 * ```
 */
export const jsonParser = (): Parser<JSONValue> => {
  // Parse JSON values recursively
  const [valueParser, setValueParser] = recursive<JSONValue>();

  // Parse arrays
  const arrayParser = map(
    seq(token(literal("[")), commaSeparated(valueParser), token(literal("]"))),
    ([, elements]) => elements,
  );

  // Parse key-value pairs in objects
  const keyValuePair: Parser<[string, JSONValue]> = map(
    seq(token(quotedString), token(literal(":")), token(valueParser)),
    ([key, , value]) => [key, value] as const,
  );

  // Parse objects
  const objectParser = map(
    seq(token(literal("{")), commaSeparated(keyValuePair), token(literal("}"))),
    ([, pairs]) => {
      const obj: JSONObject = {};
      for (const [key, value] of pairs) {
        obj[key] = value;
      }
      return obj;
    },
  );

  // Handle empty objects specifically
  const emptyObjectParser = map(
    seq(token(literal("{")), token(literal("}"))),
    () => ({}),
  );

  // Set up the JSON value parser
  setValueParser(
    choice(
      nullParser,
      trueParser,
      falseParser,
      stringParser,
      numberParser,
      emptyObjectParser,
      objectParser,
      emptyArrayParser,
      arrayParser,
    ),
  );

  // Return a tokenized JSON parser
  //
  // Without an explicit end-of-input check, a value parser that matches a
  // valid prefix (e.g. "true" out of "true xyz", or "123" out of "123abc")
  // succeeds while silently discarding the malformed trailing content
  // instead of rejecting the input.
  return memoize(map(seq(token(valueParser), not(any)), ([value]) => value));
};

/**
 * Parse a JSON string into a JavaScript value.
 *
 * This function provides a high-level interface for parsing JSON strings.
 * It first attempts to use the built-in JSON.parse for performance, and
 * falls back to the custom TPEG parser if that fails. The function handles
 * various edge cases including null input and empty strings.
 *
 * @param input - JSON string to parse
 * @returns Parsed JavaScript value, empty string for empty input, or null if parsing fails
 * @throws Error when the input is null
 *
 * @example
 * ```typescript
 * const result = parseJSON('{"name": "John", "age": 30}');
 * // Returns: { name: "John", age: 30 }
 *
 * const array = parseJSON('[1, 2, 3]');
 * // Returns: [1, 2, 3]
 *
 * const string = parseJSON('"hello world"');
 * // Returns: "hello world"
 * ```
 */
// Built once and reused across calls, instead of on every call that reaches
// the custom-parser fallback below (parseJSON() only gets there when
// JSON.parse() rejects the input first). jsonParser() constructs a whole
// recursive combinator graph including a memoize() cache; without this,
// repeatedly parsing many invalid/non-standard JSON strings would rebuild
// that graph from scratch every time. memoize()'s cache is FIFO-bounded
// (default 1000 distinct input strings), so reusing it here only adds a
// bounded amount of retained state, not an unbounded one.
let cachedJsonParser: Parser<JSONValue> | undefined;

export const parseJSON = (input: string): JSONValue | null | string => {
  // Throw error if input is null
  if (input === null) {
    throw new Error("Input cannot be null");
  }

  try {
    // Return empty string if input is empty
    if (!input) {
      return "";
    }

    // First try built-in JSON.parse
    try {
      return JSON.parse(input);
    } catch (_e) {
      // If JSON.parse fails, use custom parser
    }

    // Use custom parser
    // token() function automatically handles leading and trailing whitespace
    cachedJsonParser ??= jsonParser();
    const result = parse(cachedJsonParser)(input);

    if (result.success) {
      return result.val;
    }

    // Output error message when parsing fails
    console.error("Parse error:", result.error?.message);
    return null;
  } catch (e) {
    console.error("Parse error:", e);
    return null;
  }
};
