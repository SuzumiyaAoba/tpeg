import {
  createFailure,
  parse,
  type Parser,
  type ParseResult,
} from "@suzumiyaaoba/tpeg-core";

/** Each displayed example represents one complete input in its own parse session. */
export function parseExample<T>(
  parser: Parser<T>,
  input: string,
): ParseResult<T> {
  const result = parse(parser)(input);
  if (result.success && result.next !== input.length) {
    return createFailure("Expected end of input", result.next, {
      expected: "end of input",
    });
  }
  return result;
}
