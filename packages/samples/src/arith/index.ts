import {
  type ParseResult,
  type Pos,
  any,
  charClass,
  choice,
  lit,
  map,
  not,
  plus,
  seq,
  star,
} from "tpeg";

export const EOF = not(any());

/**
 * ```txt
 * Space <- [ \t]
 * ```
 */
export const Space = charClass(" ", "\t");

/**
 * ```txt
 * _ <- Space*
 * ```
 */
export const _ = star(Space);

/**
 * ```txt
 * Digit <- [0-9]
 * ```
 */
export const Digit = charClass(["0", "9"]);

/**
 * ```txt
 * Number <- Digit+
 * ```
 */
// biome-ignore lint/suspicious/noShadowRestrictedNames:
export const Number = map(plus(Digit), ($) =>
  global.Number.parseInt($.join("")),
);

/**
 * ```txt
 * Factor <- _ "(" _ Expr _ ")" _ / _ Number _
 * ```
 */
export function Factor(input: string, pos: Pos): ParseResult<number> {
  return map(
    choice(
      map(seq(_, lit("("), _, Expr, _, lit(")"), _), ($) => $[3]),
      map(seq(_, Number, _), ($) => $[1]),
    ),
    ($) => $,
  )(input, pos);
}

/**
 * ```txt
 * Term <- Factor ("*" Factor / "/" Factor / "%" Factor)*
 * ```
 */
export function Term(input: string, pos: Pos): ParseResult<number> {
  return map(
    seq(
      Factor,
      star(
        choice(
          seq(lit("*"), Factor),
          seq(lit("/"), Factor),
          seq(lit("%"), Factor),
        ),
      ),
    ),
    ($) => {
      const left = $[0];

      return $[1].reduce((acc, [op, factor]) => {
        switch (op) {
          case "*":
            return acc * factor;
          case "/":
            return acc / factor;
          case "%":
            return acc % factor;
          default: {
            const exhaustiveCheck: never = op;
            throw new Error(`Unreachable: ${exhaustiveCheck}`);
          }
        }
      }, left);
    },
  )(input, pos);
}

/**
 * ```txt
 * Expr <- Term ("+" Term / "-" Term)*
 * ```
 */
export function Expr(input: string, pos: Pos): ParseResult<number> {
  return map(
    seq(Term, star(choice(seq(lit("+"), Term), seq(lit("-"), Term)))),
    ($) => {
      const left = $[0];

      return $[1].reduce((acc, [op, term]) => {
        switch (op) {
          case "+":
            return acc + term;
          case "-":
            return acc - term;
          default: {
            const exhaustiveCheck: never = op;
            throw new Error(`Unreachable: ${exhaustiveCheck}`);
          }
        }
      }, left);
    },
  )(input, pos);
}

export const Grammar = map(seq(Expr, EOF), ($) => $[0]);
