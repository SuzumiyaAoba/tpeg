import { describe, expect, test } from "vite-plus/test";
import { scanBalancedBraces as handActionBlock } from "../brace-scanner";
import { actionBlock as genActionBlock } from "./generated/action.generated";

const pos = 0;

describe("self-hosted action-block grammar vs brace-scanner.ts", () => {
  const cases = [
    "{}",
    "{ return 1; }",
    '{ return "}"; }',
    "{ return '}'; }",
    "{ return `${a}-${b}`; }",
    "{ const x = { a: 1, b: { c: 2 } }; return x; }",
    "{ // a comment with a } inside\n return 1; }",
    "{ /* block comment with } inside */ return 1; }",
    '{\n  const value = { parsed: parseInt(digits.join("")) };\n  return value.parsed;\n}',
    '{ return "\\"}\\""; }',
    "no brace here",
    "{ unterminated",
    // Regex literals: `}` or a quote inside a `/.../ ` must not be
    // miscounted (issue #51) -- and a `/` after an operand is division.
    "{ return /}/.test('a'); }",
    "{ return s.replace(/\"/g, 'x'); }",
    "{ const re = /}/; return re.test('a'); }",
    "{ return /[}]/.test('a'); }",
    "{ return s.replace(/\\}/g, 'x'); }",
    "{ return a / b / c; }",
    "{ return arr[i] / 2; }",
    '{ if (a) { return /}/; } return /"/.test(b); }',
    "{ /re/g.test(x) }",
    "{ x = {a:1} /re/; }",
    "{ y = x++ / 2; z = a-- / 3; }",
    "{ xreturn /re/; }",
    "{ a = b /* c */ /d/; }",
    "{ x = () => /}/; }",
    "{ for (const m of s.matchAll(/}/g)) {} }",
    "{ if (x) /re/; }",
    "{ x = /unterminated\n }",
    // Nested `${ ... }` interpolation inside a template literal --
    // including a nested template literal, an object literal, and a
    // call whose argument is itself a template (issue #103)
    "{ return `a${`b}c`}d`; }",
    "{ return `a${x}b`; }",
    "{ return `${ {a:1} }`; }",
    "{ return `pre ${fn(`in${1}ner`)} post`; }",
    "{ return `unterminated${x`; }",
    // A regex literal right after a statement keyword's parenthesized
    // header -- `)` here restores "value expected" (issue #104), unlike
    // a call/grouping `)` where `/` is division
    "{ if (x) /}/.test(y); }",
    "{ while (t) /{/.exec(s); }",
    "{ for (const m of x) /}/g.test(m); }",
    "{ if ((a && b)) /}/.test(y); }",
    "{ switch (v) { case 1: /}/.test(s); } }",
    "{ foo(x) / re / 2; }",
    "{ if (x) doThing(); }",
  ];

  for (const input of cases) {
    test(JSON.stringify(input), () => {
      const a = handActionBlock(input, pos);
      const b = genActionBlock(input, pos);
      expect(a.success).toBe(b.success);
      if (a.success && b.success) {
        expect(b.val).toEqual(a.val);
        expect(b.next).toEqual(a.next);
      }
    });
  }
});
