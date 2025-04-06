import {
  type Expr,
  type Grammar,
  isAndPredicate,
  isAnyChar,
  isCharClass,
  isChar,
  isRange,
  isChoice,
  isIdentifier,
  isLiteral,
  isNotPredicate,
  isOptional,
  isSequence,
  isMapping,
} from "tpeg-ast";
import {
  type Parser,
  isNonEmptyArray,
  literal,
  sequence,
  choice,
  optional,
  anyChar,
  charClass,
  andPredicate,
  notPredicate,
  map,
} from "tpeg-combinator";

const buildExpr =
  (expr: Expr<unknown>) =>
  (env: Record<string, () => Parser<unknown>>): (() => Parser<unknown>) => {
    if (isIdentifier(expr)) {
      return () => env[expr.value]();
    }
    if (isLiteral(expr)) {
      return () => literal(expr.value);
    }
    if (isSequence(expr)) {
      return () =>
        sequence(...expr.children.map((child) => buildExpr(child)(env)()));
    }
    if (isChoice(expr)) {
      return () =>
        choice(...expr.children.map((child) => buildExpr(child)(env)()));
    }
    if (isOptional(expr)) {
      return () => optional(buildExpr(expr.children[0])(env)());
    }
    if (isAnyChar(expr)) {
      return () => anyChar();
    }
    if (isCharClass(expr)) {
      const charClassElements = expr.children.map((element) => {
        if (isChar(element)) {
          return element.value;
        }

        if (isRange(element)) {
          return element.value;
        }

        throw new Error(`Unknown char class element: ${element}`);
      });

      if (isNonEmptyArray(charClassElements)) {
        return () => charClass(...charClassElements);
      }

      throw new Error("CharClassElements should be non-empty");
    }
    if (isAndPredicate(expr)) {
      return () => andPredicate(buildExpr(expr.children[0])(env)());
    }
    if (isNotPredicate(expr)) {
      return () => notPredicate(buildExpr(expr.children[0])(env)());
    }
    if (isMapping(expr)) {
      return () => map(buildExpr(expr.children[0])(env)(), expr.data);
    }

    throw new Error(`Unknown expr: ${expr.type}`);
  };

const build = (grammar: Grammar<unknown>) => {
  const env: Record<string, () => Parser<unknown>> = {};

  for (const definition of grammar.children) {
    const [id, expr] = definition.children;

    env[id.value] = buildExpr(expr)(env);
  }

  return env;
};

export const evalAst = (grammar: Grammar<unknown>, entry: string) => {
  const definitions = build(grammar);

  return definitions[entry]();
};
