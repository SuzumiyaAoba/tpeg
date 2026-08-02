/**
 * `regexFused`: a leaf `Parser` backed by a single sticky `RegExp`, for
 * PEG subexpressions that contain no non-terminal references (no
 * `Identifier`/`QualifiedIdentifier`/`ActionExpression`/
 * `LabeledExpression`/lookahead/`Cut`) -- such a subexpression denotes a
 * regular language, so it can be compiled to one DFA-backed match instead
 * of a tree of combinator calls that each allocate a `ParseSuccess`
 * per character consumed.
 *
 * This module only performs the match and hands back the raw capture
 * groups -- it has no idea what PEG node produced `source`, so it cannot
 * (and does not try to) reconstruct a `Sequence`'s tuple shape or a
 * `Star`'s array shape. That reconstruction is codegen's job (see
 * `packages/parser/src/regex-fusion.ts`), built from the *same* AST
 * subtree that generated `source`, wrapped around this parser with
 * `map`. Soundness (this regex's greedy/backtracking behavior coinciding
 * with PEG's possessive one) is also codegen's responsibility, decided
 * before `source` is ever generated -- this module trusts its caller
 * completely and does no validation of `source` itself.
 */

import type { Parser } from "./types";
import { advancePos, createFailure, getCharAt } from "./utils";

/** The raw result of a successful `regexFused` match: `text` is the
 * whole match (`RegExpExecArray[0]`), `groups` is every capturing group
 * in the pattern (`RegExpExecArray.slice(1)`, in source order) -- an
 * entry is `undefined` exactly when that group's alternative/optional
 * branch didn't participate in the match. */
export interface FusedMatch {
  readonly text: string;
  readonly groups: readonly (string | undefined)[];
}

/**
 * Builds a `Parser<FusedMatch>` from `source`, a regex source string
 * (no delimiters/flags) meant to match starting exactly at the current
 * position. Constructs the `RegExp` once (sticky `y` so `exec` only
 * matches right at `lastIndex`, never searching forward; `u` so
 * `\u{...}` escapes and per-code-point character classes behave as
 * `packages/parser/src/char-set.ts`'s code-point-based `CharSet` assumes).
 *
 * `description` is used only for the failure message (`Expected
 * <description>`) -- it has no effect on matching.
 */
export const regexFused = (
  source: string,
  description: string,
): Parser<FusedMatch> => {
  const re = new RegExp(source, "yu");
  return (input: string, pos: number) => {
    re.lastIndex = pos;
    const m = re.exec(input);
    if (m === null) {
      const found = getCharAt(input, pos) || "end of input";
      return createFailure(`Expected ${description}`, pos, {
        expected: description,
        found,
        parserName: "regexFused",
      });
    }
    const text = m[0];
    return {
      success: true,
      val: { text, groups: m.slice(1) as (string | undefined)[] },
      current: pos,
      next: advancePos(text, pos),
    };
  };
};
