/**
 * Combined entry-level parsers for TPEG grammar syntax.
 *
 * The building-block parsers in `string-literal.ts`, `character-class.ts`,
 * `identifier.ts`, `module.ts`, `composition.ts`, `grammar.ts`,
 * `transforms.ts` are composed here into the three public entry points
 * this package exposes: `basicSyntax` (any basic syntax element),
 * `tpegExpression` (any expression), and `tpegFile` (a whole `.tpeg`
 * file). Kept out of `index.ts` so that module stays a pure
 * re-export barrel.
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  choice as coreChoice,
  map,
  sequence,
  star,
} from "@suzumiyaaoba/tpeg-core";
import { characterClass } from "./character-class";
import { expression } from "./composition";
import { grammarDefinition } from "./grammar";
import { identifier } from "./identifier";
import { qualifiedIdentifier } from "./module";
import { stringLiteral } from "./string-literal";
import { transformDefinition } from "./transforms";
import type { BasicSyntaxNode, GrammarDefinition } from "./types";
import { optionalWhitespaceOrComment } from "./whitespace-utils";
import { wordBoundaryMarker } from "./word-boundary";

/**
 * Combined parser for all basic TPEG syntax elements.
 * Attempts to parse string literals, character classes, qualified
 * identifiers (`module.rule`), or plain identifiers.
 *
 * @returns Parser<BasicSyntaxNode> Parser that matches any basic syntax element
 *
 * @example
 * ```typescript
 * const result1 = basicSyntax('"hello"', 0);
 * // result1.success === true, result1.val.type === "StringLiteral"
 *
 * const result2 = basicSyntax('[a-z]', 0);
 * // result2.success === true, result2.val.type === "CharacterClass"
 *
 * const result3 = basicSyntax('identifier', 0);
 * // result3.success === true, result3.val.type === "Identifier"
 *
 * const result4 = basicSyntax('math.expr', 0);
 * // result4.success === true, result4.val.type === "QualifiedIdentifier"
 * ```
 */
export const basicSyntax: Parser<BasicSyntaxNode> = coreChoice(
  stringLiteral,
  characterClass,
  qualifiedIdentifier,
  identifier,
  // `\b` / `\B` word-boundary assertions -- tried last since no other
  // basic syntax begins with a backslash.
  wordBoundaryMarker,
);

/**
 * Combined parser for all TPEG expression elements including composition operators.
 * Supports sequences, choices, groups, and basic syntax elements.
 *
 * @returns Parser<Expression> Parser that matches any TPEG expression
 *
 * @example
 * ```typescript
 * // Parse basic syntax
 * const result1 = tpegExpression('"hello"', 0);
 *
 * // Parse sequence
 * const result2 = tpegExpression('"hello" " " "world"', 0);
 *
 * // Parse choice
 * const result3 = tpegExpression('"true" / "false"', 0);
 *
 * // Parse group with complex precedence
 * const result4 = tpegExpression('("a" / "b") "c"', 0);
 * ```
 */
export const tpegExpression = expression();

/**
 * Parses a complete `.tpeg` file: a single `grammar Name { ... }` block,
 * optionally followed by one or more `transforms Name@language { ... }`
 * blocks. The transforms are attached to the returned grammar's
 * `transforms` array, exactly as `GrammarDefinition.transforms` expects,
 * so the result can be passed directly to `generateTypeScriptParser` (or
 * the optimized/Eta generators) to get transform-aware generated code.
 *
 * @example
 * ```typescript
 * const result = parse(tpegFile)(`
 *   grammar Calculator {
 *     number = [0-9]+
 *   }
 *
 *   transforms Evaluator@typescript {
 *     number(captures: string) -> Result<number> {
 *       return { success: true, value: parseInt(captures, 10) };
 *     }
 *   }
 * `);
 * ```
 */
export const tpegFile: Parser<GrammarDefinition> = map(
  sequence(
    grammarDefinition,
    star(
      map(
        sequence(optionalWhitespaceOrComment, transformDefinition),
        ([, transform]) => transform,
      ),
    ),
  ),
  ([grammar, transforms]) => ({
    ...grammar,
    ...(transforms.length > 0
      ? { transforms: [...(grammar.transforms ?? []), ...transforms] }
      : {}),
  }),
);
