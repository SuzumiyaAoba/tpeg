import {
  commaSeparated,
  labeled,
  memoize,
  recursive,
  token,
} from "@suzumiyaaoba/tpeg-combinator";
import {
  type Parser,
  any,
  anyChar,
  charClass,
  choice,
  literal,
  map,
  not,
  oneOrMore,
  optional,
  parse,
  seq,
  zeroOrMore,
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

// Strict JSON string (#91). The shared `quotedString` combinator is too
// permissive for the fallback path: its generic escape arm maps ANY
// `\x` to `x` (accepting `"\x"`, `"\q"`, `\u` without hex digits), and
// its plain-char arm accepts unescaped control characters that JSON
// requires to be escaped (U+0000-U+001F, including raw newlines). These
// parsers only run when JSON.parse already rejected the input, so they
// must apply the JSON grammar exactly.

const jsonHexDigit = charClass(["0", "9"], ["a", "f"], ["A", "F"]);

// \uXXXX -- four hex digits decoded as one UTF-16 code unit (an astral
// character is two consecutive \uXXXX escapes, same as JSON).
const jsonUnicodeEscape = map(
  seq(literal("\\u"), jsonHexDigit, jsonHexDigit, jsonHexDigit, jsonHexDigit),
  ([, h1, h2, h3, h4]) =>
    String.fromCharCode(Number.parseInt(`${h1}${h2}${h3}${h4}`, 16)),
);

// The eight single-character escapes JSON legalizes. "u" is deliberately
// NOT in this class: a `\u` not followed by exactly four hex digits must
// fail rather than decode as a literal "u".
const jsonSimpleEscape = map(
  seq(literal("\\"), charClass('"', "\\", "/", "b", "f", "n", "r", "t")),
  ([, char]): string => {
    switch (char) {
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return char;
    }
  },
);

// Unescaped control characters U+0000-U+001F are illegal in JSON strings.
const jsonControlChar = charClass(["\u0000", "\u001F"]);

const jsonStringChar = choice(
  jsonUnicodeEscape,
  jsonSimpleEscape,
  map(
    seq(not(choice(literal('"'), literal("\\"), jsonControlChar)), anyChar()),
    ([, char]) => char,
  ),
);

const jsonString: Parser<string> = labeled(
  map(
    seq(literal('"'), zeroOrMore(jsonStringChar), literal('"')),
    ([, chars]) => chars.join(""),
  ),
  "Expected valid JSON string",
);

// Strict JSON number (#91): -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?
// The shared `number` combinator accepts leading zeros ("007", "-01")
// that JSON.parse rejects. `Number()` on the matched text can't produce
// NaN because the grammar itself only admits valid JSON numerals.
const jsonDigits = map(oneOrMore(charClass(["0", "9"])), (chars) =>
  chars.join(""),
);
const jsonIntPart = choice(
  literal("0"),
  map(
    seq(charClass(["1", "9"]), zeroOrMore(charClass(["0", "9"]))),
    ([d, ds]) => d + ds.join(""),
  ),
);
const jsonNumber = map(
  seq(
    optional(literal("-")),
    jsonIntPart,
    optional(map(seq(literal("."), jsonDigits), ([, frac]) => `.${frac}`)),
    optional(
      map(
        seq(charClass("e", "E"), optional(charClass("+", "-")), jsonDigits),
        ([e, sign, exp]) => `${e}${sign ?? ""}${exp}`,
      ),
    ),
  ),
  ([sign, int, frac, exp]) =>
    Number(`${sign !== null ? "-" : ""}${int}${frac ?? ""}${exp ?? ""}`),
);

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
    seq(token(jsonString), token(literal(":")), token(valueParser)),
    ([key, , value]) => [key, value] as const,
  );

  // Parse objects
  const objectParser = map(
    seq(token(literal("{")), commaSeparated(keyValuePair), token(literal("}"))),
    ([, pairs]) => {
      const obj: JSONObject = {};
      for (const [key, value] of pairs) {
        // `obj[key] = value` on the key "__proto__" would invoke
        // Object.prototype's __proto__ SETTER -- mutating the object's
        // prototype (or silently doing nothing when `value` isn't an
        // object) instead of storing an own property, so `{"__proto__":
        // 1}` both loses the key and risks prototype pollution.
        // `Object.defineProperty` defines `__proto__` as an own data
        // property (shadowing the inherited accessor) while keeping the
        // ordinary Object.prototype on the returned object, matching what
        // JSON.parse produces for the same input.
        Object.defineProperty(obj, key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
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
      jsonString,
      jsonNumber,
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
