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

const buildExpr = (expr: Expr) =>
  (env: Record<string, () => Parser<unknown>>): () => Parser<unknown> => {
  if (isIdentifier(expr)) {
    return () => env[expr.value]();
  } else if (isLiteral(expr)) {
    return () => literal(expr.value);
  } else if (isSequence(expr)) {
    return () => sequence(
      ...expr.children.map(child => buildExpr(child)(env)())
    );
  } else if (isChoice(expr)) {
    return () => choice(
      ...expr.children.map(child => buildExpr(child)(env)())
    );
  } else if (isOptional(expr)) {
    return () => optional(
      buildExpr(expr.children[0])(env)(),
    );
  } else if (isAnyChar(expr)) {
    return () => anyChar();
  } else if (isCharClass(expr)) {
    const charClassElements = expr.children.map(element => {
      if (isChar(element)) {
        return element.value;
      } else if (isRange(element)) {
        return element.value;
      }

      throw new Error(`Unknown char class element: ${element}`);
    });

    if (isNonEmptyArray(charClassElements)) {
      return () => charClass(...charClassElements);
    }

    throw new Error('CharClassElements should be non-empty');
  } else if (isAndPredicate(expr)) {
    return () => andPredicate(buildExpr(expr.children[0])(env)());
  } else if (isNotPredicate(expr)) {
    return () => notPredicate(buildExpr(expr.children[0])(env)());
  } else if (isMapping(expr)) {
    return () => map(buildExpr(expr.children[0])(env)(), expr.data);
  }

  throw new Error(`Unknown expr: ${expr.type}`);
}

const build = (grammar: Grammar) => {
  const env: Record<string, () => Parser<unknown>> = {};

  for (const definition of grammar.children) {
    const [id, expr] = definition.children;

    env[id.value] = buildExpr(expr)(env);
  }

  return env;
}

export const evalAst = (grammar: Grammar, entry: string) => {
  const definitions = build(grammar);

  return definitions[entry]();
}
