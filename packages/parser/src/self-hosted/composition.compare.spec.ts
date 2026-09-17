import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { describe, expect, test } from "vite-plus/test";
import { expression as handExpression } from "../composition";
import { choiceExpr as genExpression } from "./generated/composition.generated";

const pos = 0;

/**
 * A generated parser's semantic action has no way to produce a
 * backtrackable ParseFailure, so the self-hosted grammar encodes
 * "reject this input" checks (backwards char ranges, reversed/overflowing
 * quantifier bounds, quantifier-shaped action blocks) as thrown Errors --
 * those propagate out of the generated parser where the hand-written
 * parser returns a failure. Both reject the input; normalize a throw to
 * `success: false` so the comparison covers that.
 */
const callGen = (parser: Parser<unknown>, input: string) => {
  try {
    return parser(input, pos);
  } catch {
    return { success: false as const };
  }
};

const cases = [
  // leaf constructs
  '"hello"',
  "identifier",
  "module.rule",
  "[a-z]",
  "[^0-9]",
  ".",

  // groups
  '("a" / "b")',
  '("a" / "b") "c"',

  // lookahead
  '&"a"',
  '!"a"',
  "&[a-z]",
  "!(module.rule)",

  // repetition
  '"a"*',
  '"a"+',
  '"a"?',
  "[0-9]{3}",
  "[0-9]{3,}",
  "[0-9]{3,5}",
  '&"a"*',

  // labels
  'name:"hello"',
  "value:[0-9]+",
  'sign:("+" / "-")',

  // sequences (with and without whitespace, single vs multi-line)
  '"a" "b" "c"',
  "[a-z][0-9]*",
  'first:"a" second:"b" third:"c"',
  'left:number "+" right:number',
  '"a"\n  "b"',

  // choices
  '"true" / "false"',
  'a:"x" / b:"y"',

  // precedence interplay
  '"a"+ "b"',
  '("a" / "b")* "c"',
  'left:term "+" right:term',

  // actions
  'digits:[0-9]+ { return parseInt(digits.join(""), 10); }',
  'left:"a" right:"b" { return left + right; }',
  '"a" { return 1; } / "b" { return 2; }',
  '"a" { return "}"; }',
  '"a" "b"', // no action - should stay a Sequence, not ActionExpression

  // `~` cut/commit markers as sequence elements (issue #98)
  '"a" ~ "b"',
  '"a" ~ "b" / "c"',
  "~",
  'name:"a" ~ value:"b"',

  // comments between expression elements (issues #97/#99) -- the
  // hand-written parser's `whitespace` is comment-tolerant
  '"a" /* c */ "b"',
  '"a" // line\n "b"',
  '("a" /* c */ / "b")',
  '"a"\n/* c */\n/ "b"',
  '"a" /* c */ { return 1; }',
  '"a"{ return 1; }', // adjacent action, no space -- valid on both sides

  // rejected quantifier syntax (issue #96): reversed ranges, a missing
  // minimum, a second operator chained on, a bound beyond MAX_SAFE_INTEGER
  '"a"{5,2}',
  '"a"{,3}',
  '"a"{2}{4}',
  '"a"**',
  '"a"?+',
  '"a"{}',
  '"a"{2,3,4}',
  '"a"{99999999999999999999}',
  // a VALID quantifier body with a space before "{" reads like an action
  // but is rejected as ambiguous on both sides (issue #100)
  '"a" {2}',
  '"a" {2,}',
  '"a" {2,5}',
  // a spaced "{...}" whose content isn't quantifier-shaped is a real action
  '"a" {x}',
  '"a" {,3}', // ",3" isn't quantifier-shaped (no leading digit) -> action

  // failure cases
  "",
  "@invalid",
];

describe("self-hosted composition grammar vs composition.ts's expression()", () => {
  for (const input of cases) {
    test(JSON.stringify(input), () => {
      const a = handExpression()(input, pos);
      const b = callGen(genExpression, input);
      expect(a.success).toBe(b.success);
      if (a.success && b.success) {
        expect(b.val).toEqual(a.val);
        expect(b.next).toEqual(a.next);
      }
    });
  }
});
