import { describe, expect, test } from "bun:test";
import { expression as handExpression } from "../composition";
import { choiceExpr as genExpression } from "./generated/composition.generated";

const pos = { offset: 0, line: 1, column: 1 };

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

  // failure cases
  "",
  "@invalid",
];

describe("self-hosted composition grammar vs composition.ts's expression()", () => {
  for (const input of cases) {
    test(JSON.stringify(input), () => {
      const a = handExpression()(input, pos);
      const b = genExpression(input, pos);
      expect(a.success).toBe(b.success);
      if (a.success && b.success) {
        expect(b.val).toEqual(a.val);
        expect(b.next).toEqual(a.next);
      }
    });
  }
});
