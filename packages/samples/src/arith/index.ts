import {
  type Parser,
  any,
  charClass,
  choice,
  lit,
  map,
  not,
  plus,
  seq,
  star,
} from "tpeg-core";

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
export const Factor: Parser<number> = choice(
  map(
    seq(_, lit("("), _, (input, pos) => Expr(input, pos), _, lit(")"), _),
    ($) => $[3],
  ),
  map(seq(_, Number, _), ($) => $[1]),
);

/**
 * ```txt
 * Term <- Factor ("*" Factor / "/" Factor / "%" Factor)*
 * ```
 */
export const Term: Parser<number> = map(
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
);

/**
 * ```txt
 * Expr <- Term ("+" Term / "-" Term)*
 * ```
 */
export const Expr: Parser<number> = map(
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
);

export const Grammar = map(seq(Expr, EOF), ($) => $[0]);
