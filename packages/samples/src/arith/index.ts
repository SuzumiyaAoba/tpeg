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

/**
 * End of file parser.
 * 
 * This parser matches the end of input using a negative lookahead.
 * It succeeds only when no more characters are available to parse.
 */
export const EOF = not(any);

/**
 * Space character parser.
 * 
 * Matches a single space or tab character.
 */
export const Space = charClass(" ", "\t");

/**
 * Optional whitespace parser.
 * 
 * Matches zero or more space or tab characters.
 * This is commonly used to handle optional spacing around operators.
 */
export const _ = star(Space);

/**
 * Digit parser.
 * 
 * Matches any single digit from 0 to 9.
 */
export const Digit = charClass(["0", "9"]);

/**
 * Number parser.
 * 
 * Parses one or more digits and converts them to a number.
 * This parser handles positive integers only.
 */
// biome-ignore lint/suspicious/noShadowRestrictedNames:
export const Number = map(plus(Digit), ($) =>
  global.Number.parseInt($.join("")),
);

/**
 * Factor parser (number or parenthesized expression).
 * 
 * This parser handles the highest precedence level in the arithmetic grammar.
 * It matches either a number literal or a parenthesized expression.
 * Parentheses are used to override operator precedence.
 */
export const Factor: Parser<number> = choice(
  map(
    seq(_, lit("("), _, (input, pos) => Expr(input, pos), _, lit(")"), _),
    ($) => $[3],
  ),
  map(seq(_, Number, _), ($) => $[1]),
);

/**
 * Term parser (multiplication, division, modulo).
 * 
 * This parser handles multiplication, division, and modulo operations.
 * These operators have higher precedence than addition and subtraction.
 * The parser implements left associativity for these operators.
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
 * Expression parser (addition and subtraction).
 * 
 * This parser handles addition and subtraction operations.
 * These operators have lower precedence than multiplication, division, and modulo.
 * The parser implements left associativity for these operators.
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

/**
 * Complete arithmetic grammar parser.
 * 
 * This is the main parser for arithmetic expressions. It parses an expression
 * followed by the end of input, ensuring the entire input is consumed.
 * 
 * @param input - The arithmetic expression string to parse
 * @param pos - The starting position for parsing
 * @returns A parse result containing the calculated value
 * 
 * @example
 * ```typescript
 * const result = Grammar("1 + 2 * 3", createPos(0));
 * // Returns: { success: true, val: 7, ... }
 * ```
 */
export const Grammar = map(seq(Expr, EOF), ($) => $[0]);
