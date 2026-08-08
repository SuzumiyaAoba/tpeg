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

import type { Expectation } from "./failure";
import { fail } from "./failure";
import type { Parser } from "./types";
import { advancePos } from "./utils";

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
  // One `Expectation` per `regexFused(...)` call (construction time), not
  // per attempted match -- see `./failure.ts`'s `Expectation` doc comment.
  const expectation: Expectation = {
    label: description,
    parserName: "regexFused",
  };
  return (input: string, pos: number) => {
    re.lastIndex = pos;
    const m = re.exec(input);
    if (m === null) {
      return fail(input, pos, expectation);
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

/**
 * `map(regexFused(source, description), f)` collapsed into one parser:
 * one `ParseSuccess`, no intermediate `FusedMatch` object, and no
 * `m.slice(1)` copy of the capture groups -- `f` reads groups directly
 * off the raw `RegExpExecArray` (group `i` is `m[i + 1]`, `m[0]` is the
 * whole match, exactly `RegExp.exec`'s own indexing).
 *
 * Exists purely to shave allocations off `regexFused`'s already-hot path
 * once sub-expression fusion (`packages/parser/src/regex-fusion.ts`)
 * makes it common for many small fused nodes to exist per parse rather
 * than a handful of whole-rule ones: each `regexFused` + `map` pairing
 * costs a `FusedMatch` + `m.slice(1)` + two separate `ParseSuccess`
 * objects (one from `regexFused`, one from `map`); this costs one
 * `ParseSuccess` and nothing else. Semantically identical to
 * `map(regexFused(source, description), (m) => f(rawMatchArray))` for a
 * `f` written against `m.groups`/`m.text` translated to `m[i+1]`/`m[0]` --
 * codegen is responsible for emitting `f` in the right indexing (see
 * `regex-fusion.ts`'s `emit`, whose `valueExpr` this backs).
 */
export const regexFusedMap = <T>(
  source: string,
  description: string,
  f: (m: RegExpExecArray) => T,
): Parser<T> => {
  const re = new RegExp(source, "yu");
  const expectation: Expectation = {
    label: description,
    parserName: "regexFused",
  };
  return (input: string, pos: number) => {
    re.lastIndex = pos;
    const m = re.exec(input);
    if (m === null) {
      return fail(input, pos, expectation);
    }
    return {
      success: true,
      val: f(m),
      current: pos,
      next: advancePos(m[0], pos),
    };
  };
};
