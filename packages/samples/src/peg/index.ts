import {
  type ParseResult,
  type Pos,
  any,
  charClass,
  choice,
  lit,
  zeroOrMore as many,
  oneOrMore as many1,
  map,
  mapResult,
  not,
  opt,
  seq,
} from "tpeg-core";
import type { Expr } from "./ast";
import { octalDigitsToChar } from "./utils";

/**
 * End of file parser.
 *
 * Matches the end of input using a negative lookahead.
 * This parser succeeds only when no more characters are available.
 *
 * ```txt
 * EndOfFile <- !.
 * ```
 */
export const EndOfFile = not(any);

/**
 * End of line parser.
 *
 * Matches various line ending sequences including CRLF, LF, and CR.
 * This parser handles different line ending conventions across platforms.
 *
 * ```txt
 * EndOfLine <- '\r\n' / '\n' / '\r'
 * ```
 */
export const EndOfLine = choice(lit("\r\n"), lit("\n"), lit("\r"));

/**
 * Space character parser.
 *
 * Matches a single space, tab, or line ending character.
 * This parser is used for handling whitespace in PEG grammars.
 *
 * ```txt
 * Space <- ' ' / '\t' / EndOfLine
 * ```
 */
export const Space = choice(lit(" "), lit("\r"), EndOfLine);

/**
 * Comment parser.
 *
 * Matches PEG-style comments that start with '#' and continue until the end of line.
 * Comments are used for documentation and are typically ignored during parsing.
 *
 * ```txt
 * Comment <- '#' (!EndOfLine .)* EndOfLine
 * ```
 */
export const Comment = seq(
  lit("#"),
  map(many(map(seq(not(EndOfLine), any), ($) => $[1])), ($) => $.join("")),
  EndOfLine,
);

/**
 * Spacing parser.
 *
 * Matches zero or more spaces or comments.
 * This parser is used to handle optional whitespace and comments in PEG grammars.
 *
 * ```txt
 * Spacing <- (Space / Comment)*
 * ```
 */
export const Spacing = many(choice(Space, Comment));

/**
 * DOT parser.
 *
 * Matches a literal dot followed by optional spacing.
 * The dot represents "any character" in PEG grammars.
 *
 * ```txt
 * DOT <- '.' Spacing
 * ```
 */
export const DOT = map(seq(lit("."), Spacing), ($) => $[0]);

/**
 * CLOSE parser.
 *
 * Matches a literal closing parenthesis followed by optional spacing.
 * Used for parsing parenthesized expressions.
 *
 * ```txt
 * CLOSE <- ')' Spacing
 * ```
 */
export const CLOSE = map(seq(lit(")"), Spacing), ($) => $[0]);

/**
 * OPEN parser.
 *
 * Matches a literal opening parenthesis followed by optional spacing.
 * Used for parsing parenthesized expressions.
 *
 * ```txt
 * OPEN <- '(' Spacing
 * ```
 */
export const OPEN = map(seq(lit("("), Spacing), ($) => $[0]);

/**
 * PLUS parser.
 *
 * Matches a literal plus sign followed by optional spacing.
 * The plus represents "one or more" repetition in PEG grammars.
 *
 * ```txt
 * PLUS <- '+' Spacing
 * ```
 */
export const PLUS = map(seq(lit("+"), Spacing), ($) => $[0]);

/**
 * STAR parser.
 *
 * Matches a literal asterisk followed by optional spacing.
 * The star represents "zero or more" repetition in PEG grammars.
 *
 * ```txt
 * STAR <- '*' Spacing
 * ```
 */
export const STAR = map(seq(lit("*"), Spacing), ($) => $[0]);

/**
 * QUESTION parser.
 *
 * Matches a literal question mark followed by optional spacing.
 * The question mark represents "zero or one" (optional) in PEG grammars.
 *
 * ```txt
 * QUESTION <- '?' Spacing
 * ```
 */
export const QUESTION = map(seq(lit("?"), Spacing), ($) => $[0]);

/**
 * NOT parser.
 *
 * Matches a literal exclamation mark followed by optional spacing.
 * The exclamation mark represents negative lookahead in PEG grammars.
 *
 * ```txt
 * NOT <- '!' Spacing
 * ```
 */
export const NOT = map(seq(lit("!"), Spacing), ($) => $[0]);

/**
 * AND parser.
 *
 * Matches a literal ampersand followed by optional spacing.
 * The ampersand represents positive lookahead in PEG grammars.
 *
 * ```txt
 * AND <- '&' Spacing
 * ```
 */
export const AND = map(seq(lit("&"), Spacing), ($) => $[0]);

/**
 * SLASH parser.
 *
 * Matches a literal forward slash followed by optional spacing.
 * The slash represents ordered choice in PEG grammars.
 *
 * ```txt
 * SLASH <- '/' Spacing
 * ```
 */
export const SLASH = map(seq(lit("/"), Spacing), ($) => $[0]);

/**
 * LEFTARROW parser.
 *
 * Matches the literal '<-' followed by optional spacing.
 * The left arrow is used to define rules in PEG grammars.
 *
 * ```txt
 * LEFTARROW <- '<-' Spacing
 * ```
 */
export const LEFTARROW = seq(lit("<-"), Spacing);

/**
 * Character parser.
 *
 * Matches individual characters with support for escape sequences.
 * This parser handles various character representations including:
 * - Escape sequences (n, r, t, quotes, brackets, backslash)
 * - Octal escape sequences (1-3 digits)
 * - Any character except backslash
 *
 * ```txt
 * Char <- '\\' [nrt'"\[\]\\]
 *       / '\\' [0-2][0-7][0-7]
 *       / '\\' [0-7][0-7]?
 *       / !'\\' .
 * ```
 */
export const Char = choice(
  map(
    seq(lit("\\"), charClass("n", "r", "t", "'", '"', "[", "]", "\\")),
    ($) => {
      const char = $[1];
      switch (char) {
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
  ),
  map(
    seq(
      lit("\\"),
      charClass(["0", "2"]),
      charClass(["0", "7"]),
      charClass(["0", "7"]),
    ),
    ($) => octalDigitsToChar($[1] + $[2] + $[3]),
  ),
  map(seq(lit("\\"), charClass(["0", "7"]), opt(charClass(["0", "7"]))), ($) =>
    octalDigitsToChar($[1] + ($[2]?.[0] ?? "")),
  ),
  map(seq(not(lit("\\")), any), ($) => $[1]),
);

/**
 * Range parser.
 *
 * Matches either a character range (char-char) or a single character.
 * Character ranges are used in character classes to specify ranges of characters.
 *
 * ```txt
 * Range <- Char '-' Char / Char
 * ```
 */
export const Range = choice(
  map(seq(Char, lit("-"), Char), ($) => [$[0], $[2]] as const),
  Char,
);

/**
 * Character class parser.
 *
 * Matches a character class enclosed in square brackets.
 * Character classes can contain individual characters and character ranges.
 *
 * ```txt
 * Class <- '[' (!']' Range)* ']' Spacing
 * ```
 */
export const Class = mapResult(
  seq(
    lit("["),
    many(map(seq(not(lit("]")), Range), ($) => $[1])),
    lit("]"),
    Spacing,
  ),
  ($) =>
    ({
      type: "CharClass",
      value: $.val[1],
      pos: $.current,
    }) as const,
);

/**
 * Literal parser.
 *
 * Matches a literal string enclosed in single quotes.
 * Literals can contain escape sequences and are used for matching exact text.
 *
 * ```txt
 * Literal <- ['] (!['] Char)* ['] Spacing
 * ```
 */
export const Literal = mapResult(
  choice(
    seq(
      charClass("'"),
      many(map(seq(not(charClass("'")), Char), ($) => $[1])),
      charClass("'"),
      Spacing,
    ),
    seq(
      charClass('"'),
      many(map(seq(not(charClass('"')), Char), ($) => $[1])),
      charClass('"'),
      Spacing,
    ),
  ),
  ($) =>
    ({
      type: "Literal",
      value: $.val[1].join(""),
      pos: $.current,
    }) as const,
);

/**
 * ```txt
 * IdentStart <- [a-zA-Z_]
 * ```
 */
export const IdentStart = charClass(["a", "z"], ["A", "Z"], "_");

/**
 * ```txt
 * IdentCont <- IdentStart / [0-9]
 * ```
 */
export const IdentCont = choice(IdentStart, charClass(["0", "9"]));

/**
 * ```txt
 * Identifier <- IdentStart IdentCont* Spacing
 * ```
 */
export const Identifier = mapResult(
  seq(IdentStart, many(IdentCont), Spacing),
  ($) =>
    ({
      type: "Identifier",
      value: $.val[0] + $.val[1].join(""),
      pos: $.current,
    }) as const,
);

/**
 * ```txt
 * Primary <- Identifier !LEFTARROW
 *          / OPEN Expression CLOSE
 *          / Literal
 *          / Class
 *          / DOT
 * ```
 */
export function Primary(input: string, pos: Pos): ParseResult<Expr> {
  return choice(
    map(seq(Identifier, not(LEFTARROW)), ($) => $[0]),
    map(seq(OPEN, Expression, CLOSE), ($) => $[1]),
    Literal,
    Class,
    mapResult(
      DOT,
      ($) =>
        ({
          type: "AnyChar",
          pos: $.current,
        }) as const,
    ),
  )(input, pos) as ParseResult<Expr>;
}

/**
 * ```txt
 * Suffix <- Primary (QUESTION / STAR / PLUS)?
 * ```
 */
export const Suffix = mapResult(
  seq(Primary, opt(choice(QUESTION, STAR, PLUS))),
  ($) => {
    const quantifier = $.val[1]?.[0];
    if (!quantifier) {
      return $.val[0];
    }

    const type = (() => {
      switch (quantifier) {
        case "?":
          return "Optional";
        case "*":
          return "ZeroOrMore";
        case "+":
          return "OneOrMore";
      }
    })();

    return {
      type,
      value: $.val[0],
      pos: $.current,
    } as const;
  },
);

/**
 * ```txt
 * Prefix <- (AND / NOT)? Suffix
 * ```
 */
export const Prefix = mapResult(seq(opt(choice(AND, NOT)), Suffix), ($) => {
  const predicate = $.val[0]?.[0];
  if (!predicate) {
    return $.val[1];
  }

  const type = (() => {
    switch (predicate) {
      case "&":
        return "AndPredicate";
      case "!":
        return "NotPredicate";
    }
  })();

  return {
    type,
    value: $.val[1],
    pos: $.current,
  } as const;
});

/**
 * ```txt
 * Sequence <- Prefix*
 * ```
 */
export const Sequence = mapResult(many(Prefix), ($) => {
  if ($.val.length === 1) {
    return $.val[0];
  }

  return {
    type: "Sequence",
    value: $.val,
    pos: $.current,
  } as const;
});

/**
 * ```txt
 * Expression <- Sequence (SLASH Sequence)*
 * ```
 */
export const Expression = mapResult(
  seq(Sequence, many(map(seq(SLASH, Sequence), ($) => $[1]))),
  ($) => {
    if ($.val[1].length === 0) {
      return $.val[0];
    }

    return {
      type: "Choice",
      value: [$.val[0], ...$.val[1]],
      pos: $.current,
    } as const;
  },
);

/**
 * ```txt
 * Definition <- Identifier LEFTARROW Expression
 * ```
 */
export const Definition = mapResult(
  seq(Identifier, LEFTARROW, Expression),
  ($) =>
    ({
      type: "Definition",
      name: $.val[0].value,
      expr: $.val[2],
      pos: $.current,
    }) as const,
);

/**
 * ```txt
 * Grammar <- Spacing Definition+ EndOfFile
 * ```
 */
export const Grammar = mapResult(
  seq(Spacing, many1(Definition), EndOfFile),
  ($) =>
    ({
      type: "Grammar",
      value: $.val[1],
      pos: $.current,
    }) as const,
);
