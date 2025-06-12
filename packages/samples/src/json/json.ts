import {
  labeled,
  memoize,
  number,
  quotedString,
  recursive,
  token,
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

// Export Parser type
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

// Parse null value
const nullParser = map(labeled(literal("null"), "Expected 'null'"), () => null);

// Parse boolean values
const trueParser = map(literal("true"), () => true);
const falseParser = map(literal("false"), () => false);

// Parse string values
const stringParser = map(quotedString(), (s) => s);

// Parse number values
const numberParser = map(number(), (n) => n);

// Parse comma-separated values (empty array if empty)
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

// Handle empty arrays specifically
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
  // Parse JSON values recursively
  const [valueParser, setValueParser] = recursive<JSONValue>();

  // Parse arrays
  const arrayParser = map(
    seq(
      token(literal("[")),
      commaSeparatedValues(valueParser),
      token(literal("]")),
    ),
    ([, elements]) => elements,
  );

  // Parse key-value pairs in objects
  const keyValuePair: Parser<[string, JSONValue]> = map(
    seq(token(quotedString), token(literal(":")), token(valueParser)),
    ([key, , value]) => [key, value] as const,
  );

  // Parse comma-separated properties (empty array if empty)
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

  // Parse objects
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
  return memoize(token(valueParser));
};

/**
 * Parse a JSON string into a JavaScript value
 *
 * @param input JSON string
 * @returns Parsed JavaScript value, empty string for empty input, or null if parsing fails
 * @throws Error when the input is null
 */
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
    } catch (e) {
      // If JSON.parse fails, use custom parser
    }

    // Use custom parser
    // token() function automatically handles leading and trailing whitespace
    const result = parse(jsonParser())(input);

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
