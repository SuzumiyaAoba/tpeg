/**
 * TPEG Word-Boundary Assertion Parser
 *
 * Implements parsing of the expression-level `\b` / `\B` word-boundary
 * assertions. Based on docs/peg-grammar.md specification.
 *
 * `\b` is a zero-width assertion that succeeds when the current position
 * sits on a word boundary (a word character on exactly one side); `\B`
 * is its negation. Both are leaf expressions -- inside a string literal
 * or character class the same `\b` escape still decodes to the backspace
 * character, exactly the regex convention where `[\b]` is backspace but
 * a bare `\b` is a boundary.
 */

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { charClass, literal, map, seq } from "@suzumiyaaoba/tpeg-core";
import type { WordBoundary } from "./types";
import { createWordBoundary } from "./types";

/**
 * Parses a word-boundary assertion marker: `\b` (boundary) or `\B`
 * (non-boundary), at expression level.
 *
 * Any other `\x` sequence at expression level fails here -- and then
 * fails the enclosing `basicSyntax` choice too, since no other leaf
 * begins with a backslash. Escaped single characters (`\n`, `\\`,
 * `\"`) are NOT expression syntax: write the corresponding string
 * literal (`"\n"`) instead.
 */
export const wordBoundaryMarker: Parser<WordBoundary> = map(
  seq(literal("\\"), charClass("b", "B")),
  ([, letter]): WordBoundary => createWordBoundary(letter === "B"),
);
