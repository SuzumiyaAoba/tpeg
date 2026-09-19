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
  // a label only exists if the WHOLE `name:expr` matches -- on failure
  // the parse falls back to the unlabeled `prefix` alternative, matching
  // the self-hosted `labeled = label:identifierName ":" expr:prefix /
  // prefix` (whitespace between name and ":" is not allowed on either
  // side, so all of these fall back to a bare `name`/`x`/`a` prefix)
  "x:!",
  "x:(",
  "x:*",
  "name:",
  'name: "a"',
  'name :"a"',
  'x: &"a"',
  'x: !"a"',
  'a: "x" b:"y"',

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
  // the same rejections inside a group/label/lookahead must abort the
  // WHOLE parse, not degrade to a partial success: the generated parser
  // signals them with a `throw` that escapes every enclosing boundary,
  // so the hand-written parser marks them `abort` (not merely `fatal`,
  // which `choice`/`optional`/lookahead boundaries would absorb)
  '("b" {2})',
  '"a" ("b" {2})?',
  'x:("b" {2})',
  '!("a" {2})',
  '"x" ("a"{5,2})?',
  '"a" [z-a]',
  '"x" [z-a]',

  // `notNextRuleStart`: `identifier <ws/comments> =` can't continue a
  // sequence (`=` never starts an element) -- it's the next rule's
  // header, so the continuation stops BEFORE the identifier rather than
  // consuming it and stranding the `=`. Applies to continuations only:
  // a sequence's/alternative's first element is unguarded on both sides.
  '"a"name="b"',
  "'b'x=\"",
  '"a" name = "b"',
  '"a" name="b"',
  '"a" / x="b"', // `x` after `/` is an alternative's first element: unguarded
  "name x=", // `name` continues the sequence; `x=` is the boundary

  // `@expr` -- the source-span operator, a third prefix operator
  // alongside `&`/`!` (same postfix-level operand, can't stack). At the
  // bare-expression level EVERY `@` is this operator: the annotation
  // disambiguation lives in the grammar-block scanner
  // (isAnnotationStartAt / the grammar layer's `annotationStart`), which
  // `expression()` never sees -- so `@x:`/`@x` before a rule header
  // still parse as spans here, with `:`/`x =` left stranded.
  '@"a"',
  "@x",
  '@(x / "a")',
  "@x+",
  'x:@y "b"',
  '"a" @x',
  '"a" @x\nx = "b"', // span of `x`, then `x =` is the notNextRuleStart boundary
  '"a" @x:', // span of `x`; the `:` is stranded on both sides
  '@x="b"', // first element unguarded: span of `x`, `=` stranded
  "@noskip", // bare `@identifier` -- a span here, an annotation only at grammar-item level

  // `\b`/`\B` -- word-boundary assertions (word-boundary.ts's
  // wordBoundaryMarker leaf). An escaped `\b` inside a string or
  // character class stays the backspace escape (namedEscape), so the
  // assertion syntax only ever appears bare.
  "\\b",
  "\\B",
  "\\b w:[a-z]+ \\b",
  '"a" \\B "b"',
  "@\\b", // span of a zero-width assertion: `@`'s operand is postfix-level

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
