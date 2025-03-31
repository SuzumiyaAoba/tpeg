import {
  type ParseResult,
  type Pos,
  any,
  charClass,
  choice,
  lit,
  many,
  many1,
  map,
  mapResult,
  not,
  opt,
  seq,
} from "tpeg";
import type { Expr } from "./ast";
import { octalDigitsToChar } from "./utils";

/**
 * ```txt
 * EndOfFile <- !.
 * ```
 */
export const EndOfFile = not(any());

/**
 * ```txt
 * EndOfLine <- '\r\n' / '\n' / '\r'
 * ```
 */
export const EndOfLine = choice(lit("\r\n"), lit("\n"), lit("\r"));

/**
 * ```txt
 * Space <- ' ' / '\t' / EndOfLine
 * ```
 */
export const Space = choice(lit(" "), lit("\r"), EndOfLine);

/**
 * ```txt
 * Comment <- '#' (!EndOfLine .)* EndOfLine
 * ```
 */
export const Comment = seq(
  lit("#"),
  map(many(map(seq(not(EndOfLine), any()), ($) => $[1])), ($) => $.join("")),
  EndOfLine,
);

/**
 * ```txt
 * Spacing <- (Space / Comment)*
 * ```
 */
export const Spacing = many(choice(Space, Comment));

/**
 * ```txt
 * DOT <- '.' Spacing
 * ```
 */
export const DOT = map(seq(lit("."), Spacing), ($) => $[0]);

/**
 * ```txt
 * CLOSE <- '(' Spacing
 * ```
 */
export const CLOSE = map(seq(lit(")"), Spacing), ($) => $[0]);

/**
 * ```txt
 * OPEN <- '(' Spacing
 * ```
 */
export const OPEN = map(seq(lit("("), Spacing), ($) => $[0]);

/**
 * ```txt
 * PLUS <- '+' Spacing
 * ```
 */
export const PLUS = map(seq(lit("+"), Spacing), ($) => $[0]);

/**
 * ```txt
 * STAR <- '*' Spacing
 * ```
 */
export const STAR = map(seq(lit("*"), Spacing), ($) => $[0]);

/**
 * ```txt
 * QUESTION <- '?' Spacing
 * ```
 */
export const QUESTION = map(seq(lit("?"), Spacing), ($) => $[0]);

/**
 * ```txt
 * NOT <- '!' Spacing
 * ```
 */
export const NOT = map(seq(lit("!"), Spacing), ($) => $[0]);

/**
 * ```txt
 * AND <- '&' Spacing
 * ```
 */
export const AND = map(seq(lit("&"), Spacing), ($) => $[0]);

/**
 * ```txt
 * SLASH <- '/' Spacing
 * ```
 */
export const SLASH = map(seq(lit("/"), Spacing), ($) => $[0]);

/**
 * ```txt
 * LEFTARROW <- '<-' Spacing
 * ```
 */
export const LEFTARROW = seq(lit("<-"), Spacing);

/**
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
  map(seq(not(lit("\\")), any()), ($) => $[1]),
);

/**
 * ```txt
 * Range <- Char '-' Char / Char
 * ```
 */
export const Range = choice(
  map(seq(Char, lit("-"), Char), ($) => [$[0], $[2]] as const),
  Char,
);

/**
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
 * ```txt
 * Literal <- ['] (!['] Char)* ['] Spacing
 *          / ["] (!["] Char)* ["] Spacing
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
  )(input, pos);
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
export const Expression = map(
  seq(Sequence, many(map(seq(SLASH, Sequence), ($) => $[1]))),
  ($) => {
    if ($[1].length === 0) {
      return $[0];
    }

    return {
      type: "Choice",
      value: [$[0], ...$[1]],
    } as const;
  },
);

/**
 * ```txt
 * Definition <- Identifier LEFTARROW Expression
 * ```
 */
export const Definition = map(
  seq(Identifier, LEFTARROW, Expression),
  ($) =>
    ({
      type: "Definition",
      name: $[0].value,
      expr: $[2],
    }) as const,
);

/**
 * ```txt
 * Grammar <- Spacing Definition+ EndOfFile
 * ```
 */
export const Grammar = map(
  seq(Spacing, many1(Definition), EndOfFile),
  ($) =>
    ({
      type: "Grammar",
      value: $[1],
    }) as const,
);
