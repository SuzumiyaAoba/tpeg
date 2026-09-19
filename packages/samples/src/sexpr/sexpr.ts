import { quotedString, recursive } from "@suzumiyaaoba/tpeg-combinator";
import {
  type Parser,
  any,
  charClass,
  choice,
  literal,
  map,
  negatedCharClass,
  not,
  notPredicate,
  oneOrMore,
  optional,
  parse,
  seq,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";

/**
 * S-expression Parser Sample
 *
 * A parser for Lisp-style S-expressions:
 * - atoms: symbols (`foo`, `+`, `a-b`), numbers (`42`, `-3.14`), and
 *   double-quoted strings (`"hello"`, with escapes)
 * - lists: `(expr expr ...)`, arbitrarily nested
 * - quote sugar: `'expr` desugars to `(quote expr)`
 * - `;` line comments and arbitrary whitespace between elements
 *
 * An atom keeps its kind so a string literal never collides with a
 * symbol of the same text.
 */

/**
 * An atom: a symbol, a string literal, or a number.
 */
export type SAtom =
  | { readonly type: "symbol"; readonly name: string }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "number"; readonly value: number };

/**
 * An S-expression: either an atom or a list of S-expressions.
 */
export type SExp = SAtom | readonly SExp[];

// Convenience constructors, exported for consumers building S-expressions
// programmatically (e.g. an evaluator feeding parse output back in).
export const sym = (name: string): SAtom => ({ type: "symbol", name });
export const str = (value: string): SAtom => ({ type: "string", value });
export const num = (value: number): SAtom => ({ type: "number", value });

// End of input.
const EOF = not(any);

// Whitespace and `;`-to-end-of-line comments are both skippable.
const wsChar = charClass(" ", "\t", "\n", "\r");
const eol = choice(literal("\r\n"), literal("\n"), literal("\r"));
const comment = seq(literal(";"), zeroOrMore(seq(notPredicate(eol), any)));
const skip = zeroOrMore(choice(wsChar, comment));

// A symbol character: anything except delimiters. `"` and `;` are excluded
// so a string literal or comment can start right next to a symbol
// (`foo"bar"` and `foo;note` split cleanly rather than being absorbed),
// and `'` is excluded because it is the quote macro character, not part
// of a symbol (`a'b` reads as `a` then `'b` -> `(quote b)`).
const symbolChar = negatedCharClass(
  "(",
  ")",
  '"',
  ";",
  "'",
  " ",
  "\t",
  "\n",
  "\r",
);

const symbolAtom: Parser<SAtom> = map(oneOrMore(symbolChar), (chars) =>
  sym(chars.join("")),
);

// -?digits(.digits)? -- the trailing lookahead forces a delimiter after
// the number, so `-5abc` is rejected as a number and falls through to the
// symbol alternative (it is one symbol in most Lisp dialects, too).
const digits = oneOrMore(charClass(["0", "9"]));
const numberAtom: Parser<SAtom> = map(
  seq(
    optional(charClass("+", "-")),
    digits,
    optional(seq(literal("."), digits)),
    notPredicate(symbolChar),
  ),
  ([sign, int, frac]) => {
    const text = `${sign ?? ""}${int.join("")}${
      frac === null ? "" : `.${frac[1].join("")}`
    }`;
    return num(Number(text));
  },
);

// "..." with the usual escapes -- `quotedString` already handles \n, \t,
// \uXXXX, and escaped quotes.
const stringAtom: Parser<SAtom> = map(quotedString, (value) => str(value));

const QUOTE = sym("quote");

/**
 * Build the top-level parser. Constructed inside a function (rather than
 * as module constants) because `recursive` is stateful -- a fresh pair of
 * placeholder/setter per call keeps every returned parser self-contained.
 */
const buildParser = (): Parser<SExp[]> => {
  const [sexp, setSexp] = recursive<SExp>();

  const atom = choice(numberAtom, stringAtom, symbolAtom);

  // `( elem elem ... )` -- `skip` after `(` and after every element lets
  // whitespace and comments appear anywhere between elements.
  const list: Parser<SExp[]> = map(
    seq(
      literal("("),
      skip,
      zeroOrMore(map(seq(sexp, skip), ([elem]) => elem)),
      literal(")"),
    ),
    ([, , elems]) => elems,
  );

  // `'x` desugars to `(quote x)` at parse time -- a classic macro-expand
  // performed by the grammar itself.
  const quoted: Parser<SExp[]> = map(seq(literal("'"), sexp), ([, expr]) => [
    QUOTE,
    expr,
  ]);

  setSexp(choice(quoted, list, atom));

  // A document is any number of top-level forms; EOF makes malformed
  // trailing content an error instead of being silently dropped.
  return map(
    seq(skip, zeroOrMore(map(seq(sexp, skip), ([e]) => e)), EOF),
    ([, forms]) => forms,
  );
};

const parser = buildParser();

/**
 * Parse a document of one or more S-expressions.
 *
 * @param input - The source text to parse
 * @returns Every top-level form in the document, in order
 * @throws Error when the input is not well-formed
 */
export const parseSExprs = (input: string): SExp[] => {
  const result = parse(parser)(input);

  if (!result.success) {
    throw new Error(`S-expression parse error: ${result.error.message}`);
  }

  return result.val;
};

/**
 * Parse exactly one S-expression.
 *
 * @param input - Source containing a single form (surrounding whitespace
 *   and comments are allowed)
 * @returns The parsed form
 * @throws Error when there is not exactly one form
 */
export const parseSExpr = (input: string): SExp => {
  const [form, ...rest] = parseSExprs(input);

  if (form === undefined || rest.length > 0) {
    throw new Error(
      `Expected exactly one S-expression, found ${
        form === undefined ? 0 : rest.length + 1
      }`,
    );
  }

  return form;
};

// `Array.isArray` alone can't narrow `readonly SExp[]` out of the union
// (a readonly array is not assignable to `any[]`), so spell the guard out.
const isList = (expr: SExp): expr is readonly SExp[] => Array.isArray(expr);

/**
 * Render an S-expression back to source text.
 *
 * Symbols print bare, strings print quoted with escaping, and lists print
 * parenthesized with single-space separators -- so
 * `printSExp(parseSExpr("(a (b) \"c\")"))` is `(a (b) "c")`.
 */
export const printSExp = (expr: SExp): string => {
  if (isList(expr)) {
    return `(${expr.map(printSExp).join(" ")})`;
  }
  switch (expr.type) {
    case "symbol":
      return expr.name;
    case "number":
      return String(expr.value);
    case "string":
      return `"${expr.value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t")
        .replace(/\r/g, "\\r")}"`;
  }
};
