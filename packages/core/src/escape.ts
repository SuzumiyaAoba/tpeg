/**
 * Named escapes for control characters that can't appear literally inside a
 * double-quoted TypeScript string. Grammar values commonly contain these
 * (e.g. a whitespace character class `[ \t\n\r]` decodes to actual tab/
 * newline/CR bytes, not the two-character `\t` etc. sequences), so
 * `escapeStringLiteral` must re-escape them, not just backslash/quote.
 */
const NAMED_CONTROL_CHAR_ESCAPES: Record<string, string> = {
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
  "\v": "\\v",
  // "\x00", not "\0": a following digit in the emitted literal would
  // merge into the escape ("\\0" + "5" -> "\05", a legacy octal escape
  // that is a SyntaxError in strict-mode ESM -- which generated parsers
  // are). The two-character hex spelling is unambiguous regardless of
  // what character comes next (#105).
  "\0": "\\x00",
};

/**
 * Escapes a string literal's value for embedding in generated TypeScript
 * source (as the argument to `literal("...")`, or as a string-literal TYPE
 * like `export type X = "a\\b";`).
 *
 * Beyond backslash/double-quote, this also re-escapes control characters
 * (newline, tab, CR, and other non-printable bytes) - without it, a value
 * containing an actual newline byte would emit as a raw newline inside a
 * `"..."` literal, which is invalid TypeScript (unterminated string).
 *
 * Lives in tpeg-core (not `packages/parser/src/constants.ts`, where it used
 * to be) so `tpeg-type-inference` -- which depends on tpeg-core only -- can
 * share it instead of keeping a hand-synced copy (`escapeStringLiteralType`)
 * that had to be maintained in lockstep with this one.
 */
export const escapeStringLiteral = (value: string): string => {
  let result = "";
  for (const char of value) {
    if (char === "\\") {
      result += "\\\\";
      continue;
    }
    if (char === '"') {
      result += '\\"';
      continue;
    }
    const named = NAMED_CONTROL_CHAR_ESCAPES[char];
    if (named) {
      result += named;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      result += `\\x${code.toString(16).padStart(2, "0")}`;
      continue;
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      // A LONE surrogate code unit (the only way one reaches this loop:
      // `for...of` yields a well-formed pair as a single astral char,
      // whose code point is > 0xffff and takes the raw-`char` branch
      // below). Emitting it verbatim would put an unpaired surrogate
      // byte sequence into the generated source -- unencodable in UTF-8,
      // so a file write either errors or silently substitutes U+FFFD,
      // and the generated parser then matches the WRONG character.
      // `\uXXXX` spells the same code unit in plain ASCII instead.
      result += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    result += char;
  }
  return result;
};
