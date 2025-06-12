/**
 * TPEG Identifier Parser
 *
 * Implements parsing of identifiers for rule references.
 * Based on docs/peg-grammar.md specification.
 */

import type { Parser } from "tpeg-core";
import { charClass, map, oneOrMore, seq, zeroOrMore } from "tpeg-core";
import type { Identifier } from "./types";

/**
 * Parses the first character of an identifier.
 * Must be a letter or underscore.
 */
const identStart: Parser<string> = charClass(["a", "z"], ["A", "Z"], "_");

/**
 * Parses continuation characters of an identifier.
 * Can be letters, digits, or underscores.
 */
const identCont: Parser<string> = charClass(["a", "z"], ["A", "Z"], ["0", "9"], "_");

/**
 * Parses a complete identifier.
 * Identifiers start with a letter or underscore, followed by letters, digits, or underscores.
 *
 * @returns Parser<Identifier> Parser that matches identifiers
 *
 * @example
 * ```typescript
 * const result1 = identifier()("expression", { offset: 0, line: 1, column: 1 });
 * // result1.success === true, result1.val.type === "Identifier"
 * // result1.val.name === "expression"
 *
 * const result2 = identifier()("_private", { offset: 0, line: 1, column: 1 });
 * // result2.success === true, result2.val.name === "_private"
 *
 * const result3 = identifier()("rule123", { offset: 0, line: 1, column: 1 });
 * // result3.success === true, result3.val.name === "rule123"
 * ```
 */
export const identifier: Parser<Identifier> = map(
  seq(
    identStart,
    map(zeroOrMore(identCont), (chars) => chars.join("")),
  ),
  ([first, rest]) => ({
    type: "Identifier" as const,
    name: first + rest,
  }),
);
